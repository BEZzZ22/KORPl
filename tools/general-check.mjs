// Генеральная проверка разбора на живых матчах (Actions → «Генеральная проверка разбора»).
// 1) Движок: свежие публичные, разобранные, про-, турбо- и старые матчи — разбор за каждого игрока с открытым профилем.
// 2) Приложение в Chromium: главная игрока → последняя катка → все вкладки; прямые ссылки ?match= (как из бота).
// 3) Заявка на разбор реплея: напрямую и через воркер, сколько ждать до готового реплея.
// В лог идут только id матчей, тайминги и тексты ошибок. CHECK_MATCHES — сколько матчей в движок, CHECK_UI — сколько прогонов в браузере.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyze, createDictionary, isParsed } from "../docs/engine.js";
import { matchVerdicts } from "../docs/blame.js";
import { replayModel } from "../docs/dotamap.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DOCS = join(ROOT, "docs");
const OUT = process.env.CHECK_OUT || join(ROOT, "tests", "ui", "general");
const CACHE = join(OUT, ".cache");
mkdirSync(CACHE, { recursive: true });
const API = "https://api.opendota.com/api";
const WORKER = "https://dotacoach.2007rggg.workers.dev";
const N_MATCHES = Number(process.env.CHECK_MATCHES || 50);
const N_UI = Number(process.env.CHECK_UI || 14);
const problems = [];
const bad = (where, what) => { problems.push(`${where}: ${what}`); console.log(`  ✗ ${where}: ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- OpenDota из Node: пауза между запросами (лимит 60 в минуту), повтор на 429/5xx, кэш на диск ----------
let lastCall = 0, calls = 0;
async function raw(url, { method = "GET", cache = method === "GET", timeout = 40000 } = {}) {
  const key = join(CACHE, createHash("sha1").update(method + url).digest("hex"));
  if (cache && existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  let out = null;
  for (let i = 0; i < 4; i++) {
    const wait = lastCall + 1100 - Date.now();
    if (url.startsWith(API) && wait > 0) await sleep(wait);
    lastCall = Date.now();
    calls++;
    const t0 = Date.now();
    try {
      const headers = url.startsWith(WORKER) ? { Origin: "https://bezzz22.github.io" } : {};
      const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(timeout) });
      const body = Buffer.from(await res.arrayBuffer());
      out = { status: res.status, type: res.headers.get("content-type") || "application/octet-stream", body: body.toString("base64"), ms: Date.now() - t0 };
      if (res.status === 429 || res.status >= 500) { await sleep(4000 * (i + 1)); continue; }
      break;
    } catch (e) {
      out = { status: 0, type: "text/plain", body: Buffer.from(String(e)).toString("base64"), ms: Date.now() - t0 };
      await sleep(3000);
    }
  }
  if (cache && out && out.status === 200) writeFileSync(key, JSON.stringify(out));
  return out;
}
const json = (r) => { try { return JSON.parse(Buffer.from(r.body, "base64").toString("utf8")); } catch { return null; } };
const od = async (path, opt) => { const r = await raw(API + path, opt); return r.status === 200 ? json(r) : null; };

// ---------- выборка матчей ----------
const doc = (n) => JSON.parse(readFileSync(join(DOCS, n), "utf8"));
const heroes = await od("/constants/heroes");
const itemIds = await od("/constants/item_ids");
if (!heroes) { console.log("OpenDota не отдала героев — проверка невозможна"); process.exit(1); }
const dictionary = createDictionary({ heroes, items: doc("items.json"), abilities: doc("abilities.json") });
const knowledge = doc("knowledge.json"), texts = doc("texts.json");
let norms = {}; try { norms = doc("rank_norms.json"); } catch {}
const extra = { guides: (() => { try { return doc("khan_builds.json"); } catch { return null; } })(), builds: (() => { try { return doc("builds.json"); } catch { return null; } })() };

const MODES = { 1: "all pick", 2: "CM", 3: "random draft", 4: "SD", 5: "all random", 16: "CD", 18: "ability draft", 22: "ranked AP", 23: "турбо" };
const pub = (await od("/publicMatches", { cache: false })) || [];
const pub2 = pub.length ? (await od(`/publicMatches?less_than_match_id=${pub[pub.length - 1].match_id}`, { cache: false })) || [] : [];
const parsed = (await od("/parsedMatches", { cache: false })) || [];
const pro = (await od("/proMatches", { cache: false })) || [];
const turbo = (await od(`/explorer?sql=${encodeURIComponent("SELECT match_id FROM public_matches WHERE game_mode=23 ORDER BY match_id DESC LIMIT 6")}`, { cache: false }));
const sample = new Map();
const add = (id, tag) => { if (id && !sample.has(id)) sample.set(id, tag); };
const all = [...pub, ...pub2];
// разные режимы, по паре каждого
const byMode = {};
for (const m of all) { const k = m.game_mode; byMode[k] = (byMode[k] || 0) + 1; if (byMode[k] <= 3) add(m.match_id, `публичный ${MODES[k] || `mode ${k}`}`); }
for (const r of (turbo && turbo.rows) || []) add(r.match_id, "турбо");
for (const m of parsed.slice(0, 10)) add(m.match_id, "разобранный");
for (const m of pro.slice(0, 5)) add(m.match_id, "про");
// старые: реплея давно нет, разбор только быстрый
for (const id of [7100000000, 7600000000, 8200000000, 8700000000]) add(id + Math.floor(Math.random() * 1000), "старый");
for (const m of all.slice(10)) { if (sample.size >= N_MATCHES) break; add(m.match_id, "публичный"); }
console.log(`режимы в выборке: ${JSON.stringify(byMode)}`);
console.log(`матчей к проверке: ${sample.size}`);

// ---------- 1. движок ----------
const heroExtra = new Map();
async function extrasFor(heroId) {
  if (heroExtra.has(heroId)) return heroExtra.get(heroId);
  // на дополнения уходит по три запроса: берём их для первых 40 героев, остальным — пусто (так же бывает в приложении, если OpenDota медлит)
  let v = { pro: {}, bench: {}, matchups: [] };
  if (heroExtra.size < 40) {
    const [pop, bench, mu] = [await od(`/heroes/${heroId}/itemPopularity`), await od(`/benchmarks?hero_id=${heroId}`), await od(`/heroes/${heroId}/matchups`)];
    const counts = {};
    for (const phase of Object.values(pop || {})) for (const [id, n] of Object.entries(phase || {})) { const k = itemIds && itemIds[id]; if (k) counts[k] = (counts[k] || 0) + n; }
    v = { pro: counts, bench: (bench && bench.result) || {}, matchups: Array.isArray(mu) ? mu : [] };
  }
  heroExtra.set(heroId, v);
  return v;
}
function scanStrings(obj, path, out, seen = new Set()) {
  if (obj == null || typeof obj !== "object" || seen.has(obj)) return;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") { if (/undefined|NaN|\[object|Infinity/.test(v)) out.push(`${path}.${k}: «${v.slice(0, 120)}»`); }
    else if (typeof v === "number") { if (!Number.isFinite(v) && !["overall"].includes(k)) out.push(`${path}.${k}: ${v}`); }
    else scanStrings(v, `${path}.${k}`, out, seen);
  }
}
const uiCandidates = [];
const stats = { matches: 0, players: 0, lite: 0, full: 0, missing: 0, anon: 0, ms: [] };
for (const [id, tag] of sample) {
  const r = await raw(`${API}/matches/${id}`);
  const match = r.status === 200 ? json(r) : null;
  if (!match || !Array.isArray(match.players) || match.players.length === 0) { stats.missing++; console.log(`${id} (${tag}): нет матча (${r.status})`); continue; }
  stats.matches++;
  const lite = !isParsed(match);
  lite ? stats.lite++ : stats.full++;
  const open = match.players.filter((p) => p.account_id && p.account_id !== 4294967295);
  stats.anon += match.players.length - open.length;
  let line = `${id} (${tag}, mode ${match.game_mode}, ${Math.round(match.duration / 60)} мин, ${lite ? "без реплея" : "реплей разобран"}): игроков с профилем ${open.length}`;
  const errs = [];
  for (const p of open) {
    const ex = await extrasFor(p.hero_id);
    const t0 = Date.now();
    try {
      const a = analyze(match, p, dictionary, knowledge, texts, ex.pro, ex.bench, norms, ex.matchups, null, extra);
      stats.ms.push(Date.now() - t0);
      stats.players++;
      const s = [];
      scanStrings(a, "a", s);
      if (!a.verdict) s.push("пустой вердикт");
      if (!Number.isFinite(a.overall)) s.push(`оценка ${a.overall}`);
      if (s.length) errs.push(`слот ${p.player_slot} ${dictionary.heroName(p.hero_id)}: ${s.slice(0, 3).join("; ")}`);
    } catch (e) {
      errs.push(`слот ${p.player_slot} ${dictionary.heroName(p.hero_id)}: падение движка ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ← ") : e}`);
    }
  }
  try {
    const me = open[0] || match.players[0];
    const v = matchVerdicts(match, me.account_id, { heroName: dictionary.heroName, heroKey: (h) => dictionary.heroKey ? dictionary.heroKey(h) : "" });
    const s = []; scanStrings(v, "blame", s);
    if (s.length) errs.push(`кто слил: ${s.slice(0, 2).join("; ")}`);
    replayModel(match, null, me, { heroKey: (h) => (heroes[h] ? heroes[h].name.replace("npc_dota_hero_", "") : ""), heroName: dictionary.heroName });
  } catch (e) {
    errs.push(`кто слил/карта: падение ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ← ") : e}`);
  }
  console.log(line);
  for (const e of errs) bad(`движок ${id}`, e);
  if (open.length) uiCandidates.push({ id, tag, lite, account: open[Math.floor(Math.random() * open.length)].account_id, mode: match.game_mode });
}
stats.ms.sort((a, b) => a - b);
console.log(`\nДВИЖОК: матчей ${stats.matches} (полных ${stats.full}, без реплея ${stats.lite}, не нашлось ${stats.missing}), разборов ${stats.players}, скрытых профилей ${stats.anon}, время разбора медиана ${stats.ms[stats.ms.length >> 1] || 0} мс, макс ${stats.ms[stats.ms.length - 1] || 0} мс`);

