// Видеоразбор катки: человек просит ролик у бота, воркер ставит заявку в очередь и будит GitHub Actions
// (.github/workflows/video.yml). Там реплей качается, разбирается и рендерится (tools/video/, без нейросетей),
// ролик уходит человеку прямо из Actions, а воркеру приходит отметка «готово» или причина отказа.
// Заявка — ключ vq:<матч>:<tg id> со значением { t, account, slot }. Очередь отдаётся только по ключу выгрузки:
// в ней Telegram id.
import { matchFromText } from "./growth.js";
import { PACKS, spendVideo, giveVideo, invoiceLink, payUrl, robokassaOn } from "./pay.js";
import { matchWidgetStatus } from "./widget.js";

export const VIDEO_PREFIX = "vq:";
export const VIDEO_FREE_DAYS = 7;          // один бесплатный ролик раз в столько дней, дальше — платный (PACKS.video); владельцу — без счёта
const WANT_TTL = 3600;                     // сколько помним, какой ролик человек хотел, пока он платит
const weekKey = (user) => `vweek:${user}`;
const wantKey = (user) => `vwant:${user}`;
export const VIDEO_TTL = 3 * 3600 * 1000;  // заявка старше — Actions так и не справился, снимаем
const VIDEO_WORKFLOW = "https://api.github.com/repos/BEZzZ22/KORPl/actions/workflows/video.yml/dispatches";
const VIDEO_REF = "claude/opus-55-capabilities-limits-ekkxhj";

export const VIDEO_BUTTON = (id) => ({ text: "Видеоразбор", callback_data: `vid:${id}` });
// Владельцу: выбрать игрока в чужой катке. Места 1–5 — Свет, 6–10 — Тьма
export const slotKeyboard = (match) => ({ inline_keyboard: [0, 1].map((r) => Array.from({ length: 5 }, (_, i) => {
  const n = r * 5 + i + 1;
  return { text: `${r ? "Тьма" : "Свет"} ${i + 1}`, callback_data: `vid:${match}:${n}` };
})) });
const isOwnerId = (env, id) => String(env.OWNER_TG_IDS || "").split(",").map((x) => x.trim()).includes(String(id));
export const VIDEO_HELP = `Видеоразбор: напиши /video и номер матча — пришлю ролик на минуту с главными моментами катки на карте, с озвучкой. Один в неделю бесплатно, дальше ${PACKS.video.stars} звёзд или ${PACKS.video.rub} ₽ за ролик.`;

// «/video 9079943457», «/video <ссылка>», владелец может добавить место игрока 1–10: «/video 9079943457 6»
export function parseVideoCommand(text) {
  const m = /^\/video(?:@\w+)?(?:\s+(.*))?$/is.exec(String(text || "").trim());
  if (!m) return null;
  const rest = String(m[1] || "").trim();
  if (!rest) return { match: null, pick: null };
  const [first, second] = rest.split(/\s+/);
  const match = matchFromText(first) || (/^\d{7,11}$/.test(first) ? Number(first) : null);
  const pick = /^(?:[1-9]|10)$/.test(second || "") ? Number(second) : null;
  return { match, pick };
}

export async function kickVideo(env, now = Date.now(), gap = 60 * 1000) {
  if (!env.GH_TOKEN || !env.COACH_KV) return false;
  const last = Number(await env.COACH_KV.get("video_kick")) || 0;
  if (now - last < gap) return false;
  await env.COACH_KV.put("video_kick", String(now), { expirationTtl: 86400 });
  const res = await fetch(VIDEO_WORKFLOW, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "dotacoach", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: env.GH_REF || VIDEO_REF }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  return !!(res && res.ok);
}

async function entries(env) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const page = await env.COACH_KV.list({ prefix: VIDEO_PREFIX, cursor });
    for (const k of page.keys) {
      const [match, user] = k.name.slice(VIDEO_PREFIX.length).split(":").map(Number);
      const v = await env.COACH_KV.get(k.name, "json").catch(() => null);
      if (!match || !user || !v) { await env.COACH_KV.delete(k.name); continue; }
      out.push({ key: k.name, match, user, t: Number(v.t) || 0, account: v.account || null, slot: Number.isInteger(v.slot) ? v.slot : null });
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return out.sort((a, b) => a.t - b.t);
}

