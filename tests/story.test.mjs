// Ход игры (docs/story.js) на реальном матче из fixtures и на правках этого матча: node --test tests/story.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createDictionary } from "../docs/engine.js";
import { gameStory } from "../docs/story.js";

const gz = (n) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))).toString("utf8"));
const base = gz("match_9052987576.json.gz");
const od = createDictionary(gz("constants.json.gz"));
const copy = () => { const m = JSON.parse(JSON.stringify(base)); for (const p of m.players) p.isRadiant = p.player_slot < 128; return m; };
const hero = (m, name) => m.players.find((p) => od.heroName(p.hero_id) === name);
const story = (m, name) => gameStory(m, hero(m, name), od);

test("без драк и графика золота хода игры нет", () => {
  const m = copy();
  m.teamfights = []; m.radiant_gold_adv = [];
  assert.equal(story(m, "Tiny"), null);
});

test("каждая постройка записана только на одну драку", () => {
  const s = story(copy(), "Tiny");
  const seen = new Set();
  for (const f of s.fights) for (const b of [...f.lost, ...f.took]) {
    assert.ok(!seen.has(b), `${b.name} в двух драках`);
    seen.add(b);
  }
});

test("проигравшая сторона: перевес ушёл и причина названа с минутой", () => {
  const s = story(copy(), "Tiny");
  assert.equal(s.won, false);
  assert.match(s.verdict, /Вы вели до 14,4к на 34-й минуте и проиграли/);
  assert.match(s.verdict, /Перевес ушёл с 34-й по 46-ю минуту/);
  const rosh = s.causes.find((c) => c.key === "enemy_rosh_push");
  assert.ok(rosh, "Рошан врага и сломанная база");
  assert.match(rosh.fact, /^37:10: Рошана забрали враги/);
  assert.ok(s.causes.every((c) => c.title && c.fact && c.why && c.fix));
});

test("победившая сторона: та же игра с другой стороны", () => {
  const s = story(copy(), "Tusk");
  assert.equal(s.won, true);
  assert.match(s.verdict, /отставали на 14,4к на 34-й минуте и вытащили/);
  assert.ok(s.turns.some((t) => t.good && /Рошан ваш/.test(t.text)));
});

test("драки без игрока, пока он жив, — личная ошибка с временем", () => {
  const m = copy();
  const me = hero(m, "Tiny");
  const i = m.players.indexOf(me);
  // Tiny выпал из трёх драк середины игры
  const mid = m.teamfights.filter((f) => f.start > 1300 && f.start < 1800).slice(0, 3);
  for (const f of mid) f.players[i] = { damage: 0, healing: 0, deaths: 0, ability_uses: {}, item_uses: {}, deaths_pos: {} };
  me.deaths_log = me.deaths_log.filter((d) => !mid.some((f) => d.time >= f.start - 60 && d.time <= f.end + 5));
  const miss = story(m, "Tiny").mistakes.find((x) => x.key === "missed_fights");
  assert.ok(miss);
  assert.match(miss.title, /^3 драки без тебя/);
  for (const f of mid) assert.ok(miss.clock.includes(`${Math.floor(f.start / 60)}:`));
});

test("BKB был, не в откате и не нажат — ошибка «умер с ненажатым BKB»", () => {
  const m = copy();
  const me = hero(m, "Tiny");
  const i = m.players.indexOf(me);
  const f = m.teamfights.find((x) => x.start > 2000 && x.players[i] && x.players[i].deaths > 0);
  me.purchase_log.push({ time: 1500, key: "black_king_bar" });
  f.players[i].item_uses = { ...(f.players[i].item_uses || {}) };
  delete f.players[i].item_uses.black_king_bar;
  for (const x of m.teamfights) if (x !== f && x.players[i] && x.players[i].item_uses) delete x.players[i].item_uses.black_king_bar;
  const s = story(m, "Tiny");
  const u = s.mistakes.find((x) => x.key === "unused_save");
  assert.ok(u);
  assert.match(u.title, /BKB/);
  assert.ok(s.fights.find((x) => x.start === f.start).text.includes("не нажат BKB"));
});

test("долгий перевес без построек — причина команды", () => {
  const m = copy();
  const me = hero(m, "Tiny");
  const sign = me.isRadiant ? 1 : -1;
  // 10 минут перевеса 6к, и на этих минутах ни одной постройки врага
  for (let t = 12; t < 22; t++) m.radiant_gold_adv[t] = 6000 * sign;
  const enemySide = me.isRadiant ? "badguys" : "goodguys";
  m.objectives = m.objectives.filter((o) => !(o.type === "building_kill" && o.key.includes(enemySide) && o.time >= 720 && o.time < 1320));
  const c = story(m, "Tiny").causes.find((x) => x.key === "lead_no_buildings");
  assert.ok(c);
  assert.match(c.fact, /^С 12-й по \d+-ю минуту вы вели на 6к/);
});

test("поздняя смерть кора без выкупа, после которой ломают базу", () => {
  const m = copy();
  const me = hero(m, "Tiny");
  me.position_est = 1;
  me.buyback_log = [];
  const s = story(m, "Tiny");
  const x = s.mistakes.find((v) => v.key === "no_buyback_me");
  assert.ok(x);
  assert.match(x.fact, /ты умер, не выкупился, враги сломали .*трон/);
});
