// Снимает круговую раскадровку Аегиса (Sketchfab, msta2219, CC BY) через Viewer API: прозрачный фон,
// камера обходит щит, свет «студии» идёт вместе с камерой — как будто щит крутится под неподвижным светом.
// Сначала калибровка: ищем анфас (самый широкий силуэт с серебром), центруем цель и подгоняем расстояние.
// Запуск: node tools/capture_aegis.mjs <папка> 48 800 8 0.8  (кадров, размер, наклон камеры, экспозиция),
// потом python tools/pack_aegis.py <папка>. Нужна видеокарта: на программном WebGL Sketchfab не стартует.
// Найденные центр, расстояние и анфас — в CAM в docs/aegis.js (для витрины).
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const [out, framesArg = "8", sizeArg = "600", elevArg = "6", expArg = "0.6"] = process.argv.slice(2);
const FRAMES = Number(framesArg), SIZE = Number(sizeArg), ELEV = Number(elevArg), EXPOSURE = Number(expArg);
mkdirSync(out, { recursive: true });
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<iframe id="f" allow="autoplay; fullscreen" style="width:600px;height:600px;border:0"></iframe>
<script src="https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js"></script>
<script>
window.log = [];
const client = new Sketchfab(document.getElementById("f"));
client.init("be25c575619641c2a562cbbc7727da76", {
  autostart: 1, preload: 1, transparent: 1, ui_controls: 0, ui_infos: 0, ui_stop: 0, ui_inspector: 0, ui_hint: 0,
  ui_watermark: 0, ui_loading: 0,
  success(api) { window.api = api; api.start(); api.addEventListener("viewerready", () => log.push("ready")); },
  error(e) { log.push("init error " + e); },
});
window.call = (name, ...args) => new Promise((res, rej) => api[name](...args, (e, v) => e ? rej(String(e)) : res(v)));
// рамка непрозрачного и яркость середины кадра
window.measure = (url) => new Promise((res) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, lum = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        lum += d[i] + d[i + 1] + d[i + 2]; n++;
      }
    }
    res({ x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, lum: n ? lum / n / 3 : 0, n });
  };
  img.src = url;
});
</script></body></html>`;

const browser = await chromium.launch({ args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
await page.route("https://probe.test/", (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
await page.goto("https://probe.test/");
await page.waitForFunction(() => window.log.length > 0, null, { timeout: 90000 });
console.log(await page.evaluate(() => window.log.join(",")));
await page.waitForTimeout(3000);
const info = await page.evaluate(async ([FRAMES, SIZE, ELEV, EXPOSURE]) => {
  const cam = await call("getCameraLookAt");
  const env = await call("getEnvironment");
  const fov = await call("getFov");
  await call("setEnvironment", { exposure: EXPOSURE });
  let t = cam.target.slice();
  const d0 = cam.position.map((v, i) => v - t[i]);
  let R = Math.hypot(...d0);
  const a0 = Math.atan2(d0[1], d0[0]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const view = async (a, e, size) => {
    const pos = [t[0] + R * Math.cos(e) * Math.cos(a), t[1] + R * Math.cos(e) * Math.sin(a), t[2] + R * Math.sin(e)];
    await call("setCameraLookAt", pos, t, 0);
    await call("setEnvironment", { rotation: env.rotation + (a - a0) });
    await wait(500);
    return call("getScreenShot", size, size, "image/png");
  };
  // 1. анфас: самый широкий силуэт, из двух сторон — где ярче (серебро спереди)
  const sweep = [];
  for (let i = 0; i < 36; i++) {
    const a = a0 + (2 * Math.PI * i) / 36;
    sweep.push({ a, m: await measure(await view(a, 0, 200)) });
  }
  const wide = sweep.slice().sort((x, y) => y.m.w - x.m.w);
  const cand = [wide[0], wide.find((s) => Math.abs(Math.cos(s.a - wide[0].a)) < -0.5 || Math.cos(s.a - wide[0].a) < -0.7) || wide[1]];
  let front = cand.sort((x, y) => y.m.lum - x.m.lum)[0].a;
  // уточняем шагом в 2°
  let best = front, bw = 0;
  for (let k = -5; k <= 5; k++) {
    const a = front + (k * 2 * Math.PI) / 180;
    const m = await measure(await view(a, 0, 200));
    if (m.w > bw) { bw = m.w; best = a; }
  }
  front = best;
  // 2. центровка: в анфас — по ширине и высоте, сбоку — по глубине; два прохода
  const wpp = (size) => (2 * R * Math.tan(((fov * Math.PI) / 180) / 2)) / size;
  for (let pass = 0; pass < 3; pass++) {
    for (const a of [front, front + Math.PI / 2]) {
      const m = await measure(await view(a, 0, 300));
      const k = wpp(300);
      const right = [-Math.sin(a), Math.cos(a), 0];
      const dx = (m.cx - 150) * k, dy = (m.cy - 150) * k;
      t = [t[0] + right[0] * dx, t[1] + right[1] * dx, t[2] - dy];
    }
  }
  // 3. расстояние: самая большая сторона силуэта по всему кругу — 86% кадра
  let maxDim = 0;
  for (let i = 0; i < 12; i++) {
    const m = await measure(await view(front + (2 * Math.PI * i) / 12, (ELEV * Math.PI) / 180, 300));
    maxDim = Math.max(maxDim, m.w, m.h);
  }
  R *= maxDim / (0.86 * 300);
  // 4. кадры
  const shots = [];
  for (let i = 0; i < FRAMES; i++) shots.push(await view(front + (2 * Math.PI * i) / FRAMES, (ELEV * Math.PI) / 180, SIZE));
  return { fov, R, t, front, env, shots };
}, [FRAMES, SIZE, ELEV, EXPOSURE]);
console.log(JSON.stringify({ fov: info.fov, R: info.R, t: info.t, front: info.front, env: info.env }));
info.shots.forEach((url, i) => writeFileSync(`${out}/f${String(i).padStart(3, "0")}.png`, Buffer.from(url.split(",")[1], "base64")));
console.log("frames", info.shots.length);
await browser.close();
