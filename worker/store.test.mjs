import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { d1kv, withStore, migrateStep, purgeExpired } from "./store.js";
import { checkWatches, checkReplays, queueReplay, trackUser } from "./coach.js";

// D1 в памяти на node:sqlite с тем же интерфейсом prepare/bind/first/all/run/batch
function fakeD1() {
  const sql = new DatabaseSync(":memory:");
  let queries = 0;
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => { queries++; return sql.prepare(q).get(...args) ?? null; },
    all: async () => { queries++; return { results: sql.prepare(q).all(...args) }; },
    run: async () => { queries++; const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (q) => stmt(q), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; }, queries: () => queries };
}

// KV в памяти: значения, метаданные, срок, постраничный list
function fakeKV() {
  const m = new Map();
  let lists = 0;
  return {
    m,
    lists: () => lists,
    async get(k, type) { const x = m.get(k); if (!x) return null; return type === "json" ? JSON.parse(x.v) : x.v; },
    async getWithMetadata(k) { const x = m.get(k); return x ? { value: x.v, metadata: x.meta ?? null } : { value: null, metadata: null }; },
    async put(k, v, o = {}) { m.set(k, { v, meta: o.metadata, exp: o.expirationTtl ? Math.floor(Date.now() / 1000) + o.expirationTtl : undefined }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      lists++;
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const page = names.slice(from, from + limit);
      const end = from + limit >= names.length;
      return { keys: page.map((name) => ({ name, metadata: m.get(name).meta, expiration: m.get(name).exp })), list_complete: end, ...(end ? {} : { cursor: String(from + limit) }) };
    },
  };
}

test("D1 как KV: значения, метаданные, срок, list по префиксу постранично, удаление", async () => {
  let now = 1_000_000;
  const s = d1kv(fakeD1(), null, () => now);
  await s.put("user:1", JSON.stringify({ a: 1 }));
  assert.deepEqual(await s.get("user:1", "json"), { a: 1 });
  assert.equal(await s.get("нет"), null);
  await s.put("act:d:1", "1", { metadata: { o: 2 }, expirationTtl: 60 });
  assert.deepEqual(await s.getWithMetadata("act:d:1"), { value: "1", metadata: { o: 2 } });
  for (let i = 0; i < 5; i++) await s.put(`watch:${i}:7`, "1", { metadata: { t: i } });
  const p1 = await s.list({ prefix: "watch:", limit: 3 });
  assert.equal(p1.keys.length, 3);
  assert.equal(p1.list_complete, false);
  const p2 = await s.list({ prefix: "watch:", cursor: p1.cursor, limit: 3 });
  assert.deepEqual(p2.keys.map((x) => x.name), ["watch:3:7", "watch:4:7"]);
  assert.equal(p2.list_complete, true);
  assert.deepEqual(p2.keys[0].metadata, { t: 3 });
  await s.delete("watch:3:7");
  assert.equal((await s.list({ prefix: "watch:" })).keys.length, 4);
  now += 61_000;
  assert.equal(await s.get("act:d:1"), null);
  assert.equal((await s.list({ prefix: "act:" })).keys.length, 0);
});

test("переезд: ключ из KV читается и переносится, удаление стирает в обоих, list видит оба", async () => {
  const db = fakeD1(), kv = fakeKV();
  await kv.put("user:5", JSON.stringify({ account_id: 9 }));
  await kv.put("watch:5:7000001", "1", { metadata: { t: 1 } });
  const s = d1kv(db, kv);
  assert.deepEqual(await s.get("user:5", "json"), { account_id: 9 });
  kv.m.delete("user:5");
  assert.deepEqual(await s.get("user:5", "json"), { account_id: 9 }, "уже лежит в D1");
  await s.put("watch:6:7000002", "1", { metadata: { t: 2 } });
  assert.deepEqual((await s.list({ prefix: "watch:" })).keys.map((x) => x.name), ["watch:5:7000001", "watch:6:7000002"]);
  await s.delete("watch:5:7000001");
  assert.ok(!kv.m.has("watch:5:7000001"));
  assert.deepEqual((await s.list({ prefix: "watch:" })).keys.map((x) => x.name), ["watch:6:7000002"]);
});

test("переезд: крон копирует пачками, свежее в D1 не перетирает, после конца KV не трогаем", async () => {
  const db = fakeD1(), kv = fakeKV();
  for (let i = 0; i < 45; i++) await kv.put(`seen:${i}`, "1", { metadata: { t: i } });
  await kv.put("user:1", JSON.stringify({ v: "старое" }));
  await kv.put("card:abc.png", "картинка");
  await kv.put("coach:xyz", "ответ");
  const env = withStore({ DB: db, COACH_KV: kv });
  await env.COACH_KV.put("user:1", JSON.stringify({ v: "новое" }));
  let st;
  for (let i = 0; i < 10 && !(st && st.done); i++) st = await migrateStep(env, Date.now() + i * 1000);
  assert.ok(st.done);
  assert.deepEqual(await env.COACH_KV.get("user:1", "json"), { v: "новое" });
  assert.deepEqual((await env.COACH_KV.getWithMetadata("seen:44")).metadata, { t: 44 });
  // карточки и кэш тренера остаются в KV
  assert.equal(await env.COACH_KV.get("card:abc.png"), "картинка");
  const rows = await db.prepare("SELECT count(*) AS n FROM kv WHERE k LIKE 'card:%' OR k LIKE 'coach:%'").first();
  assert.equal(rows.n, 0);
  // перенос закончен: промах в D1 больше не идёт в KV, list не листает KV
  await kv.put("seen:999", "1");
  const before = kv.lists();
  assert.equal(await env.COACH_KV.get("seen:999"), null);
  await env.COACH_KV.list({ prefix: "seen:" });
  assert.equal(kv.lists(), before);
});

test("без D1 всё как было: env не меняется", () => {
  const env = { COACH_KV: fakeKV() };
  assert.equal(withStore(env), env);
});

test("D1 упала — запрос не падает, работает KV", async () => {
  const kv = fakeKV();
  const broken = { prepare: () => { throw new Error("D1 недоступна"); } };
  const env = withStore({ DB: broken, COACH_KV: kv });
  await env.COACH_KV.put("user:1", "{}");
  assert.equal(await env.COACH_KV.get("user:1"), "{}");
  assert.equal((await env.COACH_KV.list({ prefix: "user:" })).keys.length, 1);
  // деньги в KV не уходят: иначе оплата пропала бы, когда D1 вернётся
  const log = console.log;
  console.log = () => {};
  try {
    await assert.rejects(env.COACH_KV.put("wallet:1", "{}"));
    await assert.rejects(env.COACH_KV.get("pay:abc"));
  } finally { console.log = log; }
  assert.equal(await kv.get("wallet:1"), null);
});

test("просроченное чистится", async () => {
  const db = fakeD1();
  const env = withStore({ DB: db, COACH_KV: fakeKV() });
  await env.COACH_KV.put("hint:1", "1", { expirationTtl: 1 });
  await env.COACH_KV.put("user:1", "{}");
  assert.equal(await purgeExpired(env, Date.now() + 5000), 1);
  assert.equal(await env.COACH_KV.get("user:1"), "{}");
});

test("подписки, очередь реплеев и счётчики работают поверх D1", async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  const tg = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("telegram")) { tg.push(JSON.parse(init.body)); return new Response("{}"); }
    if (u.includes("opendota")) return new Response(JSON.stringify({ players: [{ lh_t: [1] }] }));
    if (u.includes("githubusercontent")) return new Response("", { status: init && init.method === "HEAD" ? 200 : 404 });
    throw new Error(`лишний вызов ${u}`);
  };
  const db = fakeD1(), kv = fakeKV();
  const env = withStore({ DB: db, COACH_KV: kv, BOT_TOKEN: "x" });
  await env.COACH_KV.put("watch:5:7000005", "1", { metadata: { t: Date.now() } });
  assert.equal(await checkWatches(env), 1);
  assert.equal(tg[0].chat_id, 5);
  await queueReplay(env, 7000006, 8);
  assert.equal(await checkReplays(env), 1);
  assert.equal(tg[1].chat_id, 8);
  await trackUser(env, { id: 3, first_name: "Тест" }, { open: true, secs: 10, events: { home: 1 } });
  await trackUser(env, { id: 3 }, { secs: 5, events: { home: 1 } });
  const act = (await env.COACH_KV.list({ prefix: "act:" })).keys[0].metadata;
  assert.deepEqual([act.o, act.s, act.e.home], [1, 15, 2]);
  assert.equal(kv.m.size, 0, "в KV ничего не записано");
});

