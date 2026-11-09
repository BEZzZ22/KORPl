// Видеоразбор: кадр ролика как чистая функция времени. Страницу открывает tools/video/render.mjs и по кадру
// зовёт window.renderFrame(t). Сцена объёмная: карта лежит столом в перспективе, герои стоят фишками, камера летает
// между моментами. Поверх — плоский слой: заголовки, часы матча, субтитры, плашки.
// Никакого состояния между кадрами: любой кадр можно нарисовать отдельно, поэтому рендер делится на потоки.
import { BUILDINGS } from "./mapgeo.js";

const Q = new URLSearchParams(location.search);
const film = await (await fetch(Q.get("film") || "/film.json")).json();
const { W, H } = film;
const C = { ink: "#09090b", slab: "#111113", text: "#f4f4f5", muted: "#9a9aa3", gold: "#e6b858", red: "#f0585d", green: "#3fcf8e", line: "#2a2a30" };
const TEAM = [C.green, C.red]; // 0 — свои, 1 — враги (относительно игрока)
const rel = (team) => (team === film.team ? 0 : 1);
const colorOf = (slot) => (slot === film.me ? C.gold : TEAM[rel(film.players[slot].team)]);

// ---------- математика ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (k) => k * k * (3 - 2 * k);
const outCubic = (k) => 1 - (1 - k) ** 3;
const outExpo = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const inCubic = (k) => k ** 3;
const outBack = (k, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;
// пружина: 0 → 1 с перелётом, u — секунд от старта
const spring = (u, freq = 5.2, damp = 6.5) => (u <= 0 ? 0 : 1 - Math.exp(-damp * u) * Math.cos(freq * u * 1.6));
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const mmss = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;

// ---------- ресурсы ----------
const loadImage = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
async function loadFonts() {
  const faces = [new FontFace("Display", "url(/promo/motion/common/fonts/display.otf)", { weight: "900" }), new FontFace("UI", "url(/promo/motion/common/fonts/ui.otf)", { weight: "600" })];
  for (const f of faces) { try { document.fonts.add(await f.load()); } catch { /* системный шрифт вместо фирменного */ } }
}
const [mapImg, emblem, ...portraits] = await Promise.all([loadImage("/docs/img/map.webp"), loadImage("/docs/img/emblem.png"),
  ...film.players.map((p) => loadImage(`/tools/video/assets/heroes/${p.key}.webp`).then((im) => im || loadImage(`/docs/img/heroes/${p.key}.webp`)))]);
await loadFonts();
const F = (size, face = "Display") => `${face === "Display" ? 900 : 600} ${size}px ${face}, "Inter", "Segoe UI", Arial, sans-serif`;

// ---------- сцена ----------
// Своя перспектива на обычном 2D-холсте: в безголовом Chromium WebGL считается программно и в 5–8 раз медленнее.
// Земля (карта и всё, что на ней нарисовано) — холст G в клетках карты; на экран он ложится построчно:
// у камеры без крена каждая строка экрана — прямая на земле, и её рисует один drawImage с аффинным переносом.
// Фишки и столбы света — спрайты в точках, спроецированных той же камерой.
const out = document.getElementById("out");
const hud = out.getContext("2d", { willReadFrequently: true });
const FOV = 28, FOCAL = H / 2 / Math.tan((FOV * Math.PI) / 360), CY = H * 0.415; // точка внимания выше центра: внизу субтитры
const TS = 2048;
const ground = document.createElement("canvas"); ground.width = ground.height = TS;
const dec = ground.getContext("2d", { willReadFrequently: true });
function bake(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; }
// карта: приглушённая, чтобы фишки и линии читались. Фильтр дорогой, поэтому один раз
const mapBaked = bake(2048, 2048, (c, w) => {
  c.fillStyle = "#101114"; c.fillRect(0, 0, w, w);
  if (mapImg) { c.filter = "saturate(0.85) brightness(0.92) contrast(1.1)"; c.imageSmoothingQuality = "high"; c.drawImage(mapImg, 0, 0, w, w); c.filter = "none"; }
  const g = c.createRadialGradient(w / 2, w / 2, w * 0.34, w / 2, w / 2, w * 0.74);
  g.addColorStop(0, "rgba(9,9,11,0)"); g.addColorStop(1, "rgba(9,9,11,0.5)");
  c.fillStyle = g; c.fillRect(0, 0, w, w);
  // зерно: карта в исходнике 900 точек, на крупном плане без него она мыльная
  const id = c.getImageData(0, 0, w, w), px = id.data;
  let seed = 12345;
  for (let i = 0; i < px.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = ((seed >>> 24) - 128) * 0.085;
    px[i] += n; px[i + 1] += n; px[i + 2] += n;
  }
  c.putImageData(id, 0, 0);
});
// фишки героев: круглый портрет на ножке
function tokenTex(i, dead) {
  return bake(200, 248, (c) => {
    const col = dead ? "#5b5b63" : colorOf(i), me = i === film.me;
    c.fillStyle = col; c.beginPath(); c.moveTo(100, 246); c.lineTo(72, 178); c.lineTo(128, 178); c.closePath(); c.fill();
    c.beginPath(); c.arc(100, 100, 96, 0, 7); c.fill();
    c.save(); c.beginPath(); c.arc(100, 100, me ? 82 : 85, 0, 7); c.clip();
    c.fillStyle = "#18181c"; c.fillRect(0, 0, 200, 200);
    const im = portraits[i];
    if (im) { if (dead) c.filter = "grayscale(1) brightness(0.55)"; c.imageSmoothingQuality = "high"; const h = 176, w = (im.width / im.height) * h; c.drawImage(im, 100 - w / 2, 12, w, h); c.filter = "none"; }
    c.restore();
    if (dead) { c.strokeStyle = C.red; c.lineWidth = 16; c.lineCap = "round"; c.beginPath(); c.moveTo(58, 58); c.lineTo(142, 142); c.moveTo(142, 58); c.lineTo(58, 142); c.stroke(); }
  });
}
const tokens = film.players.map((p, i) => ({ live: tokenTex(i, false), dead: tokenTex(i, true) }));

// ---------- время и сегменты ----------
const segAt = (t) => film.segs.find((s) => t < s.t1) || film.segs[film.segs.length - 1];
function warpAt(warp, s) {
  if (s <= warp[0][0]) return warp[0][1];
  for (let i = 1; i < warp.length; i++) if (s <= warp[i][0]) { const [s0, a] = warp[i - 1], [s1, b] = warp[i]; return s1 === s0 ? b : a + ((s - s0) / (s1 - s0)) * (b - a); }
  return warp[warp.length - 1][1];
}
// место героя в игровую секунду g: сглаженное (Catmull-Rom), телепорты — скачком
function posAt(seg, slot, g) {
  const row = seg.track.pos[slot], x = clamp(g - seg.track.t0, 0, row.length - 1), i = Math.floor(x), k = x - i;
  const p1 = row[i], p2 = row[Math.min(row.length - 1, i + 1)];
  if (!p1) { for (let j = i - 1; j >= 0; j--) if (row[j]) return { x: row[j][0], y: row[j][1], alive: false, since: g - (seg.track.t0 + j) }; return null; }
  if (!p2) return { x: p1[0], y: p1[1], alive: true };
  if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 9) return k < 0.5 ? { x: p1[0], y: p1[1], alive: true } : { x: p2[0], y: p2[1], alive: true, jump: true };
  const ok = (a, b) => a && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 9;
  const p0 = ok(row[i - 1], p1) ? row[i - 1] : p1, p3 = ok(row[i + 2], p2) ? row[i + 2] : p2;
  const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (3 * b - a - 3 * c + d) * k * k * k);
  return { x: cr(p0[0], p1[0], p2[0], p3[0]), y: cr(p0[1], p1[1], p2[1], p3[1]), alive: true };
}

