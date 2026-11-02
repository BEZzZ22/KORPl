// Защита чата канала: node --test worker/chatguard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_ID, handleChatUpdate, chatChores, chatStatus, releaseIfPending, spamReason, resetAdminCache } from "./chatguard.js";

function fakeKV() {
  const m = new Map(), meta = new Map();
  return {
    m, meta,
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }; },
    async get(k, type) { if (!m.has(k)) return null; const v = m.get(k); return type === "json" ? JSON.parse(v) : v; },
    async getWithMetadata(k) { return { value: m.has(k) ? m.get(k) : null, metadata: meta.get(k) ?? null }; },
    async put(k, v, opts = {}) { m.set(k, v); meta.set(k, opts.metadata); },
    async delete(k) { m.delete(k); meta.delete(k); },
  };
}

// Bot API: пишет вызовы, админ чата — 1, сообщения получают id по порядку
function fakeTg({ admins = [1], fail = [], start = 1000 } = {}) {
  const calls = [];
  let mid = start;
  const tg = async (method, body) => {
    calls.push({ method, body });
    if (fail.includes(method)) return null;
    if (method === "getChatAdministrators") return admins.map((id) => ({ user: { id }, status: "administrator" }));
    if (method === "getChat") return { id: CHAT_ID, permissions: { can_send_messages: true, can_send_photos: true } };
    if (method === "sendMessage") return { message_id: ++mid };
    if (method === "getChatMember") return { status: "administrator", can_delete_messages: true, can_restrict_members: true };
    return true;
  };
  return { tg, calls, of: (m) => calls.filter((c) => c.method === m) };
}

const env = () => ({ COACH_KV: fakeKV(), OWNER_TG_IDS: "7" });
const user = (id, first_name = "Ярик") => ({ id, is_bot: false, first_name });
const join = (u, from = u) => ({ chat_member: { chat: { id: CHAT_ID }, from, old_chat_member: { status: "left", user: u }, new_chat_member: { status: "member", user: u } } });
const leave = (u) => ({ chat_member: { chat: { id: CHAT_ID }, from: u, old_chat_member: { status: "restricted", is_member: true, user: u }, new_chat_member: { status: "left", user: u } } });
let seq = 1;
const say = (u, text, extra = {}) => ({ message: { message_id: ++seq, chat: { id: CHAT_ID, type: "supergroup" }, from: u, text, ...extra } });

test("вход: мут, кнопка «Я человек», нажатие снимает мут и меняет на приветствие", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg(), now = 1_800_000_000_000;
  const u = user(50, "Аксель <3");
  assert.deepEqual(await handleChatUpdate(e, t.tg, join(u), now), { captcha: 1 });
  assert.equal(t.of("restrictChatMember")[0].body.permissions.can_send_messages, false);
  const cap = t.of("sendMessage")[0].body;
  assert.match(cap.text, /Привет, <a href="tg:\/\/user\?id=50">Аксель &lt;3<\/a>!/);
  assert.equal(cap.reply_markup.inline_keyboard[0][0].callback_data, "cghum:50");
  // чужой жмёт — отказ
  const other = await handleChatUpdate(e, t.tg, { callback_query: { id: "q0", data: "cghum:50", from: user(51), message: { message_id: 1001 } } }, now);
  assert.deepEqual(other, { foreign: 1 });
  assert.equal(t.of("restrictChatMember").length, 1);
  // свой жмёт
  assert.deepEqual(await handleChatUpdate(e, t.tg, { callback_query: { id: "q1", data: "cghum:50", from: u, message: { message_id: 1001 } } }, now + 5000), { passed: 1 });
  const un = t.of("restrictChatMember")[1].body;
  assert.equal(un.permissions.can_send_messages, true);
  assert.match(t.of("editMessageText")[0].body.text, /Рады видеть тебя в чате/);
  assert.equal(e.COACH_KV.m.has("cgcap:50"), false);
  assert.equal(e.COACH_KV.m.has("cghuman:50"), true);
  assert.equal(await e.COACH_KV.get("cg_welcome"), "1001");
  // перезашёл — сразу приветствие без мута, прошлое приветствие убрано
  const t2 = fakeTg({ start: 2000 });
  assert.deepEqual(await handleChatUpdate(e, t2.tg, join(u), now + 9000), { welcome: 1 });
  assert.equal(t2.of("restrictChatMember").length, 0);
  assert.deepEqual(t2.of("deleteMessage")[0].body, { chat_id: CHAT_ID, message_id: 1001 });
});

