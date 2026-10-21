// Сборки под героя и позицию из про-матчей текущего патча (OpenDota explorer) -> docs/builds.json.
// Позиция: три самых богатых в команде — коры (центр — 2, лёгкая — 1, иначе 3), двое беднейших — саппорты
// (лёгкая линия — 5, иначе 4). Для каждой позиции: старт, ранние предметы, основа по медиане времени, ситуативка.
// Плюс таблица «против кого что берут»: во сколько раз чаще обычного (для того же героя и позиции) коры и саппорты
// покупают предмет, когда враг — этот герой.
// Запуск: node tools/fetch-builds.mjs [patch]   (по умолчанию последний патч из /constants/patch)
import { writeFileSync } from "node:fs";

const API = "https://api.opendota.com/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(300000) });
      const j = await r.json();
      if (j && j.err) throw new Error(j.err);
      return j;
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(5000 * (i + 1));
    }
  }
}
const sql = (q) => get(`/explorer?sql=${encodeURIComponent(q)}`).then((j) => j.rows);

const patches = await get("/constants/patch");
const patch = patches.find((p) => p.name === process.argv[2]) || patches[patches.length - 1];
const since = Math.floor(new Date(patch.date).getTime() / 1000);
const items = await get("/constants/items");

const BASE = `base as (
 select pm.match_id, pm.hero_id, pm.player_slot, pm.lane_role, pm.net_worth,
   ((pm.player_slot < 128) = m.radiant_win) as win,
   rank() over (partition by pm.match_id, pm.player_slot < 128 order by pm.net_worth desc nulls last) as nwrank
 from player_matches pm join matches m on m.match_id = pm.match_id
 where m.start_time > ${since} and pm.purchase_log is not null and m.duration > 1200
)`;
const POS = `case when nwrank <= 3 then (case when lane_role = 2 then 2 when lane_role = 1 then 1 else 3 end) else (case when lane_role = 1 then 5 else 4 end) end`;

// 1. Сколько игр у героя на каждой позиции
const games = await sql(`with ${BASE} select hero_id, ${POS} as pos, count(*) g, sum(win::int) w, count(distinct match_id) m from base group by 1,2`);
const [{ total }] = await sql(`with ${BASE} select count(distinct match_id) total from base`);

// 2. Первая покупка каждого предмета: кусками по 8 героев, иначе explorer не успевает
const bought = [];
for (let a = 1; a <= 160; a += 8) {
  bought.push(...await sql(`with ${BASE}, pos as (select *, ${POS} as pos from base where hero_id between ${a} and ${a + 7}),
firsts as (
 select p.match_id, p.player_slot, p.hero_id, p.pos, p.win, e->>'key' as item, min((e->>'time')::int) as t
 from pos p join player_matches pm on pm.match_id = p.match_id and pm.player_slot = p.player_slot, unnest(pm.purchase_log) e
 group by 1,2,3,4,5,6)
select hero_id, pos, item, count(*) n, sum(win::int) w, percentile_disc(0.5) within group (order by t) med
from firsts group by 1,2,3 having count(*) >= 3`));
  await sleep(500);
}

// 3. Против кого что берут: покупки ситуативных предметов коров и саппортов в зависимости от вражеского героя
const SITUATIONAL = Object.entries(items).filter(([k, v]) => v.components && v.cost >= 1000 && !/recipe|dispenser/.test(k)).map(([k]) => k)
  .concat(["blink", "gem", "dust", "aghanims_shard"]);
const vsRows = [];
for (let a = 1; a <= 160; a += 8) {
  vsRows.push(...await sql(`with ${BASE},
me as (select match_id, player_slot, hero_id, ${POS} as pos from base where hero_id between ${a} and ${a + 7}),
got as (
 select distinct me.match_id, me.player_slot, e->>'key' as item
 from me join player_matches pm on pm.match_id = me.match_id and pm.player_slot = me.player_slot, unnest(pm.purchase_log) e
 where e->>'key' in (${SITUATIONAL.map((x) => `'${x}'`).join(",")})),
foes as (
 select me.match_id, me.player_slot, me.hero_id, me.pos, b2.hero_id as enemy
 from me join base b2 on b2.match_id = me.match_id and (b2.player_slot < 128) <> (me.player_slot < 128)),
tot as (select hero_id, pos, enemy, count(*) n from foes group by 1,2,3)
select f.hero_id, f.pos, f.enemy, g.item, count(*) n from foes f join got g on g.match_id = f.match_id and g.player_slot = f.player_slot group by 1,2,3,4
union all select hero_id, pos, enemy, '__total', n from tot`));
  await sleep(500);
}

