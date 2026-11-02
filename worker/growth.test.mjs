import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { withStore } from "./store.js";
import { matchFromText, accountFromText, refOf, noteReferral, rewardReferral, referralFromStart, startPayload, bumpStreak, streakPrize, growthView, weekSummary, digestText, weeklyDigest } from "./growth.js";
import { getWallet } from "./pay.js";
import { trackUser, onRealAnalysis } from "./coach.js";

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

const env0 = () => withStore({ DB: fakeD1(), COACH_KV: fakeKV(), OWNER_TG_IDS: "5" });
const tgLog = () => { const sent = []; const tg = async (m, b) => { sent.push({ m, ...b }); return { ok: true }; }; return { sent, tg }; };
const at = (day, hh = 12) => Date.parse(`${day}T${String(hh).padStart(2, "0")}:00:00+03:00`);

test("ID матча: голое число больше 2^32 или ссылка; Friend ID и мусор — нет", () => {
  assert.equal(matchFromText("8012800381"), 8012800381);
  assert.equal(matchFromText(" 8012800381\n"), 8012800381);
  assert.equal(matchFromText("123456789"), null);      // Friend ID
  assert.equal(matchFromText("1234567890"), null);     // всё ещё 32 бита
  assert.equal(matchFromText("76561198000000000"), null); // Steam64
  assert.equal(matchFromText("глянь https://www.opendota.com/matches/7999999999 плиз"), 7999999999);
  assert.equal(matchFromText("https://stratz.com/match/8012800381"), 8012800381);
  assert.equal(matchFromText("dotabuff.com/matches/80128003812345"), null);
  assert.equal(matchFromText("привет"), null);
  assert.equal(matchFromText(undefined), null);
});

test("Friend ID и ссылки на профиль в личку — кнопка привязки, а не пересылка владельцу", () => {
  assert.equal(accountFromText("123456789"), 123456789);
  assert.equal(accountFromText("123 456 789"), 123456789);
  assert.equal(accountFromText("76561198083545766"), 123280038);
  assert.equal(accountFromText("https://steamcommunity.com/profiles/76561198083545766/"), 123280038);
  assert.equal(accountFromText("мой профиль https://www.dotabuff.com/players/801280038"), 801280038);
  assert.equal(accountFromText("8012800381"), null);   // это матч
  assert.equal(accountFromText("12"), null);
  assert.equal(accountFromText("привет 123456789 как дела"), null);
  assert.equal(accountFromText(""), null);
  // сначала матч: ссылка на матч остаётся матчем
  assert.equal(matchFromText("https://www.dotabuff.com/matches/8012800381"), 8012800381);
});

// trackUser шлёт письма через fetch Телеграма: подменяем и собираем, кому ушло
async function withTgFetch(fn) {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, result: {} }), text: async () => "{}" }; };
  try { await fn(calls); } finally { globalThis.fetch = real; }
  return calls;
}

test("рефералка: бонус обоим, как только друг впервые запустил по ссылке; один раз", async () => {
  const env = env0(), { tg } = tgLog();
  env.BOT_TOKEN = "1:x";
  assert.equal(refOf("r42"), "42");
  assert.equal(refOf("m123_s1"), null);
  // ссылку только отправили — ничего
  assert.equal((await getWallet(env, 42)).c, 0);
  const calls = await withTgFetch(async () => {
    // первый запуск по ссылке друга 42 — сразу обоим по разбору
    await trackUser(env, { id: 77, first_name: "Пудж" }, { open: true, src: "r42" });
    // повторный заход по другой ссылке ничего не меняет и второй бонус не даёт
    await trackUser(env, { id: 77 }, { open: true, src: "r43" });
    await trackUser(env, { id: 77 }, { open: true, src: "r42" });
  });
  assert.equal(await env.COACH_KV.get("ref:77"), "42");
  assert.equal((await getWallet(env, 77)).c, 1);
  assert.equal((await getWallet(env, 42)).c, 1);
  assert.equal((await getWallet(env, 43)).c, 0);
  assert.equal(await env.COACH_KV.get("refn:42"), "1");
  assert.deepEqual(calls.map((x) => x.chat_id).sort(), [42, 77]);
  assert.match(calls.find((x) => x.chat_id === 42).text, /^Пудж запустил бота по твоей ссылке/);
  // и разбор потом второй раз не даёт
  assert.equal(await rewardReferral(env, tg, 77), null);
  // сам себя не зовёт
  assert.equal(await noteReferral(env, 9, "r9"), null);
  // старый юзер по ссылке — не реферал
  await trackUser(env, { id: 88 }, { open: true });
  await trackUser(env, { id: 88 }, { open: true, src: "r42" });
  assert.equal(await env.COACH_KV.get("ref:88"), null);
  assert.equal(await rewardReferral(env, tg, 88), null);
  // уже привязал аккаунт через бота — тоже не новый
  await env.COACH_KV.put("user:99", JSON.stringify({ account_id: 1 }));
  assert.equal(await noteReferral(env, 99, "r42"), null);
  assert.equal((await growthView(env, 42)).ref_n, 1);
  assert.equal((await growthView(env, 42)).ref_link, "https://t.me/DotaRazbor_bot?startapp=r42");
});

