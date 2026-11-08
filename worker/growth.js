// Рост и удержание: ID матча в личку боту, рефералка, серия дней с разборами и сводка недели в боте.
//
// Ключи: ref:<tg id> — кто пригласил (пишется один раз, когда человек впервые запустил бота или приложение по ссылке r<id>);
// refdone:<tg id> — бонус за этого друга уже выдан; refn:<tg id> — скольких привёл; streak:<tg id> — серия
// { d: последний день МСК с разбором, n: дней подряд, best }; streakprize:<tg id>:<день> — приз за день выдан;
// digest:<понедельник>:<tg id> — сводка недели отправлена; digest:<понедельник>:end — все обойдены; nodigest:<tg id> — отписался.
// refm:<tg id> — катка, которую откроет бонус за следующего пришедшего друга; top:<понедельник>:<tg id> — итоги недели
// для топа в чате; topdone:<понедельник> — топ запощен; notop:<tg id> — не показывать в топе.
// tg(method, body) — вызов Bot API: результат или null.

import { giftCredits, openMatch } from "./pay.js";
import { CHAT_ID } from "./chatguard.js";

export const APP_URL = "https://bezzz22.github.io/KORPl/";
// Запросы воркера к OpenDota — с User-Agent: fetch из Cloudflare Workers сам его не ставит, а OpenDota стоит за защитой
// от ботов, и пустой UA там похож на бота (живая проверка 02.11: заявки и запасной путь через воркер — 502)
export const OD_HEADERS = { "User-Agent": "DotaRazbor/1.0 (+https://t.me/DotaRazbor_bot)", Accept: "application/json" };
const BOT = "DotaRazbor_bot";
export const REF_BONUS = 1;        // разбор тренера и другу, и тому, кто позвал
export const REF_MAX = 20;         // больше двадцати друзей — другу бонус, пригласившему уже нет (ИИ стоит денег)
const DIGEST_BATCH = 8;            // человек за один заход крона: лимит подзапросов воркера
const WEEK_MS = 7 * 86400_000;

export const mskDay = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

// ---------- ID матча в личку ----------
// «Кидаешь Match ID в бота» — так написано в постах канала, а бот раньше пересылал цифры владельцу
export function matchFromText(text) {
  const t = String(text || "").trim();
  // голое число — только больше 2^32: Friend ID (account_id) в 32 бита влезает, свежие матчи — уже нет
  if (/^\d{10,11}$/.test(t) && Number(t) > 4294967295) return Number(t);
  if (t.length > 300) return null;
  const m = /(?:opendota\.com|dotabuff\.com|stratz\.com)\/match(?:es)?\/(\d{7,11})(?!\d)/i.exec(t);
  return m ? Number(m[1]) : null;
}
// Friend ID или ссылка на профиль в личку: «кинь свой ID» — первое, что делает новичок, а бот отвечал «всё в приложении»
// и отправлял цифры владельцу. Теперь — кнопка, по которой приложение само привяжет этот аккаунт
const STEAM64 = 76561197960265728n;
export function accountFromText(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 300) return null;
  let raw = null;
  const link = /(?:steamcommunity\.com\/profiles|(?:dotabuff|opendota|stratz)\.com\/players)\/(\d{1,20})(?!\d)/i.exec(t);
  if (link) raw = link[1];
  else if (/^\d[\d\s-]{3,14}\d$/.test(t)) raw = t.replace(/[\s-]/g, "");
  else if (/^\d{17}$/.test(t)) raw = t;
  if (!raw || !/^\d{1,20}$/.test(raw)) return null;
  const n = BigInt(raw);
  const id = n > STEAM64 ? n - STEAM64 : n;
  return id >= 1000n && id < 2n ** 32n ? Number(id) : null;
}
export const linkButton = (acc) => ({ inline_keyboard: [[{ text: "Привязать и открыть мои катки", web_app: { url: `${APP_URL}?link=${acc}` } }]] });
export const LINK_TEXT = (acc) => `Похоже на твой Friend ID: ${acc}. Жми кнопку — привяжу его в приложении и покажу последние катки на разбор.`;

