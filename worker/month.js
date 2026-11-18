// Игрок месяца: кто за календарный месяц (по МСК) чаще всех разбирал катки, открывал ачивки и меньше умирал,
// получает подписку на месяц в подарок. Решение Ярика 18.11.2026.
//
// Ключи: mon:<ГГГГ-ММ>:<tg id> — итоги человека за месяц
//   { dn: дней с разборами, ld: последний такой день, a: разборов, a0: ачивок на начало месяца, ac: ачивок сейчас,
//     g, w, d: игр, побед и смертей из сводок недели };
// motm:<ГГГГ-ММ> — подарок за месяц уже выдан (id победителя или «-», если никто не набрал минимум).
// Ачивки считает приложение (engine.js, achievements) и присылает число открытых в счётчиках (mode: track, поле ach).
// tg(method, body) — вызов Bot API: результат или null.

import { giftDays } from "./pay.js";
import { CHAT_ID } from "./chatguard.js";

const BOT = "DotaRazbor_bot";
const APP_URL = "https://bezzz22.github.io/KORPl/";
export const MOTM_DAYS = 30;        // сколько дней подписки в подарок
export const MOTM_MIN_DAYS = 5;     // дней с разборами за месяц, чтобы участвовать
const MON_TTL = 70 * 86400;

const mskDay = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
export const monthOf = (now) => mskDay(now).slice(0, 7);
const prevMonth = (m) => { const [y, mm] = m.split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; };
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const monthName = (m, of = false) => (of ? MONTHS_OF : MONTHS)[Number(m.slice(5, 7)) - 1] || m;

const key = (month, id) => `mon:${month}:${id}`;
async function read(env, month, id) {
  return (await env.COACH_KV.get(key(month, id), "json").catch(() => null)) || { dn: 0, ld: "", a: 0, g: 0, w: 0, d: 0 };
}
const write = (env, month, id, r) => env.COACH_KV.put(key(month, id), JSON.stringify(r), { expirationTtl: MON_TTL });

// Очки месяца. Дни важнее числа разборов: десять разборов за вечер не перебьют человека, который заходит каждый день
export function monthScore(r) {
  const dn = Number(r && r.dn) || 0, a = Number(r && r.a) || 0, g = Number(r && r.g) || 0;
  const ach = Math.max(0, (Number(r && r.ac) || 0) - (Number(r && r.a0) || 0));
  let pts = dn * 10 + Math.min(a, dn * 3) * 2 + ach * 15;
  if (g >= 10) {
    pts += Math.round(Math.max(0, 8 - (Number(r.d) || 0) / g) * 10);       // 3 смерти за катку = +50
    pts += Math.max(0, Math.round(((Number(r.w) || 0) / g - 0.5) * 100)); // винрейт 60% = +10
  }
  return pts;
}

// Настоящий разбор (onRealAnalysis): день и разбор в итоги месяца
export async function noteMonthAnalysis(env, id, now = Date.now()) {
  const month = monthOf(now), day = mskDay(now);
  const r = await read(env, month, id);
  if (r.ld !== day) { r.dn = (Number(r.dn) || 0) + 1; r.ld = day; }
  r.a = (Number(r.a) || 0) + 1;
  await write(env, month, id, r);
  return r;
}

// Число открытых ачивок из приложения. Точка отсчёта — сколько было в конце прошлого месяца, а если тогда не было
// данных — первое число в этом месяце. Пишем только когда число выросло
export async function noteMonthAch(env, id, n, now = Date.now()) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > 200) return null;
  const month = monthOf(now);
  const r = await read(env, month, id);
  if (r.a0 == null) {
    const prev = await env.COACH_KV.get(key(prevMonth(month), id), "json").catch(() => null);
    r.a0 = prev && prev.ac != null ? Math.min(Number(prev.ac) || 0, n) : n;
    r.ac = n;
  } else if (n > (Number(r.ac) || 0)) r.ac = n;
  else return r;
  await write(env, month, id, r);
  return r;
}

// Сводка недели (weeklyDigest): игры, победы и смерти за неделю — в месяц, на который пришлась прошлая неделя
export async function noteMonthWeek(env, id, s, now = Date.now()) {
  if (!s || !s.games) return null;
  const month = monthOf(now - 86400_000);
  const r = await read(env, month, id);
  r.g = (Number(r.g) || 0) + s.games;
  r.w = (Number(r.w) || 0) + s.wins;
  r.d = (Number(r.d) || 0) + Math.round(s.deaths * s.games);
  await write(env, month, id, r);
  return r;
}

async function rows(env, month, skip = () => false) {
  const out = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const got = await env.COACH_KV.list({ prefix: `mon:${month}:`, cursor });
    for (const k of got.keys) {
      const id = k.name.split(":")[2];
      if (!/^\d{1,20}$/.test(id) || skip(id)) continue;
      const r = await env.COACH_KV.get(k.name, "json").catch(() => null);
      if (r) out.push({ id, r, pts: monthScore(r) });
    }
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  // при равных очках выше тот, у кого больше дней
  return out.sort((x, y) => y.pts - x.pts || (Number(y.r.dn) || 0) - (Number(x.r.dn) || 0));
}

