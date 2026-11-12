// Глубокий разбор: нормы высокого ранга. Из готовых разборов (analyze.mjs) собирает по ролям
// четверти распределения каждой метрики: с ними сравнивается игрок («у керри высокого ранга — столько-то»).
// Запуск: node tools/deep/norms.mjs <norms-src.json> <разбор.json>... > norms.json
// norms-src.json копит метрики по матчам между прогонами (файл дописывается на месте).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { metrics } from "./analyze.mjs";

const KEEP = 400; // сколько последних матчей держим в выборке

export function addMatch(src, report) {
  if (!report || !report.match_id || report.end < 1200) return false; // короткие игры и стомпы до 20 минут нормы портят
  if (src.matches.some((m) => m.id === report.match_id)) return false;
  src.matches.push({ id: report.match_id, players: report.players.map((p) => ({ role: p.role, m: metrics(p) })) });
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
  return { v: 1, matches: src.matches.length, roles };
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
