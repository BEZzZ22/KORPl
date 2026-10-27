// Медаль ранга в профиле (дизайн «Новый»): объёмная монета на CSS 3D. Лицо — своя чеканка в цвете ранга
// со звёздами, на обороте — название ранга, ребро из стопки дисков. Крутится пальцем с инерцией и сама
// встаёт лицом или оборотом, сама чуть покачивается, наклон телефона поворачивает её. Тап — переворот.
import { gyro } from "./aegis.js?v=4";

const MEDALS = ["Рекрут", "Страж", "Рыцарь", "Герой", "Легенда", "Властелин", "Божество", "Титан"];
// основной цвет металла по рангу, как у значка ранга в профиле
const METAL = ["#9b8576", "#8fa36b", "#7fae8a", "#7f8fd0", "#c08adf", "#6fc9d6", "#ead6a0", "#ff6a2a"];
const NS = "http://www.w3.org/2000/svg";
const EDGE = 12; // толщина монеты, px

function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...children);
  return n;
}
function d(cls, ...children) {
  const n = document.createElement("div");
  n.className = cls;
  n.append(...children);
  return n;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)));
  return `rgb(${ch.join(",")})`;
}
function starPath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

// Лицо монеты: обод с насечками, металл в цвете ранга, щит и звёзды
function face(medal, stars, id, emblem = true) {
  const col = METAL[medal - 1] || "#8f817a";
  const g = (name) => `url(#${id}-${name})`;
  const notches = Array.from({ length: 36 }, (_, i) => s("rect", { x: "98.5", y: "6", width: "3", height: "7", rx: "1", fill: "rgba(0,0,0,.35)", transform: `rotate(${i * 10} 100 100)` }));
  const starCount = medal === 8 ? 0 : Math.max(0, Math.min(5, stars));
  const starNodes = Array.from({ length: starCount }, (_, i) => {
    const a = (90 + (i - (starCount - 1) / 2) * 17) * (Math.PI / 180);
    return s("path", { d: starPath(100 + 62 * Math.cos(a), 100 + 62 * Math.sin(a), 8), fill: "#fff6dc", stroke: "rgba(0,0,0,.35)", "stroke-width": "1" });
  });
  return s("svg", { viewBox: "0 0 200 200", class: "r3-art", "aria-hidden": "true" },
    s("defs", {},
      s("radialGradient", { id: `${id}-metal`, cx: "35%", cy: "28%", r: "80%" },
        s("stop", { offset: "0", "stop-color": shade(col, 0.55) }), s("stop", { offset: ".45", "stop-color": col }), s("stop", { offset: "1", "stop-color": shade(col, -0.55) })),
      s("linearGradient", { id: `${id}-rim`, x1: "0", y1: "0", x2: "1", y2: "1" },
        s("stop", { offset: "0", "stop-color": "#e9e4d8" }), s("stop", { offset: ".35", "stop-color": "#8b867c" }), s("stop", { offset: ".7", "stop-color": "#3a3833" }), s("stop", { offset: "1", "stop-color": "#b9b3a6" })),
      s("linearGradient", { id: `${id}-shield`, x1: "0", y1: "0", x2: "0", y2: "1" },
        s("stop", { offset: "0", "stop-color": shade(col, -0.25) }), s("stop", { offset: "1", "stop-color": shade(col, -0.7) }))),
    s("circle", { cx: "100", cy: "100", r: "98", fill: g("rim") }),
    ...notches,
    s("circle", { cx: "100", cy: "100", r: "84", fill: g("metal") }),
    s("circle", { cx: "100", cy: "100", r: "76", fill: "none", stroke: "rgba(255,255,255,.28)", "stroke-width": "1.5" }),
    s("circle", { cx: "100", cy: "100", r: "73.5", fill: "none", stroke: "rgba(0,0,0,.3)", "stroke-width": "1.5" }),
    ...(emblem ? [
      s("path", { d: "M100 44 66 59v22c0 22 14.5 33.5 34 40 19.5-6.5 34-18 34-40V59L100 44Z", fill: g("shield"), stroke: shade(col, 0.6), "stroke-width": "2.5", "stroke-linejoin": "round" }),
      s("path", { d: starPath(100, 82, 15), fill: shade(col, 0.75), "fill-opacity": ".9" }),
      ...starNodes,
    ] : []),
    s("ellipse", { cx: "78", cy: "52", rx: "46", ry: "22", fill: "#fff", "fill-opacity": ".13", transform: "rotate(-24 78 52)" }),
  );
}

