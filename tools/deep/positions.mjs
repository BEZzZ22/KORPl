// Файл позиций героев для карты (r/<матч>.json) из сырых данных своего сборщика (tools/deep/extract), без парсера OpenDota.
// Формат тот же, что делает tools/replay-summary.mjs из вывода odota/parser (v1): каждые STEP секунд координаты героя
// в клетках карты (64..192), мёртвый — null; player_slot как у OpenDota (0..4 Свет, 128..132 Тьма);
// lasthits: [время, герой без npc_dota_hero_, что] — крип линии "c", Рошан "r", торментор "m".
// Запуск: node tools/deep/positions.mjs <match_id> raw.json > r/<match_id>.json
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STEP = 2;
const KIND = [[/^npc_dota_(creep_goodguys|creep_badguys|goodguys_siege|badguys_siege)/, "c"], [/^npc_dota_roshan/, "r"], [/^npc_dota_miniboss/, "m"]];

export function positions(raw, matchId = null) {
  if (!raw || !Array.isArray(raw.players) || !raw.players.length || !Array.isArray(raw.tracks)) throw new Error("нет игроков");
  const start = Math.max(raw.t0, -90);
  const startAt = start + ((((STEP - (start % STEP)) % STEP) + STEP) % STEP); // ровная сетка: секунды, кратные STEP
  const pos = {}, heroes = {};
  raw.players.forEach((p, i) => {
    const tr = raw.tracks[i];
    if (!tr) return;
    const slot = p.slot < 5 ? p.slot : 128 + p.slot - 5;
    heroes[slot] = p.hero_id;
    const xs = [];
    for (let t = startAt; t <= raw.end; t += STEP) {
      const k = t - raw.t0;
      xs.push(tr.alive[k] === 1 && tr.x[k] > 0 ? [Math.round(tr.x[k] / 10) / 10, Math.round(tr.y[k] / 10) / 10] : null);
    }
    pos[slot] = xs;
  });
  const lasthits = [];
  for (const e of raw.log || []) {
    if (e.k !== "death" || typeof e.v !== "string" || !/^npc_dota_hero_/.test(e.s || "")) continue;
    const kind = KIND.find(([re]) => re.test(e.v));
    if (kind) lasthits.push([Math.round(e.t), e.s.slice(14), kind[1]]);
  }
  return { v: 1, match_id: matchId || raw.match_id || null, step: STEP, start: startAt, end: raw.end, heroes, pos, lasthits, src: "deep" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const out = positions(raw, Number(process.argv[2]) || null);
  if (!Object.values(out.pos).some((xs) => xs.some(Boolean))) { process.stderr.write("в сырых данных нет позиций героев\n"); process.exit(2); }
  process.stdout.write(JSON.stringify(out));
}