test("служебные «вступил/вышел» удаляются, ушедший без нажатия — кнопка тоже", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg();
  const u = user(60);
  assert.deepEqual(await handleChatUpdate(e, t.tg, say(u, undefined, { new_chat_members: [u] })), { service: 1 });
  assert.deepEqual(await handleChatUpdate(e, t.tg, say(u, undefined, { left_chat_member: u })), { service: 1 });
  assert.equal(t.of("deleteMessage").length, 2);
  await handleChatUpdate(e, t.tg, join(u));
  await handleChatUpdate(e, t.tg, leave(u));
  assert.equal(t.of("deleteMessage")[2].body.message_id, 1001);
  assert.equal(e.COACH_KV.m.has("cgcap:60"), false);
});

test("не нажал за 15 минут: кнопка пропадает, человек остаётся читателем; приложение или личка снимают ограничение", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg(), now = 1_800_000_000_000;
  const u = user(70);
  await handleChatUpdate(e, t.tg, join(u), now);
  assert.equal(await chatChores(e, t.tg, now + 60_000), 0);
  assert.equal(await chatChores(e, t.tg, now + 16 * 60_000), 1);
  assert.equal(t.of("deleteMessage")[0].body.message_id, 1001);
  assert.equal(t.of("banChatMember").length, 0);
  assert.equal(e.COACH_KV.meta.get("cgcap:70").m, 0);
  assert.equal(await chatChores(e, t.tg, now + 30 * 60_000), 0);
  // пока висит — его сообщения (если мут не встал) удаляются
  assert.deepEqual(await handleChatUpdate(e, t.tg, say(u, "привет")), { unconfirmed: 1 });
  assert.equal(await releaseIfPending(e, t.tg, u, now), true);
  assert.equal(t.of("restrictChatMember").at(-1).body.permissions.can_send_messages, true);
  assert.equal(await releaseIfPending(e, t.tg, u, now), false);
});

test("чужой бот, добавленный не админом, — бан; админ может добавить", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg({ admins: [1] });
  const bot = { id: 99, is_bot: true, first_name: "spam" };
  assert.deepEqual(await handleChatUpdate(e, t.tg, join(bot, user(5))), { bot: "banned" });
  assert.equal(t.of("banChatMember")[0].body.user_id, 99);
  assert.deepEqual(await handleChatUpdate(e, t.tg, join(bot, user(1))), { bot: "allowed" });
});

test("нет прав ограничивать — приветствие без кнопки", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg({ fail: ["restrictChatMember"] });
  assert.deepEqual(await handleChatUpdate(e, t.tg, join(user(80))), { welcome: 1, captcha: 0 });
  assert.equal(e.COACH_KV.m.has("cgcap:80"), false);
});

test("spamReason: чужие чаты, мошенничество, ссылки новичков", () => {
  const m = (text, extra = {}) => ({ text, ...extra });
  assert.equal(spamReason(m("заходи t.me/freeskins_dota"), false), "tg_link");
  assert.equal(spamReason(m("наш бот t.me/DotaRazbor_bot и чат https://t.me/dotarazbor_chat"), false), null);
  assert.equal(spamReason(m("раздача скинов тут"), false), "scam");
  assert.equal(spamReason(m("Бесплатные арканы забирай"), false), "scam");
  assert.equal(spamReason(m("продал скины, ставка на мид не зашла"), false), null);
  assert.equal(spamReason(m("мой матч https://www.dotabuff.com/matches/123"), true), null);
  assert.equal(spamReason(m("смотри https://youtube.com/watch?v=1"), false), null);
  assert.equal(spamReason(m("смотри https://youtube.com/watch?v=1"), true), "link");
  assert.equal(spamReason(m("жми", { entities: [{ type: "text_link", offset: 0, length: 3, url: "https://evil.example" }] }), true), "link");
  assert.equal(spamReason(m("жми", { reply_markup: { inline_keyboard: [[{ text: "x", url: "https://t.me/+abcdef" }]] } }), false), "tg_link");
  assert.equal(spamReason(m("репост", { forward_origin: { type: "channel" } }), true), "forward");
  assert.equal(spamReason(m("репост", { forward_origin: { type: "channel" } }), false), null);
});

