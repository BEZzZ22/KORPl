// Глубокий разбор: нормы высокого ранга. Из готовых разборов (analyze.mjs) собирает по ролям
// четверти распределения каждой метрики: с ними сравнивается игрок («у керри высокого ранга — столько-то»).
// Запуск: node tools/deep/norms.mjs <norms-src.json> <разбор.json>... > norms.json
// norms-src.json копит метрики по матчам между прогонами (файл дописывается на месте).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { metrics, wardPhase } from "./analyze.mjs";

const KEEP = 400; // сколько последних матчей держим в выборке

export function addMatch(src, report) {
  if (!report || !report.match_id || report.end < 1200) return false; // короткие игры и стомпы до 20 минут нормы портят
  if (src.matches.some((m) => m.id === report.match_id)) return false;
  src.matches.push({ id: report.match_id, players: report.players.map((p) => ({ role: p.role, m: metrics(p) })),
    // обсы: [команда 0/1, секунда, x, y, сколько раз показали врага]
    obs: (report.wards || []).map((w) => [w.team, w.t, w.x, w.y, w.sightings]) });
  if (src.matches.length > KEEP) src.matches.splice(0, src.matches.length - KEEP);
  return true;
}

export function buildNorms(src) {
  const byRole = {};
  for (const m of src.matches) for (const p of m.players) {
    const r = (byRole[p.role] = byRole[p.role] || {});
    for (const [k, v] of Object.entries(p.m)) if (Number.isFinite(v)) (r[k] = r[k] || []).push(v);
  }
  const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * f; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
  const roles = {};
  for (const [role, ms] of Object.entries(byRole)) {
    roles[role] = {};
    for (const [k, xs] of Object.entries(ms)) if (xs.length >= 8) roles[role][k] = [q(xs, 0.25), q(xs, 0.5), q(xs, 0.75)].map((v) => Math.round(v * 1000) / 1000);
  }
  return { v: 1, matches: src.matches.length, roles, wards: wardSpots(src) };
}

// Точки обсов высокого ранга по команде и фазе игры: сетка по 6 клеток (~770 единиц), в точке — в скольких матчах
// там стоял обс. Берём точки, где обс стоял хотя бы в 10% матчей и хотя бы раз кого-то показал.
const GRID = 600; // в сотых долях клетки
export function wardSpots(src) {
  const withObs = src.matches.filter((m) => Array.isArray(m.obs));
  const res = { matches: withObs.length };
  const cells = {};
  withObs.forEach((m, mi) => {
    for (const [team, t, x, y, seen] of m.obs) {
      const key = `${team}-${wardPhase(t)}`;
      const c = ((cells[key] = cells[key] || {})[`${Math.floor(x / GRID)}:${Math.floor(y / GRID)}`] ||= { m: new Set(), x: 0, y: 0, n: 0, seen: 0 });
      c.m.add(mi); c.x += x; c.y += y; c.n++; c.seen += seen;
    }
  });
  const min = Math.max(2, Math.ceil(withObs.length * 0.1));
  for (const [key, grid] of Object.entries(cells)) {
    res[key] = Object.values(grid).filter((c) => c.m.size >= min && c.seen > 0)
      .sort((a, b) => b.m.size - a.m.size)
      .slice(0, 12)
      .map((c) => [Math.round(c.x / c.n), Math.round(c.y / c.n), c.m.size]);
  }
  return res;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [srcPath, ...files] = process.argv.slice(2);
  const src = existsSync(srcPath) ? JSON.parse(readFileSync(srcPath, "utf8")) : { matches: [] };
  let added = 0;
  for (const f of files) { try { if (addMatch(src, JSON.parse(readFileSync(f, "utf8")))) added++; } catch { /* битый файл пропускаем */ } }
  writeFileSync(srcPath, JSON.stringify(src));
  process.stderr.write(`нормы: добавлено ${added}, всего матчей ${src.matches.length}\n`);
  process.stdout.write(JSON.stringify(buildNorms(src)));
}