test("рефералка: два события разом — бонус один раз", async () => {
  const env = env0(), { tg } = tgLog();
  await noteReferral(env, 77, "r42");
  const [a, b] = await Promise.all([rewardReferral(env, tg, 77), rewardReferral(env, tg, 77)]);
  assert.ok(Boolean(a) !== Boolean(b));
  assert.equal((await getWallet(env, 42)).c, 1);
});

test("рефералка через /start r<id> в боте: новый человек — бонус, повтор и старый — нет", async () => {
  const env = env0(), { sent, tg } = tgLog();
  assert.equal(startPayload("/start r42"), "r42");
  assert.equal(startPayload("/start"), null);
  assert.equal((await referralFromStart(env, tg, { id: 55, first_name: "Инвокер" }, "/start r42")).by, "42");
  assert.equal(await referralFromStart(env, tg, { id: 55 }, "/start r42"), null);
  assert.equal(await referralFromStart(env, tg, { id: 42 }, "/start r42"), null);
  await env.COACH_KV.put("seen:66", "1");
  assert.equal(await referralFromStart(env, tg, { id: 66 }, "/start r42"), null);
  assert.equal((await getWallet(env, 55)).c, 1);
  assert.equal((await getWallet(env, 42)).c, 1);
  assert.equal(sent.length, 2);
  // потом открыл приложение — второго бонуса нет
  await withTgFetch(async () => { env.BOT_TOKEN = "1:x"; await trackUser(env, { id: 55 }, { open: true, src: "r42" }); });
  assert.equal((await getWallet(env, 42)).c, 1);
});

test("рефералка: после 20 друзей пригласившему больше не капает, другу — да", async () => {
  const env = env0(), { tg } = tgLog();
  await env.COACH_KV.put("refn:42", "20");
  await noteReferral(env, 100, "r42");
  const got = await rewardReferral(env, tg, 100);
  assert.equal(got.inviter, false);
  assert.equal((await getWallet(env, 100)).c, 1);
  assert.equal((await getWallet(env, 42)).c, 0);
});

test("серия: подарок на 3-й день подряд и на 10-й, пропуск дня обнуляет, день считается раз", async () => {
  const env = env0(), { sent, tg } = tgLog();
  assert.deepEqual([1, 2, 3, 4, 9, 10, 11, 17, 24].filter(streakPrize), [3, 10, 17, 24]);
  assert.equal((await bumpStreak(env, tg, 7, at("2026-11-01", 10))).n, 1);
  assert.equal((await bumpStreak(env, tg, 7, at("2026-11-01", 23))).n, 1);
  assert.equal((await bumpStreak(env, tg, 7, at("2026-11-02", 0))).n, 2);
  const third = await bumpStreak(env, tg, 7, at("2026-11-03", 9));
  assert.equal(third.n, 3);
  assert.equal(third.prize, true);
  assert.equal((await bumpStreak(env, tg, 7, at("2026-11-03", 20))).prize, false);
  assert.equal((await getWallet(env, 7)).c, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Серия 3 дня подряд/);
  assert.match(sent[0].text, /на 10-й день/);
  // вид в приложении: серия жива назавтра, сгорает через день
  assert.equal((await growthView(env, 7, at("2026-11-04"))).streak, 3);
  assert.equal((await growthView(env, 7, at("2026-11-04"))).streak_today, false);
  assert.equal((await growthView(env, 7, at("2026-11-05"))).streak, 0);
  assert.equal((await bumpStreak(env, tg, 7, at("2026-11-05"))).n, 1);
  assert.equal((await env.COACH_KV.get("streak:7", "json")).best, 3);
});