export const matchUrl = (id) => `${APP_URL}?match=${id}`;
export const matchButton = (id, text = "Разобрать катку") => ({ inline_keyboard: [[{ text, web_app: { url: matchUrl(id) } }]] });
export const MATCH_TEXT = (id) => `Катка ${id}. Жми кнопку — откроется разбор: кто слил, ошибки по таймкодам, повтор на карте. `
  + "Если реплей ещё не разобран, приложение само закажет его у OpenDota.";

// ---------- рефералка ----------
export const refLink = (id) => `https://t.me/${BOT}?startapp=r${id}`;
export const refOf = (src) => { const m = /^r(\d{1,20})$/.exec(String(src || "")); return m ? m[1] : null; };

// Первый запуск бота или приложения по ссылке r<id>: запомнить, кто позвал. Себя не зовут; кто уже пользовался
// ботом (привязал аккаунт или уже пришёл от кого-то) — не реферал
export async function noteReferral(env, userId, src) {
  const by = refOf(src), kv = env.COACH_KV;
  if (!by || by === String(userId)) return null;
  if (await kv.get(`ref:${userId}`) || await kv.get(`user:${userId}`)) return null;
  await kv.put(`ref:${userId}`, by);
  return by;
}

// Друг впервые запустил бота по ссылке — бонус обоим (решение Ярика 02.11: за запуск, а не за отправленную ссылку).
// Один раз на друга, даже если пачки событий пришли разом. name — имя друга для письма пригласившему
export async function rewardReferral(env, tg, userId, now = Date.now(), name = "") {
  const kv = env.COACH_KV;
  const by = await kv.get(`ref:${userId}`);
  if (!by || await kv.get(`refdone:${userId}`)) return null;
  if (kv.cas) { if (!(await kv.cas(`refdone:${userId}`, null, String(now)))) return null; }
  else await kv.put(`refdone:${userId}`, String(now));
  const n = (Number(await kv.get(`refn:${by}`)) || 0) + 1;
  await kv.put(`refn:${by}`, String(n));
  await giftCredits(env, userId, REF_BONUS, now);
  const inviter = n <= REF_MAX;
  if (inviter) await giftCredits(env, by, REF_BONUS, now);
  // звал друга с закрытой катки — бонус сразу открывает её (openMatch тратит только что выданный разбор)
  let opened = 0;
  const want = inviter && Number(await kv.get(`refm:${by}`));
  if (want) {
    await kv.delete(`refm:${by}`);
    const r = await openMatch(env, by, `m${want}`, false, now).catch(() => null);
    if (r && r.full) opened = want;
  }
  await tg("sendMessage", { chat_id: Number(userId), text: "Ты пришёл по приглашению друга — держи бесплатный полный разбор матча с ИИ-тренером. Он уже на счету.",
    reply_markup: { inline_keyboard: [[{ text: "Открыть разбор", web_app: { url: APP_URL } }]] } });
  if (inviter && opened) {
    const who = String(name || "").trim().slice(0, 40);
    await tg("sendMessage", { chat_id: Number(by), text: `${who ? `${who} запустил` : "Друг запустил"} бота по твоей ссылке. Как обещал, катка ${opened} открыта целиком: фазы, смерти, карта, сборка и тренер. `
      + `Всего привёл: ${n}.`, reply_markup: matchButton(opened, "Открыть катку") });
  } else if (inviter) {
    const who = String(name || "").trim().slice(0, 40);
    await tg("sendMessage", { chat_id: Number(by), text: `${who ? `${who} запустил` : "Друг запустил"} бота по твоей ссылке. Тебе +${REF_BONUS} разбор ИИ-тренера, уже на счету. `
      + `Всего привёл: ${n}. Зови ещё — ссылка во вкладке «Бонусы».`,
      reply_markup: { inline_keyboard: [[{ text: "Бонусы", web_app: { url: `${APP_URL}?tab=bonus` } }]] } });
  }
  return { by, n, inviter, opened };
}

