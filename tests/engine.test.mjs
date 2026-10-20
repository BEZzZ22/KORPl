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

test("драфт: лучший свой герой против врагов и предметы против их механик", () => {
  const enemies = [6, 1]; // Drow Ranger, Anti-Mage — без механик в базе пусть будет только один
  const pool = [{ hero_id: 100, games: 40, win: 22 }, { hero_id: 74, games: 30, win: 12 }, { hero_id: 21, games: 2, win: 2 }];
  const matchups = {
    100: [{ hero_id: 6, games_played: 100, wins: 60 }, { hero_id: 1, games_played: 80, wins: 44 }],
    74: [{ hero_id: 6, games_played: 100, wins: 40 }, { hero_id: 1, games_played: 80, wins: 36 }],
    21: [{ hero_id: 6, games_played: 5, wins: 5 }],
  };
  const kb = { heroes: { [od.heroKey(56)]: ["invis"] }, mechanics: { invis: { name: "невидимость", core: ["dust"], support: ["dust", "ward_sentry"], roles: ["core", "support"] } } };
  const out = draftAdvice({ enemies: [...enemies, 56], pool, matchups, knowledge: kb, od, role: "support" });
  assert.deepEqual(out.picks.map((p) => p.hero_id), [100, 74]); // у 21 мало игр в матчапах
  assert.equal(out.picks[0].vs[0].hero_id, 6);
  assert.deepEqual(out.items.map((i) => i.key), ["dust", "ward_sentry"]);
  assert.equal(out.items[0].why, "невидимость");
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