test("кошелёк: сравнить-и-записать — списание и оплата в одну секунду не затирают друг друга", async () => {
  const { spendUnit, grant, getWallet } = await import("./pay.js");
  const env = withStore({ DB: fakeD1(), COACH_KV: fakeKV() });
  const kv = env.COACH_KV;
  // cas сам по себе: пустой ключ, верное и устаревшее ожидание
  assert.equal(await kv.cas("wallet:1", null, "a"), true);
  assert.equal(await kv.cas("wallet:1", null, "b"), false);
  assert.equal(await kv.cas("wallet:1", "x", "b"), false);
  assert.equal(await kv.cas("wallet:1", "a", "b"), true);
  assert.equal(await kv.get("wallet:1"), "b");
  // гонка: пока списание читает кошелёк, приходит оплата 10 разборов
  await kv.put("wallet:7", JSON.stringify({ c: 3, until: 0, free: 1, d: "", n: 0 }));
  const realGet = kv.get;
  let once = true;
  kv.get = async (k, t) => {
    const v = await realGet(k, t);
    if (once && k === "wallet:7") {
      once = false;
      await grant(env, { from: { id: 7 }, successful_payment: { invoice_payload: "p10:7", currency: "XTR", total_amount: 49, telegram_payment_charge_id: "ch1" } });
    }
    return v;
  };
  const r = await spendUnit(env, "7", "m1");
  kv.get = realGet;
  assert.equal(r.how, "credit");
  assert.equal((await getWallet(env, "7")).c, 12); // 3 − 1 + 10: оплата не пропала
  await r.refund();
  assert.equal((await getWallet(env, "7")).c, 13);
});
