// Видеоразбор (tools/video): данные реплея → моменты → сценарий → раскадровка. Без рендера и звука.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { extract } from "../tools/video/extract.mjs";
import { findMoments, findFights, createView } from "../tools/video/moments.mjs";
import { buildScript, cardinal, ordinalFem, plural, buildingsPhrase } from "../tools/video/script.mjs";
import { buildTimeline, warpAt, warpInv, estimate } from "../tools/video/timeline.mjs";
import { plan, MAX_SECONDS } from "../tools/video/plan.mjs";
import { resolveSlot } from "../tools/video/make.mjs";
import { caption } from "../tools/video/job.mjs";

const data = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/video_data.json.gz", import.meta.url))).toString("utf8"));
const heroes = JSON.parse(readFileSync(new URL("../tools/video/heroes.json", import.meta.url), "utf8"));
const texts = JSON.parse(readFileSync(new URL("../tools/video/texts.json", import.meta.url), "utf8"));
const ME = 5;

// Мини-реплей: десять героев стоят по базам, один идёт в чужой лес и умирает от двоих
function fakeLog() {
  const names = ["antimage", "axe", "bane", "bloodseeker", "crystal_maiden", "sniper", "earthshaker", "pudge", "jakiro", "drow_ranger"];
  const ids = [1, 2, 3, 4, 5, 35, 7, 14, 64, 6];
  const lines = [];
  for (let t = 0; t <= 300; t++) {
    for (let s = 0; s < 10; s++) {
      let x = s < 5 ? 80 + s : 176 - (s - 5), y = s < 5 ? 80 : 176, life = 0;
      if (s === 5) { x = Math.max(100, 176 - t * 0.5); y = Math.max(100, 176 - t * 0.5); if (t > 200 && t < 250) life = 2; }
      if (s === 0 || s === 1) { if (t > 150) { x = 101 + s; y = 101; } }
      lines.push(JSON.stringify({ time: t, type: "interval", slot: s, x, y, hero_id: ids[s], life_state: life, networth: 1000 + t * (s + 1), level: 1 + Math.floor(t / 60) }));
    }
  }
  const dmg = (t, a, v) => JSON.stringify({ time: t, type: "DOTA_COMBATLOG_DAMAGE", value: 300, attackername: `npc_dota_hero_${a}`, sourcename: `npc_dota_hero_${a}`, targetname: `npc_dota_hero_${v}`, targethero: true, targetillusion: false });
  lines.push(dmg(197, "antimage", "sniper"), dmg(198, "axe", "sniper"), dmg(199, "antimage", "sniper"));
  lines.push(JSON.stringify({ time: 200, type: "DOTA_COMBATLOG_DEATH", attackername: "npc_dota_hero_antimage", sourcename: "npc_dota_hero_antimage", targetname: "npc_dota_hero_sniper", targethero: true, targetillusion: false }));
  lines.push(JSON.stringify({ time: 120, type: "obs", slot: 0, x: 102, y: 102, ehandle: 7 }));
  lines.push(JSON.stringify({ time: 290, type: "DOTA_COMBATLOG_TEAM_BUILDING_KILL", targetname: "npc_dota_badguys_tower1_mid" }));
  lines.push("мусор, не JSON", "");
  return lines;
}

test("видео: extract собирает позиции, смерти, урон и варды из вывода парсера", async () => {
  const d = await extract(fakeLog());
  assert.equal(d.players.length, 10);
  assert.equal(d.players[5].key, "sniper");
  assert.equal(d.players[5].ru, "Снайпер");
  assert.equal(d.kills.length, 1);
  assert.deepEqual([d.kills[0].v, d.kills[0].k, d.kills[0].t], [5, 0, 200]);
  assert.ok(d.kills[0].x > 990 && d.kills[0].x < 1010, "место смерти — последняя живая точка");
  assert.equal(d.pos[5][200 - d.start + 1], null, "мёртвый герой без координат");
  assert.equal(d.dmg.length, 3);
  assert.equal(d.wards.length, 1);
  assert.equal(d.buildings[0].team, 1);
  await assert.rejects(() => extract(["{}"]), /позиций/);
});