// ---------- 2. заявка на разбор реплея ----------
// Свежие публичные катки без реплея: одну заявку шлём напрямую в OpenDota, другую через воркер (так делает приложение при сбое)
async function parseRun() {
  const fresh = pub.filter((m) => Date.now() / 1000 - (m.start_time + m.duration) < 3 * 3600).slice(0, 12);
  const picks = [];
  for (const m of fresh) {
    if (picks.length >= 3) break;
    const d = await od(`/matches/${m.match_id}`, { cache: false });
    if (d && d.players && !isParsed(d)) picks.push(m.match_id);
  }
  const res = [];
  for (const [i, id] of picks.entries()) {
    const viaWorker = i === 1;
    const t0 = Date.now();
    const r = await raw(viaWorker ? `${WORKER}/od/request/${id}` : `${API}/request/${id}`, { method: "POST", cache: false });
    console.log(`заявка ${id} ${viaWorker ? "через воркер" : "напрямую"}: ${r.status} за ${r.ms} мс ${Buffer.from(r.body, "base64").toString("utf8").slice(0, 120)}`);
    if (r.status !== 200) bad(`заявка ${viaWorker ? "через воркер" : "в OpenDota"}`, `ответ ${r.status}`);
    res.push({ id, t0, viaWorker, done: null });
  }
  // как приложение: опрос матча; ждём до 6 минут
  for (let k = 0; k < 24 && res.some((x) => !x.done); k++) {
    await sleep(15000);
    for (const x of res.filter((y) => !y.done)) {
      const d = await od(`/matches/${x.id}`, { cache: false });
      if (d && isParsed(d)) x.done = Math.round((Date.now() - x.t0) / 1000);
    }
  }
  for (const x of res) console.log(`реплей ${x.id} (${x.viaWorker ? "воркер" : "напрямую"}): ${x.done ? `готов через ${x.done} с` : "не разобрался за 6 минут"}`);
  // запасной путь: GET матча через воркер
  if (picks[0]) {
    const r = await raw(`${WORKER}/od/matches/${picks[0]}`, { cache: false });
    console.log(`воркер GET /od/matches: ${r.status} за ${r.ms} мс`);
    if (r.status !== 200) bad("воркер /od/matches", `ответ ${r.status}`);
  }
  return res;
}

