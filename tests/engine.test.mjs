// Тесты движка на реальном матче из fixtures: node --test tests/engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { analyze, createDictionary } from "../docs/engine.js";

const gz = (n) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))).toString("utf8"));
const docs = (n) => JSON.parse(readFileSync(new URL(`../docs/${n}`, import.meta.url), "utf8"));
const base = gz("match_9052987576.json.gz");
const od = createDictionary(gz("constants.json.gz"));
const kb = docs("knowledge.json"), tx = docs("texts.json"), pro = gz("pro_items.json.gz"), bench = gz("hero_bench.json.gz");
const run = (match, hero) => {
  const p = match.players.find((x) => od.heroName(x.hero_id) === hero);
  return analyze(match, p, od, kb, tx, pro, bench, {}, []);
};
const copy = () => JSON.parse(JSON.stringify(base));
// Матч, где у всех остались только смерти до 10-й минуты: так моменты линии попадают в выборку
const earlyOnly = () => {
  const m = copy();
  for (const p of m.players) p.deaths_log = (p.deaths_log || []).filter((d) => d.time < 600);
  return m;
};
const episode = (a, clock) => a.episodes.find((e) => e.clock === clock);

test("смерть на линии: линия и кто убил, а не «один, рядом своих не было»", () => {
  const e = episode(run(earlyOnly(), "Invoker"), "6:18");
  assert.ok(e.facts.includes("стадия линий, твоя линия: мид"));
  assert.ok(e.facts.includes("убийца стоял на твоей линии"));
  assert.ok(!e.facts.some((f) => /один, рядом своих не было/.test(f)));
  assert.ok(!e.facts.some((f) => /следом за тобой/.test(f)));
});

test("размен: сам убил врага рядом по времени со своей смертью", () => {
  const e = episode(run(earlyOnly(), "Beastmaster"), "6:18");
  assert.ok(e.facts.includes("размен: ты тоже убил Invoker"));
});

test("ганг: убийца с другой линии", () => {
  const m = earlyOnly();
  const bm = m.players.find((x) => od.heroName(x.hero_id) === "Beastmaster");
  m.players.find((x) => od.heroName(x.hero_id) === "Invoker").lane = 3; // Invoker будто стоял на топе
  bm.kills_log = []; // без размена
  const e = episode(run(m, "Beastmaster"), "4:01");
  assert.ok(e.facts.includes("ганг: убийца пришёл не с твоей линии"));
});

test("смерть в первые полторы минуты — драка за руну", () => {
  const e = episode(run(earlyOnly(), "Tiny"), "0:06");
  assert.ok(e.facts[1].startsWith("драка за руну"));
});

test("на линии чужие вышки к смерти не приклеиваются, своя линия — да", () => {
  const m = earlyOnly();
  m.objectives.push({ time: 400, type: "building_kill", key: "npc_dota_goodguys_tower1_top" },
    { time: 410, type: "building_kill", key: "npc_dota_goodguys_tower1_mid" });
  const e = episode(run(m, "Invoker"), "6:18");
  assert.ok(e.facts.includes("за 2 минуты враги сломали: T1 на миде"));
});

test("после линии одиночная смерть остаётся одиночной", () => {
  const e = episode(run(copy(), "Batrider"), "24:10");
  assert.ok(e.facts.includes("один, рядом своих не было"));
});

test("после линии смерть с убийством врага рядом — размен, а не «один»", () => {
  const m = copy();
  const bat = m.players.find((x) => od.heroName(x.hero_id) === "Batrider");
  bat.kills_log.push({ time: 1445, key: "npc_dota_hero_tiny" });
  bat.deaths_log = bat.deaths_log.filter((d) => d.time === 1450); // размен весит меньше, оставляем только эту смерть
  const e = episode(run(m, "Batrider"), "24:10");
  assert.ok(e.facts.includes("размен: ты тоже убил Tiny"));
  assert.ok(!e.facts.includes("один, рядом своих не было"));
});

test("Рошан, забранный врагами после нашей выигранной драки, не считается нашим", () => {
  const m = copy();
  // Большая выигранная драка Radiant, следом Рошана берут враги
  const tf = { start: 1500, end: 1520, players: m.players.map((p) => ({ deaths: p.isRadiant ? 0 : 1, damage: 1, ability_uses: {} })) };
  m.teamfights = [tf];
  m.objectives = [{ time: 1560, type: "CHAT_MESSAGE_ROSHAN_KILL", team: 3 }];
  m.radiant_win = false; // проигрыш, чтобы одного случая хватило для замечания
  const a = run(m, "Tusk");
  assert.ok(a.findings.some((f) => f.kind === "micro" && /Рошан/.test(f.text)));
});