// Позвал друга с экрана закрытой катки: её и откроем, когда друг придёт. Неделю, потом обычный бонус на счёт
export async function noteRefMatch(env, userId, match) {
  await env.COACH_KV.put(`refm:${userId}`, String(match), { expirationTtl: 7 * 86400 });
}

// ---------- инлайн-режим: «@DotaRazbor_bot <ID катки>» в любом чате ----------
// Бота не надо добавлять в чат: человек выбирает карточку, в чат уходит сообщение с кнопкой на разбор. В ссылке
// метка пригласившего (_r<id>): кто пришёл по карточке впервые — это его друг, бонус как по рефералке
export function inlineAnswer(q) {
  const from = q && q.from && /^\d{1,20}$/.test(String(q.from.id)) ? String(q.from.id) : "";
  const text = String((q && q.query) || "").trim();
  const id = matchFromText(text) || (/^\d{7,11}$/.test(text) ? Number(text) : null);
  const tag = from ? `_r${from}` : "";
  const results = [];
  if (id) {
    results.push({
      type: "article", id: `m${id}`, title: `Разбор катки ${id}`, description: "Кто тащил, кто слил, ошибки по минутам, повтор на карте",
      input_message_content: { message_text: `Катка ${id}: кто тащил, а кто слил? Разбор по минутам у @${BOT}, жми кнопку.` },
      reply_markup: { inline_keyboard: [[{ text: "Кто слил", url: `https://t.me/${BOT}?startapp=m${id}${tag}` }]] },
    });
  } else {
    results.push({
      type: "article", id: "invite", title: "Позвать в Дота Разбор", description: "Впиши ID катки после имени бота — пришлю карточку разбора. Или отправь приглашение",
      input_message_content: { message_text: "Разбирает катки в Доте: кто слил, ошибки по таймкодам, повтор на карте. Заходи — первый матч целиком бесплатно." },
      reply_markup: { inline_keyboard: [[{ text: "Разобрать свою катку", url: from ? refLink(from) : `https://t.me/${BOT}?startapp` }]] },
    });
  }
  return { inline_query_id: q && q.id, results, cache_time: id ? 300 : 30, is_personal: true };
}

// /start r<id> в личке бота — тот же реферал, что и открытие приложения по ссылке. Только для тех, кто бота ещё не видел
export const startPayload = (text) => { const m = /^\/start(?:@\w+)?\s+(\S{1,64})/i.exec(String(text || "").trim()); return m ? m[1] : null; };
export async function referralFromStart(env, tg, user, text, now = Date.now()) {
  const src = startPayload(text);
  if (!refOf(src) || !user || !user.id || await env.COACH_KV.get(`seen:${user.id}`)) return null;
  if (!(await noteReferral(env, user.id, src))) return null;
  return rewardReferral(env, tg, user.id, now, user.first_name);
}

// Откуда пришёл тот, кто сначала нажал /start в боте, а приложение открыл кнопкой (там start_param пустой).
// Метка из ссылки t.me/<бот>?start=<метка> (свои ссылки партнёрам) или «bot», если просто нашёл бота.
// trackUser берёт её, когда человек впервые откроет приложение без своей метки
export const SRC_TTL = 30 * 86400;
export const cleanSrc = (s) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(s || "")) ? String(s) : "");
export async function noteStartSource(env, user, text) {
  if (!user || !user.id || !/^\/start(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim())) return null;
  const kv = env.COACH_KV;
  if (await kv.get(`seen:${user.id}`) || await kv.get(`src0:${user.id}`)) return null;
  const src = cleanSrc(startPayload(text)) || "bot";
  await kv.put(`src0:${user.id}`, src, { expirationTtl: SRC_TTL });
  return src;
}

// ---------- серия дней ----------
// Приз — разбор тренера на 3-й день подряд и дальше каждые 7 дней (10, 17, 24…)
export const streakPrize = (n) => n === 3 || (n > 3 && (n - 3) % 7 === 0);

