// Справочник скиллов для приложения -> docs/abilities.json. У OpenDota он весит 2 МБ (300 КБ сжатого) и качается
// при каждом первом запуске, а приложению из него нужны только имя, тип урона, описание, пробитие BKB и диспел.
// Урезанный файл в 5 раз меньше. Обновляется раз в неделю вместе со сборками (builds.yml).
// Запуск: node tools/fetch-abilities.mjs
import { writeFileSync } from "node:fs";

const SOURCES = ["https://api.opendota.com/api/constants/abilities", "https://raw.githubusercontent.com/odota/dotaconstants/master/build/abilities.json"];
let all = null;
for (const url of SOURCES) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (r.ok) all = await r.json();
    if (all && Object.keys(all).length > 1000) break;
  } catch (e) {
    console.error(`${url}: ${e.message}`);
  }
  all = null;
}
if (!all) { console.error("справочник скиллов не скачался"); process.exit(1); }

const out = {};
for (const [key, a] of Object.entries(all)) {
  if (!a || !a.dname) continue;
  const one = { dname: a.dname };
  for (const f of ["dmg_type", "desc", "bkbpierce", "dispellable"]) if (a[f] != null && a[f] !== "") one[f] = a[f];
  out[key] = one;
}
writeFileSync(new URL("../docs/abilities.json", import.meta.url), JSON.stringify(out));
console.log(`скиллов: ${Object.keys(out).length}`);
