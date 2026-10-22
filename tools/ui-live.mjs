// Приложение в Chromium на настоящих данных: живая OpenDota (через Node, с кэшем на диске), аккаунт игрока.
// Тренер подменён заглушкой, Телеграма нет. Скриншоты в tests/ui/live/.
// Запуск: node tools/ui-live.mjs <match_id> [вкладки через запятую: overview,phases,deaths,map,build,charts]
// или node tools/ui-live.mjs 0 home,profile,hero — главная, профиль и страница героя
// ACCOUNT=801280038 по умолчанию, UI_WIDTH=390, LIVE_CACHE=папка кэша ответов OpenDota, OPEN=1 раскрывает <details>,
// COACH=1 — на «Обзоре» нажать «Разобрать с тренером» и сходить в настоящий воркер
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "tests", "ui", "live");
const CACHE = process.env.LIVE_CACHE || join(OUT, ".cache");
const MATCH = Number(process.argv[2]);
const TABS = (process.argv[3] || "overview,phases,deaths,map,build,charts").split(",");
const ACCOUNT = Number(process.env.ACCOUNT || 801280038);
if (!MATCH && !process.argv[3]) { console.error("нужен match_id"); process.exit(1); }
rmSync(join(OUT, String(MATCH)), { recursive: true, force: true });
mkdirSync(join(OUT, String(MATCH)), { recursive: true });
mkdirSync(CACHE, { recursive: true });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = join(DOCS, path);
  if (!file.startsWith(DOCS) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Запрос наружу через Node (у Chromium в контейнере нет прокси), GET-ответы кэшируются на диск
async function outside(url, method) {
  const key = join(CACHE, createHash("sha1").update(url).digest("hex"));
  if (method === "GET" && existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  const res = await fetch(url, { method, signal: AbortSignal.timeout(40000) });
  const body = Buffer.from(await res.arrayBuffer()).toString("base64");
  const out = { status: res.status, type: res.headers.get("content-type") || "application/octet-stream", body };
  if (method === "GET" && res.ok) writeFileSync(key, JSON.stringify(out));
  return out;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: Number(process.env.UI_WIDTH) || 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  locale: "ru-RU", serviceWorkers: "block", colorScheme: "dark", reducedMotion: "reduce",
});
await context.addInitScript((acc) => { try { localStorage.setItem("account_id", String(acc)); } catch { /* */ } }, ACCOUNT);
const errors = [];
await context.route("**/*", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin === BASE) return route.continue();
  if (url.hostname.endsWith("workers.dev")) {
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" } });
    // COACH=1 — настоящий тренер: запрос уходит в воркер через Node, в консоль — кто ответил и за сколько
    if (process.env.COACH && req.method() === "POST") {
      const t0 = Date.now();
      try {
        const r = await fetch(req.url(), { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://bezzz22.github.io" }, body: req.postData(), signal: AbortSignal.timeout(120000) });
        const body = await r.text();
        console.log(`тренер: ${r.status} за ${((Date.now() - t0) / 1000).toFixed(1)} с, ответил ${r.headers.get("x-coach-by") || "—"}`);
        return route.fulfill({ status: r.status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body });
      } catch (e) {
        console.log(`тренер: нет ответа за ${((Date.now() - t0) / 1000).toFixed(1)} с (${e.message})`);
        return route.abort();
      }
    }
    return route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Тренер в живом прогоне выключен." }) });
  }
  if (url.hostname === "telegram.org") return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  if (/opendota\.com$|githubusercontent\.com$|steamstatic\.com$|steamcdn|fonts\.(googleapis|gstatic)\.com$|sketchfab/.test(url.hostname)) {
    try {
      const r = await outside(req.url(), req.method());
      return route.fulfill({ status: r.status, contentType: r.type, headers: { "Access-Control-Allow-Origin": "*" }, body: Buffer.from(r.body, "base64") });
    } catch (e) {
      return route.abort();
    }
  }
  return route.abort();
});

const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });

// DRAFT=PA,Viper,... — вместо матча прогнать «Драфт перед игрой» с этими врагами и сборкой (OWN=свой герой)
if (process.env.DRAFT) {
  await page.goto(`${BASE}/`);
  await page.locator(".draft-entry").click();
  for (const name of process.env.DRAFT.split(",")) {
    await page.locator('input[type="search"]').first().fill(name);
    await page.locator(".draft-hero").first().click();
  }
  if (process.env.ROLE === "support") await page.locator(".seg", { hasText: "Я саппорт" }).click();
  await page.locator(".draft-go").click();
  await page.waitForSelector(".draft-result h2", { timeout: 90000 });
  const btns = page.locator(".draft-build-btn");
  if (await btns.count()) await btns.first().click();
  if (process.env.OWN) {
    await page.locator('input[aria-label="Свой герой"]').fill(process.env.OWN);
    await page.locator(".own-heroes .draft-pick").first().click();
  }
  await page.waitForTimeout(500);
  const file = join(OUT, String(MATCH), "draft.png");
  await page.screenshot({ path: file, fullPage: true });
  console.log("screenshot", file);
  const text = await page.locator("#app").innerText();
  for (const bad of ["undefined", "NaN", "null", "[object"]) if (text.includes(bad)) errors.push(`на экране «${bad}»`);
  await browser.close();
  server.close();
  if (errors.length) { console.log(errors.join("\n")); process.exit(1); }
  console.log("ok");
  process.exit(0);
}
// node tools/ui-live.mjs 0 home,profile,hero — главная, профиль и страница самого частого героя на живых данных
if (TABS.some((t) => ["home", "profile", "hero"].includes(t))) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".match-item", { timeout: 90000 });
  for (const t of TABS) {
    if (t === "profile") {
      await page.locator('.tabbtn[data-tab="profile"]').click();
      await page.waitForSelector(".profile-card", { timeout: 90000 });
      await page.waitForTimeout(4000); // профиль догружает героев и друзей
    }
    if (t === "hero") {
      await page.locator(".hero-stat").first().click();
      await page.waitForSelector(".page-head", { timeout: 90000 });
      await page.waitForTimeout(3000);
    }
    if (process.env.OPEN) await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    const file = join(OUT, String(MATCH), `${t}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("screenshot", file);
  }
  const text = await page.locator("#app").innerText();
  for (const bad of ["undefined", "NaN", "null", "[object"]) if (text.includes(bad)) errors.push(`на экране «${bad}»`);
  await browser.close();
  server.close();
  if (errors.length) { console.log(errors.join("\n")); process.exit(1); }
  console.log("ok");
  process.exit(0);
}
await page.goto(`${BASE}/?match=${MATCH}`);
await page.waitForSelector(".hero-head", { timeout: 90000 });
const names = await page.locator(".tabs .tab").allInnerTexts();
const KEYS = { overview: "Обзор", phases: "Фазы", deaths: "Смерти", map: "Карта", build: "Сборка", charts: "Графики" };
for (const t of TABS) {
  const i = names.findIndex((n) => n.trim() === (KEYS[t] || t));
  if (i < 0) { errors.push(`нет вкладки ${t}`); continue; }
  await page.locator(".tabs .tab").nth(i).click();
  await page.waitForTimeout(600);
  if (t === "overview" && process.env.COACH) {
    await page.locator(".coach-btn").first().click();
    await page.waitForFunction(() => document.querySelector(".coach-steps, .coach .loss-text, .coach [role=alert], .coach .error") || /недоступ|ошиб|устал|часто/i.test(document.querySelector(".coach")?.innerText || ""), null, { timeout: 130000 }).catch(() => {});
    console.log("блок тренера:", (await page.locator(".coach").first().innerText()).replace(/\s+/g, " ").slice(0, 400));
  }
  if (t === "charts") {
    // подсказки: тап в 10-ю минуту и в самый конец каждого графика
    const charts = page.locator("svg.chart");
    for (let k = 0; k < await charts.count(); k++) {
      const c = charts.nth(k);
      await c.scrollIntoViewIfNeeded();
      const box = await c.boundingBox();
      const len = Number(await c.getAttribute("data-len"));
      const at = async (frac) => {
        await page.mouse.move(box.x + box.width * frac, box.y + box.height / 2);
        return (await c.locator("text.tt").allTextContents()).filter(Boolean).join(" | ");
      };
      const L = 34 / 340, R = 8 / 340;
      console.log(`график ${k + 1}: 10 мин → ${await at(L + (10 / len) * (1 - L - R))}; конец → ${await at(0.995)}`);
    }
  }
  if (t === "charts" && await page.locator(".chart-seg button").count()) {
    // переключатель «Опыт» на преимуществе команды
    await page.locator(".chart-seg button", { hasText: "Опыт" }).click();
    const c = page.locator("svg.chart").first();
    const box = await c.boundingBox();
    const len = Number(await c.getAttribute("data-len"));
    await page.mouse.move(box.x + box.width * (34 / 340 + (10 / len) * (1 - 42 / 340)), box.y + box.height / 2);
    console.log(`опыт: 10 мин → ${(await c.locator("text.tt").allTextContents()).filter(Boolean).join(" | ")}`);
    await page.locator(".chart-seg button", { hasText: "Золото" }).click();
  }
  // OPEN=1 — раскрыть все сворачиваемые блоки (хронология и пр.) перед скриншотом
  if (process.env.OPEN) await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  const file = join(OUT, String(MATCH), `${t}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("screenshot", file);
}
// Текст экрана: ловим undefined/NaN и пустые подписи
const text = await page.locator("#app").innerText();
for (const bad of ["undefined", "NaN", "null", "[object"]) if (text.includes(bad)) errors.push(`на экране «${bad}»`);
await browser.close();
server.close();
if (errors.length) { console.log(errors.join("\n")); process.exit(1); }
console.log("ok");