export function rankMedal3d(tier, { reduced = false, haptic = () => {}, tick = () => {} } = {}) {
  const medal = tier ? Math.floor(tier / 10) : 0, stars = tier ? tier % 10 : 0;
  const known = medal >= 1 && medal <= 8;
  const name = known ? MEDALS[medal - 1] : "Калибровка";
  const col = METAL[medal - 1] || "#8f817a";
  const id = `r3${Math.random().toString(36).slice(2, 8)}`;

  const front = d("r3-face r3-front", face(known ? medal : 0, stars, id), d("r3-shine"));
  const back = d("r3-face r3-back", face(known ? medal : 0, 0, `${id}b`, false), d("r3-back-in", d("r3-back-name", name), d("r3-back-sub", known && medal < 8 && stars ? `${stars} из 5 звёзд` : "ранг по OpenDota")), d("r3-shine"));
  back.style.setProperty("--metal", col);
  const discs = Array.from({ length: EDGE }, (_, i) => {
    const disc = d("r3-edge");
    disc.style.transform = `translateZ(${(i - (EDGE - 1) / 2).toFixed(1)}px)`;
    return disc;
  });
  const coin = d("r3-coin", ...discs, front, back);
  const shadow = d("r3-shadow");
  const root = d("rank3d", coin, shadow);
  root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `Медаль ранга: ${name}${known && medal < 8 && stars ? `, ${stars} из 5` : ""}`);
  root.style.setProperty("--metal", col);

  // ---------- физика: угол, скорость, пружина к ближайшей стороне ----------
  let ry = -18, rx = 8, vy = 0, held = false, lastX = 0, lastY = 0, lastT = 0, moved = 0, raf = 0, tiltX = 0, tiltY = 0, side = 0, t0 = performance.now();
  const draw = () => {
    coin.style.transform = `rotateX(${(rx + tiltX).toFixed(2)}deg) rotateY(${(ry + tiltY).toFixed(2)}deg)`;
    // блик бежит по лицу, когда монета поворачивается
    root.style.setProperty("--sh", `${(50 + (((ry + tiltY) % 360) / 360) * 300).toFixed(1)}%`);
    const edgeOn = Math.abs(Math.cos(((ry + tiltY) * Math.PI) / 180));
    shadow.style.transform = `scaleX(${(0.35 + 0.65 * edgeOn).toFixed(3)})`;
    const nowSide = Math.round(ry / 180);
    if (nowSide !== side) { side = nowSide; tick(); }
  };
  const loop = (now) => {
    raf = 0;
    if (!root.isConnected) return;
    if (!held) {
      if (Math.abs(vy) > 0.05) {
        ry += vy;
        vy *= 0.955;
      } else {
        // встаёт лицом или оборотом и покачивается
        const target = Math.round(ry / 180) * 180;
        vy = 0;
        ry += (target + Math.sin((now - t0) / 1400) * 14 - ry) * 0.06;
      }
      rx += (8 + Math.cos((now - t0) / 1900) * 4 - rx) * 0.06;
    }
    draw();
    raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  root.addEventListener("pointerdown", (e) => {
    held = true; moved = 0; vy = 0;
    lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
    root.setPointerCapture(e.pointerId);
    root.classList.add("held");
  });
  root.addEventListener("pointermove", (e) => {
    if (!held) return;
    const now = performance.now(), dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    ry += dx * 0.9;
    rx = Math.max(-35, Math.min(35, rx - dy * 0.4));
    vy = (dx * 0.9) / Math.max(8, now - lastT) * 16;
    lastX = e.clientX; lastY = e.clientY; lastT = now;
    kick();
  });
  const release = () => {
    if (!held) return;
    held = false;
    root.classList.remove("held");
    if (moved < 8) {
      // тап: переворот с подкруткой
      vy = 0;
      const from = ry, to = (Math.round(ry / 180) + 1) * 180, start = performance.now();
      haptic("medium");
      root.classList.remove("flash"); void root.offsetWidth; root.classList.add("flash");
      const flip = (now) => {
        const k = Math.min(1, (now - start) / 700), e = 1 - Math.pow(1 - k, 3);
        ry = from + (to - from) * (e + Math.sin(k * Math.PI) * 0.08);
        if (k < 1) requestAnimationFrame(flip); else ry = to;
      };
      requestAnimationFrame(flip);
    } else if (Math.abs(vy) > 6) haptic("light");
    kick();
  };
  root.addEventListener("pointerup", release);
  root.addEventListener("pointercancel", release);

  if (!reduced) {
    const stop = gyro((beta, gamma) => {
      if (!root.isConnected) { stop(); return; }
      tiltY = Math.max(-25, Math.min(25, gamma * 0.8));
      tiltX = Math.max(-20, Math.min(20, -beta * 0.6));
      kick();
    });
    kick();
  } else draw();
  return root;
}