// ---------- карта, линия, тайминги, драфт ----------
import { itemTimings, draftAdvice } from "../docs/engine.js";

test("карта: смерти в драках и обсы команды с координатами", () => {
  const a = run(copy(), "Tusk");
  assert.ok(a.map.deaths.length > 0);
  for (const d of a.map.deaths) assert.ok(d.x >= 64 && d.x <= 192 && d.y >= 64 && d.y <= 192 && typeof d.t === "number");
  assert.ok(a.map.wards.length > 0);
  assert.ok(a.map.wards.some((w) => w.mine) || a.map.wards.every((w) => !w.mine));
  assert.equal(a.map.radiant, true);
});

test("дуэль на линии: каждые 2 минуты до 10:00, обе стороны", () => {
  const a = run(copy(), "Invoker");
  assert.equal(a.lane.opponent, a.facts.lane_opponent);
  assert.deepEqual(a.lane.rows.map((r) => r.m), [2, 4, 6, 8, 10]);
  for (const r of a.lane.rows) for (const k of ["lh", "nw", "xp"]) assert.ok(r[k].every((v) => typeof v === "number"), `${k} ${r.m}`);
});

test("тайминги: медиана по играм, вердикт и винрейт до и после", () => {
  const rows = [
    { item: "black_king_bar", time: 1200, games: "10", wins: "7" },
    { item: "black_king_bar", time: 1500, games: "20", wins: "12" },
    { item: "black_king_bar", time: 1800, games: "30", wins: "12" },
    { item: "blink", time: 900, games: "3", wins: "2" },
  ];
  const out = itemTimings([{ key: "black_king_bar", item: "Black King Bar", time: 1900 }, { key: "blink", item: "Blink Dagger", time: 800 }, { key: "black_king_bar", item: "Black King Bar", time: 2500 }], rows);
  assert.equal(out.length, 1); // у Blink мало игр, повтор BKB не считается
  assert.equal(out[0].usual, 1500);
  assert.equal(out[0].verdict, "late");
  assert.equal(out[0].wr_by, 63);
  assert.equal(out[0].wr_after, 40);
});

test("тайминги: медиана в последней корзине (OpenDota режет покупки после 30:00) — не сравниваем", () => {
  const rows = [
    { item: "ultimate_scepter", time: 1200, games: "9", wins: "4" },
    { item: "ultimate_scepter", time: 1500, games: "18", wins: "12" },
    { item: "ultimate_scepter", time: 1800, games: "70", wins: "47" },
  ];
  assert.deepEqual(itemTimings([{ key: "ultimate_scepter", item: "Aghanim's Scepter", time: 2561 }], rows), []);
});

test("драфт: лучший свой герой против врагов и предметы против их механик", () => {
  const enemies = [6, 1]; // Drow Ranger, Anti-Mage — без механик в базе пусть будет только один
  const pool = [{ hero_id: 100, games: 40, win: 22 }, { hero_id: 74, games: 30, win: 12 }, { hero_id: 21, games: 2, win: 2 }];
  const matchups = {
    100: [{ hero_id: 6, games_played: 100, wins: 60 }, { hero_id: 1, games_played: 80, wins: 44 }],
    74: [{ hero_id: 6, games_played: 100, wins: 40 }, { hero_id: 1, games_played: 80, wins: 36 }],
    21: [{ hero_id: 6, games_played: 5, wins: 5 }],
  };
  const kb = { heroes: { [od.heroKey(56)]: ["invis"] }, mechanics: { invis: { name: "невидимость", core: ["dust"], support: ["dust", "ward_sentry"], roles: ["core", "support"] } } };
  const out = draftAdvice({ enemies: [...enemies, 56], pool, matchups, knowledge: kb, od: { ...od, heroRoles: () => [] }, role: "support" });
  assert.deepEqual(out.picks.map((p) => p.hero_id), [100]); // 74 проигрывает этим врагам, у 21 мало игр
  assert.ok(out.picks[0].matchup_wr > 0.5);
  assert.deepEqual(out.items.map((i) => i.key), ["dust", "ward_sentry"]);
  assert.equal(out.items[0].why, "невидимость");
});

