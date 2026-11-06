// Защита чата канала (@dotarazbor_chat) силами @DotaRazbor_bot.
// Бот — админ чата с правами удалять сообщения и ограничивать участников (tools/tg_community.py).
//
// Что делает:
// — служебные «вступил / вышел» удаляет, чтобы не мусорили ленту;
// — новичка сразу ограничивает (читать можно, писать нельзя) и здоровается по имени с кнопкой «Я человек».
//   Нажал — пишет, приветствие остаётся. Не нажал за час — кнопка
//   пропадает, человек остаётся читателем. Из чата НЕ выгоняем: без членства в чате закрыто приложение
//   (проверка подписки gateCheck), а ограниченный участник для неё — участник. Снять ограничение потом можно,
//   открыв приложение или написав боту в личку: это делает живой человек из Телеграма;
// — чужих ботов, добавленных не админом, банит;
// — антиспам: ссылки на чужие чаты и каналы, мошеннические слова (раздачи скинов, казино, заработок),
//   а в первые сутки после входа — любые ссылки и пересылки удаляет, на второй раз за сутки мут на сутки;
// — антифлуд: 6+ сообщений за 10 секунд или одно и то же 3 раза за минуту — мут 10 минут, повторно час, потом сутки.
// Сообщения админов, владельца и постов канала не трогает. Уведомления бота о муте сами удаляются через несколько минут.
//
// tg(method, body) — вызов Bot API: результат метода или null при ошибке.

export const CHAT_ID = -1003744417862;
const CHANNEL_ID = -1003943596949;
const BOT_URL = "https://t.me/DotaRazbor_bot";

const CAPTCHA_LIFE = 60 * 60_000;      // сколько живёт кнопка «Я человек»; потом сообщение становится приветствием, не удаляется
const PENDING_TTL = 30 * 86400;        // помним неподтверждённого, чтобы снять ограничение из приложения или лички
const HUMAN_TTL = 365 * 86400;         // подтверждённый: при перезаходе — без кнопки
const FRESH_TTL = 86400;               // первые сутки после входа — без ссылок и пересылок
const NOTICE_LIFE = 2 * 60_000;        // уведомления бота в чате
const FLOOD_WINDOW = 10_000, FLOOD_MAX = 6;
const DUP_WINDOW = 60_000, DUP_MAX = 3;
const MUTE_STEPS = [10 * 60, 3600, 86400];
const MUTES_TTL = 7 * 86400;

const NO_RIGHTS = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false, can_change_info: false,
  can_invite_users: false, can_pin_messages: false, can_manage_topics: false,
};
// если Телеграм не отдал права чата по умолчанию
const BASE_RIGHTS = {
  can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
  can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
  can_send_other_messages: true, can_add_web_page_previews: true, can_invite_users: true,
};