// ---------- камера ----------
function segCam(seg, s) {
  const dur = seg.t1 - seg.t0, u = clamp(s / dur);
  if (seg.kind === "intro") return { c: [64, 66], r: lerp(76, 66, outCubic(u)), yaw: lerp(-0.5, -0.12, smooth(u)), pitch: lerp(0.62, 0.86, outCubic(u)) };
  if (seg.kind === "outro") return { c: [64, 64], r: lerp(64, 72, u), yaw: lerp(0.1, 0.42, u), pitch: 0.92 };
  const keys = seg.cam, e = smooth(u);
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 1; i < keys.length; i++) if (e <= keys[i].u) { a = keys[i - 1]; b = keys[i]; break; }
  const k = smooth(prog(e, a.u, b.u));
  const dir = seg.index % 2 ? -1 : 1;
  return { c: [lerp(a.c[0], b.c[0], k), lerp(a.c[1], b.c[1], k)], r: lerp(a.r, b.r, k), yaw: dir * lerp(0.26, -0.2, u), pitch: lerp(0.98, 0.8, smooth(u)) };
}
const FLY = 1.15; // перелёт камеры между сегментами, секунд
function camAt(t) {
  const i = film.segs.indexOf(segAt(t)), seg = film.segs[i], s = t - seg.t0;
  const own = segCam(seg, s);
  if (i === 0 || s >= FLY) return own;
  const prev = film.segs[i - 1], from = segCam(prev, prev.t1 - prev.t0), k = smooth(smooth(s / FLY));
  // в середине перелёта камера приподнимается: видно, куда летим
  const lift = Math.sin(Math.PI * k) * Math.min(26, Math.hypot(own.c[0] - from.c[0], own.c[1] - from.c[1]) * 0.35);
  return { c: [lerp(from.c[0], own.c[0], k), lerp(from.c[1], own.c[1], k)], r: lerp(from.r, own.r, k) + lift, yaw: lerp(from.yaw, own.yaw, k), pitch: lerp(from.pitch, own.pitch, k) };
}
// камера: смотрит на точку c (клетки карты) с расстояния, при котором по ширине кадра видно 2r клеток
let CAM = null;
function applyCam(cs) {
  const d = (cs.r * 2 * 1.04 * FOCAL) / W;
  const sy = Math.sin(cs.yaw), cy = Math.cos(cs.yaw), sp = Math.sin(cs.pitch), cp = Math.cos(cs.pitch);
  CAM = { d, r: cs.r, c: cs.c,
    pos: [cs.c[0] + sy * cp * d, sp * d, cs.c[1] + cy * cp * d],
    f: [-sy * cp, -sp, -cy * cp], right: [cy, 0, -sy], up: [-sy * sp, cp, -cy * sp] };
  return d;
}
// точка карты (и высота над землёй) → пиксели экрана и глубина
function project(mx, my, up = 0) {
  const v = [mx - CAM.pos[0], up - CAM.pos[1], my - CAM.pos[2]];
  const z = v[0] * CAM.f[0] + v[1] * CAM.f[1] + v[2] * CAM.f[2];
  const x = v[0] * CAM.right[0] + v[2] * CAM.right[2], y = v[0] * CAM.up[0] + v[1] * CAM.up[1] + v[2] * CAM.up[2];
  return [W / 2 + (FOCAL * x) / z, CY - (FOCAL * y) / z, z];
}
// строка экрана → точка земли под центром строки и шаг по земле на пиксель вправо
function groundRow(sy) {
  const b = (CY - sy) / FOCAL;
  const dy = CAM.f[1] + CAM.up[1] * b;
  if (dy > -1e-3) return null; // выше горизонта
  const t = -CAM.pos[1] / dy;
  return { x: CAM.pos[0] + t * (CAM.f[0] + CAM.up[0] * b), y: CAM.pos[2] + t * (CAM.f[2] + CAM.up[2] * b), dx: (t * CAM.right[0]) / FOCAL, dy: (t * CAM.right[2]) / FOCAL };
}
// кладёт холст земли на экран в перспективе
function blitGround() {
  hud.setTransform(1, 0, 0, 1, 0, 0);
  hud.fillStyle = C.ink; hud.fillRect(0, 0, W, H);
  const k = TS / region.size;
  hud.imageSmoothingEnabled = true; hud.imageSmoothingQuality = "low";
  let prev = groundRow(0);
  for (let sy = 0; sy < H; sy++) {
    const next = groundRow(sy + 1);
    const row = prev; prev = next;
    if (!row || !next) continue;
    // текстурные координаты: A — под центром строки, B — на пиксель вправо, Cc — на строку вниз
    const Ax = (row.x - region.x) * k - (W / 2) * row.dx * k, Ay = (row.y - region.y) * k - (W / 2) * row.dy * k;
    const Bx = row.dx * k, By = row.dy * k, Cx = (next.x - row.x) * k, Cy2 = (next.y - row.y) * k;
    const det = Bx * Cy2 - Cx * By;
    if (Math.abs(det) < 1e-9) continue;
    hud.save(); hud.beginPath(); hud.rect(0, sy, W, 1); hud.clip();
    hud.setTransform(Cy2 / det, -By / det, -Cx / det, Bx / det, -(Cy2 * Ax - Cx * Ay) / det, sy - (-By * Ax + Bx * Ay) / det);
    hud.drawImage(ground, 0, 0);
    hud.restore();
  }
  hud.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- слой на земле ----------
// какой кусок карты сейчас лежит на холсте земли: квадрат вокруг точки внимания, едет вместе с камерой
let region = { x: 0, y: 0, size: 128 };
function beginGround(cs, spotK) {
  const size = cs.r * 5.4;
  // центр сдвинут вперёд по взгляду: вдаль камера видит больше, чем к себе
  region = { x: cs.c[0] - Math.sin(cs.yaw) * cs.r * 0.1 - size / 2, y: cs.c[1] - Math.cos(cs.yaw) * cs.r * 0.1 - size / 2, size };
  const k = TS / size;
  dec.setTransform(1, 0, 0, 1, 0, 0);
  dec.globalAlpha = 1; dec.fillStyle = "#0b0b0e"; dec.fillRect(0, 0, TS, TS);
  dec.setTransform(k, 0, 0, k, -region.x * k, -region.y * k);
  dec.lineCap = "round"; dec.lineJoin = "round";
  // стол вокруг карты: сетка
  dec.strokeStyle = "rgba(255,255,255,0.05)"; dec.lineWidth = Math.max(0.12, size / 900);
  const step = 16, x0 = Math.floor(region.x / step) * step, y0 = Math.floor(region.y / step) * step;
  dec.beginPath();
  for (let x = x0; x <= region.x + size; x += step) { dec.moveTo(x, region.y); dec.lineTo(x, region.y + size); }
  for (let y = y0; y <= region.y + size; y += step) { dec.moveTo(region.x, y); dec.lineTo(region.x + size, y); }
  dec.stroke();
  dec.imageSmoothingQuality = "high";
  dec.drawImage(mapBaked, 0, 0, 128, 128);
  dec.strokeStyle = rgba(C.gold, 0.55); dec.lineWidth = Math.max(0.3, size / 420); dec.strokeRect(0, 0, 128, 128);
  // прожектор: вне места действия карта темнеет
  if (spotK > 0.01) {
    const g = dec.createRadialGradient(cs.c[0], cs.c[1], cs.r * 0.55, cs.c[0], cs.c[1], cs.r * 1.9);
    g.addColorStop(0, "rgba(5,5,7,0)"); g.addColorStop(0.5, `rgba(5,5,7,${0.42 * spotK})`); g.addColorStop(1, `rgba(5,5,7,${0.8 * spotK})`);
    dec.fillStyle = g; dec.fillRect(region.x, region.y, size, size);
  }
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function ring(x, y, r, color, width, alpha = 1) {
  dec.globalAlpha = alpha; dec.strokeStyle = color; dec.lineWidth = width;
  dec.beginPath(); dec.arc(x, y, r, 0, 7); dec.stroke(); dec.globalAlpha = 1;
}
function buildingList(seg, g) {
  const dead = new Map(), seen = {}, out = [];
  for (const b of seg ? seg.buildings : []) { seen[b.n] = (seen[b.n] || 0) + 1; dead.set(`${b.n}#${seen[b.n]}`, b.t); }
  for (const side of ["goodguys", "badguys"]) {
    const col = TEAM[rel(side === "goodguys" ? 0 : 1)];
    for (const [name, at] of Object.entries(BUILDINGS[side])) {
      const list = Array.isArray(at[0]) ? at : [at];
      list.forEach((p, j) => {
        const t = dead.get(`${side}_${name}#${j + 1}`);
        const gone = t !== undefined && t <= g;
        out.push({ p, name, col, gone, flash: gone ? clamp(1 - (g - t) / 2.5) : 0 });
      });
    }
  }
  return out;
}
function drawBuildings(seg, g) {
  for (const { p, name, col, gone, flash } of buildingList(seg, g)) {
    const size = name === "fort" ? 2.3 : /rax/.test(name) ? 1.1 : 1.45;
    dec.save(); dec.translate(p[0], p[1]); if (!/rax/.test(name)) dec.rotate(Math.PI / 4);
    dec.globalAlpha = gone ? 0.28 + flash * 0.7 : 0.95;
    dec.fillStyle = gone ? (flash > 0 ? "#ffffff" : "#3a3a41") : col; dec.strokeStyle = "rgba(9,9,11,0.9)"; dec.lineWidth = 0.35;
    dec.fillRect(-size / 2, -size / 2, size, size); dec.strokeRect(-size / 2, -size / 2, size, size);
    dec.restore();
    if (flash > 0) ring(p[0], p[1], 1.5 + (1 - flash) * 6, "#ffffff", 0.4, flash);
  }
  dec.globalAlpha = 1;
}
// здания стоят: светящийся столбик над ромбом на земле
function drawPillars(seg, g) {
  const unit = FOCAL / CAM.d;
  hud.globalCompositeOperation = "lighter";
  for (const { p, name, col, gone } of buildingList(seg, g)) {
    if (gone || /rax/.test(name)) continue;
    const h = name === "fort" ? 6.5 : 4.2, [x, y, z] = project(p[0], p[1]);
    if (z <= 1 || x < -40 || x > W + 40 || y < 0 || y > H + 200) continue;
    const top = project(p[0], p[1], h)[1], half = unit * (name === "fort" ? 1.0 : 0.6) * (CAM.d / z);
    const gy = hud.createLinearGradient(0, y, 0, top); gy.addColorStop(0, rgba(col, 0.75)); gy.addColorStop(1, rgba(col, 0.04));
    hud.fillStyle = gy; hud.fillRect(x - half, top, half * 2, y - top);
    hud.fillStyle = rgba(col, 0.55); hud.fillRect(x - half * 0.3, top, half * 0.6, y - top);
  }
  hud.globalCompositeOperation = "source-over";
}
// искры от убийства: разлетаются и падают, всё по номеру частицы, без случайности
function drawSparks(seg, s) {
  hud.globalCompositeOperation = "lighter";
  for (let ki = 0; ki < seg.kills.length; ki++) {
    const kill = seg.kills[ki], u = s - kill.s;
    if (u < 0 || u > 1.0) continue;
    const col = rel(film.players[kill.v].team) === 0 ? C.red : C.green, mine = kill.v === film.me || kill.k === film.me;
    const n = mine ? 26 : 16;
    for (let j = 0; j < n; j++) {
      const a = hash(ki * 97 + j) * 6.283, sp = 5 + hash(ki * 31 + j * 7 + 1) * 9, up0 = 9 + hash(ki * 13 + j * 3 + 2) * 12;
      const life = 0.55 + hash(j * 5 + ki) * 0.45;
      if (u > life) continue;
      const at = (uu) => project(kill.x + Math.cos(a) * sp * uu, kill.y + Math.sin(a) * sp * uu, Math.max(0, 1.2 + up0 * uu - 26 * uu * uu));
      const p1 = at(u), p0 = at(Math.max(0, u - 0.045)), k = 1 - u / life;
      hud.globalAlpha = k; hud.strokeStyle = j % 3 ? col : "#ffffff"; hud.lineWidth = 2 + 4 * k; hud.lineCap = "round";
      hud.beginPath(); hud.moveTo(p0[0], p0[1]); hud.lineTo(p1[0], p1[1]); hud.stroke();
    }
  }
  hud.globalAlpha = 1; hud.globalCompositeOperation = "source-over";
}
function drawGround(seg, s, g) {
  drawBuildings(seg, g);
  const tipT = seg.lines[seg.lines.length - 1].t0;
  // обзор своих обсов: золотой круг. Видно, что место смерти в него не попадает
  for (const w of seg.wards) {
    if (w.t > g || w.t1 < g || rel(w.team) !== 0) continue;
    dec.fillStyle = rgba(C.gold, 0.05); dec.beginPath(); dec.arc(w.x, w.y, 12.5, 0, 7); dec.fill();
    ring(w.x, w.y, 12.5, C.gold, 0.18, 0.4);
    dec.fillStyle = C.gold; dec.beginPath(); dec.arc(w.x, w.y, 0.7, 0, 7); dec.fill();
  }
  const M = seg.marks;
  if (M.enemy_obs) {
    const k = outCubic(prog(s, tipT - 2.2, tipT - 1.4));
    if (k > 0) {
      dec.fillStyle = rgba(C.red, 0.1 * k); dec.beginPath(); dec.arc(M.enemy_obs[0], M.enemy_obs[1], 12.5 * k, 0, 7); dec.fill();
      ring(M.enemy_obs[0], M.enemy_obs[1], 12.5 * k, C.red, 0.3, 0.8);
      ring(M.enemy_obs[0], M.enemy_obs[1], 1.2 + (s * 1.4 % 1) * 3, C.red, 0.3, 1 - (s * 1.4 % 1));
      dec.fillStyle = C.red; dec.beginPath(); dec.arc(M.enemy_obs[0], M.enemy_obs[1], 0.9, 0, 7); dec.fill();
    }
  }
  if (M.pit) {
    const pulse = (s * 0.9) % 1;
    ring(M.pit[0], M.pit[1], 4.2, C.gold, 0.4, 0.9);
    ring(M.pit[0], M.pit[1], 4.2 + pulse * 5, C.gold, 0.3, 1 - pulse);
  }
  // хвосты: откуда пришёл каждый
  for (let slot = 0; slot < 10; slot++) {
    const actor = seg.actors.includes(slot);
    const col = colorOf(slot), back = actor ? 7 : 3.5, steps = 28;
    let prev = null;
    for (let j = 0; j <= steps; j++) {
      const gg = g - back + (back * j) / steps;
      const p = posAt(seg, slot, gg);
      if (!p || !p.alive || p.jump) { prev = null; continue; }
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 6) {
        dec.globalAlpha = (j / steps) ** 1.6 * (actor ? 0.85 : 0.3);
        dec.strokeStyle = col; dec.lineWidth = (actor ? 0.62 : 0.4) * (0.35 + 0.65 * (j / steps));
        dec.beginPath(); dec.moveTo(prev.x, prev.y); dec.lineTo(p.x, p.y); dec.stroke();
      }
      prev = p;
    }
  }
  dec.globalAlpha = 1;
  // удары: линия от того, кто бьёт, к тому, кого бьют
  for (const d of seg.dmg) {
    const age = g - d[0];
    if (age < 0 || age > 0.9) continue;
    const a = posAt(seg, d[1], g), b = posAt(seg, d[2], g);
    if (!a || !b || !a.alive) continue;
    const k = 1 - age / 0.9, col = colorOf(d[1]);
    dec.globalAlpha = k * 0.85; dec.strokeStyle = col; dec.lineWidth = clamp(0.16 + Math.log10(1 + d[3]) * 0.12, 0.2, 0.62);
    dec.beginPath(); dec.moveTo(a.x, a.y); dec.lineTo(b.x, b.y); dec.stroke();
    dec.fillStyle = "#ffffff"; dec.globalAlpha = k * 0.9; dec.beginPath(); dec.arc(lerp(a.x, b.x, 1 - k * 0.5), lerp(a.y, b.y, 1 - k * 0.5), 0.34, 0, 7); dec.fill();
  }
  dec.globalAlpha = 1;
  // кольца под героями
  for (let slot = 0; slot < 10; slot++) {
    const p = posAt(seg, slot, g);
    if (!p) continue;
    const actor = seg.actors.includes(slot), me = slot === film.me, col = colorOf(slot);
    if (!p.alive) { dec.strokeStyle = rgba(C.red, 0.85); dec.lineWidth = 0.42; dec.beginPath(); dec.moveTo(p.x - 1.2, p.y - 1.2); dec.lineTo(p.x + 1.2, p.y + 1.2); dec.moveTo(p.x + 1.2, p.y - 1.2); dec.lineTo(p.x - 1.2, p.y + 1.2); dec.stroke(); continue; }
    dec.fillStyle = "rgba(0,0,0,0.38)"; dec.beginPath(); dec.arc(p.x, p.y, me ? 2.9 : actor ? 2.4 : 1.6, 0, 7); dec.fill();
    dec.fillStyle = rgba(col, actor ? 0.22 : 0.1); dec.beginPath(); dec.arc(p.x, p.y, me ? 2.1 : 1.7, 0, 7); dec.fill();
    ring(p.x, p.y, me ? 2.1 : 1.7, col, me ? 0.5 : 0.32, actor ? 1 : 0.45);
    if (me) { const pulse = (s * 1.1) % 1; ring(p.x, p.y, 2.1 + pulse * 3.2, C.gold, 0.26, (1 - pulse) * 0.8); }
    if (M.attackers && M.attackers.includes(slot)) { const k = prog(s, tipT - 0.2, tipT + 0.4); if (k > 0) ring(p.x, p.y, 2.6 + (1 - outCubic(k)) * 4, C.red, 0.4, k); }
  }
  // убийства: ударная волна
  for (const kill of seg.kills) {
    const u = s - kill.s;
    if (u < 0) continue;
    const col = rel(film.players[kill.v].team) === 0 ? C.red : C.green;
    if (u < 1.1) { const k = outExpo(u / 1.1); ring(kill.x, kill.y, 1 + k * 9, col, 0.7 * (1 - k) + 0.1, 1 - k); ring(kill.x, kill.y, 0.5 + k * 5, "#ffffff", 0.35 * (1 - k), 1 - k); ring(kill.x, kill.y, 2 + k * 16, col, 0.2, (1 - k) * 0.6); }
    const sc = dec.createRadialGradient(kill.x, kill.y, 0, kill.x, kill.y, 4.2);
    sc.addColorStop(0, rgba(col, 0.34 * clamp(u * 4))); sc.addColorStop(1, rgba(col, 0));
    dec.fillStyle = sc; dec.beginPath(); dec.arc(kill.x, kill.y, 4.2, 0, 7); dec.fill();
  }
  // «до своих далеко»: пунктир до ближайшего союзника
  if (M.ally) {
    const k = outCubic(prog(s, tipT - 1.6, tipT - 0.9));
    const a = seg.kills.find((x) => x.v === film.me), b = posAt(seg, M.ally.slot, seg.key - 3);
    if (k > 0 && a && b) {
      dec.strokeStyle = C.text; dec.globalAlpha = 0.9; dec.lineWidth = 0.3; dec.setLineDash([1.1, 1.1]); dec.lineDashOffset = -s * 2;
      dec.beginPath(); dec.moveTo(a.x, a.y); dec.lineTo(lerp(a.x, b.x, k), lerp(a.y, b.y, k)); dec.stroke(); dec.setLineDash([]); dec.globalAlpha = 1;
    }
  }
}
function drawOverview(t, upTo, alpha) {
  drawBuildings(null, 0);
  // все убийства катки: красные — свои смерти, зелёные — вражеские, мои — с золотым кольцом
  for (let i = 0; i < film.all_kills.length; i++) {
    const [at, x, y, team, mine] = film.all_kills[i];
    if (at > upTo) continue;
    const born = (upTo - at) * 14, k = clamp(born), col = rel(team) === 0 ? C.red : C.green;
    dec.globalAlpha = alpha * (0.55 + 0.45 * k);
    dec.fillStyle = col; dec.beginPath(); dec.arc(x, y, Math.max(0, (mine ? 1.5 : 1.05) * outBack(k)), 0, 7); dec.fill();
    if (mine) ring(x, y, 2.5, C.gold, 0.4, alpha);
    if (born < 1.6) ring(x, y, 1 + born * 5, col, 0.3, alpha * clamp(1 - born / 1.6));
  }
  dec.globalAlpha = 1;
}

// ---------- плоский слой: текст ----------
function text(str, x, y, font, color, align = "left", alpha = 1) {
  hud.font = font; hud.fillStyle = color; hud.textAlign = align; hud.globalAlpha = alpha; hud.fillText(str, x, y); hud.globalAlpha = 1;
}
function rrect(x, y, w, h, r) { hud.beginPath(); hud.roundRect(x, y, w, h, r); }
function wrap(str, font, maxW) {
  hud.font = font;
  const lines = []; let cur = [];
  for (const word of str.split(" ")) {
    if (cur.length && hud.measureText([...cur, word].join(" ")).width > maxW) { lines.push(cur); cur = []; }
    cur.push(word);
  }
  if (cur.length) lines.push(cur);
  // короткий хвост из одного слова некрасив: забираем слово с предыдущей строки
  const last = lines[lines.length - 1];
  if (lines.length > 1 && last.length === 1 && lines[lines.length - 2].length > 2) last.unshift(lines[lines.length - 2].pop());
  return lines;
}
// субтитры: строка диктора, слова загораются по мере чтения
function captions(seg, s) {
  const line = seg.lines.find((l) => s >= l.t0 - 0.12 && s < l.t1 + 0.22);
  if (!line) return;
  const tip = line.role === "tip";
  const font = F(tip ? 58 : 56, "Display"), lh = 72;
  const rows = wrap(line.text, font, 880);
  const words = rows.flat(), total = words.reduce((a, w) => a + w.length + 1, 0);
  const inK = outCubic(prog(s, line.t0 - 0.12, line.t0 + 0.14)), outK = prog(s, line.t1 + 0.06, line.t1 + 0.22);
  const alpha = inK * (1 - outK);
  const h = rows.length * lh + 44 + (tip ? 58 : 0), y0 = 1500 - h / 2 + (1 - inK) * 26;
  hud.globalAlpha = alpha * 0.88; hud.fillStyle = "#0b0b0e"; rrect(70, y0, 940, h, 30); hud.fill();
  hud.globalAlpha = alpha; hud.strokeStyle = tip ? C.gold : "rgba(255,255,255,0.1)"; hud.lineWidth = tip ? 4 : 2; rrect(70, y0, 940, h, 30); hud.stroke();
  let ty = y0 + 22;
  if (tip) {
    hud.font = F(30, "Display"); const lw = hud.measureText("ЧТО ДЕЛАТЬ").width + 44;
    hud.fillStyle = C.gold; rrect(W / 2 - lw / 2, y0 - 26, lw, 52, 26); hud.fill();
    text("ЧТО ДЕЛАТЬ", W / 2, y0 + 11, F(30, "Display"), C.ink, "center", alpha);
    ty += 40;
  }
  let seen = 0;
  hud.font = font; hud.textBaseline = "alphabetic";
  rows.forEach((row, ri) => {
    const widths = row.map((w) => hud.measureText(w).width), space = hud.measureText(" ").width;
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + space * (row.length - 1)) / 2;
    row.forEach((w, wi) => {
      const at = line.t0 + ((line.t1 - line.t0) * seen) / total;
      seen += w.length + 1;
      const k = outBack(prog(s, at - 0.05, at + 0.16), 2.2), lit = s >= at - 0.05;
      hud.save(); hud.translate(x + widths[wi] / 2, ty + (ri + 1) * lh - 18); hud.scale(lerp(0.9, 1, k), lerp(0.9, 1, k));
      hud.textAlign = "center"; hud.globalAlpha = alpha * (lit ? 1 : 0.42);
      hud.fillStyle = lit ? (tip ? C.gold : C.text) : C.muted; hud.fillText(w, 0, 0);
      hud.restore();
      x += widths[wi] + space;
    });
  });
  hud.globalAlpha = 1;
}
function chip(label, cx, y, color, k) {
  if (k <= 0) return 0;
  hud.font = F(36, "Display");
  const w = hud.measureText(label).width + 52, sc = outBack(clamp(k), 2);
  hud.save(); hud.translate(cx, y); hud.scale(sc, sc); hud.globalAlpha = clamp(k * 2);
  hud.fillStyle = "#0b0b0e"; rrect(-w / 2, -32, w, 64, 32); hud.fill();
  hud.strokeStyle = color; hud.lineWidth = 3; rrect(-w / 2, -32, w, 64, 32); hud.stroke();
  hud.fillStyle = color; hud.textAlign = "center"; hud.fillText(label, 0, 13);
  hud.restore(); hud.globalAlpha = 1;
  return w;
}
function portrait(i, cx, cy, r, ringColor, ringW = 6) {
  hud.save(); hud.beginPath(); hud.arc(cx, cy, r, 0, 7); hud.clip();
  hud.fillStyle = "#18181c"; hud.fillRect(cx - r, cy - r, r * 2, r * 2);
  const im = portraits[i];
  if (im) { const h = r * 2, w = (im.width / im.height) * h; hud.imageSmoothingQuality = "high"; hud.drawImage(im, cx - w / 2, cy - r, w, h); }
  hud.restore();
  hud.strokeStyle = ringColor; hud.lineWidth = ringW; hud.beginPath(); hud.arc(cx, cy, r, 0, 7); hud.stroke();
}
function vignette() {
  const g = hud.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(9,9,11,0.82)"); g.addColorStop(0.17, "rgba(9,9,11,0)"); g.addColorStop(0.62, "rgba(9,9,11,0)"); g.addColorStop(0.86, "rgba(9,9,11,0.78)"); g.addColorStop(1, "rgba(9,9,11,0.95)");
  hud.fillStyle = g; hud.fillRect(0, 0, W, H);
}
function topBar(t, seg, s) {
  // полоса прогресса ролика и шапка
  hud.fillStyle = "rgba(255,255,255,0.12)"; hud.fillRect(0, 0, W, 8);
  hud.fillStyle = C.gold; hud.fillRect(0, 0, W * clamp(t / film.duration), 8);
  if (emblem) hud.drawImage(emblem, 48, 58, 76, 76);
  text("ДОТА РАЗБОР", 140, 96, F(34, "Display"), C.text);
  text("видеоразбор катки", 140, 130, F(26, "UI"), C.muted);
  // график золота за катку с метками моментов: видно, где мы сейчас и что было с перевесом
  if (seg.kind !== "intro") goldChart(W - 400, 60, 352, 78, 1, seg.kind === "moment" ? seg.index : film.moments, s, false);
}
const ADV_MAX = Math.max(3, ...film.adv.map((a) => Math.abs(a[1])));
// перевес по золоту: зелёное над нулём — впереди мы, красное под нулём — враг. upTo — доля нарисованного
function goldChart(x, y, w, h, upTo, cur, s, big) {
  const mid = y + h / 2, px = (f) => x + f * w, py = (v) => mid - (v / ADV_MAX) * (h / 2);
  hud.save();
  if (!big) { hud.globalAlpha = 0.72; hud.fillStyle = "#0b0b0e"; rrect(x - 14, y - 10, w + 28, h + 20, 16); hud.fill(); hud.globalAlpha = 1; }
  hud.beginPath(); hud.rect(x, y - 4, w * upTo, h + 8); hud.clip();
  for (const sign of [1, -1]) {
    hud.beginPath(); hud.moveTo(px(0), mid);
    for (const [f, v] of film.adv) hud.lineTo(px(f), py(sign > 0 ? Math.max(0, v) : Math.min(0, v)));
    hud.lineTo(px(1), mid); hud.closePath();
    const col = sign > 0 ? C.green : C.red;
    const gr = hud.createLinearGradient(0, mid, 0, mid - sign * h / 2); gr.addColorStop(0, rgba(col, 0.12)); gr.addColorStop(1, rgba(col, 0.75));
    hud.fillStyle = gr; hud.fill();
  }
  hud.strokeStyle = C.text; hud.lineWidth = big ? 4 : 2; hud.lineJoin = "round"; hud.beginPath();
  film.adv.forEach(([f, v], i) => (i ? hud.lineTo(px(f), py(v)) : hud.moveTo(px(f), py(v))));
  hud.stroke();
  hud.restore();
  hud.fillStyle = "rgba(255,255,255,0.25)"; hud.fillRect(x, mid - 1, w, 2);
  const advAt = (f) => { let v = film.adv[0][1]; for (const a of film.adv) { if (a[0] > f) break; v = a[1]; } return v; };
  film.pins.forEach(([f, good], i) => {
    if (f > upTo) return;
    const here = i === cur, done = i < cur, col = good ? C.gold : C.red, r = (big ? 13 : 7) * (here ? 1.35 + Math.sin(s * 6) * 0.15 : 1);
    const cx = px(f), cy = py(advAt(f));
    hud.globalAlpha = here || big ? 1 : done ? 0.55 : 0.9;
    hud.fillStyle = "#0b0b0e"; hud.beginPath(); hud.arc(cx, cy, r + (big ? 5 : 3), 0, 7); hud.fill();
    hud.fillStyle = here || big || !done ? col : C.muted; hud.beginPath(); hud.arc(cx, cy, r, 0, 7); hud.fill();
    if (big) text(String(i + 1), cx, cy + 8, F(22), C.ink, "center");
    if (here && !big) { hud.strokeStyle = col; hud.lineWidth = 2; hud.beginPath(); hud.moveTo(cx, y - 4); hud.lineTo(cx, y + h + 4); hud.stroke(); }
  });
  hud.globalAlpha = 1;
}

