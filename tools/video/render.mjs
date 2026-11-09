// Видеоразбор, шаг 5: рендер кадров. Поднимает локальный сервер с репозиторием, открывает film/index.html в Chromium
// и снимает кадры в несколько потоков (кадр — чистая функция времени, поэтому куски независимы).
// Каждый поток гонит JPEG-кадры прямо в ffmpeg (сразу итоговое качество: до 2.5 Мбит/с, ролик выходит 20–30 МБ при пределе
// 50 МБ у Телеграма); куски потом склеиваются без перекодирования.
// Запуск: node tools/video/render.mjs <film.json> <out.mp4> [--workers 4] [--frames a-b] [--still t out.png]
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".otf": "font/otf", ".jpg": "image/jpeg" };

function serve(filmPath) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const file = url.pathname === "/film.json" ? filmPath : join(ROOT, normalize(decodeURIComponent(url.pathname)));
      if (file !== filmPath && !file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}
async function launch() {
  const { chromium } = await import("playwright");
  const opts = { args: ["--disable-gpu", "--disable-dev-shm-usage"] };
  if (process.env.PW_EXEC) opts.executablePath = process.env.PW_EXEC;
  return chromium.launch(opts);
}
async function openPage(browser, port, film) {
  const page = await browser.newPage({ viewport: { width: film.W, height: film.H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/video/film/index.html`);
  try { await page.waitForFunction("window.__ready === true", null, { timeout: 60000 }); }
  catch { throw new Error(`страница ролика не запустилась: ${errors.join(" | ") || "нет ответа"}`); }
  return page;
}
const run = (cmd, args, input) => new Promise((ok, fail) => {
  const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  p.on("error", fail);
  p.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd}: код ${code}: ${err}`))));
  if (input) input(p.stdin);
});

export async function renderStill(filmPath, t, outPng) {
  const film = JSON.parse(await readFile(filmPath, "utf8"));
  const server = await serve(resolve(filmPath)), browser = await launch();
  try {
    const page = await openPage(browser, server.address().port, film);
    const url = await page.evaluate(`window.frameJpeg(${t}, 0.95)`);
    await writeFile(outPng, Buffer.from(url.split(",")[1], "base64"));
  } finally { await browser.close(); server.close(); }
}

export async function renderVideo(filmPath, outMp4, { workers = Math.max(1, Math.min(4, cpus().length)), from = 0, to = null, log = () => {} } = {}) {
  const film = JSON.parse(await readFile(filmPath, "utf8"));
  const last = to ?? film.frames, total = last - from;
  const tmp = `${outMp4}.parts`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const server = await serve(resolve(filmPath));
  const browsers = [];
  const started = Date.now();
  let done = 0;
  try {
    const n = Math.min(workers, Math.max(1, Math.floor(total / 30)));
    const per = Math.ceil(total / n);
    const parts = [];
    await Promise.all(Array.from({ length: n }, async (_, w) => {
      const a = from + w * per, b = Math.min(last, a + per);
      if (a >= b) return;
      const part = join(tmp, `p${String(w).padStart(2, "0")}.mp4`);
      parts[w] = part;
      // свой браузер на поток: у вкладок одного браузера общий GPU-процесс, и они рисуют по очереди
      const browser = await launch();
      browsers.push(browser);
      const page = await openPage(browser, server.address().port, film);
      let stdin;
      const enc = run("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(film.fps), "-i", "-",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-maxrate", "2500k", "-bufsize", "5M", "-pix_fmt", "yuv420p", "-r", String(film.fps), "-g", String(film.fps), part], (s) => { stdin = s; });
      for (let f = a; f < b; f++) {
        const url = await page.evaluate(`window.frameJpeg(${(f + 0.5) / film.fps})`);
        const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
        if (!stdin.write(buf)) await new Promise((r) => stdin.once("drain", r));
        done++;
        if (done % 300 === 0) log(`кадры ${done}/${total}, ${(done / ((Date.now() - started) / 1000)).toFixed(1)} к/с`);
      }
      stdin.end();
      await enc;
      await page.close();
    }));
    const list = join(tmp, "list.txt");
    await writeFile(list, parts.filter(Boolean).map((p) => `file '${resolve(p)}'`).join("\n"));
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", outMp4]);
  } finally { await Promise.all(browsers.map((b) => b.close().catch(() => {}))); server.close(); await rm(tmp, { recursive: true, force: true }); }
  return { frames: total, seconds: (Date.now() - started) / 1000 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
  const still = args.indexOf("--still");
  if (still >= 0) { const [, t, png] = args.splice(still, 3); await renderStill(args[0], Number(t), png); }
  else {
    const workers = flag("--workers"), frames = flag("--frames");
    const [a, b] = frames ? frames.split("-").map(Number) : [0, null];
    const r = await renderVideo(args[0], args[1], { workers: workers ? Number(workers) : undefined, from: a, to: b, log: (m) => process.stderr.write(`${m}\n`) });
    process.stderr.write(`готово: ${r.frames} кадров за ${r.seconds.toFixed(1)} с\n`);
  }
}
