// Тактический стол (дизайн «Новый»): карта Доты лежит в 3D, смерти стоят на ней красными столбами
// (несколько смертей в одном месте — столб выше), обсы — золотыми. Пальцем стол крутится с инерцией
// и наклоняется, без пальца медленно поворачивается сам. Тап по столбу — что там случилось.
import { mapX, mapY, terrainUrl } from "./dotamap.js?v=5";
import { whenGone } from "./aegis.js?v=9";

function d(cls, ...children) {
  const n = document.createElement("div");
  n.className = cls;
  n.append(...children);
  return n;
}
const mmss = (t) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;

// Столб из двух скрещённых плоскостей и шапки: виден под любым углом
function pillar(kind, height, delay) {
  const a = d("m3d-plane"), b = d("m3d-plane m3d-plane-b"), cap = d("m3d-cap"), ring = d("m3d-ring");
  for (const p of [a, b]) p.style.height = `${height}px`;
  cap.style.transform = `translateZ(${height}px)`;
  const col = d("m3d-col", a, b, cap);
  const pin = d(`m3d-pin ${kind}`, ring, col);
  pin.style.setProperty("--delay", `${delay}ms`);
  return pin;
}

export function tacticalTable({ deaths = [], wards = [], reduced = false, haptic = () => {} } = {}) {
  const board = d("m3d-board");
  board.style.backgroundImage = `url("${terrainUrl()}")`;
  const info = d("m3d-info");
  const showInfo = (text) => { info.textContent = text; };

  // смерти рядом друг с другом (в пределах ~4 клеток) складываем в один столб
  const groups = [];
  for (const x of deaths) {
    const cx = mapX(x.x), cy = mapY(x.y);
    const g = groups.find((q) => Math.hypot(q.cx - cx, q.cy - cy) < 4);
    if (g) g.list.push(x); else groups.push({ cx, cy, list: [x] });
  }
  groups.forEach((g, i) => {
    const pin = pillar("death", 22 + (g.list.length - 1) * 16, 120 + i * 70);
    pin.style.left = `${(g.cx / 128) * 100}%`;
    pin.style.top = `${(g.cy / 128) * 100}%`;
    const times = g.list.map((x) => mmss(x.t)).join(", ");
    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      if (moved > 8) return; // это был поворот стола, а не тап по столбу
      haptic("light");
      board.querySelectorAll(".m3d-pin.on").forEach((p) => p.classList.remove("on"));
      pin.classList.add("on");
      const n = g.list.length, m10 = n % 10, m100 = n % 100;
      const word = m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "смерти" : "смертей";
      showInfo(`${n > 1 ? `${n} ${word} здесь` : "Смерть"}: ${times}`);
    });
    board.append(pin);
  });
  wards.slice(0, 24).forEach((w, i) => {
    const pin = pillar(`ward${w.mine ? " mine" : ""}${w.dewarded ? " dewarded" : ""}`, 12, 300 + i * 30);
    pin.style.left = `${(mapX(w.x) / 128) * 100}%`;
    pin.style.top = `${(mapY(w.y) / 128) * 100}%`;
    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      if (moved > 8) return; // это был поворот стола, а не тап по столбу
      haptic("light");
      board.querySelectorAll(".m3d-pin.on").forEach((p) => p.classList.remove("on"));
      pin.classList.add("on");
      showInfo(`Обс${w.mine ? " (твой)" : ""} в ${mmss(w.t)}${w.dewarded ? ", снесли раньше времени" : ""}`);
    });
    board.append(pin);
  });

  const stage = d("m3d-stage", board);
  const view = d("m3d", stage);
  view.setAttribute("role", "img");
  view.setAttribute("aria-label", `Карта: смертей ${deaths.length}, обсов ${wards.length}`);
  const root = d("m3d-wrap", view, info);
  showInfo("Крути стол пальцем, тап по столбу — что там было");

  // ---------- вращение: угол стола и наклон, инерция ----------
  let spin = -20, tilt = 52, v = 0, held = false, lastX = 0, lastY = 0, lastT = 0, raf = 0, moved = 0, visible = false;
  const draw = () => { stage.style.transform = `rotateX(${tilt.toFixed(2)}deg) rotateZ(${spin.toFixed(2)}deg)`; };
  const loop = () => {
    raf = 0;
    // вне экрана и в свёрнутом приложении стол не крутим
    if (!root.isConnected || !visible || document.hidden) return;
    if (!held) {
      spin += v;
      v *= 0.95;
      if (Math.abs(v) < 0.08) v = reduced ? 0 : 0.08; // сам медленно крутится
    }
    draw();
    // без анимаций стол крутится только пальцем и докатывается по инерции, потом цикл спит
    if (reduced && !held && v === 0) return;
    raf = requestAnimationFrame(loop);
  };
  view.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    held = true; moved = 0; v = 0;
    lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
    view.classList.add("held");
  });
  view.addEventListener("pointermove", (e) => {
    if (!held) return;
    const now = performance.now(), dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    // палец уехал за край стола — поворот всё равно идёт, пока не отпустили. Захват только когда это уже поворот:
    // с захватом сразу клик мышью уходит столу, а не столбу, и тап по столбу молчит
    if (moved > 8 && !view.hasPointerCapture(e.pointerId)) try { view.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    // горизонталь крутит, вертикаль наклоняет
    spin -= dx * 0.5;
    tilt = Math.max(15, Math.min(68, tilt - dy * 0.25));
    v = (-dx * 0.5) / Math.max(8, now - lastT) * 16;
    lastX = e.clientX; lastY = e.clientY; lastT = now;
    draw();
  });
  const release = () => {
    if (!held) return;
    held = false;
    view.classList.remove("held");
    if (performance.now() - lastT > 80) v = 0; // палец остановился перед отпусканием
    v = Math.max(-25, Math.min(25, v));
  };
  view.addEventListener("pointerup", release);
  view.addEventListener("pointercancel", release);
  view.addEventListener("lostpointercapture", release);
  // айфон не всегда слушается touch-action: без этого страница начинает скроллиться,
  // браузер отменяет жест и стол замирает посреди поворота
  view.addEventListener("touchmove", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  view.addEventListener("click", () => {
    if (moved > 8) return;
    board.querySelectorAll(".m3d-pin.on").forEach((p) => p.classList.remove("on"));
    showInfo("Крути стол пальцем, тап по столбу — что там было");
  });

  draw();
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  view.addEventListener("pointerdown", kick);
  document.addEventListener("visibilitychange", kick);
  // столбы вырастают, когда стол доехал до экрана; вне экрана — пауза
  const io = new IntersectionObserver((es) => {
    visible = es[es.length - 1].isIntersecting; // события приходят пачкой: верим последнему
    root.classList.toggle("paused", !visible);
    if (visible) { root.classList.add("grown"); kick(); }
  }, { threshold: 0.15 });
  io.observe(root);
  whenGone(root, () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", kick);
    if (raf) cancelAnimationFrame(raf);
  });
  if (reduced) root.classList.add("grown");
  return root;
}