// ---------- сегменты: плоский слой ----------
function hudIntro(seg, s) {
  const dur = seg.t1 - seg.t0, out = inCubic(prog(s, dur - 0.32, dur));
  hud.save(); hud.globalAlpha = 1 - out; hud.translate(0, -out * 60);
  // крючок: вопрос, на который отвечает ролик, с первого кадра
  const hook = seg.won ? "ЧТО МОЖНО БЫЛО ЛУЧШЕ?" : "ПОЧЕМУ СЛИТА КАТКА?";
  let hs = 92; hud.font = F(hs); while (hud.measureText(hook).width > 960 && hs > 50) { hs -= 4; hud.font = F(hs); }
  const hk = outExpo(prog(s, 0, 0.32));
  hud.save(); hud.translate(W / 2 + (s < 0.5 ? Math.sin(s * 70) * 7 * (1 - s / 0.5) : 0), 318); hud.scale(lerp(2.3, 1, hk), lerp(2.3, 1, hk));
  hud.fillStyle = seg.won ? C.gold : C.red; hud.globalAlpha = clamp(hk * 1.5); const hw = hud.measureText(hook).width;
  rrect(-hw / 2 - 30, -hs * 0.92, hw + 60, hs * 1.28, 18); hud.fill();
  text(hook, 0, 0, F(hs), C.ink, "center", clamp(hk * 1.5));
  hud.restore();
  const me = film.me, k0 = spring(s - 0.1);
  hud.save(); hud.translate(W / 2, 580); hud.scale(k0, k0);
  hud.shadowColor = rgba(C.gold, 0.55); hud.shadowBlur = 70;
  portrait(me, 0, 0, 150, C.gold, 10); hud.shadowBlur = 0;
  hud.restore();
  const name = seg.hero.toUpperCase();
  let size = 132; hud.font = F(size); while (hud.measureText(name).width > 960 && size > 60) { size -= 6; hud.font = F(size); }
  const k1 = outExpo(prog(s, 0.28, 0.85));
  text(name, W / 2, 862 + (1 - k1) * 50, F(size), C.text, "center", k1);
  const k2 = outExpo(prog(s, 0.5, 1.05));
  const parts = seg.kda.split("/"), cols = [C.green, C.red, C.text];
  hud.font = F(92); const wSlash = hud.measureText(" / ").width, ws = parts.map((p) => hud.measureText(p).width);
  let x = W / 2 - (ws.reduce((a, b) => a + b, 0) + wSlash * 2) / 2;
  parts.forEach((p, i) => { text(p, x, 976 + (1 - k2) * 40, F(92), cols[i], "left", k2); x += ws[i]; if (i < 2) { text(" / ", x, 976 + (1 - k2) * 40, F(92), C.muted, "left", k2 * 0.7); x += wSlash; } });
  const k3 = prog(s, 0.8, 1.15);
  chip(seg.won ? "ПОБЕДА" : "ПОРАЖЕНИЕ", W / 2 - 150, 1072, seg.won ? C.green : C.red, k3);
  chip(`${film.match.minutes} МИН`, W / 2 + 170, 1070, C.muted, prog(s, 0.92, 1.27));
  // «5 моментов»: счётчик
  const k4 = prog(s, dur * 0.52, dur * 0.52 + 0.5);
  if (k4 > 0) {
    const n = Math.max(1, Math.round(seg.n * outCubic(k4)));
    const word = seg.n === 1 ? "МОМЕНТ" : seg.n < 5 ? "МОМЕНТА" : "МОМЕНТОВ";
    hud.save(); hud.translate(W / 2, 1168); const sc = outBack(k4, 2.4); hud.scale(sc, sc);
    text(`${n} ${word}`, 0, 0, F(40), C.gold, "center", clamp(k4 * 2));
    hud.restore();
  }
  // график золота рисуется слева направо, метки моментов встают по ходу
  const gk = prog(s, 1.0, Math.max(2.2, dur * 0.52 + 0.4));
  if (gk > 0) {
    hud.globalAlpha = clamp(gk * 4) * 0.86; hud.fillStyle = "#0b0b0e"; rrect(60, 1120, 960, 250, 28); hud.fill(); hud.globalAlpha = 1;
    text("ЗОЛОТО", 96, 1168, F(26), C.muted, "left", clamp(gk * 4));
    const last = film.adv[film.adv.length - 1][1], lab = `${last > 0 ? "+" : "−"}${Math.abs(Math.round(last))}к в конце`;
    text(lab, W - 96, 1168, F(26), last >= 0 ? C.green : C.red, "right", prog(gk, 0.85, 1));
    goldChart(100, 1196, 880, 150, smooth(gk), -1, s, true);
  }
  hud.restore();
}
function hudMoment(seg, s, g) {
  const dur = seg.t1 - seg.t0, accent = seg.good ? C.gold : C.red;
  const tipT = seg.lines[seg.lines.length - 1].t0;
  // подписи над фишками: «ТЫ» всегда, имена живых участников — на стоп-кадре. Наложившиеся раздвигаем вверх
  const nameK = prog(s, tipT - 0.5, tipT - 0.1), labels = [];
  for (const slot of seg.actors) {
    const p = posAt(seg, slot, g);
    if (!p) continue;
    const me = slot === film.me;
    if (!me && (nameK <= 0 || !p.alive)) continue;
    const [x, y] = project(p.x, p.y);
    const label = me ? "ТЫ" : film.players[slot].ru, size = me ? 36 : 28;
    hud.font = F(size);
    const w = hud.measureText(label).width + 28, lift = (me ? 176 : 138) * (p.alive ? 1 : 0.7) + 6;
    labels.push({ label, size, me, x: clamp(x, w / 2 + 12, W - w / 2 - 12), y: y - lift, w, a: (me ? 1 : nameK) * (p.alive ? 1 : 0.75), color: me ? C.ink : colorOf(slot) });
  }
  labels.sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0) || b.y - a.y);
  const placed = [];
  for (const L of labels) {
    for (let guard = 0; guard < 8; guard++) {
      const hit = placed.find((q) => Math.abs(q.x - L.x) < (q.w + L.w) / 2 + 6 && Math.abs(q.y - L.y) < 48);
      if (!hit) break;
      L.y = hit.y - 50;
    }
    placed.push(L);
    hud.globalAlpha = L.a; hud.fillStyle = L.me ? C.gold : "rgba(11,11,14,0.9)"; rrect(L.x - L.w / 2, L.y - 44, L.w, 46, 23); hud.fill();
    text(L.label, L.x, L.y - 10, F(L.size), L.color, "center", L.a);
  }
  if (seg.marks.ally) {
    const k = prog(s, tipT - 1.0, tipT - 0.6), a = seg.kills.find((x) => x.v === film.me), b = posAt(seg, seg.marks.ally.slot, seg.key - 3);
    if (k > 0 && a && b) { const [x, y] = project((a.x + b.x) / 2, (a.y + b.y) / 2); chip(`до своих ${String(seg.marks.ally.d).replace(/\B(?=(\d{3})+$)/, " ")}`, x, y, C.text, k); }
  }
  if (seg.marks.enemy_obs) { const k = prog(s, tipT - 1.6, tipT - 1.2); if (k > 0) { const [x, y] = project(seg.marks.enemy_obs[0], seg.marks.enemy_obs[1]); chip("вражеский вард", x, y - 46, C.red, k); } }
  if (seg.marks.pit) { const [x, y] = project(seg.marks.pit[0], seg.marks.pit[1]); chip("Рошан", x, y - 60, C.gold, prog(s, 0.9, 1.3)); }
  // нажатые предметы: подпись всплывает над фишкой
  for (const c of seg.casts) {
    const u = s - c.s;
    if (u < 0 || u > 1.25) continue;
    const p = posAt(seg, c.slot, g);
    if (!p) continue;
    const [x, y] = project(p.x, p.y), k = outBack(prog(u, 0, 0.22), 2) * (1 - prog(u, 0.95, 1.25));
    const lift = (c.slot === film.me ? 176 : 138) + 64 + u * 34;
    hud.font = F(30); const w = hud.measureText(c.label).width + 30, cx = clamp(x, w / 2 + 10, W - w / 2 - 10);
    hud.globalAlpha = clamp(k) * 0.92; hud.fillStyle = colorOf(c.slot); rrect(cx - w / 2, y - lift - 34, w, 46, 12); hud.fill();
    text(c.label, cx, y - lift, F(30), C.ink, "center", clamp(k));
  }
  // урон по мне: цифры
  const mePos = posAt(seg, film.me, g);
  if (mePos) {
    const [x, y] = project(mePos.x, mePos.y);
    seg.hits.forEach(([hg, v], hi) => {
      const age = g - hg;
      if (age < 0 || age > 1.1) return;
      const k = age / 1.1, dx = (hash(hi * 3.7) - 0.5) * 150, size = clamp(34 + v / 14, 36, 78);
      hud.lineWidth = 8; hud.strokeStyle = "rgba(9,9,11,0.9)"; hud.font = F(size); hud.textAlign = "center"; hud.globalAlpha = 1 - k * k;
      hud.strokeText(`−${v}`, x + dx, y - 250 - outCubic(k) * 110); 
      text(`−${v}`, x + dx, y - 250 - outCubic(k) * 110, F(size), C.red, "center", 1 - k * k);
    });
    hud.globalAlpha = 1;
  }
  // лента убийств: кто кого
  let row = 0;
  for (const kill of seg.kills) {
    const u = s - kill.s;
    if (u < 0 || u > 2.6) continue;
    const k = outExpo(prog(u, 0, 0.3)) * (1 - prog(u, 2.2, 2.6)), y = 400 + row * 96, x = 56 - (1 - k) * 80;
    hud.globalAlpha = k * 0.9; hud.fillStyle = "#0b0b0e"; rrect(x, y - 40, kill.k >= 0 ? 236 : 150, 80, 40); hud.fill(); hud.globalAlpha = k;
    if (kill.k >= 0) { portrait(kill.k, x + 42, y, 30, colorOf(kill.k), 4); text("›", x + 104, y + 15, F(46), C.text, "center", k); portrait(kill.v, x + 166, y, 30, colorOf(kill.v), 4); hud.strokeStyle = C.red; hud.lineWidth = 5; hud.beginPath(); hud.moveTo(x + 148, y - 18); hud.lineTo(x + 184, y + 18); hud.stroke(); }
    else { portrait(kill.v, x + 42, y, 30, colorOf(kill.v), 4); text("✕", x + 104, y + 14, F(38), C.red, "center", k); }
    hud.globalAlpha = 1; row++;
  }
  // заголовок: влетает крупно, потом уходит в шапку
  const inK = spring(s - 0.08, 4.6, 7), shrink = smooth(prog(s, 1.35, 1.8)), outK = prog(s, dur - 0.25, dur);
  const num = String(seg.index + 1).padStart(2, "0"), title = seg.title.toUpperCase();
  let big = 104; hud.font = F(big); while (hud.measureText(title).width > 940 && big > 56) { big -= 4; hud.font = F(big); }
  const size = lerp(big, 46, shrink), cy = lerp(720, 236, shrink), a = clamp(inK * 1.6) * (1 - outK);
  if (shrink < 1) { hud.globalAlpha = (1 - shrink) * 0.55 * clamp(inK); hud.fillStyle = "#050507"; hud.fillRect(0, 480, W, 420); hud.globalAlpha = 1; }
  hud.save(); hud.translate(W / 2, cy); hud.scale(lerp(0.6, 1, clamp(inK)), lerp(0.6, 1, clamp(inK)));
  text(`МОМЕНТ ${num} · ${seg.clock}`, 0, -size * 0.92 - lerp(18, 4, shrink), F(lerp(44, 28, shrink)), accent, "center", a);
  hud.shadowColor = "rgba(0,0,0,0.7)"; hud.shadowBlur = 24;
  text(title, 0, 0, F(size), C.text, "center", a);
  hud.shadowBlur = 0;
  const lw = lerp(260, 120, shrink) * clamp(inK); hud.globalAlpha = a; hud.fillStyle = accent; hud.fillRect(-lw / 2, lerp(34, 18, shrink), lw, lerp(8, 5, shrink)); hud.globalAlpha = 1;
  hud.restore();
  // часы матча
  const ck = prog(s, 1.5, 1.9) * (1 - outK);
  if (ck > 0) {
    hud.globalAlpha = ck * 0.9; hud.fillStyle = "#0b0b0e"; rrect(W - 250, 290, 200, 76, 38); hud.fill(); hud.globalAlpha = 1;
    hud.fillStyle = accent; hud.beginPath(); hud.arc(W - 220, 328, 8, 0, 7); hud.fill();
    text(mmss(g), W - 72, 344, F(44), C.text, "right", ck);
    // как идёт время: замедление у убийств, стоп-кадр на совете
    const rate = (warpAt(seg.warp, s + 0.05) - warpAt(seg.warp, s - 0.05)) / 0.1;
    const lab = rate < 0.05 ? "СТОП-КАДР" : rate < 0.75 ? "ЗАМЕДЛЕНИЕ" : rate > 1.7 ? `×${Math.round(rate)}` : "";
    if (lab) text(lab, W - 150, 404, F(24), rate < 0.75 ? accent : C.muted, "center", ck * 0.95);
  }
  // плашки последствий: появляются перед советом
  const base = Math.max(1.8, tipT - 2.4);
  let cx = 0; hud.font = F(36);
  const ws = seg.chips.map((c) => hud.measureText(c.label).width + 52), totalW = ws.reduce((a2, b) => a2 + b, 0) + 16 * (ws.length - 1);
  const rows = totalW > 960 ? 2 : 1, perRow = Math.ceil(seg.chips.length / rows);
  for (let r = 0; r < rows; r++) {
    const items = seg.chips.slice(r * perRow, (r + 1) * perRow), wRow = ws.slice(r * perRow, (r + 1) * perRow);
    cx = W / 2 - (wRow.reduce((a2, b) => a2 + b, 0) + 16 * (wRow.length - 1)) / 2;
    items.forEach((c, i) => {
      const idx = r * perRow + i;
      chip(c.label, cx + wRow[i] / 2, 1262 - (rows - 1 - r) * 78, c.tone === "good" ? C.green : C.red, prog(s, base + idx * 0.22, base + idx * 0.22 + 0.3) * (1 - outK));
      cx += wRow[i] + 16;
    });
  }
}
function hudOutro(seg, s) {
  const dur = seg.t1 - seg.t0, split = seg.lines[1] ? seg.lines[1].t0 - 0.15 : dur;
  hud.fillStyle = "rgba(9,9,11,0.5)"; hud.fillRect(0, 0, W, H);
  if (s < split + 0.3) {
    const a = 1 - prog(s, split, split + 0.3), k = spring(s - 0.05);
    hud.save(); hud.translate(W / 2, 520); hud.scale(k, k);
    text("ГЛАВНОЕ", 0, 0, F(150), C.gold, "center", a);
    hud.restore();
    const body = seg.lines[0].text.replace(/^[^:]+:\s*/, ""), rows = wrap(body.charAt(0).toUpperCase() + body.slice(1), F(64), 900);
    rows.forEach((row, i) => { const kk = outExpo(prog(s, 0.5 + i * 0.12, 1.0 + i * 0.12)); text(row.join(" "), W / 2, 670 + i * 84 + (1 - kk) * 40, F(64), C.text, "center", kk * a); });
    // все моменты ролика списком
    const y0 = 700 + rows.length * 84 + 40;
    (seg.recap || []).forEach((r, i) => {
      const kk = outExpo(prog(s, 1.0 + i * 0.14, 1.4 + i * 0.14)), y = y0 + i * 62, col = r.good ? C.gold : C.red, x = 150 - (1 - kk) * 60;
      hud.globalAlpha = kk * a; hud.fillStyle = col; hud.beginPath(); hud.arc(x + 20, y - 13, 20, 0, 7); hud.fill();
      text(String(i + 1), x + 20, y - 3, F(26), C.ink, "center", kk * a);
      text(r.title, x + 62, y, F(38, "UI"), C.text, "left", kk * a);
      text(r.clock, W - 150, y, F(38), C.muted, "right", kk * a);
    });
    hud.globalAlpha = 1;
  } else {
    const u = s - split - 0.2, k = spring(u);
    if (emblem) { hud.save(); hud.translate(W / 2, 600); hud.scale(k, k); hud.shadowColor = rgba(C.gold, 0.5); hud.shadowBlur = 80; hud.drawImage(emblem, -130, -130, 260, 260); hud.restore(); }
    const k1 = outExpo(prog(u, 0.2, 0.7));
    text("РАЗБЕРИ СВОЮ КАТКУ", W / 2, 880 + (1 - k1) * 40, F(84), C.text, "center", k1);
    const k2 = prog(u, 0.45, 0.8);
    hud.font = F(72); const w = hud.measureText("@DotaRazbor_bot").width + 90;
    hud.save(); hud.translate(W / 2, 1010); const sc = outBack(clamp(k2), 2); hud.scale(sc, sc); hud.globalAlpha = clamp(k2 * 2);
    hud.fillStyle = C.gold; rrect(-w / 2, -66, w, 124, 62); hud.fill();
    text("@DotaRazbor_bot", 0, 22, F(72), C.ink, "center", clamp(k2 * 2));
    hud.restore();
    text("кидай номер матча в Телеграме", W / 2, 1140, F(40, "UI"), C.muted, "center", prog(u, 0.7, 1.0));
  }
}