test("драфт: свои подходящие герои первыми по последним 20 играм, объяснения из контрпиков", () => {
  const enemies = [2]; // Axe
  const counter = {
    t: ["Атакует с расстояния.", "Бьёт магией.", "Axe его ловит."],
    h: { 2: [[48, 0], [72, 0], [31, 1]], 48: [[2, 2]] }, // Luna, Gyrocopter, Lich против Axe; Axe контрит Luna
  };
  const pool = [{ hero_id: 72, games: 50, win: 25 }, { hero_id: 31, games: 10, win: 5 }, { hero_id: 8, games: 90, win: 50 }, { hero_id: 48, games: 30, win: 15 }];
  const recent = { 31: 6, 72: 1 };
  const out = draftAdvice({ enemies, pool, recent, counter, knowledge: { heroes: {}, mechanics: {} }, od: { ...od, heroRoles: () => [] } });
  // Juggernaut (8) играл больше всех, но против Axe не подходит; Luna — её контрит сам Axe
  assert.deepEqual(out.picks.map((p) => p.hero_id), [72, 31]);
  assert.equal(out.picks[1].why[0].why, "Бьёт магией.");
  assert.equal(out.picks[1].recent, 6);
  assert.equal(out.picks[0].why[0].name, od.heroName(2));
  assert.equal(out.picks[0].why[0].why, "Атакует с расстояния.");
  assert.deepEqual(out.counters.map((p) => p.hero_id), []); // Luna: контрпик, но Axe сам её контрит — счёт 0
  // без аккаунта — только контрпики
  const anon = draftAdvice({ enemies, counter, knowledge: { heroes: {}, mechanics: {} }, od: { ...od, heroRoles: () => [] } });
  assert.deepEqual(anon.counters.map((p) => p.hero_id), [72, 31]);
});

test("словарь: список героев по алфавиту", () => {
  const list = od.heroList();
  assert.ok(list.length > 100);
  assert.ok(list.every((h, i) => i === 0 || list[i - 1].name.localeCompare(h.name) <= 0));
});

test("хронология: смерть на линии подписана линией и разменом, а не «поймали одного»", () => {
  const a = run(earlyOnly(), "Beastmaster");
  const lane = a.moments.filter((m) => m.time < 600 && m.severity === "bad");
  assert.ok(lane.length >= 2);
  for (const m of lane) assert.doesNotMatch(m.text, /соло|одного|без команды|без союзников/);
  assert.ok(lane.some((m) => /\(размен\)/.test(m.text)));
});

// ---------- прогресс ----------
import { checkGoal, achievements, formatMetric } from "../docs/engine.js";

test("прогресс: показатели катки и цель в проверяемом виде", () => {
  const a = run(copy(), "Tusk");
  const m = a.progress;
  assert.equal(m.deaths, 19);
  assert.equal(typeof m.lane_deaths, "number");
  assert.ok(m.dead_share > 0 && m.dead_share < 1);
  assert.ok(Array.isArray(m.enemy_keys) && m.enemy_keys.length === 5);
  assert.equal(a.facts.start_time, base.start_time);
  // главная проблема Tusk — смерти от Tiny: цель проверяется по смертям от него
  if (a.summary.goal_check) assert.ok(typeof a.summary.goal_check.metric === "string");
});

test("checkGoal: выполнено, провалено и нельзя проверить", () => {
  const m = { lane_deaths: 1, kp: 0.5, bought: ["blink"], unused: [], enemy_keys: ["npc_dota_hero_tiny"], killers: { npc_dota_hero_tiny: 3 } };
  assert.deepEqual(checkGoal({ metric: "lane_deaths", op: "<=", target: 1 }, m), { status: "done", value: 1 });
  assert.deepEqual(checkGoal({ metric: "kp", op: ">=", target: 0.6 }, m), { status: "failed", value: 0.5 });
  assert.deepEqual(checkGoal({ metric: "lh10", op: ">=", target: 45 }, m), { status: "skip" });
  assert.deepEqual(checkGoal({ metric: "unused:black_king_bar", op: "<=", target: 0 }, m), { status: "skip" });
  assert.deepEqual(checkGoal({ metric: "unused:blink", op: "<=", target: 0 }, m), { status: "done", value: 0 });
  assert.deepEqual(checkGoal({ metric: "killer:npc_dota_hero_tiny", op: "<=", target: 1 }, m), { status: "failed", value: 3 });
  assert.deepEqual(checkGoal({ metric: "killer:npc_dota_hero_pudge", op: "<=", target: 1 }, m), { status: "skip" });
  assert.equal(formatMetric("kp", 0.5), "50%");
  assert.equal(formatMetric("first_item", 905), "15:05");
});

