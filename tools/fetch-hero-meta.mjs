// Винрейт героев в пабах по рангам (OpenDota /heroStats: свежие публичные матчи) -> docs/hero_meta.json.
// Это то, как герой играется сейчас, в текущем патче, на ранге игрока, а не у про.
// Формат: { fetched, patch, patch_date, fresh, h: { "<id героя>": [[игр, побед] × 8 рангов: Рекрут … Титан] } }
// fresh = false, если патч вышел меньше недели назад: в выборке ещё прошлый баланс, движок такие цифры не показывает.
// Запуск: node tools/fetch-hero-meta.mjs
import { writeFileSync } from "node:fs";

const API = "https://api.opendota.com/api";
const FRESH_DAYS = 7;

async function get(path) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
    }
  }
}

const [stats, patches] = await Promise.all([get("/heroStats"), get("/constants/patch")]);
const patch = patches[patches.length - 1];
const now = new Date();
const h = {};
for (const x of stats) {
  h[x.id] = Array.from({ length: 8 }, (_, i) => [x[`${i + 1}_pick`] || 0, x[`${i + 1}_win`] || 0]);
}
const out = {
  fetched: now.toISOString().slice(0, 10),
  patch: patch.name,
  patch_date: patch.date.slice(0, 10),
  fresh: now - new Date(patch.date) >= FRESH_DAYS * 86400e3,
  h,
};
writeFileSync(new URL("../docs/hero_meta.json", import.meta.url), JSON.stringify(out) + "\n");
const games = Object.values(h).reduce((s, r) => s + r[1][0], 0);
console.log(`патч ${out.patch}, героев ${stats.length}, игр на Страже ${games}, свежие: ${out.fresh}`);
