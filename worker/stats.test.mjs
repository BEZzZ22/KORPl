import test from "node:test";
import assert from "node:assert/strict";
import { mergeAct, trackUser, buildReport, reportOnRequest } from "./coach.js";

// KV в памяти: get, getWithMetadata, put с metadata, list по префиксу
function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k).value : null),
    getWithMetadata: async (k) => (m.has(k) ? { value: m.get(k).value, metadata: m.get(k).metadata ?? null } : { value: null, metadata: null }),
    put: async (k, value, opts = {}) => { m.set(k, { value, metadata: opts.metadata }); },
    list: async ({ prefix }) => ({ keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })), list_complete: true }),
  };
}

const at = (day, hh = 12) => Date.parse(`${day}T${String(hh).padStart(2, "0")}:00:00+03:00`);

test("mergeAct складывает и отсекает мусор", () => {
  let a = mergeAct(null, { open: true, secs: 90, events: { analysis: 2, "BAD key": 5, coach: -3 } });
  a = mergeAct(a, { secs: 1e9, events: { analysis: 1 } });
  assert.equal(a.o, 1);
  assert.equal(a.s, 90 + 3 * 3600);
  assert.deepEqual(a.e, { analysis: 3 });
});

test("первый заход пишется один раз, дни — отдельно", async () => {
  const kv = memKV(), env = { COACH_KV: kv };
  await trackUser(env, { id: 1, first_name: "Вася", username: "vasya" }, { open: true, src: "promo" }, at("2026-10-23"));
  await trackUser(env, { id: 1, first_name: "Другое" }, { open: true }, at("2026-10-24"));
  assert.equal(kv.m.get("seen:1").metadata.n, "Вася");
  assert.equal(kv.m.get("seen:1").metadata.src, "promo");
  assert.ok(kv.m.has("act:2026-10-23:1") && kv.m.has("act:2026-10-24:1"));
});

test("отчёт: приток, вернувшиеся, удержание, владелец не считается", async () => {
  const kv = memKV(), env = { COACH_KV: kv, OWNER_TG_IDS: "99" };
  const u = (id) => ({ id, first_name: `Игрок${id}` });
  await trackUser(env, u(1), { open: true, secs: 120, events: { analysis: 2 } }, at("2026-10-23"));
  await trackUser(env, u(2), { open: true }, at("2026-10-23"));
  await trackUser(env, u(1), { open: true, secs: 60, events: { coach: 1 } }, at("2026-10-24"));
  await trackUser(env, u(3), { open: true, secs: 300, events: { analysis: 1, chat: 2 } }, at("2026-10-24"));
  await trackUser(env, u(99), { open: true }, at("2026-10-24"));
  await kv.put("user:1", "{}");
  const text = await buildReport(env, at("2026-10-25", 9));
  assert.match(text, /Отчёт за 24\.10/);
  assert.match(text, /Всего юзеров: 3, новых за день: 1/);
  assert.match(text, /23\.10 2 · 24\.10 1/);
  assert.match(text, /Активных за день: 2 \(новых 1, вернулись 1\)/);
  assert.match(text, /23\.10: 2 → на след\. день 1, за неделю 1/);
  assert.match(text, /— Игрок3: 1 откр\., 5 мин, вопросов тренеру 2, разборов 1/);
  assert.match(text, /Профилей с привязанным аккаунтом: 1/);
  assert.doesNotMatch(text, /Игрок99/);
});

test("заявка report_now отправляет отчёт один раз", async () => {
  const kv = memKV(), sent = [];
  kv.delete = async (k) => { kv.m.delete(k); };
  const env = { COACH_KV: kv, BOT_TOKEN: "x", OWNER_TG_IDS: "5" };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    await kv.put("report_now", "2026-10-24");
    assert.ok(await reportOnRequest(env, at("2026-10-25")));
    assert.equal(await reportOnRequest(env, at("2026-10-25")), null);
  } finally { globalThis.fetch = real; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, "5");
  assert.match(sent[0].text, /Отчёт за 24\.10/);
});
