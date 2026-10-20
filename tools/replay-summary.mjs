// Сжимает вывод парсера реплеев OpenDota (odota/parser, по JSON на строку) в файл позиций героев.
// Запуск: node tools/replay-summary.mjs <match_id> < parsed.jsonl > r/<match_id>.json
// Формат результата (v1): каждые STEP секунд координаты каждого героя в клетках карты (64..192, как obs_log у OpenDota),
// мёртвый или неизвестный — null. player_slot как в матче OpenDota: 0..4 Свет, 128..132 Тьма.
import { createInterface } from "node:readline";

const STEP = 2;
const matchId = Number(process.argv[2]) || null;
const byPlayer = new Map(); // player_slot -> Map(секунда -> [x, y] | null)
const heroes = new Map();
let tMin = Infinity, tMax = -Infinity;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line || line[0] !== "{") continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.type !== "interval" || typeof e.slot !== "number" || e.slot < 0 || e.slot > 9) continue;
  const t = Math.round(e.time);
  if (t % STEP !== 0) continue;
  const slot = e.slot < 5 ? e.slot : 128 + e.slot - 5;
  if (!byPlayer.has(slot)) byPlayer.set(slot, new Map());
  if (e.hero_id) heroes.set(slot, e.hero_id);
  const alive = !e.life_state && typeof e.x === "number" && typeof e.y === "number";
  byPlayer.get(slot).set(t, alive ? [Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10] : null);
  tMin = Math.min(tMin, t);
  tMax = Math.max(tMax, t);
}

if (!byPlayer.size) {
  process.stderr.write("в выводе парсера нет позиций героев\n");
  process.exit(2);
}
const start = Math.max(tMin, -90);
const pos = {};
for (const [slot, track] of [...byPlayer].sort((a, b) => a[0] - b[0])) {
  const xs = [];
  for (let t = start; t <= tMax; t += STEP) {
    const p = track.get(t);
    xs.push(p ? p : null);
  }
  pos[slot] = xs;
}
process.stdout.write(JSON.stringify({
  v: 1, match_id: matchId, step: STEP, start, end: tMax,
  heroes: Object.fromEntries(heroes), pos,
}));
