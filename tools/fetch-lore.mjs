// Лор героев с dota2.com на русском: биография, короткое описание и чем герой силён.
// Запуск: node tools/fetch-lore.mjs  → worker/lore.json (тренер опирается на него, когда речь о героях)
import { writeFileSync } from "node:fs";

const FEED = "https://www.dota2.com/datafeed";
const clean = (s) => String(s || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
  .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

async function get(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

const list = (await get(`${FEED}/herolist?language=russian`)).result.data.heroes;
const out = {};
const queue = [...list];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let x; (x = queue.shift());) {
    const h = (await get(`${FEED}/herodata?language=russian&hero_id=${x.id}`)).result.data.heroes[0];
    out[h.id] = {
      key: h.name.replace("npc_dota_hero_", ""),
      name: h.name_loc,
      short: clean(h.npe_desc_loc),
      hype: clean(h.hype_loc),
      bio: clean(h.bio_loc),
    };
  }
}));
const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])));
writeFileSync(new URL("../worker/lore.json", import.meta.url), JSON.stringify(sorted, null, 1) + "\n");
console.log(`героев: ${Object.keys(sorted).length}, пустых биографий: ${Object.values(sorted).filter((h) => !h.bio).length}`);