// свои ресурсы и статистика по Доте — ссылки на них можно всем
const OUR_TG = /^(dota_razbor|dotarazbor_chat|dotarazbor_bot)$/i;
const SAFE_HOSTS = /(^|\.)(bezzz22\.github\.io|2007rggg\.workers\.dev|opendota\.com|dotabuff\.com|stratz\.com|dota2\.com|steamcommunity\.com|steampowered\.com)$/i;
const TG_HOSTS = /^(t\.me|telegram\.me|telegram\.dog)$/i;
// мошенничество, которое ходит по Дота-чатам. Слова «скины», «ставка» сами по себе не режем — только связки
const SCAM = new RegExp([
  "раздач[аеиу]\\s+(скин|предмет|арканы?|аркан)", "(бесплатн[а-яёa-z]*|халявн[а-яёa-z]*)\\s+(скин|аркан|предмет)", "free\\s+(skins?|arcana|items?)",
  "казино", "casino", "1xbet", "1хбет", "промокод[а-яёa-z]*\\s+на\\s+(депозит|ставк)", "заработ[а-яёa-z]*\\s+(от|до)\\s+\\d", "пассивн[а-яёa-z]+\\s+доход",
  "заработок\\s+в\\s+(интернете|телеграм)", "арбитраж[а-яёa-z]*\\s+(крипт|трафик)", "интим", "onlyfans", "18\\s*\\+\\s*(видео|фото|канал)",
  "пиши\\s+в\\s+(лс|личку)\\s+(за|для)\\s+(заработ|подробн)", "steam\\s*gift", "airdrop",
].join("|"), "i");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nameOf = (u) => String([u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "друг").slice(0, 40);
const mention = (u) => `<a href="tg://user?id=${u.id}">${esc(nameOf(u))}</a>`;
const owners = (env) => String(env.OWNER_TG_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
const mskDay = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

// админы чата: раз в 10 минут на изолят
let adminCache = { t: 0, ids: null };
async function admins(tg, now) {
  if (adminCache.ids && now - adminCache.t < 10 * 60_000) return adminCache.ids;
  const list = await tg("getChatAdministrators", { chat_id: CHAT_ID });
  if (Array.isArray(list)) adminCache = { t: now, ids: new Set(list.map((m) => String(m.user && m.user.id))) };
  return adminCache.ids || new Set();
}
export function resetAdminCache() { adminCache = { t: 0, ids: null }; }
async function trusted(env, tg, id, now) {
  return owners(env).includes(String(id)) || (await admins(tg, now)).has(String(id));
}

let rightsCache = { t: 0, p: null };
async function chatRights(tg, now) {
  if (rightsCache.p && now - rightsCache.t < 3600_000) return rightsCache.p;
  const chat = await tg("getChat", { chat_id: CHAT_ID });
  if (chat && chat.permissions) rightsCache = { t: now, p: chat.permissions };
  return rightsCache.p || BASE_RIGHTS;
}

// счётчики за день для команды владельца «чат»
async function count(env, what, now) {
  const key = `cg:${mskDay(now)}`;
  const got = await env.COACH_KV.getWithMetadata(key);
  const m = { ...((got && got.metadata) || {}) };
  m[what] = (m[what] || 0) + 1;
  await env.COACH_KV.put(key, "1", { metadata: m, expirationTtl: 8 * 86400 });
}

// уведомление в чат, которое крон потом удалит
async function notice(env, tg, html, now) {
  const sent = await tg("sendMessage", { chat_id: CHAT_ID, text: html, parse_mode: "HTML", disable_notification: true, link_preview_options: { is_disabled: true } });
  if (sent && sent.message_id) await env.COACH_KV.put(`cgtmp:${sent.message_id}`, "1", { metadata: { at: now + NOTICE_LIFE }, expirationTtl: 86400 });
  return sent;
}

const welcomeText = (u) => `Привет, ${mention(u)}! Рады видеть тебя в чате Dota Разбор.\n`
  + "Тут обсуждаем катки, драфты, руинеров и разборы. Свою игру можно разобрать в @DotaRazbor_bot: ошибки по таймкодам, лайн, смерти и сборка.\n"
  + "Ссылки и пересылки — через сутки после входа, чтобы не лезли спамеры.";
const captchaText = (u) => `Привет, ${mention(u)}! Рады видеть тебя в чате Dota Разбор.\n`
  + "Жми кнопку ниже, что ты не бот, — и сможешь писать. Кнопка живёт час; не успел — запусти @DotaRazbor_bot, и писать в чате станет можно.";
const botButton = { inline_keyboard: [[{ text: "Разобрать свою катку", url: BOT_URL }]] };

// Приветствия больше не удаляем (Ярик: «сделай так, чтобы не удалялось»). Раньше в ленте оставалось только
// последнее, и при двух входах подряд или двух проверках подписки из приложения новое приветствие тут же
// стирало предыдущее — со стороны это выглядело как «Привет» на полсекунды
async function swapWelcome() {}

// последние события чата для команды владельца «чат»: что и почему делал бот
const LOG_MAX = 30;
async function log(env, ev, user, now) {
  const got = (await env.COACH_KV.get("cglog", "json")) || [];
  got.push({ t: now, ev, id: user && user.id, n: user ? nameOf(user) : "" });
  await env.COACH_KV.put("cglog", JSON.stringify(got.slice(-LOG_MAX)), { expirationTtl: 14 * 86400 });
}

async function unmute(tg, userId, now) {
  return tg("restrictChatMember", { chat_id: CHAT_ID, user_id: userId, permissions: await chatRights(tg, now), use_independent_chat_permissions: true });
}

async function mute(env, tg, user, why, now) {
  const key = `cgmutes:${user.id}`;
  const n = Number(await env.COACH_KV.get(key)) || 0;
  const secs = why === "spam" ? 86400 : MUTE_STEPS[Math.min(n, MUTE_STEPS.length - 1)];
  await env.COACH_KV.put(key, String(n + 1), { expirationTtl: MUTES_TTL });
  const ok = await tg("restrictChatMember", { chat_id: CHAT_ID, user_id: user.id, permissions: NO_RIGHTS, use_independent_chat_permissions: true, until_date: Math.floor(now / 1000) + secs });
  if (!ok) return null;
  const span = secs >= 86400 ? "сутки" : secs >= 3600 ? "час" : "10 минут";
  await notice(env, tg, `${mention(user)} помолчит ${span}: ${why === "spam" ? "спам" : "флуд"}.`, now);
  await count(env, "muted", now);
  return secs;
}

const isMember = (m) => m && (["member", "administrator", "creator"].includes(m.status) || (m.status === "restricted" && m.is_member));

// ---------- вход и выход ----------
async function onMember(env, tg, cm, now) {
  const user = cm.new_chat_member && cm.new_chat_member.user;
  if (!user) return null;
  const was = isMember(cm.old_chat_member), is = isMember(cm.new_chat_member);
  if (was && !is) {
    // ушёл, не нажав кнопку — убираем кнопку
    const got = await env.COACH_KV.getWithMetadata(`cgcap:${user.id}`);
    if (got && got.metadata && got.metadata.m) await tg("deleteMessage", { chat_id: CHAT_ID, message_id: got.metadata.m });
    if (got && got.value != null) await env.COACH_KV.delete(`cgcap:${user.id}`);
    await log(env, got && got.metadata && got.metadata.m ? "ушёл, не нажав кнопку (кнопку убрал)" : "ушёл", user, now);
    return { left: user.id };
  }
  if (was || !is) return null;
  if (user.is_bot) {
    const by = cm.from && cm.from.id;
    if (by && by !== user.id && await trusted(env, tg, by, now)) return { bot: "allowed" };
    await tg("banChatMember", { chat_id: CHAT_ID, user_id: user.id });
    await count(env, "bots", now);
    return { bot: "banned" };
  }
  if (await trusted(env, tg, user.id, now)) return { trusted: 1 };
  await count(env, "joined", now);
  // уже подтверждал — просто здороваемся
  if (await env.COACH_KV.get(`cghuman:${user.id}`)) {
    const sent = await tg("sendMessage", { chat_id: CHAT_ID, text: welcomeText(user), parse_mode: "HTML", reply_markup: botButton, disable_notification: true, link_preview_options: { is_disabled: true } });
    if (sent && sent.message_id) await swapWelcome(env, tg, sent.message_id);
    return { welcome: sent ? 1 : 0 };
  }
  const muted = await tg("restrictChatMember", { chat_id: CHAT_ID, user_id: user.id, permissions: NO_RIGHTS, use_independent_chat_permissions: true });
  if (!muted) {
    // нет права ограничивать — хотя бы приветствие, без кнопки
    const sent = await tg("sendMessage", { chat_id: CHAT_ID, text: welcomeText(user), parse_mode: "HTML", reply_markup: botButton, disable_notification: true, link_preview_options: { is_disabled: true } });
    if (sent && sent.message_id) await swapWelcome(env, tg, sent.message_id);
    return { welcome: sent ? 1 : 0, captcha: 0 };
  }
  const sent = await tg("sendMessage", {
    chat_id: CHAT_ID, text: captchaText(user), parse_mode: "HTML", disable_notification: true,
    reply_markup: { inline_keyboard: [[{ text: "Я человек", callback_data: `cghum:${user.id}` }]] },
  });
  await env.COACH_KV.put(`cgcap:${user.id}`, "1", { metadata: { m: (sent && sent.message_id) || 0, t: now, n: nameOf(user) }, expirationTtl: PENDING_TTL });
  await log(env, sent ? "вошёл, кнопка «Я человек»" : "вошёл, кнопка не отправилась", user, now);
  return { captcha: 1 };
}

// подтвердил: снимаем ограничение, помним, кнопку меняем на приветствие
async function confirm(env, tg, user, now) {
  await unmute(tg, user.id, now);
  await env.COACH_KV.delete(`cgcap:${user.id}`);
  await env.COACH_KV.put(`cghuman:${user.id}`, "1", { expirationTtl: HUMAN_TTL });
  await env.COACH_KV.put(`cgfresh:${user.id}`, "1", { expirationTtl: FRESH_TTL });
  await count(env, "passed", now);
}

async function onPress(env, tg, q, now) {
  const m = /^cghum:(\d+)$/.exec(String(q.data || ""));
  if (!m) return null;
  if (String(q.from.id) !== m[1]) {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Эта кнопка для новичка, ты уже в чате." });
    return { foreign: 1 };
  }
  const pending = await env.COACH_KV.get(`cgcap:${q.from.id}`);
  if (pending != null) { await confirm(env, tg, q.from, now); await log(env, "нажал «Я человек»", q.from, now); }
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Готово, пиши! Рады тебе." });
  const mid = q.message && q.message.message_id;
  if (mid) {
    const edited = await tg("editMessageText", { chat_id: CHAT_ID, message_id: mid, text: welcomeText(q.from), parse_mode: "HTML", reply_markup: botButton, link_preview_options: { is_disabled: true } });
    if (edited) await swapWelcome(env, tg, mid);
  }
  return { passed: 1 };
}

// Живой человек открыл приложение или написал боту — снимаем ограничение, если висит неподтверждённым
export async function releaseIfPending(env, tg, user, now = Date.now()) {
  if (!env.COACH_KV || !user || !user.id) return false;
  const got = await env.COACH_KV.getWithMetadata(`cgcap:${user.id}`);
  if (!got || got.value == null) return false;
  await confirm(env, tg, user, now);
  await log(env, "открыл приложение или написал боту — ограничение снято", user, now);
  // Кнопку превращаем в приветствие, как при нажатии. Раньше её удаляли, а приложение спрашивает подписку
  // сразу после «Вступить» — и новичок видел, как приветствие появляется и тут же пропадает.
  // Кнопка уже снята по сроку — здороваемся заново
  const mid = got.metadata && got.metadata.m;
  const edited = mid && await tg("editMessageText", { chat_id: CHAT_ID, message_id: mid, text: welcomeText(user), parse_mode: "HTML", reply_markup: botButton, link_preview_options: { is_disabled: true } });
  if (edited) await swapWelcome(env, tg, mid);
  // сообщение с кнопкой есть, но не правится (уже приветствие от параллельной проверки) — второе не шлём
  else if (!mid) {
    const sent = await tg("sendMessage", { chat_id: CHAT_ID, text: welcomeText(user), parse_mode: "HTML", reply_markup: botButton, disable_notification: true, link_preview_options: { is_disabled: true } });
    if (sent && sent.message_id) await swapWelcome(env, tg, sent.message_id);
  }
  return true;
}

// ---------- сообщения ----------
function links(msg) {
  const text = String(msg.text || msg.caption || "");
  const out = [];
  for (const e of msg.entities || msg.caption_entities || []) {
    if (e.type === "url") out.push(text.slice(e.offset, e.offset + e.length));
    if (e.type === "text_link" && e.url) out.push(e.url);
  }
  // ссылки без разметки (Телеграм размечает не всё) и t.me без протокола
  for (const m of text.matchAll(/(?:https?:\/\/|www\.)[^\s]+|(?:^|[\s(])((?:t\.me|telegram\.me)\/[^\s)]+)/gi)) out.push((m[1] || m[0]).trim());
  if (msg.reply_markup && msg.reply_markup.inline_keyboard) {
    for (const row of msg.reply_markup.inline_keyboard) for (const b of row) if (b.url) out.push(b.url);
  }
  return out;
}
function hostPath(link) {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(link) ? link : `https://${link}`);
    return { host: u.hostname.replace(/^www\./i, "").toLowerCase(), path: u.pathname };
  } catch { return null; }
}
// чужой Телеграм: каналы, чаты, боты, инвайты (кроме наших)
const foreignTg = (hp) => hp && TG_HOSTS.test(hp.host) && !OUR_TG.test(hp.path.split("/")[1] || "");
const unsafe = (hp) => !hp || (!SAFE_HOSTS.test(hp.host) && !(TG_HOSTS.test(hp.host) && OUR_TG.test(hp.path.split("/")[1] || "")));
// @упоминание чужого канала или бота — тоже реклама, людей не трогаем (их не отличить, поэтому только в первые сутки)
const atLinks = (text) => [...String(text).matchAll(/(^|[^\w@])@([a-z]\w{3,31})/gi)].map((m) => m[2]).filter((n) => !OUR_TG.test(n));

