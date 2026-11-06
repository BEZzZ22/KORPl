// Выгрузка OpenDota для воркера (workflow «Выгрузка OpenDota», od-relay.yml).
// Воркеру OpenDota отвечает 429 (общие IP Cloudflare), а раннеру GitHub — 200. Раз в 20 секунд спрашиваем воркер
// GET /relay, что принести, ходим в OpenDota и отдаём ответы в POST /relay (worker/relay.js).
// В лог — только числа: репо публичный, номера матчей и аккаунтов туда не пишем.
// Нужен секрет BOT_TOKEN (тот же ключ, что у «Отчёта по юзерам»).

const WORKER = process.env.WORKER_URL || "https://dotacoach.2007rggg.workers.dev";
const OD = "https://api.opendota.com/api";
const HEADERS = { "User-Agent": "DotaRazbor/1.0 (+https://t.me/DotaRazbor_bot)", Accept: "application/json" };
const POLL = 20_000;
const GAP = 1100;                       // OpenDota без ключа: до 60 запросов в минуту

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Матч целиком весит мегабайты, воркеру на бесплатном тарифе столько не разобрать. Оставляем то, что нужно
// карточке «Кто слил» (docs/blame.js) и проверке «реплей разобран»: числа у игроков, kills_log, есть ли lh_t
export function trimMatch(m) {
  if (!m || typeof m !== "object") return m;
  const scalars = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === null || typeof v !== "object"));
  return {
    ...scalars(m),
    players: Array.isArray(m.players) ? m.players.map((p) => ({
      ...scalars(p),
      kills_log: Array.isArray(p.kills_log) ? p.kills_log.map((k) => ({ time: k.time, key: k.key })) : undefined,
      lh_t: p.lh_t != null ? [] : null,
    })) : m.players,
  };
}

export function trimHeroes(raw) {
  const out = {};
  for (const [k, h] of Object.entries(raw || {})) if (h && h.id) out[k] = { id: h.id, name: h.name, localized_name: h.localized_name };
  return out;
}

export function trim(path, json) {
  if (path.startsWith("/matches/")) return trimMatch(json);
  if (path === "/constants/heroes") return trimHeroes(json);
  if (/\/recentMatches$/.test(path) && Array.isArray(json)) {
    return json.slice(0, 20).map((x) => ({ match_id: x.match_id, player_slot: x.player_slot, radiant_win: x.radiant_win, hero_id: x.hero_id,
      kills: x.kills, deaths: x.deaths, assists: x.assists, duration: x.duration, start_time: x.start_time, game_mode: x.game_mode }));
  }
  return json;
}

async function od(path, init = {}) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${OD}${path}`, { ...init, headers: HEADERS, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (res && res.status === 429) { await sleep(30_000); continue; }
    return res;
  }
  return null;
}

async function worker(method, body) {
  const res = await fetch(`${WORKER}/relay`, {
    method, headers: { Authorization: `Bearer ${process.env.BOT_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  if (!res || !res.ok) throw new Error(`воркер ${method}: ${res ? res.status : "сеть"}`);
  return res.json();
}

async function round() {
  const task = await worker("GET");
  const data = {}, requested = [];
  let got = 0, miss = 0;
  for (const id of task.requests || []) {
    const res = await od(`/request/${id}`, { method: "POST" });
    if (res && res.ok) requested.push(id);
    await sleep(GAP);
  }
  for (const path of task.paths || []) {
    const res = await od(path);
    if (res && res.ok) { data[path] = trim(path, await res.json().catch(() => null)); got++; }
    else if (res && res.status === 404) { data[path] = null; got++; }
    else miss++;
    await sleep(GAP);
  }
  if (!got && !requested.length && !task.users) return { got, miss };
  const out = await worker("POST", { data, requested, users: task.users || null });
  return { got, miss, requested: requested.length, ...out };
}

async function main() {
  if (!process.env.BOT_TOKEN) { console.log("Нет секрета BOT_TOKEN"); process.exit(1); }
  const until = Date.now() + Number(process.env.RELAY_MINUTES || 340) * 60_000;
  let rounds = 0, fails = 0;
  while (Date.now() < until) {
    const t0 = Date.now();
    try {
      const r = await round();
      rounds++;
      if (r.got || r.miss || r.requested) console.log(`OpenDota: принесли ${r.got}, не ответила ${r.miss}, заявок ${r.requested || 0}; карточек ${r.party || 0}, разобрано ${r.watch || 0}, пушей ${r.push || 0}, сводок ${r.digest || 0}`);
      fails = 0;
    } catch (e) {
      fails++;
      console.log(`заход не удался (${fails} подряд): ${String(e && e.message || e).slice(0, 80)}`);
      if (fails >= 30) process.exit(1);
    }
    await sleep(Math.max(1000, POLL - (Date.now() - t0)));
  }
  console.log(`дежурство окончено, заходов ${rounds}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
