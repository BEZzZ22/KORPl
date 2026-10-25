// Разметка карты по выводу парсера OpenDota (odota/parser, JSON на строку): где стоят кемпы и где ходят герои.
// Кемп = средняя точка героя-убийцы в момент смерти нейтрала: по сотням убийств за игру центр кемпа виден до клетки.
// Запуск: node tools/mapdata.mjs heroes.json < parsed.jsonl > out.json   (heroes.json — dotaconstants)
// Координаты — клетки OpenDota (64..192), как у позиций героев в tools/replay-summary.mjs.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const heroes = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nameById = new Map(Object.values(heroes).map((h) => [h.id, h.name]));
const pos = new Map(); // `${slot}:${t}` -> [x, y]
const slotByName = new Map();
const deaths = []; // [t, attacker, target]
const types = {};
const walk = new Uint8Array(256 * 256);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line || line[0] !== "{") continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  types[e.type] = (types[e.type] || 0) + 1;
  if (e.type === "interval" && typeof e.slot === "number" && typeof e.x === "number" && !e.life_state) {
    const t = Math.round(e.time);
    pos.set(`${e.slot}:${t}`, [e.x, e.y]);
    if (e.hero_id && nameById.has(e.hero_id)) slotByName.set(nameById.get(e.hero_id), e.slot);
    // сетка вдвое мельче клетки: 256 x 256 на 64..192
    const gx = Math.floor((e.x - 64) * 2), gy = Math.floor((e.y - 64) * 2);
    if (gx >= 0 && gy >= 0 && gx < 256 && gy < 256) walk[gy * 256 + gx] = Math.min(255, walk[gy * 256 + gx] + 1);
  } else if (e.type === "DOTA_COMBATLOG_DEATH" && typeof e.targetname === "string"
    && /^npc_dota_(neutral|roshan|miniboss)/.test(e.targetname) && /^npc_dota_hero_/.test(e.attackername || "")) {
    deaths.push([Math.round(e.time), e.attackername, e.targetname]);
  }
}

const kills = [];
for (const [t, attacker, target] of deaths) {
  const slot = slotByName.get(attacker);
  if (slot == null) continue;
  const p = pos.get(`${slot}:${t}`) || pos.get(`${slot}:${t - 1}`);
  if (p) kills.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, target.replace("npc_dota_", ""), t]);
}
let bits = "";
for (let i = 0; i < walk.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) if (walk[i + j]) b |= 1 << j; bits += String.fromCharCode(b); }
process.stdout.write(JSON.stringify({ types, heroes: slotByName.size, kills, walk: Buffer.from(bits, "latin1").toString("base64") }));