export function spamReason(msg, fresh) {
  const text = String(msg.text || msg.caption || "");
  if (SCAM.test(text)) return "scam";
  const hps = links(msg).map(hostPath);
  if (hps.some(foreignTg)) return "tg_link";
  if (fresh) {
    if (hps.some(unsafe)) return "link";
    if (msg.forward_origin || msg.forward_from || msg.forward_from_chat) return "forward";
    if (atLinks(text).some((n) => /(bot|chat|channel|news|_?ru)$/i.test(n))) return "mention";
  }
  return null;
}

async function onMessage(env, tg, msg, now, edited = false) {
  // служебные «вступил / вышел» — убираем
  if (msg.new_chat_members || msg.left_chat_member) {
    await tg("deleteMessage", { chat_id: CHAT_ID, message_id: msg.message_id });
    await count(env, "service", now);
    return { service: 1 };
  }
  // посты канала и анонимные админы
  if (msg.is_automatic_forward || (msg.sender_chat && (msg.sender_chat.id === CHANNEL_ID || msg.sender_chat.id === CHAT_ID))) return null;
  const from = msg.from;
  if (!from || from.is_bot && !msg.sender_chat) return null;
  // пишет от имени чужого канала — как новичок: без ссылок и рекламы
  const asChannel = Boolean(msg.sender_chat);
  if (!asChannel && await trusted(env, tg, from.id, now)) return null;

  // не нажал кнопку, а ограничение не встало — сообщение убираем
  if (!asChannel && (await env.COACH_KV.get(`cgcap:${from.id}`)) != null) {
    await tg("deleteMessage", { chat_id: CHAT_ID, message_id: msg.message_id });
    return { unconfirmed: 1 };
  }

  const fresh = asChannel || (await env.COACH_KV.get(`cgfresh:${from.id}`)) != null;
  const reason = spamReason(msg, fresh);
  if (reason) {
    await tg("deleteMessage", { chat_id: CHAT_ID, message_id: msg.message_id });
    await count(env, "spam", now);
    if (asChannel) {
      await tg("banChatSenderChat", { chat_id: CHAT_ID, sender_chat_id: msg.sender_chat.id });
      return { spam: reason, banned_chat: 1 };
    }
    const key = `cgstrike:${from.id}`;
    const n = (Number(await env.COACH_KV.get(key)) || 0) + 1;
    await env.COACH_KV.put(key, String(n), { expirationTtl: 86400 });
    if (n >= 2 || reason === "scam") return { spam: reason, muted: await mute(env, tg, from, "spam", now) };
    const why = reason === "tg_link" ? "ссылки на другие чаты и каналы здесь нельзя"
      : "ссылки и пересылки можно через сутки после входа";
    await notice(env, tg, `${mention(from)}, убрал сообщение: ${why}.`, now);
    return { spam: reason };
  }
  if (asChannel || edited) return null;

  // флуд: частота и повторы
  const key = `cgflood:${from.id}`;
  const prev = (await env.COACH_KV.get(key, "json")) || [];
  const sig = String(msg.text || msg.caption || (msg.sticker && msg.sticker.file_unique_id) || "").trim().toLowerCase().slice(0, 200);
  const recent = prev.filter((x) => now - x.t < DUP_WINDOW);
  recent.push({ t: now, s: sig });
  await env.COACH_KV.put(key, JSON.stringify(recent.slice(-20)), { expirationTtl: 120 });
  const burst = recent.filter((x) => now - x.t < FLOOD_WINDOW).length;
  const dups = sig ? recent.filter((x) => x.s === sig).length : 0;
  if (burst >= FLOOD_MAX || dups >= DUP_MAX) {
    await tg("deleteMessage", { chat_id: CHAT_ID, message_id: msg.message_id });
    // мут один раз на волну: следующие сообщения той же волны просто удаляются
    if (burst === FLOOD_MAX || dups === DUP_MAX) return { flood: 1, muted: await mute(env, tg, from, "flood", now) };
    return { flood: 1 };
  }
  return null;
}

