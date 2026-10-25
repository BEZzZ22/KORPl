// «Кто слил» и данные повтора на карте: на настоящем матче из fixtures
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { matchVerdicts } from "../docs/blame.js";
import { replayModel } from "../docs/dotamap.js";

const gz = (n) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))).toString("utf8"));
const match = gz("match_9052987576.json.gz");
const replay = gz("replay_9052987576.json.gz");
const heroes = Object.fromEntries(Object.values(gz("constants.json.gz").heroes).map((h) => [h.id, h]));
const names = { heroName: (id) => heroes[id].localized_name, heroKey: (id) => heroes[id].name };
const ME = match.players[0];

test("кто слил: вклад у всех десяти, MVP у победителей, слил — у проигравших", () => {
  const v = matchVerdicts(match, ME.account_id, names);
  assert.equal(v.rows.length, 10);
  assert.ok(v.rows.every((r) => r.impact >= 0 && r.impact <= 100));
  assert.equal(v.meRow.name, "Tusk");
  assert.ok(v.mvp.won);
  assert.ok(!v.anchor || !v.anchor.won);
  // по три кора в каждой команде
  for (const side of [true, false]) assert.equal(v.rows.filter((r) => r.radiant === side && r.core).length, 3);
  // смертей без размена не больше, чем смертей
  assert.ok(v.rows.every((r) => r.noTrade <= r.deaths));
  // факты без утёкших значений
  for (const r of v.rows) for (const t of [r.plus, r.minus]) if (t) assert.doesNotMatch(t, /undefined|NaN|null/);
});

test("награды: у каждой есть игрок и текст", () => {
  const v = matchVerdicts(match, ME.account_id, names);
  assert.ok(v.awards.length >= 4);
  for (const a of v.awards) { assert.ok(a.row && a.row.name); assert.doesNotMatch(a.text, /undefined|NaN/); }
});

test("повтор: все убийства, варды обеих команд, здания падают по objectives", () => {
  const m = replayModel(match, replay, ME, { heroKey: (id) => heroes[id].name.replace("npc_dota_hero_", ""), heroName: names.heroName });
  const kills = match.players.reduce((n, p) => n + (p.kills_log || []).filter((k) => k.key.startsWith("npc_dota_hero_")).length, 0);
  assert.equal(m.kills.length, kills);
  // с реплеем у каждой смерти есть место
  assert.ok(m.kills.filter((k) => k.pos).length >= kills * 0.9);
  assert.ok(m.wards.some((w) => w.radiant) && m.wards.some((w) => !w.radiant));
  // проигравший трон падает в конце
  const fort = m.buildings.find((b) => b.id === (match.radiant_win ? "badguys_fort" : "goodguys_fort"));
  assert.equal(fort.died, match.duration);
  // позиции всех десяти в середине игры
  assert.ok(m.players.filter((_, i) => m.posAt(i, 900)).length >= 8);
  assert.equal(m.meIdx, 0);
});

test("повтор без реплея: смерти в драках берут место из teamfights", () => {
  const m = replayModel(match, null, ME, { heroKey: (id) => heroes[id].name.replace("npc_dota_hero_", ""), heroName: names.heroName });
  assert.equal(m.hasPos, false);
  assert.ok(m.kills.some((k) => k.pos));
  assert.equal(m.posAt(0, 900), null);
});