test("ачивки: серия считается подряд, неподходящие по роли пропускаются", () => {
  const h = [{ m: { lane_deaths: 0, deaths: 3, pos: 1, lh10: 50 } }, { m: { lane_deaths: 2, deaths: 9, pos: 5 } },
    { m: { lane_deaths: 1, deaths: 4, pos: 1, lh10: 46 } }, { m: { lane_deaths: 0, deaths: 2, pos: 1, lh10: 30 } }, { m: { lane_deaths: 1, deaths: 4, pos: 2, lh10: 60 } }];
  const by = Object.fromEntries(achievements(h, 6).map((x) => [x.id, x]));
  assert.equal(by.clean_lane.done, true);
  assert.equal(by.clean_lane.have, 3);
  assert.equal(by.no_feed.done, true);
  assert.equal(by.farmer.have, 3);
  assert.equal(by.farmer.done, true);
  assert.equal(by.eyes.have, 0);
  assert.equal(by.goals5.done, true);
});

// ---------- реплей ----------
import { replayInsights } from "../docs/engine.js";

// Синтетический файл позиций: все стоят на месте весь матч
function fakeReplay(match, spots) {
  const n = Math.ceil((match.duration + 90) / 2) + 1;
  const pos = {};
  for (const p of match.players) pos[p.player_slot] = Array.from({ length: n }, () => spots[p.player_slot] || [180, 180]);
  return { v: 1, step: 2, start: -90, end: match.duration, pos };
}

test("реплей: кто был рядом в смерти, зоны и тепловая карта", () => {
  const m = copy();
  const replay = fakeReplay(m, { 0: [100, 100], 1: [100, 105], 2: [150, 150], 128: [102, 100] });
  const tusk = m.players[0];
  const r = replayInsights(m, tusk, replay);
  assert.equal(r.deaths.length, tusk.deaths_log.length);
  const d = r.deaths[5];
  assert.equal(d.allies_near, 1); // слот 1 в 5 клетках = 640 юнитов
  assert.equal(d.enemies_near, 1); // слот 128 в 2 клетках
  assert.equal(d.nearest_ally, 600);
  assert.equal(d.enemy_half, false);
  assert.ok(d.path.length >= 5);
  assert.equal(r.zones.lane.own, 1);
  assert.ok(r.heat.length > 100);
  assert.equal(replayInsights(m, tusk, null), null);
  assert.equal(replayInsights(m, tusk, { v: 2 }), null);
});

test("реплей: в моментах тренера правда о соседях вместо догадки", () => {
  const m = copy();
  // Batrider (слот 2) один на вражеской половине, свои далеко
  const replay = fakeReplay(m, { 2: [170, 170], 0: [80, 80], 1: [80, 82], 3: [82, 80], 4: [84, 84] });
  const p = m.players.find((x) => od.heroName(x.hero_id) === "Batrider");
  const a = analyze(m, p, od, kb, tx, pro, bench, {}, [], replay);
  assert.ok(a.replay && a.replay.deaths.length);
  const ep = a.episodes.find((e) => e.kind === "death" && e.time >= 600);
  assert.ok(ep.facts.some((f) => /^по реплею: своих в радиусе 1 500 не было/.test(f)), ep.facts.join(" | "));
  assert.ok(ep.facts.includes("на вражеской половине карты"));
  // «своих рядом не было» и «в командной драке» в одном моменте противоречат друг другу
  for (const e of a.episodes.filter((x) => x.facts.some((f) => /радиусе 1 500 не было/.test(f))))
    assert.ok(!e.facts.includes("в командной драке"), e.facts.join(" | "));
});

test("реплей: настоящий разбор матча (GitHub Actions + odota/parser)", () => {
  const replay = gz("replay_9052987576.json.gz");
  assert.equal(replay.v, 1);
  assert.deepEqual(Object.keys(replay.pos).map(Number).sort((a, b) => a - b), [0, 1, 2, 3, 4, 128, 129, 130, 131, 132]);
  const wr = base.players.find((x) => x.hero_id === 21);
  const r = replayInsights(base, wr, replay);
  assert.equal(r.deaths.length, wr.deaths_log.length);
  // 18:05: по логу «один», а по реплею рядом был союзник и трое врагов
  const d = r.deaths.find((x) => x.t === 1085);
  assert.equal(d.allies_near, 1);
  assert.equal(d.enemies_near, 3);
  for (const z of Object.values(r.zones)) assert.ok(Math.abs(z.own + z.river + z.enemy - 1) < 1e-9);
});

import { mapZone, replayNotes } from "../docs/engine.js";