// Вкладка «Бонусы»: очки, место и сколько дней ещё нужно до участия
export async function monthView(env, id, now = Date.now(), skip) {
  const month = monthOf(now);
  const list = await rows(env, month, skip);
  const me = list.findIndex((x) => x.id === String(id));
  const r = me >= 0 ? list[me].r : null;
  const days = Number(r && r.dn) || 0;
  return { month: monthName(month), pts: me >= 0 ? list[me].pts : 0, place: me >= 0 ? me + 1 : 0, total: list.length,
    days, need: Math.max(0, MOTM_MIN_DAYS - days), prize_days: MOTM_DAYS };
}

export function winnerText(month, r) {
  const dn = Number(r.dn) || 0, a = Number(r.a) || 0, ach = Math.max(0, (Number(r.ac) || 0) - (Number(r.a0) || 0));
  const lines = [`Ты красавчик! По итогам ${monthName(month, true)} ты игрок месяца у бота.`, ""];
  lines.push(`${dn} ${plural(dn, "день", "дня", "дней")} с разборами, ${a} ${plural(a, "катка разобрана", "катки разобрано", "каток разобрано")}`
    + (ach ? `, ${ach} ${plural(ach, "новая ачивка", "новые ачивки", "новых ачивок")}` : "") + ".");
  if ((Number(r.g) || 0) >= 10) lines.push(`В среднем ${String(Math.round((r.d / r.g) * 10) / 10).replace(".", ",")} ${plural(Math.round(r.d / r.g), "смерть", "смерти", "смертей")} за катку.`);
  lines.push("", `Держи подписку на месяц в подарок: полный разбор и ИИ-тренер на ${MOTM_DAYS} дней уже включены. Так держать.`);
  return lines.join("\n");
}

const firstName = (seen) => String((seen && seen.metadata && seen.metadata.n) || "").trim().split(/\s+/)[0].replace(/[<>@]/g, "").slice(0, 20);

// Крон: 1-го числа с 15:00 МСК (после сводки недели, если 1-е — понедельник) подводим итоги прошлого месяца.
// Владелец не участвует. Победителю — подписка и письмо, в чат канала — имя (если не просил /notop), владельцу — кто выиграл
export async function monthAward(env, tg, now = Date.now(), { isOwner = () => false, owners = [] } = {}) {
  const kv = env.COACH_KV;
  if (!kv) return null;
  const msk = new Date(now + 3 * 3600_000);
  if (msk.getUTCDate() !== 1 || msk.getUTCHours() < 15) return null;
  const month = prevMonth(monthOf(now));
  const claim = `motm:${month}`;
  if (await kv.get(claim)) return null;
  const list = (await rows(env, month, isOwner)).filter((x) => (Number(x.r.dn) || 0) >= MOTM_MIN_DAYS);
  const win = list[0];
  if (kv.cas) { if (!(await kv.cas(claim, null, win ? win.id : "-"))) return null; }
  else await kv.put(claim, win ? win.id : "-", { expirationTtl: 400 * 86400 });
  if (!win) return { month, winner: null };
  await giftDays(env, win.id, MOTM_DAYS, now);
  await tg("sendMessage", { chat_id: Number(win.id), text: winnerText(month, win.r), reply_markup: { inline_keyboard: [[{ text: "Открыть разбор", web_app: { url: APP_URL } }]] } });
  const seen = await kv.getWithMetadata(`seen:${win.id}`).catch(() => null);
  const name = firstName(seen);
  if (name && !(await kv.get(`notop:${win.id}`))) {
    await tg("sendMessage", { chat_id: CHAT_ID, disable_notification: true, link_preview_options: { is_disabled: true },
      text: `Игрок ${monthName(month, true)} у бота — ${name}. ${Number(win.r.dn) || 0} ${plural(Number(win.r.dn) || 0, "день", "дня", "дней")} с разборами и ${win.pts} очков. Получает подписку на месяц.\n\n`
        + `В этом месяце может быть ты: разбирай катки хотя бы ${MOTM_MIN_DAYS} дней, открывай ачивки и умирай поменьше. Очки и место — во вкладке «Бонусы».`,
      reply_markup: { inline_keyboard: [[{ text: "Разобрать свою катку", url: `https://t.me/${BOT}?start=motm` }]] } });
  }
  for (const o of owners) await tg("sendMessage", { chat_id: Number(o), text: `Игрок месяца (${monthName(month)}): ${name || "без имени"} (${win.id}), ${win.pts} очков, участников с ${MOTM_MIN_DAYS}+ днями: ${list.length}. Подписка на ${MOTM_DAYS} дней выдана.` });
  return { month, winner: win.id, pts: win.pts };
}
