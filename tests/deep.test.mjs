// Глубокий разбор по реплею (tools/deep/analyze.mjs) на сырых данных настоящего матча (публичный тестовый реплей парсера manta).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { analyze, metrics } from "../tools/deep/analyze.mjs";
import { addMatch, buildNorms } from "../tools/deep/norms.mjs";

const raw = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/deep_raw.json.gz", import.meta.url))).toString("utf8"));
const report = analyze(raw);

test("разбор: десять игроков, у каждого роль 1–5 без повторов в команде", () => {
  assert.equal(report.players.length, 10);
  for (const team of [0, 1]) {
    const roles = report.players.filter((p) => p.team === team).map((p) => p.role).sort();
    assert.deepEqual(roles, [1, 2, 3, 4, 5]);
  }
});

test("смерти: у каждой есть причина, начало замеса не позже смерти, убийцы — враги", () => {
  const kinds = new Set(["fight", "gank", "smoke", "blind_farm", "saw_coming", "low_hp", "dive_enemy_tower", "outnumbered", "dived", "duel", "tower", "creeps"]);
  let n = 0;
  for (const p of report.players) for (const d of p.deaths) {
    n++;
    assert.ok(kinds.has(d.kind), d.kind);
    assert.ok(d.t0 <= d.t && d.t - d.t0 <= 31);
    assert.ok(d.hp0 >= 0 && d.hp0 <= 1);
    for (const k of d.killers) {
      assert.notEqual(report.players[k.slot].team, p.team);
      assert.ok(k.fog >= 0 && k.fog <= 180);
    }
  }
  assert.ok(n > 20);
});

test("туман войны: герой не виден врагу всю игру подряд и не светится всю игру", () => {
  for (const p of report.players) assert.ok(p.time.seen_share > 0.05 && p.time.seen_share < 0.95, `${p.hero} ${p.time.seen_share}`);
});

test("время: доли занятий в сумме дают единицу", () => {
  for (const p of report.players) {
    const t = p.time.total;
    assert.ok(Math.abs(t.dead + t.base + t.fight + t.farm + t.move + t.idle - 1) < 0.01);
  }
});

test("драки: счёт погибших сходится со списком смертей, игрок либо в драке, либо далеко, либо мёртв", () => {
  assert.ok(report.fights.length >= 5);
  for (const f of report.fights) assert.equal(f.dead[0] + f.dead[1], f.deaths.length);
  for (const p of report.players) {
    assert.equal(p.fights.length, report.fights.length);
    for (const f of p.fights) assert.ok(["in", "absent", "dead"].includes(f.state));
  }
});

test("варды: только обсы, срок жизни не больше шести минут с запасом", () => {
  assert.ok(report.wards.length > 5);
  for (const w of report.wards) assert.ok(w.life > 0 && w.life <= 365 && w.sightings >= 0);
});

test("выводы: отсортированы по важности и ссылаются на секунды матча", () => {
  for (const p of report.players) {
    for (let i = 1; i < p.findings.length; i++) assert.ok(p.findings[i - 1].sev >= p.findings[i].sev);
    for (const f of p.findings) assert.ok(f.t === null || (f.t >= report.start && f.t <= report.end + 5));
  }
});

test("нормы: метрики копятся по ролям, с нормами у игрока появляется сравнение", () => {
  const src = { matches: [] };
  const long = { ...report, end: 2400 };
  for (let i = 0; i < 8; i++) assert.equal(addMatch(src, { ...long, match_id: 100 + i }), true);
  assert.equal(addMatch(src, { ...long, match_id: 100 }), false);
  const norms = buildNorms(src);
  assert.equal(norms.matches, 8);
  assert.equal(norms.roles["1"].seen_share.length, 3);
  const withNorms = analyze(raw, norms);
  const p = withNorms.players[0];
  assert.equal(p.vs.seen_share.v, Math.round(metrics(p).seen_share * 1000) / 1000);
});

// ---------- слова для приложения (docs/deep.js) ----------
import { deepView, deepBrief } from "../docs/deep.js";

const texts = JSON.parse(readFileSync(new URL("../docs/texts.json", import.meta.url), "utf8"));
const lib = { texts, heroName: (id) => `Герой${id}`, itemName: (k) => `предмет ${k}`, abilityName: (k) => `способность ${k}` };

test("слова: у каждого игрока разбор собирается без пустых шаблонов и мусора", () => {
  for (let slot = 0; slot < 10; slot++) {
    const v = deepView(report, slot, lib);
    assert.ok(v && v.role >= 1 && v.role <= 5);
    assert.equal(v.deaths.length, report.players[slot].deaths.length);
    assert.ok(v.top.length <= 6);
    const all = [v.head, ...v.top.flatMap((x) => [x.text, x.tip]), ...v.deaths.flatMap((d) => [d.title, d.tip, ...d.lines, ...d.facts.flat()]),
      ...v.fights.flatMap((f) => [f.tip, f.where, ...f.notes]), ...v.time.notes.flatMap((n) => [n.text, n.tip]),
      ...v.vision.notes.flatMap((n) => [n.text, n.tip]), ...v.lane.notes.flatMap((n) => [n.text, n.tip])];
    for (const s of all) {
      assert.equal(typeof s, "string");
      assert.ok(!/\{\w+\}|undefined|NaN|null|\[object/.test(s), s);
    }
    for (const d of v.deaths) { assert.ok(d.lines.length >= 1, `смерть без объяснения: ${d.kind}`); assert.ok(d.title); }
    for (const b of v.time.bars) assert.ok(b.pct >= 0 && b.pct <= 100);
    assert.ok(deepBrief(v).length <= 8);
  }
});

test("слова: каждый шаблон deep_* — непустой список строк, слова по правилам проекта", () => {
  const keys = Object.keys(texts).filter((k) => k.startsWith("deep_"));
  assert.ok(keys.length >= 40);
  for (const k of keys) {
    assert.ok(Array.isArray(texts[k]) && texts[k].length >= 1, k);
    for (const s of texts[k]) { assert.ok(s && typeof s === "string", k); assert.ok(!/байбек|ластхит/i.test(s), `${k}: ${s}`); }
  }
});

test("слова: одинаковый матч и игрок дают одинаковый текст", () => {
  assert.deepEqual(deepView(report, 3, lib), deepView(report, 3, lib));
  assert.equal(deepView(report, 42, lib), null);
});