export async function bumpStreak(env, tg, userId, now = Date.now()) {
  const kv = env.COACH_KV, day = mskDay(now), key = `streak:${userId}`;
  const cur = (await kv.get(key, "json").catch(() => null)) || { d: "", n: 0, best: 0 };
  if (cur.d === day) return { ...cur, prize: false };
  const n = cur.d === dayBefore(day) ? (Number(cur.n) || 0) + 1 : 1;
  const next = { d: day, n, best: Math.max(Number(cur.best) || 0, n) };
  await kv.put(key, JSON.stringify(next), { expirationTtl: 60 * 86400 });
  if (!streakPrize(n)) return { ...next, prize: false };
  const claim = `streakprize:${userId}:${day}`;
  if (kv.cas) { if (!(await kv.cas(claim, null, "1"))) return { ...next, prize: false }; }
  else { if (await kv.get(claim)) return { ...next, prize: false }; await kv.put(claim, "1", { expirationTtl: 3 * 86400 }); }
  await giftCredits(env, userId, 1, now);
  const nextAt = n === 3 ? 10 : n + 7;
  await tg("sendMessage", { chat_id: Number(userId), text: `Серия ${n} ${plural(n, "день", "дня", "дней")} подряд с разборами! Держи бесплатный полный разбор матча с ИИ-тренером, он уже на счету. `
    + `Не прерывай серию: следующий подарок на ${nextAt}-й день.`, reply_markup: { inline_keyboard: [[{ text: "Открыть разбор", web_app: { url: APP_URL } }]] } });
  return { ...next, prize: true };
}

// Что показать в приложении: серия (жива, если последний разбор сегодня или вчера) и рефералка
export async function growthView(env, userId, now = Date.now()) {
  const kv = env.COACH_KV, day = mskDay(now);
  const s = (await kv.get(`streak:${userId}`, "json").catch(() => null)) || {};
  const alive = s.d === day || s.d === dayBefore(day);
  return {
    streak: alive ? Number(s.n) || 0 : 0, streak_today: s.d === day,
    ref_link: refLink(userId), ref_n: Number(await kv.get(`refn:${userId}`)) || 0, ref_bonus: REF_BONUS,
  };
}

// ---------- сводка недели ----------
const won = (m) => (m.player_slot < 128) === Boolean(m.radiant_win);

// recentMatches OpenDota -> итоги последних 7 дней или null, если не играл
export function weekSummary(matches, now = Date.now()) {
  const week = (Array.isArray(matches) ? matches : []).filter((m) => m && m.match_id && Number(m.start_time) * 1000 > now - WEEK_MS);
  if (!week.length) return null;
  const wins = week.filter(won).length;
  const deaths = week.reduce((a, m) => a + (Number(m.deaths) || 0), 0) / week.length;
  // худшая — проигранная с наибольшим числом смертей; все выиграны — просто с наибольшим
  const pool = week.filter((m) => !won(m)).length ? week.filter((m) => !won(m)) : week;
  const worst = [...pool].sort((a, b) => (Number(b.deaths) || 0) - (Number(a.deaths) || 0) || (Number(a.kills) || 0) - (Number(b.kills) || 0))[0];
  return { games: week.length, wins, deaths: Math.round(deaths * 10) / 10, worst };
}

export function digestText(s) {
  const pct = Math.round((s.wins / s.games) * 100);
  const w = s.worst, kda = `${w.kills || 0}/${w.deaths || 0}/${w.assists || 0}`;
  return `Твоя неделя в Доте: ${s.games} ${plural(s.games, "катка", "катки", "каток")}, ${s.wins} ${plural(s.wins, "победа", "победы", "побед")} (${pct}%). `
    + `В среднем ${String(s.deaths).replace(".", ",")} ${plural(Math.round(s.deaths), "смерть", "смерти", "смертей")} за катку.\n\n`
    + `Тяжелее всего вышла катка ${w.match_id}: ${kda}, ${won(w) ? "победа" : "поражение"}. Разбери её — покажу, где отдал и что поправить.\n\n`
    + "Не нужны сводки — напиши /nodigest.";
}

// Крон: по понедельникам с 10:00 до 13:59 МСК, понемногу за заход, каждому раз в неделю
// Понедельник, 10:00–13:59 МСК: окно сводки недели
export const digestWindow = (now) => { const d = new Date(now); return d.getUTCDay() === 1 && d.getUTCHours() >= 7 && d.getUTCHours() <= 10; };