// ---------- 3. приложение в Chromium ----------
async function uiRun() {
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { console.log("playwright нет — прогон в браузере пропущен"); return; }
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".glb": "model/gltf-binary" };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = join(DOCS, path);
    if (!file.startsWith(DOCS) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const runs = [];
  // главная игрока: половина прогонов, ещё половина — прямая ссылка на матч (из бота или поделиться)
  const picks = uiCandidates.filter((c) => c.tag !== "старый").slice(0, Math.ceil(N_UI / 2));
  for (const c of picks) runs.push({ ...c, how: "home" });
  for (const c of uiCandidates.filter((x) => !picks.includes(x)).slice(0, N_UI - picks.length)) runs.push({ ...c, how: "link" });
  const times = [];
  for (const run of runs) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", serviceWorkers: "block", reducedMotion: "reduce" });
    await ctx.addInitScript((acc) => { try { localStorage.setItem("account_id", String(acc)); } catch { /* */ } }, run.account);
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === BASE) return route.continue();
      if (url.hostname.endsWith("workers.dev")) {
        // трекинг и тренер не трогаем: события тестов не должны попасть в отчёт по юзерам
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" } });
        if (url.pathname.startsWith("/od/") && req.method() === "GET") {
          const r = await raw(req.url());
          return route.fulfill({ status: r.status || 502, contentType: r.type, headers: { "Access-Control-Allow-Origin": "*" }, body: Buffer.from(r.body, "base64") });
        }
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
      }
      if (url.hostname === "telegram.org") return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
      if (/opendota\.com$|githubusercontent\.com$|steamstatic\.com$|steamcdn|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
        // заявку на разбор не шлём: её проверяет шаг 2
        if (req.method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
        try {
          const r = await raw(req.url());
          if (!r.status) return route.abort();
          return route.fulfill({ status: r.status, contentType: r.type, headers: { "Access-Control-Allow-Origin": "*" }, body: Buffer.from(r.body, "base64") });
        } catch { return route.abort(); }
      }
      return route.abort();
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`); });
    const label = `приложение ${run.how === "home" ? "главная→катка" : "ссылка"} ${run.id} (${run.tag})`;
    const t0 = Date.now();
    try {
      if (run.how === "home") {
        await page.goto(`${BASE}/`);
        await page.waitForSelector(".match-item, .fresh-match, .hidden-matches, .error", { timeout: 60000 });
        if (await page.locator(".hidden-matches, .error").count()) {
          console.log(`${label}: на главной ${await page.locator(".hidden-matches").count() ? "«матчи скрыты»" : "ошибка"} — открываю катку ссылкой`);
          await page.goto(`${BASE}/?match=${run.id}&account=${run.account}`);
        } else {
          const first = page.locator(".fresh-match, .match-item").first();
          await first.click();
        }
      } else {
        await page.goto(`${BASE}/?match=${run.id}`);
      }
      // ждём разбор, ошибку или «Реплей разбирается»; на последнем жмём «Показать быстрый разбор» — как живой человек
      const first = await page.waitForSelector(".hero-head, .error, h1:has-text('не твоя'), h1:has-text('Привяжи'), p.display:has-text('Реплей разбирается')", { timeout: 60000 });
      let what = (await first.innerText()).slice(0, 40);
      const firstMs = Date.now() - t0;
      if (/Реплей разбирается/.test(what)) {
        await page.locator("button", { hasText: "быстрый разбор" }).click({ timeout: 40000 });
        await page.waitForSelector(".hero-head, .error", { timeout: 60000 });
      }
      const doneMs = Date.now() - t0;
      if (!(await page.locator(".hero-head").count())) {
        const msg = (await page.locator("#app").innerText()).replace(/\s+/g, " ").slice(0, 160);
        bad(label, `разбор не открылся: «${msg}»`);
      } else {
        times.push(firstMs);
        const tabs = await page.locator(".tabs .tab").allInnerTexts();
        for (let i = 0; i < tabs.length; i++) {
          await page.locator(".tabs .tab").nth(i).click();
          await page.waitForTimeout(900);
          const text = await page.locator("#app").innerText();
          for (const w of ["undefined", "NaN", "[object", "Infinity"]) if (text.includes(w)) bad(label, `вкладка «${tabs[i]}»: на экране «${w}» … ${text.slice(Math.max(0, text.indexOf(w) - 60), text.indexOf(w) + 20).replace(/\s+/g, " ")}`);
        }
        console.log(`${label}: первый экран «${what.replace(/\s+/g, " ")}» за ${(firstMs / 1000).toFixed(1)} с, разбор за ${(doneMs / 1000).toFixed(1)} с, вкладки: ${tabs.join(", ")}`);
      }
    } catch (e) {
      const msg = await page.locator("#app").innerText().catch(() => "");
      bad(label, `${String(e.message).split("\n")[0]} — на экране: «${msg.replace(/\s+/g, " ").slice(0, 160)}»`);
      await page.screenshot({ path: join(OUT, `fail-${run.id}.png`) }).catch(() => {});
    }
    for (const e of errs) bad(label, e);
    await ctx.close();
  }
  await browser.close();
  server.close();
  times.sort((a, b) => a - b);
  console.log(`\nПРИЛОЖЕНИЕ: прогонов ${runs.length}, первый экран медиана ${((times[times.length >> 1] || 0) / 1000).toFixed(1)} с, худший ${((times[times.length - 1] || 0) / 1000).toFixed(1)} с`);
}

const parseP = process.env.CHECK_PARSE === "0" ? Promise.resolve([]) : parseRun();
if (process.env.CHECK_UI !== "0") await uiRun();
await parseP;
console.log(`\nзапросов к API: ${calls}`);
console.log(problems.length ? `\nПРОБЛЕМ: ${problems.length}\n${problems.join("\n")}` : "\nпроблем не найдено");
process.exit(problems.length ? 1 : 0);
