// Медаль ранга в профиле (дизайн «Новый»): неоновая голограмма. Каркас медали в 3D из светящихся линий —
// двойной обод с рёбрами, объёмный щит, звёзды ранга, орбитальное кольцо, — висит над проектором,
// из которого поднимаются искры. Сканлайны и лёгкое мерцание, цвет — свой у каждого ранга.
// Крутится пальцем с инерцией, сам покачивается, наклон телефона поворачивает её.
// Тап — глитч: быстрый оборот, вспышка и выброс частиц. Рисуется на canvas 2D, без WebGL.
import { gyro, whenGone } from "./aegis.js?v=9";

const MEDALS = ["Рекрут", "Страж", "Рыцарь", "Герой", "Легенда", "Властелин", "Божество", "Титан"];
// неоновый цвет ранга: оттенок как у значка ранга, но яркий
const NEON = ["#ffb38a", "#b8ff6a", "#5dffb0", "#7aa8ff", "#e07bff", "#4ff3ff", "#ffe27a", "#ff6a3d"];
const W = 240, H = 290; // CSS-размер холста
const R = 78; // радиус медали в пикселях
const CX = W / 2, CY = 118;
const FOCAL = 3.4;
const DEG = Math.PI / 180;
const INTRO_MS = 1900; // проектор включается и собирает медаль
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - x, 3);

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

// ---------- геометрия: список отрезков в единицах радиуса, y вниз ----------

function ring(r, z, n = 64, from = 0, to = 360) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (from + ((to - from) * i) / n) * DEG, b = (from + ((to - from) * (i + 1)) / n) * DEG;
    out.push([[r * Math.cos(a), r * Math.sin(a), z], [r * Math.cos(b), r * Math.sin(b), z]]);
  }
  return out;
}
function poly(points, z, closed = true) {
  const out = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    out.push([[a[0], a[1], z], [b[0], b[1], z]]);
  }
  return out;
}
function star(cx, cy, r, inner = 0.45) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });
}
// контур щита: плавная кривая по точкам
function shield(s) {
  const pts = [];
  pts.push([0, -0.62 * s]);
  pts.push([0.42 * s, -0.44 * s]);
  pts.push([0.42 * s, -0.05 * s]);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    pts.push([0.42 * s * (1 - Math.pow(t, 1.8)), (-0.05 + t * 0.62) * s]);
  }
  const right = pts.slice(1, -1);
  for (let i = right.length - 1; i >= 0; i--) pts.push([-right[i][0], right[i][1]]);
  return pts;
}

function geometry(medal, stars) {
  const T = 0.09; // половина толщины
  const segs = [];
  const add = (list, kind) => { for (const s of list) segs.push({ a: s[0], b: s[1], kind }); };
  // обод: два кольца и рёбра между ними
  add(ring(1, T), "rim");
  add(ring(1, -T), "rim");
  for (let i = 0; i < 24; i++) {
    const a = i * 15 * DEG;
    add([[[Math.cos(a), Math.sin(a), T], [Math.cos(a), Math.sin(a), -T]]], "edge");
  }
  add(ring(0.86, T), "inner");
  // насечки по ободу
  for (let i = 0; i < 48; i++) {
    const a = i * 7.5 * DEG;
    add([[[0.9 * Math.cos(a), 0.9 * Math.sin(a), T], [0.97 * Math.cos(a), 0.97 * Math.sin(a), T]]], "tick");
  }
  // щит: лицо и спина, соединены рёбрами — объём
  const sh = shield(1.05);
  add(poly(sh, T + 0.05), "shield");
  add(poly(sh, -T + 0.02), "shieldBack");
  sh.forEach((p, i) => { if (i % 3 === 0) add([[[p[0], p[1], T + 0.05], [p[0], p[1], -T + 0.02]]], "edge"); });
  // звезда в центре щита и лучи от неё
  add(poly(star(0, -0.16, 0.2), T + 0.07), "emblem");
  // звёзды ранга дугой внизу
  const n = medal === 8 ? 0 : Math.max(0, Math.min(5, stars));
  for (let i = 0; i < n; i++) {
    const a = (90 + (i - (n - 1) / 2) * 19) * DEG;
    add(poly(star(0.66 * Math.cos(a), 0.66 * Math.sin(a), 0.075), T + 0.03), "star");
  }
  // Титан: лавровый венок вместо звёзд
  if (medal === 8) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const a = (110 + i * 14) * DEG, x = side * 0.72 * Math.cos(a), y = 0.72 * Math.sin(a) * -1 + 0.1;
        add(poly(star(x, -y + 0.2, 0.05, 0.9).filter((_, k) => k % 2 === 0), T + 0.03), "star");
      }
    }
  }
  return segs;
}