// ---------- сборка по позиции ----------
const STANDALONE = new Set(["blink", "aghanims_shard", "gem"]);
const isFinal = (k) => STANDALONE.has(k) || (!!items[k] && !!items[k].components && !/dispenser|recipe/.test(k) && !/consumable/.test(items[k].qual || ""));
const cost = (k) => (items[k] && items[k].cost) || 0;
const pct = (n, g) => Math.round((n / g) * 100);

function buildFor(rows, g, pos) {
  // у саппортов сборки разнообразнее: в основу берём то, что собирает хотя бы каждый пятый-шестой
  const CORE_SHARE = pos >= 4 ? 0.18 : 0.25;
  const r = rows.map((x) => ({ k: x.item, n: +x.n, w: +x.w, med: +x.med, share: +x.n / g })).filter((x) => items[x.k]);
  const byKey = new Map(r.map((x) => [x.k, x]));
  // старт: до выхода крипов, у большинства
  let start = r.filter((x) => x.med <= 0 && x.share >= 0.35 && !/ward|smoke|dust|tpscroll/.test(x.k)).sort((a, b) => b.share - a.share);
  // палка, собранная в Wand ещё до выхода крипов, в старте лишняя
  start = start.filter((x) => !start.some((y) => y !== x && (items[y.k].components || []).includes(x.k))).map((x) => x.k);
  const finals = r.filter((x) => isFinal(x.k) && x.med > 0);
  // компонент, который чаще всего потом уходит в предмет той же сборки, не показываем (Basilius → Arcane Boots)
  const absorbed = (x, pool) => pool.some((y) => y !== x && y.med > x.med && (items[y.k].components || []).includes(x.k) && y.n >= x.n * 0.6);
  // сапоги всегда ранние, даже если их берёт меньшинство (у четвёрок сапоги разные)
  const BOOTS = new Set(["phase_boots", "power_treads", "arcane_boots", "tranquil_boots"]);
  let early = finals.filter((x) => x.med <= 900 && cost(x.k) < 2600 && (x.share >= 0.3 || (BOOTS.has(x.k) && x.share >= 0.2)));
  early = early.filter((x) => !absorbed(x, finals)).sort((a, b) => a.med - b.med);
  const earlySet = new Set(early.map((x) => x.k));
  let core = finals.filter((x) => !earlySet.has(x.k) && x.share >= CORE_SHARE && (cost(x.k) >= 1300 || STANDALONE.has(x.k)));
  core = core.filter((x) => !absorbed(x, finals)).sort((a, b) => a.med - b.med).slice(0, 7);
  const coreSet = new Set(core.map((x) => x.k));
  const sit = finals.filter((x) => !earlySet.has(x.k) && !coreSet.has(x.k) && x.share >= 0.04 && (cost(x.k) >= 1000 || STANDALONE.has(x.k)) && !absorbed(x, finals))
    .sort((a, b) => b.share - a.share).slice(0, 18);
  const row = (x) => [x.k, pct(x.n, g), x.med, x.n >= 10 ? pct(x.w, x.n) : null];
  return { start, early: early.map(row), core: core.map(row), sit: sit.map(row), _byKey: byKey };
}

const heroes = {};
for (const gm of games) {
  const g = +gm.g;
  if (g < 20) continue;
  const rows = bought.filter((x) => x.hero_id === gm.hero_id && x.pos === gm.pos);
  const b = buildFor(rows, g, +gm.pos);
  delete b._byKey;
  (heroes[gm.hero_id] = heroes[gm.hero_id] || {})[gm.pos] = { g, wr: pct(+gm.w, g), ...b };
}