export async function weeklyDigest(env, tg, now = Date.now(), fetcher = fetch, batch = DIGEST_BATCH) {
  const kv = env.COACH_KV;
  if (!kv || !digestWindow(now)) return 0;
  const week = mskDay(now);
  if (await kv.get(`digest:${week}:end`)) return 0;
  let sent = 0, seen = 0, cursor, missed = 0;
  for (let page = 0; page < 20; page++) {
    const got = await kv.list({ prefix: "user:", cursor });
    for (const k of got.keys) {
      const id = k.name.slice(5);
      if (!/^\d{1,20}$/.test(id)) continue; // user:<id>:a<аккаунт> — второй аккаунт того же человека
      if (await kv.get(`digest:${week}:${id}`)) continue;
      if (seen >= batch) return sent;
      const mark = () => kv.put(`digest:${week}:${id}`, "1", { expirationTtl: 9 * 86400 });
      if (await kv.get(`nodigest:${id}`)) { await mark(); continue; }
      const user = await kv.get(k.name, "json").catch(() => null);
      const acc = Number(user && user.account_id);
      if (!acc) { await mark(); continue; }
      // OpenDota режет воркер (429 с IP Cloudflare), поэтому катки приносит выгрузка из Actions (relay.js).
      // Не ответила — не помечаем: человек получит сводку на следующем заходе, а не пропустит неделю
      let res = null;
      try { res = await fetcher(`https://api.opendota.com/api/players/${acc}/recentMatches`, { headers: OD_HEADERS, signal: AbortSignal.timeout(8000) }); } catch { res = null; }
      if (!res || (!res.ok && res.status !== 404)) { missed++; continue; }
      seen++;
      await mark();
      const matches = res.ok ? await res.json().catch(() => null) : null;
      const s = weekSummary(matches, now);
      if (!s) continue;
      await noteTop(env, week, id, s).catch(() => {});
      if (await tg("sendMessage", { chat_id: Number(id), text: digestText(s), reply_markup: matchButton(s.worst.match_id, "Разобрать эту катку") })) sent++;
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  if (missed) return sent;
  await kv.put(`digest:${week}:end`, "1", { expirationTtl: 9 * 86400 });
  return sent;
}

// ---------- топ недели в чате канала ----------
// Итоги недели каждого приходят вместе со сводкой (weeklyDigest). Когда обошли всех — один пост в @dotarazbor_chat:
// больше всех побед, лучший винрейт и меньше всех смертей. Только имя из Телеги (первое слово), без ников и аккаунтов
export const TOP_MIN = 5;          // игр за неделю, чтобы попасть в винрейт и смерти
async function noteTop(env, week, id, s) {
  const kv = env.COACH_KV;
  if (await kv.get(`notop:${id}`)) return;
  const seen = await kv.getWithMetadata(`seen:${id}`).catch(() => null);
  const name = String((seen && seen.metadata && seen.metadata.n) || "").trim().split(/\s+/)[0].replace(/[<>@]/g, "").slice(0, 20);
  if (!name) return;
  await kv.put(`top:${week}:${id}`, JSON.stringify({ n: name, g: s.games, w: s.wins, d: s.deaths }), { expirationTtl: 9 * 86400 });
}

export function topText(rows) {
  const lines = [];
  const pick = (list, key, dir) => [...list].sort((a, b) => dir * (b[key] - a[key]) || b.g - a.g).slice(0, 3);
  const most = pick(rows.filter((r) => r.w > 0), "w", 1);
  const enough = rows.filter((r) => r.g >= TOP_MIN).map((r) => ({ ...r, wr: r.w / r.g }));
  const wr = pick(enough, "wr", 1), alive = pick(enough, "d", -1);
  const place = (i) => `${i + 1}.`;
  if (most.length) lines.push("Больше всех побед:", ...most.map((r, i) => `${place(i)} ${r.n} — ${r.w} ${plural(r.w, "победа", "победы", "побед")} из ${r.g}`), "");
  if (wr.length) lines.push(`Лучший винрейт (от ${TOP_MIN} игр):`, ...wr.map((r, i) => `${place(i)} ${r.n} — ${Math.round(r.wr * 100)}%`), "");
  if (alive.length) lines.push(`Меньше всех умирает (от ${TOP_MIN} игр):`, ...alive.map((r, i) => `${place(i)} ${r.n} — ${String(r.d).replace(".", ",")} за катку`), "");
  if (!lines.length) return null;
  return ["Топ недели среди тех, кто разбирает катки у бота:", "", ...lines,
    "Хочешь сюда — разбирай свои катки и не сливай. Не хочешь в топе — напиши боту /notop."].join("\n");
}

// После сводки: все обойдены (digest:<понедельник>:end) или последний час окна. Раз в неделю, минимум два человека
export async function postWeeklyTop(env, tg, now = Date.now()) {
  const kv = env.COACH_KV;
  if (!kv || !digestWindow(now)) return 0;
  const week = mskDay(now);
  if (await kv.get(`topdone:${week}`)) return 0;
  if (!(await kv.get(`digest:${week}:end`)) && new Date(now).getUTCHours() < 10) return 0;
  const rows = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const got = await kv.list({ prefix: `top:${week}:`, cursor });
    for (const k of got.keys) {
      const r = await kv.get(k.name, "json").catch(() => null);
      if (r && r.n && r.g > 0 && !(await kv.get(`notop:${k.name.split(":")[2]}`))) rows.push(r);
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  await kv.put(`topdone:${week}`, "1", { expirationTtl: 9 * 86400 });
  const text = rows.length >= 2 && topText(rows);
  if (!text) return 0;
  const ok = await tg("sendMessage", { chat_id: CHAT_ID, text, disable_notification: true, link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: "Разобрать свою катку", url: `https://t.me/${BOT}?start=top` }]] } });
  return ok ? 1 : 0;
}