// ---------- кадр ----------
function sprite(img, x, y, hpx, alpha) {
  const w = (img.width / img.height) * hpx;
  hud.globalAlpha = alpha; hud.imageSmoothingQuality = "high";
  hud.drawImage(img, x - w / 2, y - hpx, w, hpx);
  hud.globalAlpha = 1;
}
function frame(t) {
  t = clamp(t, 0, film.duration - 1e-4);
  const seg = segAt(t), s = t - seg.t0, i = film.segs.indexOf(seg), dur = seg.t1 - seg.t0;
  const cs = camAt(t);
  const isMoment = seg.kind === "moment";
  const g = isMoment ? warpAt(seg.warp, s) : 0;
  let myDeath = 0;
  if (isMoment) {
    // на убийстве камера вздрагивает и чуть наезжает; на моей смерти — сильнее
    for (let ki = 0; ki < seg.kills.length; ki++) {
      const kill = seg.kills[ki], u = s - kill.s;
      if (u < 0 || u > 0.55) continue;
      const mine = kill.v === film.me, amp = (mine ? 0.9 : 0.42) * Math.exp(-u * 7) * (cs.r / 18);
      cs.c = [cs.c[0] + Math.sin(u * 61 + ki) * amp, cs.c[1] + Math.cos(u * 53 + ki * 2) * amp];
      cs.r *= 1 - (mine ? 0.06 : 0.03) * Math.exp(-u * 6);
      if (mine) myDeath = Math.max(myDeath, Math.exp(-u * 5));
    }
  }
  applyCam(cs);
  const spotK = isMoment ? smooth(prog(s, 0.1, 1.0)) * (1 - prog(s, dur - 0.3, dur)) : 0;
  beginGround(cs, spotK);
  if (isMoment) drawGround(seg, s, g);
  else drawOverview(t, seg.kind === "intro" ? prog(s, 0.2, dur * 0.8) : 1, seg.kind === "intro" ? 1 : 0.7);
  blitGround();

  drawPillars(isMoment ? seg : null, g);
  if (isMoment) {
    // столбы света на местах убийств
    hud.globalCompositeOperation = "lighter";
    for (const kill of seg.kills) {
      const u = s - kill.s;
      if (u < 0 || u > 1.5) continue;
      const k = outExpo(prog(u, 0, 0.18)) * (1 - inCubic(prog(u, 0.5, 1.5)));
      const [x, y] = project(kill.x, kill.y), top = project(kill.x, kill.y, 26 * (0.4 + 0.6 * outExpo(prog(u, 0, 0.3))))[1];
      const col = rel(film.players[kill.v].team) === 0 ? C.red : C.green, half = (FOCAL / CAM.d) * (1.7 + k * 0.8);
      const gy = hud.createLinearGradient(0, y, 0, top); gy.addColorStop(0, rgba(col, 0.95 * k)); gy.addColorStop(0.3, rgba(col, 0.4 * k)); gy.addColorStop(1, rgba(col, 0));
      for (const [wk, a] of [[1, 0.5], [0.45, 0.8], [0.16, 1]]) { hud.globalAlpha = a; hud.fillStyle = gy; hud.fillRect(x - half * wk, top, half * wk * 2, y - top); }
    }
    hud.globalAlpha = 1; hud.globalCompositeOperation = "source-over";
    // фишки: дальние раньше, ближние поверх; я — поверх всех рядом стоящих
    const list = [];
    for (let slot = 0; slot < 10; slot++) {
      const p = posAt(seg, slot, g);
      if (!p) continue;
      const actor = seg.actors.includes(slot), me = slot === film.me;
      let px = me ? 176 : actor ? 138 : 78, alpha = actor ? 1 : 0.62;
      if (!p.alive) { const fall = outCubic(clamp((p.since ?? 9) / 0.6)); px *= lerp(1, 0.7, fall); alpha *= lerp(1, 0.6, fall); }
      const [x, y, z] = project(p.x, p.y);
      list.push({ img: p.alive ? tokens[slot].live : tokens[slot].dead, x, y, z: me ? -1 : z + (p.alive ? 0 : 4), px, alpha }); // я всегда поверх: меня не должны закрывать стоящие рядом
    }
    list.sort((a, b) => b.z - a.z);
    for (const it of list) sprite(it.img, it.x, it.y, it.px, it.alpha);
    drawSparks(seg, s);
    // по мне попали: фишка вспыхивает красным
    const mine = posAt(seg, film.me, g);
    if (mine && mine.alive) {
      let hit = 0;
      for (const [hg, v] of seg.hits) { const age = g - hg; if (age >= 0 && age < 0.3) hit = Math.max(hit, (1 - age / 0.3) * clamp(v / 400, 0.35, 1)); }
      if (hit > 0) { const [x, y] = project(mine.x, mine.y); hud.globalCompositeOperation = "lighter"; hud.globalAlpha = hit * 0.6; hud.fillStyle = C.red; hud.beginPath(); hud.arc(x, y - 176 * 0.6, 176 * 0.4, 0, 7); hud.fill(); hud.globalAlpha = 1; hud.globalCompositeOperation = "source-over"; }
    }
  }

  hud.globalAlpha = 1; hud.textBaseline = "alphabetic";
  vignette();
  if (myDeath > 0.02) {
    // моя смерть: края кадра заливает красным
    const rg = hud.createRadialGradient(W / 2, H * 0.45, H * 0.28, W / 2, H * 0.45, H * 0.7);
    rg.addColorStop(0, rgba(C.red, 0)); rg.addColorStop(1, rgba(C.red, 0.3 * myDeath));
    hud.fillStyle = rg; hud.fillRect(0, 0, W, H);
  }
  if (seg.kind === "intro") hudIntro(seg, s);
  else if (isMoment) hudMoment(seg, s, g);
  else hudOutro(seg, s);
  topBar(t, seg, s);
  captions(seg, s);
  if (seg.kind !== "outro") text("@DotaRazbor_bot", W / 2, 1742, F(34), C.muted, "center", 0.75);
  // вспышка на стыке сегментов
  if (i > 0 && s < 0.22) { hud.fillStyle = `rgba(255,255,255,${0.16 * (1 - s / 0.22)})`; hud.fillRect(0, 0, W, H); }
}

window.film = film;
window.renderFrame = frame;
window.frameJpeg = (t, q = 0.93) => { frame(t); return out.toDataURL("image/jpeg", q); };
frame(Number(Q.get("t") || 0));
window.__ready = true;
