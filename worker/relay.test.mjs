// Выгрузка OpenDota через Actions: что воркер просит принести и что делает с ответами
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { relayTasks, relayRun, mapFetcher, pushText, roundGap, kickRelay, PUSH_GAP } from "./relay.js";
import { handlePartyMessage, partyText } from "./party.js";
import { checkWatches } from "./coach.js";
import { streakReminders } from "./growth.js";
import { trimMatch, trimHeroes, trim } from "../tools/od-relay.mjs";

const gz = (n) => JSON.parse(gunzipSync(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url))).toString("utf8"));
const match = gz("match_9052987576.json.gz");
const heroesRaw = gz("constants.json.gz").heroes;

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const x = m.get(k); if (x == null) return null; return type === "json" ? JSON.parse(x.v) : x.v; },
    async getWithMetadata(k) { const x = m.get(k); return x ? { value: x.v, metadata: x.meta ?? null } : { value: null, metadata: null }; },
    async put(k, v, o = {}) { m.set(k, { v: String(v), meta: o.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: m.get(name).meta ?? null }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

const day = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

test("выгрузка: урезанный матч даёт ту же карточку «Кто слил», что и полный", () => {
  const small = trimMatch(match);
  const heroes = Object.fromEntries(Object.values(trimHeroes(heroesRaw)).map((h) => [h.id, [h.name, h.localized_name]]));
  assert.equal(partyText(small, heroes), partyText(match, heroes));
  assert.ok(JSON.stringify(small).length < JSON.stringify(match).length / 5);
  assert.ok(small.players[0].lh_t != null); // разобранный реплей так и виден разобранным
  assert.equal(trim("/players/1/recentMatches", [{ match_id: 5, kills: 1, junk: [1, 2] }])[0].junk, undefined);
});

test("выгрузка: mapFetcher — есть путь 200, null 404, нет пути 503", async () => {
  const f = mapFetcher({ "/matches/1": { a: 1 }, "/matches/2": null });
  assert.equal((await f("https://api.opendota.com/api/matches/1")).status, 200);
  assert.deepEqual(await (await f("https://api.opendota.com/api/matches/1?x=1")).json(), { a: 1 });
  assert.equal((await f("https://api.opendota.com/api/matches/2")).status, 404);
  assert.equal((await f("https://api.opendota.com/api/matches/3")).status, 503);
});

test("пати-чат: OpenDota режет воркер — бот отвечает кнопкой, а выгрузка превращает ответ в карточку", async () => {
  const kv = fakeKV(), env = { COACH_KV: kv }, calls = [];
  const tg = async (m, b) => { calls.push([m, b]); return m === "sendMessage" ? { message_id: 77 } : true; };
  const msg = { message_id: 5, chat: { id: -100, type: "supergroup" }, from: { id: 1 }, text: "9052987576" };
  const r = await handlePartyMessage(env, tg, msg, Date.now(), async () => ({ ok: false, status: 429 }));
  assert.equal(r.party, "queued");
  assert.ok(kv.m.has("pq:-100:9052987576"));
  const task = await relayTasks(env, Date.now());
  assert.ok(task.paths.includes("/matches/9052987576"));
  assert.ok(task.paths.includes("/constants/heroes"));
  const out = await relayRun(env, tg, { data: { "/matches/9052987576": trimMatch(match), "/constants/heroes": trimHeroes(heroesRaw) } }, Date.now(), {});
  assert.equal(out.party, 1);
  const edit = calls.find(([m]) => m === "editMessageText")[1];
  assert.equal(edit.message_id, 77);
  assert.match(edit.text, /^Катка 9052987576: победа/);
  assert.ok(!kv.m.has("pq:-100:9052987576"));
});

test("«реплей разобран» по выгрузке, заявка на разбор уходит через Actions", async (t) => {
  const kv = fakeKV(), env = { COACH_KV: kv, BOT_TOKEN: "x" }, now = Date.now();
  await kv.put("watch:7:9052987576", "1", { metadata: { t: now - 60_000 } });
  await kv.put("odreq:123456789", "1");
  const task = await relayTasks(env, now);
  assert.ok(task.paths.includes("/matches/9052987576"));
  assert.deepEqual(task.requests, [123456789]);
  const real = globalThis.fetch, sent = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}"); };
  t.after(() => { globalThis.fetch = real; });
  const out = await relayRun(env, async () => true, { data: { "/matches/9052987576": trimMatch(match) }, requested: [123456789] }, now, { checkWatches });
  assert.equal(out.watch, 1);
  assert.match(sent[0].text, /разобран/);
  assert.ok(!kv.m.has("watch:7:9052987576"));
  assert.ok(!kv.m.has("odreq:123456789"));
});

test("пуш после катки: первый обход запоминает, новая свежая катка — пуш, лимит и /nopush", async () => {
  const kv = fakeKV(), env = { COACH_KV: kv }, now = Date.UTC(2026, 10, 6, 15);
  await kv.put("user:7", JSON.stringify({ account_id: 42 }));
  await kv.put("user:8", JSON.stringify({ account_id: 43 }));
  await kv.put("user:9", JSON.stringify({}));
  await kv.put(`act:${day(now)}:7`, "1");
  await kv.put(`act:${day(now - 5 * 86400_000)}:8`, "1");
  const t1 = await relayTasks(env, now);
  assert.deepEqual(t1.users, { 7: 42, 8: 43 });
  assert.equal((await relayTasks(env, now + 60_000)).users, null); // до следующего обхода — без аккаунтов
  const g = (id, end) => [{ match_id: id, player_slot: 0, radiant_win: false, hero_id: 1, kills: 2, deaths: 9, assists: 4, duration: 2400, start_time: Math.floor(end / 1000) - 2400 }];
  const sent = [];
  const tg = async (m, b) => { sent.push(b); return true; };
  await relayRun(env, tg, { data: { "/players/42/recentMatches": g(100, now - 3600_000), "/players/43/recentMatches": g(200, now) }, users: t1.users }, now);
  assert.equal(sent.length, 0); // первый раз только запомнили
  await kv.put("nopush:8", "1");
  const r = await relayRun(env, tg, { data: { "/players/42/recentMatches": g(101, now - 600_000), "/players/43/recentMatches": g(201, now) }, users: t1.users }, now);
  assert.equal(r.push, 1);
  assert.equal(sent[0].chat_id, 7);
  assert.match(sent[0].caption, /поражение, 2\/9\/4, 40 мин/);
  assert.equal(JSON.parse(sent[0].chat_data).d, 9);
  assert.equal(await kv.get("wgt:7:101"), null); // ответ без message_id — карточку не запоминаем
  assert.match(sent[0].reply_markup.inline_keyboard[0][0].web_app.url, /\?match=101$/);
  // старая катка (больше 3 часов) — не пушим
  await relayRun(env, tg, { data: { "/players/42/recentMatches": g(102, now - 5 * 3600_000) }, users: { 7: 42 } }, now);
  assert.equal(sent.length, 1);
  // новая свежая катка через час — молчим: зовём не чаще раза в 60 часов, одним сообщением
  const later = now + 3600_000;
  await relayRun(env, tg, { data: { "/players/42/recentMatches": g(103, later - 600_000) }, users: { 7: 42 } }, later);
  assert.equal(sent.length, 1);
  const soon = now + PUSH_GAP - 60_000;
  await relayRun(env, tg, { data: { "/players/42/recentMatches": g(104, soon - 600_000) }, users: { 7: 42 } }, soon);
  assert.equal(sent.length, 1);
  // прошло 60 часов — снова можно
  const after = now + PUSH_GAP + 60_000;
  const r2 = await relayRun(env, tg, { data: { "/players/42/recentMatches": g(105, after - 600_000) }, users: { 7: 42 } }, after);
  assert.equal(r2.push, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[1].reply_markup.inline_keyboard[0][0].web_app.url, /\?match=105$/);
  assert.match(pushText(g(1, now)[0], { 1: ["npc_dota_hero_antimage", "Anti-Mage"] }), /^Катка на Anti-Mage: поражение/);
});

test("обход реже, когда аккаунтов много: укладываемся в бесплатный лимит OpenDota", () => {
  assert.equal(roundGap(27), 3600_000);
  assert.equal(roundGap(80), 2 * 3600_000);
  assert.ok(roundGap(300) * 0 + (300 * 24 * 3600_000) / roundGap(300) <= 1200);
});

test("выгрузка молчит — воркер запускает workflow, но не чаще раза в 10 минут", async () => {
  const kv = fakeKV(), env = { COACH_KV: kv, GH_TOKEN: "g" }, urls = [];
  const f = async (url) => { urls.push(url); return { ok: true }; };
  assert.equal(await kickRelay(env, Date.now(), f), true);
  assert.equal(await kickRelay(env, Date.now(), f), false);
  assert.match(urls[0], /od-relay\.yml\/dispatches$/);
  await kv.delete("relay_kick");
  await kv.put("relay_seen", String(Date.now()));
  assert.equal(await kickRelay(env, Date.now(), f), false);
});

test("серия сгорит: вечером тем, у кого вчера был разбор и серия от 2 дней", async () => {
  const kv = fakeKV(), env = { COACH_KV: kv }, now = Date.UTC(2026, 10, 6, 17, 30);
  const y = day(now - 86400_000);
  await kv.put("streak:1", JSON.stringify({ d: y, n: 4 }));
  await kv.put("streak:2", JSON.stringify({ d: day(now), n: 5 }));
  await kv.put("streak:3", JSON.stringify({ d: y, n: 1 }));
  await kv.put("streak:4", JSON.stringify({ d: y, n: 2 }));
  await kv.put("nopush:4", "1");
  const sent = [];
  const tg = async (m, b) => { sent.push(b); return true; };
  assert.equal(await streakReminders(env, tg, Date.UTC(2026, 10, 6, 10)), 0); // днём не шлём
  assert.equal(await streakReminders(env, tg, now), 1);
  assert.equal(sent[0].chat_id, 1);
  assert.match(sent[0].text, /^Серия 4 дня подряд сгорит/);
  assert.equal(await streakReminders(env, tg, now + 60_000), 0);
});