// ---------- против кого что берут ----------
// Сравниваем с обычной сборкой того же героя на той же позиции: иначе «против PA берут Mask of Madness»
// значит лишь, что против PA чаще пикают героев с маской. Ожидание = сумма по игрокам их обычной доли предмета
const rate = new Map(); // hero|pos|item -> доля игр с покупкой
const gamesOf = new Map(games.map((x) => [`${x.hero_id}|${x.pos}`, +x.g]));
for (const x of bought) rate.set(`${x.hero_id}|${x.pos}|${x.item}`, +x.n / (gamesOf.get(`${x.hero_id}|${x.pos}`) || 1e9));
const grpOf = (pos) => (pos <= 3 ? "core" : "support");
const obs = new Map(), exp = new Map(), faced = new Map();
const totalsBy = new Map(); // hero|pos|enemy -> игроков против этого врага
for (const r of vsRows) if (r.item === "__total") totalsBy.set(`${r.hero_id}|${r.pos}|${r.enemy}`, +r.n);
for (const r of vsRows) {
  if (r.item === "__total") continue;
  const k = `${grpOf(r.pos)}|${r.enemy}|${r.item}`;
  obs.set(k, (obs.get(k) || 0) + +r.n);
}
for (const [key, n] of totalsBy) {
  const [hero, pos, enemy] = key.split("|");
  const f = `${grpOf(+pos)}|${enemy}`;
  faced.set(f, (faced.get(f) || 0) + n);
  for (const item of SITUATIONAL) {
    const r = rate.get(`${hero}|${pos}|${item}`);
    if (r) exp.set(`${f}|${item}`, (exp.get(`${f}|${item}`) || 0) + n * r);
  }
}
// Компонент, который почти всегда достраивают, засчитываем готовому предмету; не-контрпики выкидываем
const PROMOTE = { invis_sword: "silver_edge", maelstrom: "mjollnir", oblivion_staff: "orchid", hood_of_defiance: "pipe" };
const NOT_COUNTER = new Set(["ultimate_scepter", "ultimate_scepter_2", "aghanims_shard", "travel_boots", "travel_boots_2", "refresher", "blink",
  "overwhelming_blink", "swift_blink", "arcane_blink", "hand_of_midas", "arcane_boots", "phase_boots", "power_treads", "tranquil_boots",
  "boots_of_bearing", "moon_shard", "pers", "ancient_janggo", "essence_distiller", "specialists_array", "hydras_breath", "consecrated_wraps"]);
const CHEAP_COUNTERS = new Set(["dust", "gem", "ghost", "glimmer_cape", "vanguard", "urn_of_shadows", "pavise", "mekansm", "medallion_of_courage", "force_staff", "blade_mail"]);
// компонент другого предмета (Soul Booster, Ogre Axe) — не контрпик сам по себе
const COMPONENTS = new Set(Object.values(items).flatMap((v) => v.components || []));
const counterKey = (item) => {
  const k = PROMOTE[item] || item;
  if (NOT_COUNTER.has(k) || !items[k]) return null;
  if (CHEAP_COUNTERS.has(k)) return k;
  return items[k].cost >= 1800 && !COMPONENTS.has(k) ? k : null;
};
const vs = { core: {}, support: {} };
for (const [k, n] of obs) {
  const [grp, enemy, item] = k.split("|");
  const e = exp.get(k) || 0;
  if (n < 15 || e < 3) continue;
  const lift = n / e, p = n / faced.get(`${grp}|${enemy}`);
  if (lift < 1.3 || p < 0.03) continue;
  const key = counterKey(item);
  if (!key) continue;
  const list = (vs[grp][enemy] = vs[grp][enemy] || []);
  const prev = list.find((x) => x[0] === key);
  if (prev) { if (lift > prev[1]) { prev[1] = Math.round(lift * 100) / 100; prev[2] = Math.round(p * 100); } } else list.push([key, Math.round(lift * 100) / 100, Math.round(p * 100)]);
}
for (const grp of Object.values(vs)) for (const [e, list] of Object.entries(grp)) grp[e] = list.sort((a, b) => b[1] - a[1]).slice(0, 6);

const out = { patch: patch.name, since: patch.date.slice(0, 10), fetched: new Date().toISOString().slice(0, 10), matches: +total, heroes, vs };
writeFileSync(new URL("../docs/builds.json", import.meta.url), JSON.stringify(out));
console.log(`патч ${patch.name}: матчей ${total}, героев ${Object.keys(heroes).length}, позиций ${Object.values(heroes).reduce((s, h) => s + Object.keys(h).length, 0)}`);
