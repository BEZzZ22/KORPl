// Рост и удержание: ID матча в личку боту, рефералка, серия дней с разборами и сводка недели в боте.
//
// Ключи: ref:<tg id> — кто пригласил (пишется один раз, когда человек впервые открыл приложение по ссылке r<id>);
// refdone:<tg id> — бонус за этого друга уже выдан; refn:<tg id> — скольких привёл; streak:<tg id> — серия
// { d: последний день МСК с разбором, n: дней подряд, best }; streakprize:<tg id>:<день> — приз за день выдан;
// digest:<понедельник>:<tg id> — сводка недели отправлена; digest:<понедельник>:end — все обойдены; nodigest:<tg id> — отписался.
// tg(method, body) — вызов Bot API: результат или null.

import { giftCredits } from "./pay.js";

export const APP_URL = "https://bezzz22.github.io/KORPl/";
const BOT = "DotaRazbor_bot";
export const REF_BONUS = 1;        // разбор тренера и другу, и тому, кто позвал
export const REF_MAX = 20;         // больше двадцати друзей — другу бонус, пригласившему уже нет (ИИ стоит денег)
const DIGEST_BATCH = 8;            // человек за один заход крона: лимит подзапросов воркера
const WEEK_MS = 7 * 86400_000;

const mskDay = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
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
export const matchUrl = (id) => `${APP_URL}?match=${id}`;
export const matchButton = (id, text = "Разобрать катку") => ({ inline_keyboard: [[{ text, web_app: { url: matchUrl(id) } }]] });
export const MATCH_TEXT = (id) => `Катка ${id}. Жми кнопку — откроется разбор: кто слил, ошибки по таймкодам, повтор на карте. `
  + "Если реплей ещё не разобран, приложение само закажет его у OpenDota.";

// ---------- рефералка ----------
export const refLink = (id) => `https://t.me/${BOT}?startapp=r${id}`;
export const refOf = (src) => { const m = /^r(\d{1,20})$/.exec(String(src || "")); return m ? m[1] : null; };

// Первое открытие приложения: запомнить, кто позвал. Себя не зовут, старых юзеров не переписываем
export async function noteReferral(env, userId, src) {
  const by = refOf(src);
  if (!by || by === String(userId)) return null;
  await env.COACH_KV.put(`ref:${userId}`, by);
  return by;
}

// Друг посмотрел свой первый разбор — бонус обоим. Один раз на друга, даже если пачки событий пришли разом
export async function rewardReferral(env, tg, userId, now = Date.now()) {
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
  await tg("sendMessage", { chat_id: Number(userId), text: "Ты пришёл по приглашению друга — держи бесплатный разбор ИИ-тренера. Он уже на счету.",
    reply_markup: { inline_keyboard: [[{ text: "Открыть разбор", web_app: { url: APP_URL } }]] } });
  if (inviter) {
    await tg("sendMessage", { chat_id: Number(by), text: `Друг, которого ты позвал, разобрал первую катку. Тебе +${REF_BONUS} разбор ИИ-тренера, уже на счету. `
      + `Всего привёл: ${n}. Зови ещё — ссылка в приложении, раздел «Профиль».`,
      reply_markup: { inline_keyboard: [[{ text: "Открыть разбор", web_app: { url: APP_URL } }]] } });
  }
  return { by, n, inviter };
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
  await tg("sendMessage", { chat_id: Number(userId), text: `Серия ${n} ${plural(n, "день", "дня", "дней")} подряд с разборами! Держи бесплатный разбор ИИ-тренера, он уже на счету. `
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
export async function weeklyDigest(env, tg, now = Date.now(), fetcher = fetch) {
  const d = new Date(now), kv = env.COACH_KV;
  if (!kv || d.getUTCDay() !== 1 || d.getUTCHours() < 7 || d.getUTCHours() > 10) return 0;
  const week = mskDay(now);
  if (await kv.get(`digest:${week}:end`)) return 0;
  let sent = 0, seen = 0, cursor;
  for (let page = 0; page < 20; page++) {
    const got = await kv.list({ prefix: "user:", cursor });
    for (const k of got.keys) {
      const id = k.name.slice(5);
      if (!/^\d{1,20}$/.test(id)) continue; // user:<id>:a<аккаунт> — второй аккаунт того же человека
      if (await kv.get(`digest:${week}:${id}`)) continue;
      if (seen >= DIGEST_BATCH) return sent;
      seen++;
      await kv.put(`digest:${week}:${id}`, "1", { expirationTtl: 9 * 86400 });
      if (await kv.get(`nodigest:${id}`)) continue;
      const user = await kv.get(k.name, "json").catch(() => null);
      const acc = Number(user && user.account_id);
      if (!acc) continue;
      let matches = null;
      try {
        const res = await fetcher(`https://api.opendota.com/api/players/${acc}/recentMatches`, { signal: AbortSignal.timeout(8000) });
        matches = res.ok ? await res.json() : null;
      } catch { /* OpenDota не ответила — в эту неделю без сводки */ }
      const s = weekSummary(matches, now);
      if (!s) continue;
      if (await tg("sendMessage", { chat_id: Number(id), text: digestText(s), reply_markup: matchButton(s.worst.match_id, "Разобрать эту катку") })) sent++;
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  await kv.put(`digest:${week}:end`, "1", { expirationTtl: 9 * 86400 });
  return sent;
}
