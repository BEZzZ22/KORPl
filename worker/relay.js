// Выгрузка OpenDota через GitHub Actions.
// OpenDota отвечает 429 на запросы с IP Cloudflare Workers (генеральная проверка 03.11), поэтому всё, что воркер
// сам брал у неё, молча не работало: карточки в пати-чатах, «реплей разобран», сводка недели.
// Теперь workflow «Выгрузка OpenDota» (od-relay.yml, tools/od-relay.mjs) раз в 20 секунд спрашивает GET /relay,
// что нужно, сам ходит в OpenDota (с раннеров GitHub она отвечает) и отдаёт ответы в POST /relay. Воркер подставляет
// их вместо fetch (mapFetcher) и делает своё: редактирует карточку в чате, пишет «разобран», шлёт сводку и пуши.
//
// Ключи: pq:<чат>:<матч> — карточка в пати-чате ждёт катку; odreq:<матч> — заявку на разбор реплея отправить из Actions;
// relay_seen — когда выгрузка последний раз спрашивала; relay_kick — когда воркер её запускал; relay_round — обход
// всех привязанных аккаунтов (раз в час: пуш после катки, по понедельникам сводка); lastm:<tg id> — последняя катка,
// о которой знаем; pushlast:<tg id> — когда был последний пуш (живёт PUSH_GAP); nopush:<tg id> — отписался от пушей.

import { matchButton, mskDay, weeklyDigest, digestWindow } from "./growth.js";
import { partyRelay, partyHeroes, PARTY_Q } from "./party.js";

export const ODREQ_PREFIX = "odreq:";
export const RELAY_ROUND = 3600_000;
const ACTIVE_DAYS = 14;
const PUSH_BUDGET = 1200;               // запросов в сутки на обход аккаунтов из ~2000 бесплатных у OpenDota
export const roundGap = (n) => RELAY_ROUND * Math.max(1, Math.ceil((n * 24) / PUSH_BUDGET));
// 08.11 решение Ярика: звать на разбор не после каждой катки, а одним сообщением раз в 2–3 дня
export const PUSH_GAP = 60 * 3600_000;
const PUSH_FRESH = 3 * 3600_000;        // катка закончилась больше 3 часов назад — уже не пушим
const RELAY_STALE = 90_000;             // выгрузка не спрашивала полторы минуты — значит, не запущена
const KICK_GAP = 10 * 60;               // запускаем не чаще раза в 10 минут: прогон стартует до минуты
const REPO = "BEZzZ22/KORPl";
const REF = "claude/opus-55-capabilities-limits-ekkxhj";

export async function listAll(kv, prefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const got = await kv.list({ prefix, cursor });
    out.push(...got.keys);
    if (got.list_complete || !got.cursor) break;
    cursor = got.cursor;
  }
  return out;
}

