// «Кто слил, кто тащил»: вклад всех десяти в катку и награды матча. Только по данным OpenDota, без реплея.
// Вклад — сумма мест игрока среди своих по роли (коры с корами, саппорты с саппортами) с весами под роль.

const TRADE_WINDOW = 10; // смерть с разменом: своя команда кого-то убила в ±10 секунд

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const k1 = (n) => (n >= 10000 ? `${Math.round(n / 1000)}к` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".0", "")}к` : String(Math.round(n)));
const clock = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const wards = (p) => { const n = (p.obs_placed || 0) + (p.sen_placed || 0); return `${n} ${plural(n, "вард", "варда", "вардов")}`; };

// Метрики: как достать, вес у кора и саппорта, как сказать хорошо и плохо
const METRICS = [
  { key: "nw", core: 0.22, sup: 0, get: (p) => p.net_worth || 0, good: (v) => `нетворс ${k1(v)}`, bad: (v) => `нетворс ${k1(v)}` },
  { key: "dmg", core: 0.2, sup: 0.1, get: (p) => p.hero_damage || 0, good: (v) => `урон по героям ${k1(v)}`, bad: (v) => `урон по героям ${k1(v)}` },
  { key: "bld", core: 0.1, sup: 0, get: (p) => p.tower_damage || 0, good: (v) => `по зданиям ${k1(v)}`, bad: (v) => `по зданиям ${k1(v)}` },
  { key: "kda", core: 0.13, sup: 0.15, get: (p) => ((p.kills || 0) + (p.assists || 0)) / Math.max(1, p.deaths || 0), good: (v, p) => `KDA ${p.kills}/${p.deaths}/${p.assists}`, bad: (v, p) => `KDA ${p.kills}/${p.deaths}/${p.assists}` },
  { key: "tf", core: 0.1, sup: 0.17, get: (p) => p.teamfight_participation || 0, good: (v) => `участвовал в ${Math.round(v * 100)}% убийств команды`, bad: (v) => `только в ${Math.round(v * 100)}% убийств команды` },
  { key: "vis", core: 0, sup: 0.2, get: (p) => (p.obs_placed || 0) + (p.sen_placed || 0) + (p.observer_kills || 0), good: (v, p) => `${wards(p)}, снял ${p.observer_kills || 0}`, bad: (v, p) => wards(p) },
  { key: "ctrl", core: 0, sup: 0.08, get: (p) => p.stuns || 0, good: (v) => `контроль ${clock(v)}`, bad: (v) => `контроль ${clock(v)}` },
  { key: "heal", core: 0, sup: 0.05, get: (p) => p.hero_healing || 0, good: (v) => `отхилил ${k1(v)}`, bad: () => null },
  { key: "trade", core: 0.25, sup: 0.25, get: (p, x) => -x.noTrade, good: (v, p, x) => (!x.deaths ? "ни разу не умер" : x.heroDeaths ? `умирал с разменом: ${x.heroDeaths - x.noTrade} из ${x.heroDeaths}` : "от героев не умирал"),
    bad: (v, p, x) => `${x.noTrade} из ${x.heroDeaths} ${plural(x.heroDeaths, "смерти", "смертей", "смертей")} от героев без размена` },
];

import { assignRoles } from "./engine.js?v=41";

// heroKey(id) -> "npc_dota_hero_tusk" (так жертва записана в kills_log), heroName(id) -> "Tusk"
export function matchVerdicts(match, meAccount, { heroName, heroKey }) {
  const ps = match.players;
  const killsByVictim = new Map();
  ps.forEach((p) => {
    for (const k of p.kills_log || []) {
      if (!killsByVictim.has(k.key)) killsByVictim.set(k.key, []);
      killsByVictim.get(k.key).push({ t: k.time, radiant: p.player_slot < 128 });
    }
  });
  const teamKillTimes = { true: [], false: [] };
  for (const [, list] of killsByVictim) for (const k of list) teamKillTimes[k.radiant].push(k.t);

  const rows = ps.map((p, i) => {
    const radiant = p.player_slot < 128;
    const deathsT = (killsByVictim.get(heroKey(p.hero_id)) || []).map((k) => k.t);
    const noTrade = deathsT.filter((t) => !teamKillTimes[radiant].some((kt) => Math.abs(kt - t) <= TRADE_WINDOW)).length;
    return { i, p, radiant, won: radiant === match.radiant_win, hero_id: p.hero_id, name: heroName(p.hero_id), me: Boolean(meAccount) && p.account_id === meAccount,
      deaths: p.deaths || 0, heroDeaths: deathsT.length, noTrade, kda: `${p.kills}/${p.deaths}/${p.assists}` };
  });
  // роли — те же, что в разборе (позиции 1–3 коры, 4–5 саппорты): по фарму, линии и вардам
  for (const side of [true, false]) {
    const { roles } = assignRoles(ps.filter((p) => (p.player_slot < 128) === side));
    rows.filter((r) => r.radiant === side).forEach((r) => { r.core = (roles.get(r.p) || 5) <= 3; });
  }
  // место среди своей роли в матче: 0 — хуже всех, 1 — лучше всех
  const rank = {};
  for (const m of METRICS) {
    rank[m.key] = new Map();
    for (const core of [true, false]) {
      const group = rows.filter((r) => r.core === core);
      const vals = group.map((r) => m.get(r.p, r));
      group.forEach((r, n) => {
        const v = vals[n];
        const below = vals.filter((x) => x < v).length, same = vals.filter((x) => x === v).length - 1;
        rank[m.key].set(r.i, group.length > 1 ? (below + same / 2) / (group.length - 1) : 0.5);
      });
    }
  }
  for (const r of rows) {
    const w = METRICS.map((m) => [m, r.core ? m.core : m.sup]).filter(([, x]) => x > 0);
    const total = sum(w.map(([, x]) => x));
    r.impact = Math.round((sum(w.map(([m, x]) => rank[m.key].get(r.i) * x)) / total) * 100);
    const scored = w.map(([m]) => ({ m, q: rank[m.key].get(r.i), v: m.get(r.p, r) }));
    const best = [...scored].sort((a, b) => b.q - a.q)[0];
    const worst = [...scored].sort((a, b) => a.q - b.q).find((x) => x.m.bad(x.v, r.p, r));
    r.plus = best && best.q >= 0.5 ? best.m.good(best.v, r.p, r) : null;
    // слабое место — относительно своей роли: 30к урона мало для кора, если остальные сделали по 50к
    const tail = (q) => (q === 0 ? `, меньше всех ${r.core ? "коров" : "саппортов"}` : "");
    r.minus = worst && worst.q <= 0.34 ? worst.m.bad(worst.v, r.p, r) + (worst.m.key === "trade" || worst.m.key === "kda" ? "" : tail(worst.q)) : null;
    r.role = r.core ? "кор" : "саппорт";
  }
  const sorted = [...rows].sort((a, b) => b.impact - a.impact);
  // MVP — лучший у победителей: у проигравших саппорт легко набирает места среди саппортов, но катку не выиграл
  const mvp = sorted.find((r) => r.won) || sorted[0];
  const losers = rows.filter((r) => !r.won).sort((a, b) => a.impact - b.impact);
  const winners = rows.filter((r) => r.won).sort((a, b) => b.impact - a.impact);
  // «слил» ставим только явному: заметно ниже следующего в команде, иначе вина размазана
  const anchor = losers[0] && losers[1] && losers[1].impact - losers[0].impact >= 8 && losers[0].impact < 45 ? losers[0] : null;
  const carryLost = [...losers].sort((a, b) => b.impact - a.impact)[0];
  for (const r of rows) {
    r.tag = r === mvp ? "mvp" : r === anchor ? "anchor" : r === carryLost && r.impact >= 55 ? "carry" : r === winners[winners.length - 1] && r.impact < 35 ? "passenger" : null;
  }
  return { rows, mvp, anchor, radiantWin: match.radiant_win, awards: awards(rows), meRow: rows.find((r) => r.me) || null };
}

const AWARDS = [
  { id: "ctrl", title: "Контроль", get: (r) => r.p.stuns || 0, min: 20, fmt: (v) => `${clock(v)} в стане` },
  { id: "heal", title: "Лекарь", get: (r) => r.p.hero_healing || 0, min: 800, fmt: (v) => `отхилил ${k1(v)}` },
  { id: "eyes", title: "Глаза команды", get: (r) => (r.p.obs_placed || 0) + (r.p.sen_placed || 0), min: 6, fmt: (v, r) => `${v} ${plural(v, "вард", "варда", "вардов")}${r.p.observer_kills ? `, снял ${r.p.observer_kills}` : ""}` },
  { id: "wall", title: "Стена", get: (r) => sum(Object.values(r.p.damage_taken || {})), min: 8000, fmt: (v) => `принял ${k1(v)} урона` },
  { id: "dmg", title: "Палач", get: (r) => r.p.hero_damage || 0, min: 5000, fmt: (v) => `${k1(v)} урона по героям` },
  { id: "push", title: "Сносчик", get: (r) => r.p.tower_damage || 0, min: 2000, fmt: (v) => `${k1(v)} по зданиям` },
  { id: "feed", title: "Без размена", anti: true, get: (r) => r.noTrade, min: 4, fmt: (v, r) => `${v} из ${r.heroDeaths} ${plural(r.heroDeaths, "смерти", "смертей", "смертей")} без размена` },
];

function awards(rows) {
  const out = [];
  for (const a of AWARDS) {
    const best = [...rows].sort((x, y) => a.get(y) - a.get(x))[0];
    const v = a.get(best);
    if (v >= a.min) out.push({ id: a.id, title: a.title, anti: Boolean(a.anti), row: best, text: a.fmt(v, best) });
  }
  return out;
}