test("видео: мини-реплей — смерть одного под вражеским вардом находится и озвучивается", async () => {
  const d = await extract(fakeLog());
  const found = findMoments(d, 5);
  assert.equal(found.moments.length, 1);
  const m = found.moments[0];
  assert.equal(m.type, "death");
  assert.equal(m.sub, "under_ward");
  assert.deepEqual(m.facts.attackers.sort(), [0, 1]);
  const script = buildScript(d, found);
  const all = script.segments.flatMap((s) => s.lines.map((l) => l.text)).join(" ");
  assert.match(all, /Антимаг и Акс/);
  assert.match(all, /вражеск/);
  const film = buildTimeline(d, found, script);
  assert.equal(film.segs.length, 3);
  assert.ok(film.segs[1].marks.enemy_obs);
});

test("видео: на настоящей катке моменты разные, по времени и не внахлёст", () => {
  const found = findMoments(data, ME);
  assert.ok(found.moments.length >= 3 && found.moments.length <= 5);
  for (let i = 1; i < found.moments.length; i++) {
    assert.ok(found.moments[i].t > found.moments[i - 1].t, "по порядку");
    assert.ok(found.moments[i].a > found.moments[i - 1].b, "окна не пересекаются");
  }
  const types = found.moments.map((m) => m.type);
  assert.ok(types.includes("fight_lost"));
  assert.ok(types.filter((t) => t === "highlight").length <= 1);
  for (const m of found.moments) {
    assert.ok(m.a >= data.start && m.b <= data.end && m.b > m.a);
    assert.ok(m.actors.every((s) => s >= 0 && s <= 9));
  }
  // выбор детерминирован
  assert.deepEqual(findMoments(data, ME).moments.map((m) => [m.t, m.type, m.sub]), found.moments.map((m) => [m.t, m.type, m.sub]));
});

test("видео: моменты считаются для любого из десяти игроков", () => {
  for (let slot = 0; slot < 10; slot++) {
    const p = plan(data, slot);
    assert.ok(p.found.moments.length >= 1, `слот ${slot}`);
    assert.ok(p.seconds <= MAX_SECONDS + 1, `слот ${slot}: ${p.seconds} с`);
    for (const seg of p.script.segments) for (const l of seg.lines) {
      assert.doesNotMatch(l.text + l.say, /[{}]|undefined|NaN|null/, `слот ${slot}: ${l.text}`);
      assert.doesNotMatch(l.say, /\d/, `в речи не должно быть цифр: ${l.say}`);
      assert.match(l.text, /^[А-ЯЁ\d]/, "фраза с заглавной или с числа");
    }
  }
});

test("видео: драки — счёт смертей сходится с убийствами", () => {
  const fights = findFights(data, createView(data));
  assert.equal(fights.reduce((s, f) => s + f.kills.length, 0), data.kills.filter((k) => k.x !== null).length);
  for (const f of fights) assert.equal(f.dead[0] + f.dead[1], f.kills.length);
});