// ---------- проекция ----------

function project(p, rx, ry) {
  // поворот вокруг Y, потом вокруг X
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
  const y2 = p[1] * cx - z1 * sx, z2 = p[1] * sx + z1 * cx;
  const k = FOCAL / (FOCAL + z2);
  return [CX + x1 * R * k, CY + y2 * R * k, z2];
}

export function rankMedal3d(tier, { reduced = false, haptic = () => {}, tick = () => {} } = {}) {
  const medal = tier ? Math.floor(tier / 10) : 0, stars = tier ? tier % 10 : 0;
  const known = medal >= 1 && medal <= 8;
  const name = known ? MEDALS[medal - 1] : "Калибровка";
  const roman = ["", "I", "II", "III", "IV", "V"][stars] || "";
  const label = known ? `${name}${medal < 8 && roman ? ` ${roman}` : ""}` : name;
  const [r, g, b] = rgb(known ? NEON[medal - 1] : "#9fb4c8");
  const col = (a) => `rgba(${r},${g},${b},${a})`;
  const hot = (a) => `rgba(${Math.min(255, r + 120)},${Math.min(255, g + 120)},${Math.min(255, b + 120)},${a})`;
  const segs = geometry(known ? medal : 0, stars);

  const canvas = document.createElement("canvas");
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.className = "holo-canvas";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const root = document.createElement("div");
  root.className = "rank3d holo";
  root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `Медаль ранга: ${label}`);
  root.style.setProperty("--neon", col(1));
  const caption = document.createElement("div");
  caption.className = "holo-label";
  caption.textContent = label.toUpperCase();
  root.append(canvas, caption);

  // ---------- частицы: искры из проектора и выброс по тапу ----------
  const parts = [];
  const spawn = (burst = false) => {
    const a = Math.random() * Math.PI * 2;
    if (burst) {
      const sp = 1.2 + Math.random() * 2.8;
      parts.push({ x: CX, y: CY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.012 + Math.random() * 0.02, size: 1 + Math.random() * 1.6 });
    } else {
      const rad = Math.random() * 52;
      parts.push({ x: CX + Math.cos(a) * rad, y: 258 + Math.sin(a) * rad * 0.22, vx: (Math.random() - 0.5) * 0.15, vy: -(0.35 + Math.random() * 0.9), life: 1, decay: 0.006 + Math.random() * 0.01, size: 0.6 + Math.random() * 1.2 });
    }
  };

  // ---------- состояние вращения ----------
  let ry = -25 * DEG, rx = 10 * DEG, vy = 0, held = false, lastX = 0, lastT = 0, moved = 0, tiltX = 0, tiltY = 0;
  let glitch = 0, spinTo = null, side = 0, raf = 0, visible = true, intro = reduced ? 1 : 0, introStart = 0;
  const t0 = performance.now();
  // сканлайны рисуем один раз и потом кладём одной картинкой
  const scan = document.createElement("canvas");
  scan.width = canvas.width; scan.height = canvas.height;
  const sctx = scan.getContext("2d");
  sctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let y = 0; y < scan.height; y += Math.round(3 * dpr)) sctx.fillRect(0, y, scan.width, Math.max(1, Math.round(dpr)));

  function frame(now) {
    raf = 0;
    if (!root.isConnected || !visible || document.hidden) return;
    const t = (now - t0) / 1000;
    if (intro < 1) {
      if (!introStart) introStart = now;
      intro = Math.min(1, (now - introStart) / INTRO_MS);
      if (intro >= 0.9 && !root.classList.contains("shown")) { root.classList.add("shown"); glitch = 0.75; haptic("light"); }
    }
    if (!held) {
      if (spinTo != null) {
        ry += (spinTo - ry) * 0.12;
        if (Math.abs(spinTo - ry) < 0.002) spinTo = null;
      } else if (Math.abs(vy) > 0.0008) {
        ry += vy;
        vy *= 0.955;
      } else {
        vy = 0;
        ry += 0.004; // голограмма медленно вращается сама
      }
      rx += (10 * DEG + Math.sin(t * 0.7) * 6 * DEG - rx) * 0.05;
    }
    const nowSide = Math.round(ry / Math.PI);
    if (nowSide !== side) { side = nowSide; tick(); }
    draw(t);
    if (!reduced) raf = requestAnimationFrame(frame);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const flick = 0.92 + Math.sin(t * 37) * 0.03 + (Math.random() < 0.02 ? -0.25 : 0);
    const g2 = Math.max(0, glitch);
    glitch = Math.max(0, glitch - 0.03);
    // интро: 0…0.25 — включается проектор, 0.2…0.85 — луч поднимается и собирает медаль снизу вверх
    const power = ease(clamp01(intro / 0.25));
    const build = clamp01((intro - 0.2) / 0.65);
    const scanY = 258 - build * 240; // всё, что ниже этой линии, уже собрано
    const building = intro < 0.86;

    ctx.globalCompositeOperation = "lighter";
    // луч проектора растёт вверх при включении
    const top = 258 - (258 - 4) * power;
    const beam = ctx.createLinearGradient(0, 258, 0, top);
    beam.addColorStop(0, col((building ? 0.38 : 0.22) * flick));
    beam.addColorStop(1, col(0));
    ctx.fillStyle = beam;
    const spread = 54 + 58 * power;
    ctx.beginPath();
    ctx.moveTo(CX - 54 * power, 258); ctx.lineTo(CX + 54 * power, 258); ctx.lineTo(CX + spread, top); ctx.lineTo(CX - spread, top); ctx.closePath();
    ctx.fill();
    // проектор: эллипсы раскрываются из точки
    ctx.lineWidth = 1.2;
    for (const [rad, a] of [[58, 0.75], [44, 0.45], [26, 0.3]]) {
      ctx.strokeStyle = col(a * flick);
      ctx.beginPath(); ctx.ellipse(CX, 258, rad * power + 0.01, rad * 0.22 * power + 0.01, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const pad = ctx.createRadialGradient(CX, 258, 0, CX, 258, 60);
    pad.addColorStop(0, col(building ? 0.6 : 0.35)); pad.addColorStop(1, col(0));
    ctx.fillStyle = pad;
    ctx.beginPath(); ctx.ellipse(CX, 258, 60 * power + 0.01, 14 * power + 0.01, 0, 0, Math.PI * 2); ctx.fill();

    // каркас: отрезки раскладываем по корзинам яркости и рисуем каждую одним путём —
    // вместо сотен отдельных stroke() за кадр около двадцати
    const ay = ry + tiltY, ax = rx + tiltX;
    const shift = g2 ? (Math.random() - 0.5) * 10 * g2 : 0;
    const glow = new Map(), core = new Map(), fresh = [];
    for (const sg of segs) {
      const p = project(sg.a, ax, ay), q = project(sg.b, ax, ay);
      const low = Math.max(p[1], q[1]);
      if (building && low < scanY) continue; // ещё не собрано
      if (building && low < scanY + 16) { fresh.push(p, q); continue; } // только что собрано — горит ярче
      const depth = (p[2] + q[2]) / 2;
      const near = Math.max(0.25, Math.min(1, 0.65 - depth * 0.9));
      const main = sg.kind === "shield" || sg.kind === "emblem" || sg.kind === "star";
      const alpha = (main ? 1 : sg.kind === "tick" ? 0.45 : sg.kind === "edge" ? 0.5 : 0.8) * near;
      const lvl = Math.max(1, Math.round(alpha * 6));
      const key = (main ? 10 : 0) + lvl;
      if (!glow.has(key)) { glow.set(key, []); core.set(key, []); }
      glow.get(key).push(p, q);
      core.get(key).push(p, q);
    }
    const strokeAll = (pts, style, width) => {
      if (!pts.length) return;
      ctx.strokeStyle = style; ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i][0] + shift, pts[i][1]); ctx.lineTo(pts[i + 1][0] + shift, pts[i + 1][1]); }
      ctx.stroke();
    };
    ctx.lineCap = "round";
    for (const [key, pts] of glow) strokeAll(pts, col(((key % 10) / 6) * 0.22 * flick), key >= 10 ? 7 : 5);
    for (const [key, pts] of core) strokeAll(pts, key >= 10 ? hot(((key % 10) / 6) * flick) : col(((key % 10) / 6) * flick), key >= 10 ? 1.8 : 1.2);
    if (fresh.length) { strokeAll(fresh, hot(0.35), 8); strokeAll(fresh, "rgba(255,255,255,0.95)", 2); }

    if (building && build > 0) {
      // лазерная линия сборки и искры на ней
      const lg = ctx.createLinearGradient(CX - 120, 0, CX + 120, 0);
      lg.addColorStop(0, col(0)); lg.addColorStop(0.5, hot(0.9)); lg.addColorStop(1, col(0));
      ctx.fillStyle = lg;
      ctx.fillRect(CX - 120, scanY - 1, 240, 2);
      const halo = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
      halo.addColorStop(0, col(0)); halo.addColorStop(0.5, col(0.25)); halo.addColorStop(1, col(0));
      ctx.fillStyle = halo;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(CX - 54 * power, 258); ctx.lineTo(CX + 54 * power, 258); ctx.lineTo(CX + spread, top); ctx.lineTo(CX - spread, top); ctx.closePath();
      ctx.clip();
      ctx.fillRect(CX - 120, scanY - 14, 240, 28);
      ctx.restore();
      for (let i = 0; i < 3; i++) parts.push({ x: CX + (Math.random() - 0.5) * 170, y: scanY, vx: (Math.random() - 0.5) * 0.8, vy: -0.3 - Math.random() * 1.2, life: 1, decay: 0.03 + Math.random() * 0.03, size: 1 + Math.random() * 1.4 });
    }

    if (!building) {
      // орбитальное кольцо: наклонённое, крутится само по себе, пунктиром — тоже одним путём
      const orbitTilt = 68 * DEG, orbitSpin = t * 0.9, ox = ax * 0.4, oy = ay * 0.3;
      const front = [], back = [];
      for (let i = 0; i < 90; i++) {
        if (i % 3 === 2) continue;
        const a = orbitSpin + (i / 90) * Math.PI * 2, b = orbitSpin + ((i + 1) / 90) * Math.PI * 2;
        const p = project([1.28 * Math.cos(a), 1.28 * Math.sin(a) * Math.cos(orbitTilt), 1.28 * Math.sin(a) * Math.sin(orbitTilt)], ox, oy);
        const q = project([1.28 * Math.cos(b), 1.28 * Math.sin(b) * Math.cos(orbitTilt), 1.28 * Math.sin(b) * Math.sin(orbitTilt)], ox, oy);
        (p[2] < 0 ? front : back).push(p, q);
      }
      strokeAll(back, col(0.25 * flick), 1.2);
      strokeAll(front, col(0.7 * flick), 1.2);
      const sa = orbitSpin * 2.2;
      const sp = project([1.28 * Math.cos(sa), 1.28 * Math.sin(sa) * Math.cos(orbitTilt), 1.28 * Math.sin(sa) * Math.sin(orbitTilt)], ox, oy);
      const sgr = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], 9);
      sgr.addColorStop(0, hot(0.9)); sgr.addColorStop(1, col(0));
      ctx.fillStyle = sgr;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 9, 0, Math.PI * 2); ctx.fill();
    }

    // частицы: одним цветом на уровень яркости
    if (!reduced && power > 0.5 && Math.random() < 0.7) spawn();
    if (parts.length > 260) parts.splice(0, parts.length - 260);
    for (let lvl = 1; lvl <= 4; lvl++) {
      ctx.fillStyle = hot(lvl * 0.21);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (lvl === 1) { p.x += p.vx; p.y += p.vy; p.life -= p.decay; if (p.life <= 0) { parts.splice(i, 1); continue; } }
        if (Math.min(4, Math.ceil(p.life * 4)) === lvl) ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }

    // сканлайны (готовая картинка) и бегущая полоса
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(scan, 0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    // бегущая полоса — только внутри луча
    const band = ((t * 70) % (H + 60)) - 30;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(CX - 54 * power, 258); ctx.lineTo(CX + 54 * power, 258); ctx.lineTo(CX + spread, top); ctx.lineTo(CX - spread, top); ctx.closePath();
    ctx.clip();
    const bg = ctx.createLinearGradient(0, band - 18, 0, band + 18);
    bg.addColorStop(0, col(0)); bg.addColorStop(0.5, col(0.12)); bg.addColorStop(1, col(0));
    ctx.fillStyle = bg;
    ctx.fillRect(0, band - 18, W, 36);
    ctx.restore();
    if (g2 > 0.5) {
      const fl = ctx.createRadialGradient(CX, CY, 0, CX, CY, 120);
      fl.addColorStop(0, hot((g2 - 0.5) * 0.7)); fl.addColorStop(1, col(0));
      ctx.fillStyle = fl;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = "source-over";
    root.classList.toggle("glitching", g2 > 0.05);
  }

  const kick = () => { if (!raf && !reduced) raf = requestAnimationFrame(frame); };

  root.addEventListener("pointerdown", (e) => {
    held = true; moved = 0; vy = 0; spinTo = null;
    lastX = e.clientX; lastT = performance.now();
    root.setPointerCapture(e.pointerId);
    root.classList.add("held");
  });
  root.addEventListener("pointermove", (e) => {
    if (!held) return;
    const now = performance.now(), dx = e.clientX - lastX;
    moved += Math.abs(dx) + Math.abs(e.movementY || 0);
    ry += dx * 0.016;
    rx = Math.max(-40 * DEG, Math.min(40 * DEG, rx - (e.movementY || 0) * 0.006));
    vy = (dx * 0.016) / Math.max(8, now - lastT) * 16;
    lastX = e.clientX; lastT = now;
    if (reduced) draw(0);
  });
  const release = () => {
    if (!held) return;
    held = false;
    root.classList.remove("held");
    if (moved < 8) {
      // тап: глитч — оборот, вспышка, выброс искр
      spinTo = (Math.round(ry / (2 * Math.PI)) + 1) * 2 * Math.PI;
      glitch = 1;
      for (let i = 0; i < 70; i++) spawn(true);
      haptic("medium");
      if (reduced) { ry = spinTo; spinTo = null; draw(0); }
    } else if (Math.abs(vy) > 0.1) haptic("light");
    kick();
  };
  root.addEventListener("pointerup", release);
  root.addEventListener("pointercancel", release);

  // вне экрана и в свёрнутом приложении не рисуем: кадр стоит денег батарее
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) kick(); }); // пачка событий: верим последнему
  io.observe(root);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  let stopGyro = () => {};
  whenGone(root, () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    stopGyro();
    if (raf) cancelAnimationFrame(raf);
  });

  if (!reduced) {
    const stop = stopGyro = gyro((beta, gamma) => {
      if (!root.isConnected) { stop(); return; }
      tiltY = Math.max(-30, Math.min(30, gamma * 0.9)) * DEG;
      tiltX = Math.max(-22, Math.min(22, -beta * 0.6)) * DEG;
    });
    kick();
  } else { root.classList.add("shown"); draw(0); }
  return root;
}
