import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { MATCH_HTML, shopHtml, matchState, matchVerdict } from "./widget.js";

// лимит Телеграма: 32 КБ сырого HTML и 4096 байт после zlib уровня 9, иначе INPUT_MEDIA_WIDGET_TOO_LARGE
const fits = (html) => Buffer.byteLength(html) <= 32768 && deflateSync(Buffer.from(html), { level: 9 }).length <= 4096;

test("виджеты влезают в лимит Телеграма", () => {
  assert.ok(fits(MATCH_HTML), `карточка катки: ${deflateSync(Buffer.from(MATCH_HTML), { level: 9 }).length} байт`);
  assert.ok(fits(shopHtml(true)), `витрина: ${deflateSync(Buffer.from(shopHtml(true)), { level: 9 }).length} байт`);
  assert.doesNotMatch(MATCH_HTML + shopHtml(true), /\u0000|https?:\/\/|purple|#8a2be2|#7c4dff/i);
});

test("состояние карточки катки: до 1024 байт, итог по KDA", () => {
  const m = { match_id: 8123456789, player_slot: 0, radiant_win: true, hero_id: 1, kills: 3, deaths: 11, assists: 5, duration: 2460, gold_per_min: 412, xp_per_min: 530, last_hits: 180, hero_damage: 21450, tower_damage: 900 };
  const s = matchState(m, { 1: ["npc_dota_hero_antimage", "Anti-Mage"] });
  assert.equal(s.h, "Anti-Mage");
  assert.equal(s.w, 1);
  assert.equal(s.t, 41);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...s, v: "queued" })) <= 1024);
  assert.match(s.s, /^11 смертей/);
  assert.match(matchVerdict({ ...m, player_slot: 0, deaths: 2 }), /^Чистая катка/);
  assert.match(matchVerdict({ ...m, player_slot: 130, deaths: 3, kills: 12, assists: 9 }), /^Ты сделал своё/);
});