test("видео: раскадровка — сегменты встык, у моментов время игры идёт вперёд и встаёт на совете", () => {
  const p = plan(data, ME);
  const durations = p.script.segments.map((s) => s.lines.map((l) => estimate(l.say) * 1.1));
  const film = buildTimeline(data, p.found, p.script, durations);
  assert.equal(film.segs[0].kind, "intro");
  assert.equal(film.segs[film.segs.length - 1].kind, "outro");
  assert.equal(film.frames, Math.round(film.duration * film.fps));
  assert.equal(film.vo.length, durations.flat().length);
  let t = 0;
  for (const seg of film.segs) {
    assert.ok(Math.abs(seg.t0 - t) < 1e-6);
    t = seg.t1;
    for (let i = 1; i < seg.lines.length; i++) assert.ok(seg.lines[i].t0 >= seg.lines[i - 1].t1, "фразы не накладываются");
    assert.ok(seg.lines[seg.lines.length - 1].t1 <= seg.t1 - seg.t0 + 1e-6, "фраза помещается в сегмент");
    if (seg.kind !== "moment") continue;
    for (let i = 1; i < seg.warp.length; i++) { assert.ok(seg.warp[i][0] >= seg.warp[i - 1][0]); assert.ok(seg.warp[i][1] >= seg.warp[i - 1][1]); }
    const dur = seg.t1 - seg.t0, tip = seg.lines[seg.lines.length - 1];
    assert.equal(warpAt(seg.warp, 0), seg.g0);
    assert.equal(warpAt(seg.warp, dur), seg.g1);
    assert.equal(warpAt(seg.warp, tip.t0 + 0.2), seg.g1, "на совете стоп-кадр");
    for (const k of seg.kills) { assert.ok(k.s >= 0 && k.s <= dur); assert.ok(Math.abs(warpAt(seg.warp, warpInv(seg.warp, k.t)) - Math.min(seg.g1, Math.max(seg.g0, k.t))) < 0.05); }
    assert.equal(seg.track.pos.length, 10);
    assert.equal(seg.track.pos[0].length, seg.g1 - seg.track.t0 + 1);
    for (const c of seg.cam) assert.ok(c.r >= 10 && c.r <= 64 && c.c[0] >= 0 && c.c[0] <= 128);
  }
  assert.ok(Math.abs(film.duration - t) < 1e-6);
});

test("видео: числа словами и здания", () => {
  assert.equal(cardinal(0), "ноль");
  assert.equal(cardinal(21, true), "двадцать одна");
  assert.equal(cardinal(4200), "четыре тысячи двести");
  assert.equal(cardinal(1000), "одна тысяча");
  assert.equal(cardinal(12000), "двенадцать тысяч");
  assert.equal(ordinalFem(1), "первой");
  assert.equal(ordinalFem(23), "двадцать третьей");
  assert.equal(ordinalFem(40), "сороковой");
  assert.equal(ordinalFem(105), "сто пятой");
  assert.equal(plural(22, "момент", "момента", "моментов"), "момента");
  const b = buildingsPhrase([{ kind: "t2", lane: "mid", t: 1 }, { kind: "t3", lane: "mid", t: 2 }, { kind: "rax", lane: "mid", t: 3 }, { kind: "rax", lane: "mid", t: 4 }], { rosh: true });
  assert.equal(b.text, "2 башни, сторону бараков и Рошана");
  assert.equal(b.say, "две башни, сторону бараков и Рошана");
  assert.equal(buildingsPhrase([{ kind: "fort", lane: null, t: 1 }, { kind: "t4", lane: null, t: 0 }]).text, "трон");
  assert.ok(buildingsPhrase([]).empty);
});

test("видео: справочники — у каждого героя есть русское имя и портрет, шаблоны без пустых мест", () => {
  for (const h of Object.values(heroes)) {
    assert.ok(h.key && h.ru && /^[А-ЯЁ]/.test(h.ru), h.key);
    assert.ok(readFileSync(new URL(`../docs/img/heroes/${h.key}.webp`, import.meta.url)).length > 100, h.key);
  }
  for (const [key, v] of Object.entries(texts)) {
    if (key === "_") continue;
    for (const s of Array.isArray(v) ? v : [v]) { assert.ok(s.trim().length > 3, key); assert.doesNotMatch(s, /\{[^a-z_]/, key); }
  }
});

test("видео: игрок находится по слоту, player_slot, аккаунту и герою; подпись к ролику", () => {
  assert.equal(resolveSlot(data, { slot: 5 }), 5);
  assert.equal(resolveSlot(data, { slot: 128 }), 5);
  assert.equal(resolveSlot(data, { slot: 11 }), -1);
  assert.equal(resolveSlot(data, { account: 1005 }), 5);
  assert.equal(resolveSlot(data, { account: 42 }), -1);
  assert.equal(resolveSlot(data, { hero: "sniper" }), 5);
  assert.equal(resolveSlot(data, {}), -1);
  const p = plan(data, ME), film = buildTimeline(data, p.found, p.script);
  assert.match(caption(film, 123), /матча 123: Снайпер, 19\/10\/17/);
});