// null — апдейт не про чат
export async function handleChatUpdate(env, tg, update, now = Date.now()) {
  if (!env.COACH_KV || !update) return null;
  if (update.chat_member && update.chat_member.chat && update.chat_member.chat.id === CHAT_ID) return onMember(env, tg, update.chat_member, now);
  if (update.callback_query && /^cghum:/.test(String(update.callback_query.data || ""))) return onPress(env, tg, update.callback_query, now);
  const msg = update.message || update.edited_message;
  if (msg && msg.chat && msg.chat.id === CHAT_ID) return (await onMessage(env, tg, msg, now, !update.message)) || { ok: 1 };
  return null;
}

const lateText = (n) => `Привет${n ? `, ${esc(n)}` : ""}! Рады видеть тебя в чате Dota Разбор.\n`
  + "Чтобы писать, нажми кнопку ниже и запусти бота — ограничение снимется само.";
const unlockButton = { inline_keyboard: [[{ text: "Открыть бота и писать в чате", url: `${BOT_URL}?start=chat` }]] };

// крон: убрать кнопки, которые никто не нажал, и старые уведомления бота
export async function chatChores(env, tg, now = Date.now()) {
  if (!env.COACH_KV) return 0;
  let done = 0;
  for (const k of (await env.COACH_KV.list({ prefix: "cgtmp:" })).keys) {
    if (k.metadata && k.metadata.at > now) continue;
    await tg("deleteMessage", { chat_id: CHAT_ID, message_id: Number(k.name.slice(6)) });
    await env.COACH_KV.delete(k.name);
    done++;
  }
  for (const k of (await env.COACH_KV.list({ prefix: "cgcap:" })).keys) {
    const m = k.metadata || {};
    if (!m.m || now - (m.t || 0) < CAPTCHA_LIFE) continue;
    // не удаляем: кнопка уступает место приветствию со ссылкой на бота — написал ему, и в чате можно писать
    await tg("editMessageText", { chat_id: CHAT_ID, message_id: m.m, text: lateText(m.n), parse_mode: "HTML", reply_markup: unlockButton, link_preview_options: { is_disabled: true } });
    await env.COACH_KV.put(k.name, "1", { metadata: { m: 0, t: m.t, n: m.n }, expirationTtl: PENDING_TTL });
    await count(env, "timeout", now);
    done++;
  }
  return done;
}

