// Урезанные справочники для приложения -> docs/abilities.json и docs/items.json. У OpenDota они весят 2 МБ и 470 КБ
// (300 КБ и 68 КБ сжатого) и качаются при каждом первом запуске, а приложению из них нужно немного:
// у скиллов — имя, тип урона, слово про контроль из описания, пробитие BKB и диспел; у предметов — имя, цена, картинка и компоненты.
// Обновляются раз в неделю вместе со сборками (builds.yml). Нет файла — приложение берёт полный у OpenDota.
// Запуск: node tools/fetch-constants.mjs
import { writeFileSync } from "node:fs";
import { CONTROL_KINDS } from "../docs/engine.js";

const KEEP = {
  abilities: { min: 1000, need: "dname", fields: ["dname", "dmg_type", "desc", "bkbpierce", "dispellable"] },
  items: { min: 200, need: null, fields: ["dname", "cost", "img", "components"] },
};

async function load(name) {
  for (const url of [`https://api.opendota.com/api/constants/${name}`, `https://raw.githubusercontent.com/odota/dotaconstants/master/build/${name}.json`]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const all = r.ok ? await r.json() : null;
      if (all && Object.keys(all).length > KEEP[name].min) return all;
    } catch (e) {
      console.error(`${url}: ${e.message}`);
    }
  }
  return null;
}

// Описание скилла приложению нужно только для поиска контроля (CONTROL_KINDS в engine.js), а весит оно две трети файла.
// Оставляем от него слово, по которому контроль находится; проверяем, что вид контроля тот же, иначе — полный текст
function slimDesc(one) {
  if (one.desc == null) return;
  const full = (Array.isArray(one.desc) ? String(one.desc[0] ?? "") : String(one.desc)).toLowerCase();
  const kind = (text) => (CONTROL_KINDS.find((k) => k[1].test(text)) || [null])[0];
  const found = CONTROL_KINDS.find((k) => k[1].test(full));
  if (!found) { delete one.desc; return; }
  const word = found[1].exec(full)[0];
  one.desc = kind(word) === found[0] ? word : full;
}

let failed = false;
for (const [name, { need, fields }] of Object.entries(KEEP)) {
  const all = await load(name);
  if (!all) { console.error(`справочник ${name} не скачался`); failed = true; continue; }
  const out = {};
  for (const [key, a] of Object.entries(all)) {
    if (!a || (need && !a[need])) continue;
    const one = {};
    for (const f of fields) if (a[f] != null && a[f] !== "" && !(Array.isArray(a[f]) && !a[f].length)) one[f] = a[f];
    if (name === "abilities") slimDesc(one);
    out[key] = one;
  }
  writeFileSync(new URL(`../docs/${name}.json`, import.meta.url), JSON.stringify(out));
  console.log(`${name}: ${Object.keys(out).length}`);
}
if (failed) process.exit(1);
