// Кадры вращающегося Аегиса для аватарки канала: настоящая WebGL-модель из мини-аппа на прозрачном фоне.
// Запуск: node tools/promo_avatar_frames.mjs <папка> [кадров=90]; дальше python tools/promo_avatar.py <папка>
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DOCS = join(fileURLToPath(new URL("../", import.meta.url)), "docs");
const OUT = process.argv[2], N = Number(process.argv[3] || 90), SIZE = 560;
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".json": "application/json", ".png": "image/png" };
const PAGE = `<!doctype html><html><head><link rel="stylesheet" href="style.css"><style>html,body{background:transparent!important;margin:0}#h{padding:0}</style></head><body><div id="h"></div>
<script type="module">import { aegisBadge } from "./aegis.js?v=3"; const a = aegisBadge(); a.style.setProperty("--size","${SIZE}px"); document.getElementById("h").append(a);</script></body></html>`;
const server = createServer((req, res) => {
  if (req.url.startsWith("/__aegis")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(PAGE); return; }
  const file = join(DOCS, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(DOCS) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/__aegis`);
await page.waitForSelector(".aegis.ready", { timeout: 15000 });
const box = await page.locator(".aegis").boundingBox();
for (let i = 0; i < N; i++) {
  const t = (i / N) * Math.PI * 2; // петля: качается влево-вправо и чуть кивает
  await page.evaluate(([yaw, pitch]) => document.querySelector(".aegis").aegisPose([yaw, pitch]), [38 * Math.sin(t), 9 * Math.sin(t * 2 + 0.6)]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(OUT, `f${String(i).padStart(3, "0")}.png`), omitBackground: true, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
}
console.log(`кадров: ${N}, размер ${Math.round(box.width)}x${Math.round(box.height)}`);
await browser.close(); server.close();