// Владельцу по команде «чат»: есть ли у бота права и что было сегодня
export async function chatStatus(env, tg, botId, now = Date.now()) {
  const me = await tg("getChatMember", { chat_id: CHAT_ID, user_id: Number(botId) });
  const lines = [];
  if (!me) lines.push("Телеграм не ответил про права бота в чате, попробуй позже.");
  else if (me.status !== "administrator") lines.push("Бот в чате не админ — защита не работает. Сделай его админом с правами «Удаление сообщений» и «Блокировка пользователей».");
  else {
    const miss = [!me.can_delete_messages && "«Удаление сообщений»", !me.can_restrict_members && "«Блокировка пользователей»"].filter(Boolean);
    lines.push(miss.length ? `Бот админ, но не хватает прав: ${miss.join(", ")}. Включи их в настройках админа.` : "Бот админ, все нужные права есть — защита работает.");
  }
  const got = await env.COACH_KV.getWithMetadata(`cg:${mskDay(now)}`);
  const m = (got && got.metadata) || {};
  const ev = ((await env.COACH_KV.get("cglog", "json")) || []).slice(-10);
  if (ev.length) {
    lines.push("", "Последние события:");
    for (const e of ev) lines.push(`${new Date(e.t + 7 * 3600_000).toISOString().slice(5, 16).replace("T", " ")} ${e.n || e.id}: ${e.ev}`);
    lines.push("(время томское)");
  }
  lines.push("", "Сегодня в чате:",
    `вошли ${m.joined || 0}, нажали «Я человек» ${m.passed || 0}, не нажали ${m.timeout || 0}`,
    `убрано служебных ${m.service || 0}, спама ${m.spam || 0}, банов ботов ${m.bots || 0}, мутов ${m.muted || 0}`);
  return lines.join("\n");
}
