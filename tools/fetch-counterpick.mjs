// Контрпики с dota2.ru: по каждому герою — кто его контрит и чем.
// Запуск: node tools/fetch-counterpick.mjs  → docs/counterpick.json (драфт перед игрой объясняет пики по нему)
// Формат: { t: [объяснения], h: { "<id врага>": [[id контрпика, номер объяснения], ...] } }, порядок как в статье.
// Одно объяснение часто на нескольких героев («— Slark, Ursa, Monkey King»): храним его один раз.
// Предметы из статей не берём: там вперемешку и вещи самого врага (у Axe — его Blink и Blade Mail)
import { writeFileSync } from "node:fs";

const SITE = "https://dota2.ru";
const WHY_MAX = 280;
const PER_HERO = 10; // контрпиков на врага: дальше в статьях идут запасные варианты

async function get(url, type = "text", tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return type === "json" ? await res.json() : await res.text();
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => html
  .replace(/<img[^>]*>/g, "").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
  .replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&hellip;/g, "…")
  .replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+([.,:;!?)])/g, "$1").trim();
const sentences = (s) => s.split(/(?<=[.!?…])\s+(?=[«"A-ZА-ЯЁ])/);
// Длинное объяснение режем по концу предложения, иначе по слову
const clip = (s) => {
  if (s.length <= WHY_MAX) return s;
  const cut = s.slice(0, WHY_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
};
// Следующее предложение продолжает мысль про тех же героев («Они вынуждают…»)
const CONTINUES = /^(Он|Она|Оно|Они|Эти|Такие|Это|Их|Его|Её|Им|Также|Кроме того)\s/;
// …а это без предыдущего непонятно («В их число входят Anti-Mage, Slark…»)
const NEEDS_PREV = /^(В их числ|Среди них|К ним|К таким|Сюда|Из них)/;
// Разделы, где герои не контрпики, а наоборот
const BAD_SECTION = /не (стоит|нужно|надо|советуем)|не брать|не пикать|плох|слаб|избега|опасн/i;

const heroes = await get("https://api.opendota.com/api/constants/heroes", "json");
const heroId = new Map(Object.values(heroes).map((h) => [norm(h.localized_name), h.id]));
// Старое имя на dota2.ru
heroId.set(norm("Outworld Destroyer"), heroId.get(norm("Outworld Devourer")));

const index = await get(`${SITE}/counterpick/`);
const slugs = [...new Set([...index.matchAll(/href="\/counterpick\/([a-z0-9-]+)\/"/g)].map((m) => m[1]))];

const out = {};
const headings = new Set();
const misses = new Set();
const queue = [...slugs];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let slug; (slug = queue.shift());) {
    const page = await get(`${SITE}/counterpick/${slug}/`);
    const title = /<h1[^>]*>\s*Контрпик\s+([^<]+?)\s*<\/h1>/.exec(page);
    const self = title && heroId.get(norm(title[1]));
    if (!self) { misses.add(`страница ${slug}`); continue; }
    const start = page.indexOf("global-content p-content");
    const body = page.slice(start, page.indexOf("comment-category", start));
    const counters = new Map();
    let bad = false;
    for (const [, tag, html] of body.matchAll(/<(p|li|h[2-4])[^>]*>([\s\S]*?)<\/\1>/g)) {
      const plain = text(html);
      if (!plain) continue;
      if (tag[0] === "h") { bad = BAD_SECTION.test(plain); headings.add(`${bad ? "−" : "+"} ${plain}`); continue; }
      if (bad) continue;
      const parts = sentences(plain);
      const why = (name) => {
        // «<li>Luna. Герой дальнего боя…» — объяснение после имени
        if (tag === "li" && plain.startsWith(`${name}.`)) return plain.slice(name.length + 1).trim();
        if (tag === "li") return plain;
        const i = parts.findIndex((s) => s.includes(name));
        if (i < 0) return plain;
        const prev = i > 0 && NEEDS_PREV.test(parts[i]) ? `${parts[i - 1]} ` : "";
        return prev + parts[i] + (parts[i + 1] && CONTINUES.test(parts[i + 1]) ? ` ${parts[i + 1]}` : "");
      };
      for (const [, inner] of html.matchAll(/inserted-link--hero"[^>]*>([\s\S]*?)<\/span>/g)) {
        const name = text(inner);
        const id = heroId.get(norm(name));
        if (!id) { misses.add(`герой ${name}`); continue; }
        if (id !== self && !counters.has(id) && counters.size < PER_HERO) counters.set(id, clip(why(name)));
      }
    }
    out[self] = [...counters];
  }
}));

const texts = [], textId = new Map();
const h = {};
for (const [id, list] of Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  h[id] = list.map(([c, why]) => {
    if (!textId.has(why)) { textId.set(why, texts.length); texts.push(why); }
    return [c, textId.get(why)];
  });
}
writeFileSync(new URL("../docs/counterpick.json", import.meta.url), JSON.stringify({ t: texts, h }) + "\n");
const n = Object.values(h);
console.log(`героев: ${n.length}, без контрпиков: ${n.filter((x) => !x.length).length}, в среднем ${(n.reduce((s, x) => s + x.length, 0) / n.length).toFixed(1)}, объяснений ${texts.length}`);
if (misses.size) console.log(`не распознал: ${[...misses].join("; ")}`);
if (process.env.HEADINGS) console.log([...headings].join("\n"));