test("реплей: зоны карты — у каждого лайнера на 2–9 минуте больше всего точек на его линии", () => {
  const replay = gz("replay_9052987576.json.gz");
  const lane = { 1: "bot", 2: "mid", 3: "top" };
  for (const p of base.players.filter((x) => x.hero_id !== 21)) { // Windranger — роумер
    const c = {};
    replay.pos[p.player_slot].forEach((q, i) => {
      const t = replay.start + i * replay.step;
      if (q && t >= 120 && t <= 540) { const z = mapZone(q[0], q[1], p.isRadiant); c[z] = (c[z] || 0) + 1; }
    });
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(top, lane[p.lane], `${od.heroName(p.hero_id)}: ${JSON.stringify(c)}`);
  }
  assert.equal(mapZone(70, 70, true), "base");
  assert.equal(mapZone(70, 70, false), "ebase");
  assert.equal(mapZone(110, 160, true), "ejungle"); // выше реки — сторона Тьмы
  assert.equal(mapZone(110, 120, true), "jungle");
});

test("реплей: фарм по зонам, время с командой, движение перед смертью и место в моментах", () => {
  const replay = gz("replay_9052987576.json.gz");
  const m = copy();
  const p = m.players.find((x) => x.hero_id === 74); // Invoker
  const a = analyze(m, p, od, kb, tx, pro, bench, {}, [], replay);
  const r = a.replay;
  // крипы по зонам в сумме дают прирост lh_t (с точностью до округления)
  const farmed = Object.values(r.farm).flatMap((f) => Object.values(f)).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(farmed - p.lh_t[p.lh_t.length - 1]) <= 6, `${farmed} vs ${p.lh_t.at(-1)}`);
  assert.ok(r.farm.lane.mid / Object.values(r.farm.lane).reduce((x, y) => x + y, 0) > 0.8); // мидер на линии фармит мид
  for (const v of Object.values(r.group)) assert.ok(v >= 0 && v <= 1);
  assert.ok(r.deaths.every((d) => d.zone in { base: 1, ebase: 1, top: 1, mid: 1, bot: 1, river: 1, jungle: 1, ejungle: 1 }));
  assert.ok(r.deaths.some((d) => d.approach === "away") && r.deaths.some((d) => d.approach === "still"));
  const notes = replayNotes(r);
  assert.ok(notes.some((n) => /^крипы, линия 0–10: мид \d+%/.test(n)), notes.join(" | "));
  assert.ok(notes.some((n) => /^время рядом с двумя и больше своими: мидгейм/.test(n)));
  assert.deepEqual(a.replay_notes, notes);
  const ep = a.episodes.find((e) => e.kind === "death");
  assert.ok(ep.facts.some((f) => /^место: /.test(f)), ep.facts.join(" | "));
  // «навстречу убийцам» только для смерти без своих рядом
  for (const e of a.episodes) if (e.facts.some((f) => /навстречу/.test(f))) assert.ok(e.facts.some((f) => /радиусе 1 500 не было/.test(f)));
  assert.deepEqual(replayNotes(null), []);
});

import { assignRoles } from "../docs/engine.js";

test("роли: саппорт с кучей вардов не кор, мидер с вардами остаётся мидером", () => {
  const pl = (hero_id, lane_role, lh10, nw10, last_hits, net_worth, wards) => ({ hero_id, lane_role, lane: lane_role, lh_t: Array(11).fill(lh10), networth_t: Array(11).fill(nw10), last_hits, net_worth, obs_placed: wards, sen_placed: 0 });
  // матч 9054284490: Undying 21 вард, Techies 4 при почти равном фарме — четвёрка Undying
  const team = [pl(106, 2, 56, 4716, 311, 23129, 2), pl(71, 1, 2, 2359, 27, 10648, 4), pl(105, 1, 19, 2792, 108, 15966, 4), pl(78, 3, 21, 2414, 270, 24988, 0), pl(85, 3, 8, 2217, 204, 15618, 21)];
  const r = assignRoles(team).roles;
  assert.deepEqual(team.map((p) => r.get(p)), [2, 5, 1, 3, 4]);
  // мидер (Ancient Apparition) с 19 вардами — всё равно мидер
  const mid = [pl(68, 2, 20, 3000, 73, 42601, 19), pl(21, 1, 30, 3500, 88, 35709, 0), pl(71, 1, 25, 3300, 80, 35643, 4), pl(35, 3, 40, 4200, 201, 45617, 0), pl(100, 3, 10, 2500, 86, 30384, 12)];
  assert.equal(assignRoles(mid).roles.get(mid[0]), 2);
});