test("антиспам: первый раз — удалить и предупредить, второй — мут на сутки; мошенничество — сразу мут", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg(), now = 1_800_000_000_000;
  const u = user(90);
  assert.deepEqual(await handleChatUpdate(e, t.tg, say(u, "го t.me/othergroup"), now), { spam: "tg_link" });
  assert.match(t.of("sendMessage")[0].body.text, /ссылки на другие чаты/);
  assert.ok(e.COACH_KV.m.has("cgtmp:1001"));
  const second = await handleChatUpdate(e, t.tg, say(u, "го t.me/othergroup"), now);
  assert.equal(second.muted, 86400);
  const mute = t.of("restrictChatMember")[0].body;
  assert.equal(mute.until_date, Math.floor(now / 1000) + 86400);
  const scam = await handleChatUpdate(e, t.tg, say(user(91), "казино с бонусом"), now);
  assert.equal(scam.spam, "scam");
  assert.ok(scam.muted);
  // уведомления бота крон убирает через пару минут
  assert.equal(await chatChores(e, t.tg, now + 60_000), 0);
  assert.equal(await chatChores(e, t.tg, now + 3 * 60_000), 3);
});

test("антиспам не трогает админов, владельца, посты канала и обычные сообщения", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg({ admins: [1] });
  assert.equal((await handleChatUpdate(e, t.tg, say(user(1), "t.me/othergroup"))).ok, 1);
  assert.equal((await handleChatUpdate(e, t.tg, say(user(7), "t.me/othergroup"))).ok, 1);
  assert.equal((await handleChatUpdate(e, t.tg, say({ id: 777000, is_bot: false }, "пост", { is_automatic_forward: true, sender_chat: { id: -1003943596949 } }))).ok, 1);
  assert.equal((await handleChatUpdate(e, t.tg, say(user(5), "кто на мидах сейчас апает?"))).ok, 1);
  assert.equal(t.of("deleteMessage").length, 0);
  // реклама от имени чужого канала — удалить и забанить канал
  const ch = await handleChatUpdate(e, t.tg, say({ id: 136817688, is_bot: true }, "наш канал https://spam.example", { sender_chat: { id: -100555, type: "channel" } }));
  assert.equal(ch.banned_chat, 1);
  // свежий участник со ссылкой — убрать
  await e.COACH_KV.put("cgfresh:6", "1");
  assert.equal((await handleChatUpdate(e, t.tg, say(user(6), "https://spam.example"))).spam, "link");
});

test("антифлуд: 6 сообщений за 10 с — мут 10 минут, повторно — час; 3 одинаковых за минуту — мут", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg(), now = 1_800_000_000_000;
  const u = user(100);
  for (let i = 0; i < 5; i++) assert.equal((await handleChatUpdate(e, t.tg, say(u, `msg ${i}`), now + i * 1000)).ok, 1);
  const f = await handleChatUpdate(e, t.tg, say(u, "msg 5"), now + 5000);
  assert.equal(f.muted, 600);
  assert.deepEqual(await handleChatUpdate(e, t.tg, say(u, "msg 6"), now + 5500), { flood: 1 });
  const v = user(101);
  await handleChatUpdate(e, t.tg, say(v, "АПНИТЕ"), now);
  await handleChatUpdate(e, t.tg, say(v, "апните"), now + 20_000);
  assert.equal((await handleChatUpdate(e, t.tg, say(v, "апните "), now + 40_000)).muted, 600);
  // правка сообщения флудом не считается
  const w = user(102);
  for (let i = 0; i < 8; i++) await handleChatUpdate(e, t.tg, { edited_message: say(w, "x").message }, now);
  assert.equal(e.COACH_KV.m.has("cgflood:102"), false);
  // вторая волна у того же — час
  e.COACH_KV.m.delete("cgflood:100");
  for (let i = 0; i < 5; i++) await handleChatUpdate(e, t.tg, say(u, `again ${i}`), now + 100_000 + i);
  assert.equal((await handleChatUpdate(e, t.tg, say(u, "again 5"), now + 100_010)).muted, 3600);
});

test("статус для владельца: права бота и счётчики", async () => {
  resetAdminCache();
  const e = env(), t = fakeTg(), now = 1_800_000_000_000;
  await handleChatUpdate(e, t.tg, join(user(110)), now);
  const text = await chatStatus(e, t.tg, "123", now);
  assert.match(text, /все нужные права есть/);
  assert.match(text, /вошли 1/);
  const bad = async (m) => (m === "getChatMember" ? { status: "administrator", can_delete_messages: true, can_restrict_members: false } : null);
  assert.match(await chatStatus(e, bad, "123", now), /не хватает прав: «Блокировка пользователей»/);
});

test("апдейты не про чат — мимо", async () => {
  const e = env(), t = fakeTg();
  assert.equal(await handleChatUpdate(e, t.tg, { message: { chat: { id: 5, type: "private" }, from: user(5), text: "/start" } }), null);
  assert.equal(await handleChatUpdate(e, t.tg, { callback_query: { id: "q", data: "other", from: user(5) } }), null);
});
