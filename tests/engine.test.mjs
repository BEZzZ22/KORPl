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