// Ответы выгрузки вместо fetch: путь есть — 200, null — 404 (OpenDota не знает), нет — 503 (не принесли)
export function mapFetcher(data) {
  return async (url) => {
    const path = new URL(url).pathname.replace(/^\/api/, "");
    if (!Object.prototype.hasOwnProperty.call(data, path)) return new Response("нет в выгрузке", { status: 503 });
    if (data[path] === null) return new Response("null", { status: 404 });
    return new Response(JSON.stringify(data[path]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

// Что выгрузке сходить взять в OpenDota. Только пути и номера матчей, без людей: users — tg id → аккаунт,
// они нужны, чтобы POST знал, чьи это катки (выгрузка возвращает их как есть)
export async function relayTasks(env, now = Date.now()) {
  const kv = env.COACH_KV;
  await kv.put("relay_seen", String(now), { expirationTtl: 86400 });
  const paths = new Set();
  for (const k of await listAll(kv, PARTY_Q)) paths.add(`/matches/${k.name.split(":")[2]}`);
  for (const k of await listAll(kv, "watch:")) { const m = k.name.split(":")[2]; if (/^\d{6,12}$/.test(m || "")) paths.add(`/matches/${m}`); }
  const requests = (await listAll(kv, ODREQ_PREFIX)).map((k) => Number(k.name.slice(ODREQ_PREFIX.length))).filter((x) => x > 1e6);
  let users = null;
  if (now >= (Number(await kv.get("relay_round")) || 0)) {
    // кого обходим: заходившие за 2 недели (пуш после катки), а в окно сводки недели — все привязанные
    const digest = digestWindow(now) && !(await kv.get(`digest:${mskDay(now)}:end`));
    const active = new Set();
    if (!digest) {
      for (let i = 0; i < ACTIVE_DAYS; i++) {
        for (const k of await listAll(kv, `act:${mskDay(now - i * 86400_000)}:`)) active.add(k.name.split(":")[2]);
      }
    }
    users = {};
    for (const k of await listAll(kv, "user:")) {
      const id = k.name.slice(5);
      if (!/^\d{1,20}$/.test(id) || (!digest && !active.has(id))) continue;
      const u = await kv.get(k.name, "json").catch(() => null);
      const acc = Number(u && u.account_id);
      if (!acc) continue;
      users[id] = acc;
      paths.add(`/players/${acc}/recentMatches`);
    }
    // бесплатный лимит OpenDota ~2000 запросов в сутки: на пуши тратим до ~1200, дальше обход реже
    const n = Object.keys(users).length;
    await kv.put("relay_round", String(now + roundGap(n)), { expirationTtl: 7 * 86400 });
  }
  if (paths.size && !(await kv.get("party_heroes"))) paths.add("/constants/heroes");
  return { paths: [...paths].slice(0, 100), requests: requests.slice(0, 30), users };
}

// Пуш после катки: «сыграл на Тини — разобрать?». Первый обход только запоминает последнюю катку
export async function pushNewMatches(env, tg, users, data, heroes, now = Date.now()) {
  const kv = env.COACH_KV;
  let sent = 0;
  for (const [id, acc] of Object.entries(users || {})) {
    const list = data[`/players/${acc}/recentMatches`];
    if (!Array.isArray(list) || !list.length) continue;
    const m = list.reduce((a, b) => (Number(b.match_id) > Number(a.match_id) ? b : a));
    const key = `lastm:${id}`;
    const last = Number(await kv.get(key)) || 0;
    if (Number(m.match_id) <= last) continue;
    await kv.put(key, String(m.match_id), { expirationTtl: 60 * 86400 });
    if (!last) continue;
    if (now - (Number(m.start_time) + Number(m.duration)) * 1000 > PUSH_FRESH) continue;
    if (await kv.get(`nopush:${id}`)) continue;
    const gapKey = `pushlast:${id}`;
    if (now - (Number(await kv.get(gapKey)) || 0) < PUSH_GAP) continue;
    await kv.put(gapKey, String(now), { expirationTtl: PUSH_GAP / 1000 });
    if (await tg("sendMessage", { chat_id: Number(id), text: pushText(m, heroes), reply_markup: matchButton(m.match_id, "Разобрать катку") })) sent++;
  }
  return sent;
}

export function pushText(m, heroes = {}) {
  const hero = (heroes[m.hero_id] && heroes[m.hero_id][1]) || "";
  const won = (m.player_slot < 128) === Boolean(m.radiant_win);
  const head = `${hero ? `Катка на ${hero}` : "Новая катка"}: ${won ? "победа" : "поражение"}, ${m.kills}/${m.deaths}/${m.assists}, ${Math.round((m.duration || 0) / 60)} мин.`;
  const tail = won ? "Глянем, что можно было сыграть ещё лучше?" : "Разберём, где ушла игра и кто слил?";
  return `${head}\n${tail}\n\nОтключить такие сообщения: /nopush`;
}

// Ответы выгрузки: карточки в чатах, «реплей разобран», сводка недели, пуши. checkWatches — из coach.js
export async function relayRun(env, tg, body, now = Date.now(), { checkWatches } = {}) {
  const kv = env.COACH_KV;
  const data = body && body.data && typeof body.data === "object" ? body.data : {};
  const fetcher = mapFetcher(data);
  const out = { party: 0, watch: 0, push: 0, digest: 0 };
  for (const id of Array.isArray(body && body.requested) ? body.requested : []) await kv.delete(`${ODREQ_PREFIX}${Number(id)}`);
  const heroes = await partyHeroes(env, fetcher);
  out.party = await partyRelay(env, tg, data, heroes, (p) => listAll(kv, p));
  if (checkWatches) out.watch = await checkWatches(env, now, fetcher, (m) => kv.put(`${ODREQ_PREFIX}${m}`, "1", { expirationTtl: 3600 }));
  if (body && body.users && typeof body.users === "object") {
    if (digestWindow(now)) out.digest = await weeklyDigest(env, tg, now, fetcher, 30);
    out.push = await pushNewMatches(env, tg, body.users, data, heroes, now);
  }
  return out;
}

// Выгрузка не спрашивает — запускаем workflow сами (крон GitHub на бесплатном тарифе ленивый)
export async function kickRelay(env, now = Date.now(), fetcher = fetch) {
  const kv = env.COACH_KV;
  if (!env.GH_TOKEN || !kv) return false;
  if (now - (Number(await kv.get("relay_seen")) || 0) < RELAY_STALE) return false;
  if (await kv.get("relay_kick")) return false;
  await kv.put("relay_kick", String(now), { expirationTtl: KICK_GAP });
  const res = await fetcher(`https://api.github.com/repos/${REPO}/actions/workflows/od-relay.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "dotacoach", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: env.GH_REF || REF }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!res || !res.ok) console.log(`выгрузка OpenDota: запуск не прошёл ${res ? res.status : "сеть"}`);
  return Boolean(res && res.ok);
}
