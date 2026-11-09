// Видеоразбор катки: человек просит ролик у бота, воркер ставит заявку в очередь и будит GitHub Actions
// (.github/workflows/video.yml). Там реплей качается, разбирается и рендерится (tools/video/, без нейросетей),
// ролик уходит человеку прямо из Actions, а воркеру приходит отметка «готово» или причина отказа.
// Заявка — ключ vq:<матч>:<tg id> со значением { t, account, slot }. Очередь отдаётся только по ключу выгрузки:
// в ней Telegram id.
import { matchFromText } from "./growth.js";

export const VIDEO_PREFIX = "vq:";
export const VIDEO_PER_DAY = 2;            // роликов в сутки на человека (владельцу — без счёта)
export const VIDEO_TTL = 3 * 3600 * 1000;  // заявка старше — Actions так и не справился, снимаем
const VIDEO_WORKFLOW = "https://api.github.com/repos/BEZzZ22/KORPl/actions/workflows/video.yml/dispatches";
const VIDEO_REF = "claude/opus-55-capabilities-limits-ekkxhj";
const mskDay = (now) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10);

export const VIDEO_BUTTON = (id) => ({ text: "Видеоразбор", callback_data: `vid:${id}` });
// Владельцу: выбрать игрока в чужой катке. Места 1–5 — Свет, 6–10 — Тьма
export const slotKeyboard = (match) => ({ inline_keyboard: [0, 1].map((r) => Array.from({ length: 5 }, (_, i) => {
  const n = r * 5 + i + 1;
  return { text: `${r ? "Тьма" : "Свет"} ${i + 1}`, callback_data: `vid:${match}:${n}` };
})) });
const isOwnerId = (env, id) => String(env.OWNER_TG_IDS || "").split(",").map((x) => x.trim()).includes(String(id));
export const VIDEO_HELP = "Видеоразбор: напиши /video и номер матча — пришлю ролик на минуту с главными моментами катки на карте, с озвучкой.";

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
export async function requestVideo(env, tg, { user, match, pick = null, owner = false }, now = Date.now()) {
  const say = (text, extra = {}) => tg("sendMessage", { chat_id: user, text, ...extra });
  if (!match) { await say("Напиши номер матча после команды: /video 8123456789. Номер есть в истории матчей в Доте и в приложении."); return { video: "no_match" }; }
  const profile = await env.COACH_KV.get(`user:${user}`, "json").catch(() => null);
  const account = Number(profile && profile.account_id) || null;
  const slot = owner && pick ? pick - 1 : null;
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
  const dayKey = `vday:${user}:${mskDay(now)}`;
  const used = Number(await env.COACH_KV.get(dayKey)) || 0;
  if (!owner && used >= VIDEO_PER_DAY) {
    await say(`На сегодня видеоразборы закончились: ${VIDEO_PER_DAY} в сутки. Завтра сделаю ещё, а обычный разбор в приложении без лимита.`);
    return { video: "limit" };
  }
  await env.COACH_KV.put(key, JSON.stringify({ t: now, account, slot }), { expirationTtl: Math.ceil(VIDEO_TTL / 1000) + 3600 });
  await env.COACH_KV.put(dayKey, String(used + 1), { expirationTtl: 2 * 86400 });
  await env.COACH_KV.put("video_last", String(now), { expirationTtl: 86400 });
  const kicked = await kickVideo(env, now, 0);
  await say(`Делаю видеоразбор матча ${match}: качаю реплей, ищу ключевые моменты, рисую их на карте и озвучиваю. Ролик пришлю сюда минут через 5–10.`);
  return { video: "queued", kicked };
}

// Очередь для Actions (GET /video-queue): самые старые заявки первыми
export async function videoQueue(env, now = Date.now()) {
  return { jobs: (await entries(env)).filter((x) => now - x.t < VIDEO_TTL).slice(0, 5).map(({ match, user, account, slot }) => ({ match, user, account, slot })) };
}

const WHY = {
  no_replay: "реплея нет. Valve хранит реплеи около двух недель, а свежему матчу нужно минут 10–15 после конца игры",
  not_in_match: "тебя нет среди игроков этого матча. Проверь номер матча и привязанный аккаунт",
  no_moments: "в катке не нашлось моментов для ролика: слишком короткая или без драк",
  parse: "реплей не разобрался",
  send: "ролик собрался, но Телеграм его не принял",
};

// Отметка от Actions (POST /video-queue): { match, user, status: "done" | "error", why }
export async function videoDone(env, tg, body, now = Date.now()) {
  const match = Number(body && body.match), user = Number(body && body.user);
  if (!match || !user) return { ok: false };
  const key = `${VIDEO_PREFIX}${match}:${user}`;
  const had = await env.COACH_KV.get(key);
  await env.COACH_KV.delete(key);
  if (body.status !== "done" && had) {
    // неудача не тратит дневной лимит
    const dayKey = `vday:${user}:${mskDay(now)}`;
    const used = Number(await env.COACH_KV.get(dayKey)) || 0;
    if (used > 0) await env.COACH_KV.put(dayKey, String(used - 1), { expirationTtl: 2 * 86400 });
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
    await env.COACH_KV.delete(x.key);
    await tg("sendMessage", { chat_id: x.user, text: `Видеоразбор матча ${x.match} не успел собраться. Попробуй ещё раз: /video ${x.match}` });
    dropped++;
  }
  if (list.some((x) => now - x.t >= 12 * 60 * 1000 && now - x.t < VIDEO_TTL)) await kickVideo(env, now, 15 * 60 * 1000);
  return dropped;
}