test("разбор из приложения (match_real): серия и бонус другу через трекинг", async () => {
  const env = env0();
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, result: {} }), text: async () => "{}" }; };
  try {
    env.BOT_TOKEN = "1:x";
    // пришёл по ссылке до 03.11: ref записан, бонуса не было — выдаётся на первом разборе
    await env.COACH_KV.put("ref:77", "42");
    await trackUser(env, { id: 77 }, { open: true });
    const got = await onRealAnalysis(env, 77, at("2026-11-02"));
    assert.equal(got.streak.n, 1);
    assert.equal(got.ref.by, "42");
  } finally { globalThis.fetch = real; }
  assert.equal((await getWallet(env, 42)).c, 1);
});

const M = (id, daysAgo, win, deaths, kills = 5, now = at("2026-11-09", 11)) => ({
  match_id: id, start_time: Math.floor((now - daysAgo * 86400_000) / 1000), player_slot: 1, radiant_win: win, deaths, kills, assists: 3,
});

test("сводка недели: итоги за 7 дней и худшая проигранная", () => {
  const now = at("2026-11-09", 11);
  const s = weekSummary([M(1, 1, true, 2), M(2, 2, false, 9), M(3, 3, false, 12), M(4, 10, false, 20)], now);
  assert.equal(s.games, 3);
  assert.equal(s.wins, 1);
  assert.equal(s.worst.match_id, 3);
  assert.equal(s.deaths, 7.7);
  const text = digestText(s);
  assert.match(text, /^Твоя неделя в Доте: 3 катки, 1 победа \(33%\)\. В среднем 7,7 смертей/);
  assert.match(text, /катка 3: 5\/12\/3, поражение/);
  assert.equal(weekSummary([M(4, 10, false, 20)], now), null);
  assert.equal(weekSummary(null, now), null);
});

test("сводка недели: по понедельникам, каждому раз, отписавшимся и без аккаунта — нет", async () => {
  const env = env0(), { sent, tg } = tgLog(), kv = env.COACH_KV;
  for (let i = 1; i <= 10; i++) await kv.put(`user:${i}`, JSON.stringify({ account_id: 1000 + i }));
  await kv.put("user:1:a555", JSON.stringify({ account_id: 555 }));
  await kv.put("user:11", JSON.stringify({}));
  await kv.put("nodigest:2", "1");
  const now = at("2026-11-09", 11); // понедельник, 11:00 МСК
  const urls = [];
  const fetcher = async (url) => { urls.push(url); return { ok: true, json: async () => [M(9, 1, false, 8, 5, now)] }; };
  assert.equal(await weeklyDigest(env, tg, at("2026-11-10", 11), fetcher), 0); // вторник
  assert.equal(await weeklyDigest(env, tg, at("2026-11-09", 9), fetcher), 0);  // рано
  const first = await weeklyDigest(env, tg, now, fetcher);
  const second = await weeklyDigest(env, tg, now + 60_000, fetcher);
  const third = await weeklyDigest(env, tg, now + 120_000, fetcher);
  assert.equal(first + second + third, 9); // 11 профилей: 2 отписался, 11 без аккаунта
  assert.equal(new Set(sent.map((x) => x.chat_id)).size, 9);
  assert.ok(!sent.some((x) => x.chat_id === 2 || x.chat_id === 11));
  assert.ok(!urls.some((u) => u.includes("/555/")));
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].web_app.url, "https://bezzz22.github.io/KORPl/?match=9");
  assert.equal(await kv.get("digest:2026-11-09:end"), "1");
  assert.equal(await weeklyDigest(env, tg, now + 180_000, fetcher), 0);
});
