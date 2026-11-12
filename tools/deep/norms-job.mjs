// Глубокий разбор: набрать матчи высокого ранга для норм. Запускается из workflow «Глубокий разбор: проверка и нормы».
// Берёт свежие про-матчи и разобранные паблики со средним рангом от Властелина, качает реплеи,
// прогоняет через extract + analyze и печатает пути готовых разборов (по одному на строку).
//   node tools/deep/norms-job.mjs <сколько> <папка> <уже-есть.json>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { analyze } from "./analyze.mjs";

const want = Number(process.argv[2]) || 10;
const dir = process.argv[3] || "norms-work";
const have = new Set();
try { for (const m of JSON.parse(readFileSync(process.argv[4], "utf8")).matches) have.add(m.id); } catch { /* первый прогон */ }
mkdirSync(dir, { recursive: true });

const get = async (path) => {
  const r = await fetch(`https://api.opendota.com/api/${path}`);
  if (!r.ok) throw new Error(`OpenDota ${r.status}`);
  return r.json();
};
const ids = [];
try { for (const m of await get("proMatches")) if (m.duration > 1500) ids.push(m.match_id); } catch (e) { console.error("про-матчи:", e.message); }
try { for (const m of await get("publicMatches?min_rank=75")) if (m.duration > 1500 && m.game_mode !== 23) ids.push(m.match_id); } catch (e) { console.error("паблики:", e.message); }

let done = 0, tried = 0;
for (const id of ids) {
  if (done >= want || tried >= want * 4) break;
  if (have.has(id)) continue;
  tried++;
  const dem = `${dir}/${id}.dem`;
  try {
    execFileSync("bash", ["tools/deep/fetch-dem.sh", String(id), dem, `${dir}/${id}.match.json`], { stdio: "ignore" });
    const raw = execFileSync("./deep-extract", [dem], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    const report = analyze(JSON.parse(raw.toString("utf8")));
    if (!report.match_id) report.match_id = id;
    writeFileSync(`${dir}/${id}.json`, JSON.stringify(report));
    console.log(`${dir}/${id}.json`);
    done++;
  } catch (e) {
    console.error(`${id}: не вышло (${String(e.message).slice(0, 80)})`);
  } finally {
    for (const f of [dem, `${dir}/${id}.match.json`]) if (existsSync(f)) rmSync(f);
  }
}
console.error(`нормы: разобрано ${done} из ${tried} попыток`);