// ---------- напоминание «серия сгорит» ----------
// Вечером (20:00–21:59 МСК) тем, у кого серия от 2 дней, а сегодня разбора ещё не было. Раз в день, не больше REMIND_BATCH
// сообщений за заход крона. Отписка — та же /nopush, что и у пушей после катки
const REMIND_BATCH = 25;
export const remindWindow = (now) => { const h = new Date(now).getUTCHours(); return h >= 17 && h <= 18; };

export async function streakReminders(env, tg, now = Date.now()) {
  const kv = env.COACH_KV;
  if (!kv || !remindWindow(now)) return 0;
  const day = mskDay(now), yesterday = dayBefore(day);
  if (await kv.get(`streakrem:${day}:end`)) return 0;
  let sent = 0, cursor;
  for (let page = 0; page < 20; page++) {
    const got = await kv.list({ prefix: "streak:", cursor });
    for (const k of got.keys) {
      const id = k.name.slice(7);
      if (!/^\d{1,20}$/.test(id)) continue;
      const mark = `streakrem:${day}:${id}`;
      if (await kv.get(mark)) continue;
      const s = await kv.get(k.name, "json").catch(() => null);
      const n = Number(s && s.n) || 0;
      if (!s || s.d !== yesterday || n < 2) continue;
      if (sent >= REMIND_BATCH) return sent;
      await kv.put(mark, "1", { expirationTtl: 2 * 86400 });
      if (await kv.get(`nopush:${id}`)) continue;
      const prize = streakPrize(n + 1) ? " За сегодняшний день серии — подарок: бесплатный полный разбор с тренером." : "";
      if (await tg("sendMessage", { chat_id: Number(id), text: `Серия ${n} ${plural(n, "день", "дня", "дней")} подряд сгорит в полночь. Разбери сегодня одну катку, это минута.${prize}\n\nОтключить напоминания: /nopush`,
        reply_markup: { inline_keyboard: [[{ text: "Разобрать катку", web_app: { url: APP_URL } }]] } })) sent++;
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  await kv.put(`streakrem:${day}:end`, "1", { expirationTtl: 2 * 86400 });
  return sent;
}