// Заявка от человека. tg(method, body) — вызов Bot API. Возвращает { video: статус }
// seat — место игрока 0–9 из приложения: там человек смотрит разбор конкретного игрока, аккаунт привязывать не нужно
// Если по катке висит карточка-виджет (worker/widget.js), в ней же обновляется статус ролика
export async function requestVideo(env, tg, args, now = Date.now()) {
  const r = await askVideo(env, tg, args, now);
  if (r && args && args.match && r.video !== "no_match") await matchWidgetStatus(env, tg, args.user, args.match, r.video).catch(() => false);
  return r;
}
const widgetStatus = (env, tg, user, match, v) => matchWidgetStatus(env, tg, user, match, v).catch(() => false);

async function askVideo(env, tg, { user, match, pick = null, owner = false, seat = null }, now = Date.now()) {
  const say = (text, extra = {}) => tg("sendMessage", { chat_id: user, text, ...extra });
  if (!match) { await say("Пришли номер матча, например 8123456789: он есть в истории матчей в Доте и в приложении. Под ним будет кнопка «Видеоразбор»."); return { video: "no_match" }; }
  const profile = await env.COACH_KV.get(`user:${user}`, "json").catch(() => null);
  const account = Number(profile && profile.account_id) || null;
  const slot = owner && pick ? pick - 1 : (Number.isInteger(seat) && seat >= 0 && seat <= 9 ? seat : null);
  // владелец без привязанного аккаунта и без места: сразу спрашиваем, чей ролик
  if (owner && !account && slot === null) {
    await say(`Чей ролик по матчу ${match}? Выбери место игрока.`, { reply_markup: slotKeyboard(match) });
    return { video: "pick" };
  }
  if (!account && slot === null) {
    await say("Чтобы я знал, кто ты в этой катке, сначала привяжи аккаунт: кинь сюда свой Friend ID (цифры из профиля Доты). Потом повтори /video.");
    return { video: "no_account" };
  }
  const key = `${VIDEO_PREFIX}${match}:${user}`;
  if (await env.COACH_KV.get(key)) { await say(`Ролик по матчу ${match} уже делается, пришлю сюда.`); return { video: "busy" }; }
  // чем платим за ролик: бесплатный раз в неделю, потом купленный со счёта; нет ни того, ни другого — счёт на оплату
  let paid = "owner";
  if (!owner) {
    if (!(await env.COACH_KV.get(weekKey(user)))) paid = "free";
    else if (await spendVideo(env, user)) paid = "credit";
    else {
      await env.COACH_KV.put(wantKey(user), JSON.stringify({ match, seat: slot }), { expirationTtl: WANT_TTL });
      const p = PACKS.video;
      const stars = await Promise.resolve(invoiceLink(tg, "video", String(user))).catch(() => null);
      const card = robokassaOn(env) && env.BOT_TOKEN ? await payUrl(env.BOT_TOKEN, { id: user }, now).catch(() => null) : null;
      const rows = [];
      if (typeof stars === "string") rows.push([{ text: `Оплатить ${p.stars} звёзд`, url: stars }]);
      if (card) rows.push([{ text: `Картой или СБП, ${p.rub} ₽`, url: card }]);
      await say(`Бесплатный видеоразбор на этой неделе ты уже взял: он один раз в ${VIDEO_FREE_DAYS} дней. Ещё один ролик — ${p.stars} звёзд или ${p.rub} ₽. `
        + `Оплатишь — сразу начну делать ролик по матчу ${match}.`, rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
      return { video: "pay" };
    }
  }
  await env.COACH_KV.put(key, JSON.stringify({ t: now, account, slot, paid }), { expirationTtl: Math.ceil(VIDEO_TTL / 1000) + 3600 });
  if (paid === "free") await env.COACH_KV.put(weekKey(user), String(now), { expirationTtl: VIDEO_FREE_DAYS * 86400 });
  await env.COACH_KV.delete(wantKey(user));
  await env.COACH_KV.put("video_last", String(now), { expirationTtl: 86400 });
  const kicked = await kickVideo(env, now, 0);
  await say(`Делаю видеоразбор матча ${match}: качаю реплей, ищу ключевые моменты, рисую их на карте и озвучиваю. Ролик пришлю сюда минут через 5–10.`);
  return { video: "queued", kicked };
}

// Очередь для Actions (GET /video-queue): самые старые заявки первыми
export async function videoQueue(env, now = Date.now()) {
  return { jobs: (await entries(env)).filter((x) => now - x.t < VIDEO_TTL).slice(0, 5).map(({ match, user, account, slot }) => ({ match, user, account, slot })) };
}

// Сколько заявок ждёт сборки: дежурный выгрузки (tools/od-relay.mjs) по этому числу запускает workflow «Видеоразбор».
// Запуск от самого воркера (GH_TOKEN) — запасной: токен бывает просрочен, и заявка висела бы до ручного запуска
export async function videoPending(env, now = Date.now()) {
  if (!env.COACH_KV) return 0;
  const last = Number(await env.COACH_KV.get("video_last")) || 0;
  if (!last || now - last > VIDEO_TTL + 3600_000) return 0;
  const n = (await videoQueue(env, now)).jobs.length;
  if (!n) await env.COACH_KV.delete("video_last"); // очередь пуста: до новой заявки list не тратим
  return n;
}

const WHY = {
  no_replay: "реплея нет. Valve хранит реплеи около двух недель, а свежему матчу нужно минут 10–15 после конца игры",
  not_in_match: "тебя нет среди игроков этого матча. Проверь номер матча и привязанный аккаунт",
  no_moments: "в катке не нашлось моментов для ролика: слишком короткая или без драк",
  parse: "реплей не разобрался",
  send: "ролик собрался, но Телеграм его не принял",
};

async function giveBack(env, user, raw) {
  let paid = null;
  try { paid = JSON.parse(raw).paid; } catch { /* старая заявка без отметки */ }
  if (paid === "free") await env.COACH_KV.delete(weekKey(user));
  if (paid === "credit") await giveVideo(env, user, 1);
}

// После оплаты: человек хотел ролик и упёрся в счёт — начинаем его делать сразу
export async function resumeVideo(env, tg, user, now = Date.now()) {
  const want = await env.COACH_KV.get(wantKey(user), "json").catch(() => null);
  if (!want || !want.match) return null;
  return requestVideo(env, tg, { user: Number(user), match: Number(want.match), seat: Number.isInteger(want.seat) ? want.seat : null }, now);
}

// Отметка от Actions (POST /video-queue): { match, user, status: "done" | "error", why }
export async function videoDone(env, tg, body, now = Date.now()) {
  const match = Number(body && body.match), user = Number(body && body.user);
  if (!match || !user) return { ok: false };
  const key = `${VIDEO_PREFIX}${match}:${user}`;
  const had = await env.COACH_KV.get(key);
  await env.COACH_KV.delete(key);
  if (had) await widgetStatus(env, tg, user, match, body.status === "done" ? "done" : "error");
  if (body.status !== "done" && had) {
    // неудача ничего не тратит: бесплатный ролик и купленный возвращаются
    await giveBack(env, user, had);
    // владельца в чужой катке нет: не отказ, а выбор игрока кнопками
    if (body.why === "not_in_match" && isOwnerId(env, user)) {
      await tg("sendMessage", { chat_id: user, text: `Тебя нет в матче ${match}. Чей ролик сделать? Выбери место игрока.`, reply_markup: slotKeyboard(match) });
    } else await tg("sendMessage", { chat_id: user, text: `Видеоразбор матча ${match} не получился: ${WHY[body.why] || "что-то сломалось на сборке, уже смотрим"}. Обычный разбор в приложении работает.` });
  }
  return { ok: true, had: Boolean(had) };
}

// Крон: заявка висит дольше 12 минут — будим Actions ещё раз; дольше VIDEO_TTL — снимаем и говорим человеку
export async function checkVideo(env, tg, now = Date.now()) {
  if (!env.COACH_KV) return 0;
  // без свежих заявок list не тратим
  const last = Number(await env.COACH_KV.get("video_last")) || 0;
  if (!last || now - last > VIDEO_TTL + 3600_000) return 0;
  const list = await entries(env);
  let dropped = 0;
  for (const x of list) {
    if (now - x.t < VIDEO_TTL) continue;
    await giveBack(env, x.user, await env.COACH_KV.get(x.key));
    await env.COACH_KV.delete(x.key);
    await widgetStatus(env, tg, x.user, x.match, "error");
    await tg("sendMessage", { chat_id: x.user, text: `Видеоразбор матча ${x.match} не успел собраться. Попробуй ещё раз: /video ${x.match}` });
    dropped++;
  }
  if (list.some((x) => now - x.t >= 12 * 60 * 1000 && now - x.t < VIDEO_TTL)) await kickVideo(env, now, 15 * 60 * 1000);
  return dropped;
}
