// Видеоразбор: заявки в боте и очередь для Actions (worker/video.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVideoCommand, requestVideo, videoQueue, videoDone, checkVideo, VIDEO_PER_DAY, VIDEO_TTL } from "./video.js";
import { handleBotUpdate } from "./coach.js";

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const x = m.get(k); if (x == null) return null; return type === "json" ? JSON.parse(x.v) : x.v; },
    async put(k, v, o = {}) { m.set(k, { v: String(v), meta: o.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
}
const setup = () => {
  const sent = [];
  const env = { COACH_KV: fakeKV(), BOT_TOKEN: "1:x", OWNER_TG_IDS: "9" };
  return { env, sent, tg: async (method, body) => { sent.push({ method, ...body }); return true; } };
};
const NOW = Date.UTC(2026, 10, 10, 12);

test("видео: разбор команды /video", () => {
  assert.equal(parseVideoCommand("привет"), null);
  assert.deepEqual(parseVideoCommand("/video"), { match: null, pick: null });
  assert.deepEqual(parseVideoCommand("/video 8123456789"), { match: 8123456789, pick: null });
  assert.deepEqual(parseVideoCommand("/video@DotaRazbor_bot 8123456789 6"), { match: 8123456789, pick: 6 });
  assert.deepEqual(parseVideoCommand("/video https://www.opendota.com/matches/8123456789"), { match: 8123456789, pick: null });
  assert.deepEqual(parseVideoCommand("/video абв"), { match: null, pick: null });
  assert.deepEqual(parseVideoCommand("/video 8123456789 11"), { match: 8123456789, pick: null });
});

test("видео: без привязанного аккаунта заявка не ставится, с аккаунтом — в очередь", async () => {
  const { env, sent, tg } = setup();
  assert.deepEqual(await requestVideo(env, tg, { user: 5, match: 8123456789 }, NOW), { video: "no_account" });
  assert.match(sent[0].text, /Friend ID/);
  assert.deepEqual((await videoQueue(env, NOW)).jobs, []);
  await env.COACH_KV.put("user:5", JSON.stringify({ account_id: 777 }));
  const r = await requestVideo(env, tg, { user: 5, match: 8123456789 }, NOW);
  assert.equal(r.video, "queued");
  assert.deepEqual((await videoQueue(env, NOW)).jobs, [{ match: 8123456789, user: 5, account: 777, slot: null }]);
  // повтор той же заявки не плодит вторую
  assert.equal((await requestVideo(env, tg, { user: 5, match: 8123456789 }, NOW)).video, "busy");
  assert.equal((await videoQueue(env, NOW)).jobs.length, 1);
  assert.equal((await requestVideo(env, tg, { user: 5, match: null }, NOW)).video, "no_match");
});

test("видео: лимит в сутки, неудача его не тратит, владельцу без лимита и можно выбрать игрока", async () => {
  const { env, sent, tg } = setup();
  await env.COACH_KV.put("user:5", JSON.stringify({ account_id: 777 }));
  for (let i = 0; i < VIDEO_PER_DAY; i++) assert.equal((await requestVideo(env, tg, { user: 5, match: 8000000000 + i }, NOW)).video, "queued");
  assert.equal((await requestVideo(env, tg, { user: 5, match: 8000000099 }, NOW)).video, "limit");
  // ролик не собрался: человеку причина, лимит возвращается
  sent.length = 0;
  assert.deepEqual(await videoDone(env, tg, { match: 8000000000, user: 5, status: "error", why: "no_replay" }, NOW), { ok: true, had: true });
  assert.match(sent[0].text, /реплея нет/);
  assert.equal((await requestVideo(env, tg, { user: 5, match: 8000000099 }, NOW)).video, "queued");
  // готовый ролик: заявка снята молча (ролик человеку уже ушёл из Actions)
  sent.length = 0;
  await videoDone(env, tg, { match: 8000000001, user: 5, status: "done" }, NOW);
  assert.equal(sent.length, 0);
  assert.ok(!(await videoQueue(env, NOW)).jobs.some((j) => j.match === 8000000001));
  assert.deepEqual(await videoDone(env, tg, { match: 0, user: 5 }, NOW), { ok: false });
  // на следующий день лимит новый
  assert.equal((await requestVideo(env, tg, { user: 5, match: 8000000100 }, NOW + 86400_000)).video, "queued");
  // владелец: без аккаунта, с местом игрока, без лимита
  for (let i = 0; i < VIDEO_PER_DAY + 2; i++) assert.equal((await requestVideo(env, tg, { user: 9, match: 8100000000 + i, pick: 6, owner: true }, NOW)).video, "queued");
  assert.ok((await env.COACH_KV.get("vq:8100000000:9", "json")).slot === 5);
  // чужой не может выбрать игрока
  assert.equal((await requestVideo(env, tg, { user: 6, match: 8100000000, pick: 6 }, NOW)).video, "no_account");
});

test("видео: зависшая заявка снимается по сроку, человеку приходит сообщение", async () => {
  const { env, sent, tg } = setup();
  await env.COACH_KV.put("user:5", JSON.stringify({ account_id: 777 }));
  await requestVideo(env, tg, { user: 5, match: 8123456789 }, NOW);
  sent.length = 0;
  assert.equal(await checkVideo(env, tg, NOW + 20 * 60 * 1000), 0);
  assert.equal((await videoQueue(env, NOW + 20 * 60 * 1000)).jobs.length, 1);
  assert.equal(await checkVideo(env, tg, NOW + VIDEO_TTL + 1000), 1);
  assert.match(sent[0].text, /не успел/);
  assert.deepEqual((await videoQueue(env, NOW + VIDEO_TTL + 1000)).jobs, []);
});

test("видео: бот — команда /video и кнопка под карточкой матча", async () => {
  const { env } = setup();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null }); return new Response(JSON.stringify({ ok: true, result: {} }), { headers: { "Content-Type": "application/json" } }); };
  try {
    await env.COACH_KV.put("user:5", JSON.stringify({ account_id: 777 }));
    const from = { id: 5, first_name: "A" }, chat = { id: 5, type: "private" };
    const r = await handleBotUpdate(env, { message: { message_id: 1, from, chat, text: "/video 8123456789" } }, NOW);
    assert.equal(r.video, "queued");
    assert.ok(await env.COACH_KV.get("vq:8123456789:5"));
    // номер матча без команды: в ответе есть кнопка «Видеоразбор»
    calls.length = 0;
    await handleBotUpdate(env, { message: { message_id: 2, from, chat, text: "8123456790" } }, NOW);
    const card = calls.find((c) => c.body && c.body.reply_markup);
    assert.equal(card.body.reply_markup.inline_keyboard[1][0].callback_data, "vid:8123456790");
    // нажатие кнопки ставит заявку
    const p = await handleBotUpdate(env, { callback_query: { id: "q", from, data: "vid:8123456790" } }, NOW);
    assert.equal(p.video, "queued");
    assert.ok(await env.COACH_KV.get("vq:8123456790:5"));
  } finally { globalThis.fetch = realFetch; }
});
