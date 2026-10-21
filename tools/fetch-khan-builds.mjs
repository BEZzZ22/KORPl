// Сборки Хана (ueyo, steamcommunity.com/id/ueio) из его внутриигровых гайдов в Steam -> docs/khan_builds.json.
// Гайды публичные: ищем по «ueio» в гайдах Dota 2, берём только файлы его аккаунта, скачиваем .build (KeyValues)
// и вытаскиваем предметы по разделам. Ничего из платного Boosty не берём.
// Запуск: node tools/fetch-khan-builds.mjs
import { writeFileSync } from "node:fs";

const AUTHOR = "76561198090822128"; // ueyo
const OUT = new URL("../docs/khan_builds.json", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, init) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
      if (r.ok) return r;
      if (i >= 3) throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (i >= 3) throw e;
    }
    await sleep(2000 * (i + 1));
  }
}

// 1. Поиск по гайдам Dota 2: все страницы выдачи
const ids = new Set();
for (let p = 1; p <= 30; p++) {
  const html = await (await get(`https://steamcommunity.com/app/570/guides/?searchText=ueio&browsefilter=trend&requiredtags%5B%5D=-1&p=${p}`)).text();
  const found = [...html.matchAll(/filedetails\/\?id=(\d+)/g)].map((m) => m[1]);
  if (!found.length) break;
  found.forEach((id) => ids.add(id));
  await sleep(800);
}

// 2. Описание файлов: автор, название, ссылка на файл сборки
const details = [];
const list = [...ids];
for (let i = 0; i < list.length; i += 100) {
  const body = new URLSearchParams({ itemcount: String(list.slice(i, i + 100).length) });
  list.slice(i, i + 100).forEach((id, k) => body.set(`publishedfileids[${k}]`, id));
  const r = await get("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", { method: "POST", body });
  details.push(...(await r.json()).response.publishedfiledetails);
}
const mine = details.filter((f) => f.creator === AUTHOR && f.file_url && /\.build$/.test(f.filename || ""));

// 3. KeyValues Valve: "ключ" "значение" и "ключ" { ... }; повторяющиеся ключи (item) собираем в массив
function parseKV(text) {
  const tokens = [...text.matchAll(/"((?:[^"\\]|\\.)*)"|([{}])/g)].map((m) => (m[2] ? m[2] : { s: m[1] }));
  let i = 0;
  const block = () => {
    const obj = [];
    while (i < tokens.length && tokens[i] !== "}") {
      const key = tokens[i++].s;
      if (tokens[i] === "{") { i++; obj.push([key, block()]); i++; } else obj.push([key, tokens[i++].s]);
    }
    return obj;
  };
  return block();
}
const find = (kv, key) => (kv.find(([k]) => k === key) || [])[1];

// Роль из названия: (Основа) mid / carry, (Оффлэйн), (Поддержка); в старых гайдах — по словам в названии
function roleOf(title) {
  const t = title.toLowerCase();
  if (/поддержк|supp|support|саппорт/.test(t)) return "support";
  if (/оффл|offlane|офлейн/.test(t)) return "offlane";
  if (/\bmid\b|мид/.test(t)) return "mid";
  if (/carry|керри/.test(t)) return "carry";
  if (/основа|core/.test(t)) return "core";
  return "core";
}

const SECTIONS = {
  "#DOTA_Item_Build_Starting_Items": "start", "#DOTA_Item_Build_Early_Game": "early",
  "#DOTA_Item_Build_Core_Items": "core", "#DOTA_Item_Build_Mid_Items": "core",
  "#DOTA_Item_Build_Luxury": "luxury", "#DOTA_Item_Build_Other_Items": "luxury", "#DOTA_Item_Build_Late_Items": "luxury",
};

const heroes = {};
for (const f of mine) {
  const text = await (await get(f.file_url)).text();
  const g = find(parseKV(text), "guidedata");
  if (!g) continue;
  const hero = find(g, "Hero");
  const items = find(find(g, "ItemBuild") || [], "Items") || [];
  const build = { start: [], early: [], core: [], luxury: [] };
  for (const [section, list] of items) {
    const to = SECTIONS[section];
    if (!to || !Array.isArray(list)) continue; // «boosty.to/ueyo» и прочие подписи-рекламы пропускаем
    for (const [k, v] of list) if (k === "item" && v.startsWith("item_")) build[to].push(v.slice(5));
  }
  if (!hero || !build.core.length) continue;
  const key = `npc_dota_hero_${hero}`;
  (heroes[key] = heroes[key] || []).push({
    id: f.publishedfileid, title: f.title, role: roleOf(f.title), patch: find(g, "GameplayVersion") || "",
    updated: f.time_updated, ...build,
  });
  await sleep(150);
}
for (const list of Object.values(heroes)) list.sort((a, b) => b.updated - a.updated);
writeFileSync(OUT, JSON.stringify({ author: "ueyo", profile: "https://steamcommunity.com/id/ueio", fetched: new Date().toISOString().slice(0, 10), heroes }, null, 0));
console.log(`гайдов ${mine.length}, героев ${Object.keys(heroes).length}`);
