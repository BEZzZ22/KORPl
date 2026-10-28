// Шапка разбора как коллекционная карта (дизайн «Новый»): наклоняется за пальцем и за наклоном телефона,
// по ней бежит голографическая фольга и блик. Тап — карта переворачивается, на обороте итог катки.
import { gyro, whenGone } from "./aegis.js?v=6";

const MAX = 11; // наклон, градусы

export function heroCard3d(banner, back, { reduced = false, haptic = () => {} } = {}) {
  if (reduced) return banner;
  const front = document.createElement("div");
  front.className = "hc-face hc-front";
  front.append(...banner.childNodes);
  const holo = document.createElement("div");
  holo.className = "hc-holo";
  holo.setAttribute("aria-hidden", "true");
  front.append(holo);
  back.classList.add("hc-face", "hc-back");
  const inner = document.createElement("div");
  inner.className = "hc-inner";
  inner.append(front, back);
  banner.append(inner);
  banner.classList.add("hc");

  // Сторону прячем сами: на айфоне backface-visibility сдаётся (фольга с mix-blend-mode сплющивает 3D),
  // и зеркальный оборот просвечивал сквозь лицо
  let backShown = null;
  const showSide = () => {
    const back_ = Math.cos(((ry + flip) * Math.PI) / 180) < 0;
    if (back_ === backShown) return;
    backShown = back_;
    front.style.visibility = back_ ? "hidden" : "visible";
    back.style.visibility = back_ ? "visible" : "hidden";
  };
  let rx = 0, ry = 0, tx = 0, ty = 0, flip = 0, flipT = 0, gx = 0, gy = 0, raf = 0, down = null, touching = false;
  const set = (px, py) => {
    // px, py: 0…1 — где палец на карте
    tx = (0.5 - py) * 2 * MAX;
    ty = (px - 0.5) * 2 * MAX;
    banner.style.setProperty("--hx", `${(px * 100).toFixed(1)}%`);
    banner.style.setProperty("--hy", `${(py * 100).toFixed(1)}%`);
  };
  const loop = () => {
    raf = 0;
    if (!banner.isConnected) return;
    const goalX = touching ? tx : gx, goalY = touching ? ty : gy;
    rx += (goalX - rx) * 0.14;
    ry += (goalY - ry) * 0.14;
    flip += (flipT - flip) * 0.12;
    inner.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${(ry + flip).toFixed(2)}deg)`;
    showSide();
    const power = Math.min(1, (Math.abs(rx) + Math.abs(ry)) / MAX);
    banner.style.setProperty("--ho", (0.15 + power * 0.85).toFixed(3));
    if (!touching && !gx && !gy) banner.style.setProperty("--hx", `${(50 + ry * 3).toFixed(1)}%`);
    const still = Math.abs(goalX - rx) < 0.05 && Math.abs(goalY - ry) < 0.05 && Math.abs(flipT - flip) < 0.1;
    if (!still) raf = requestAnimationFrame(loop);
  };
  showSide();
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const where = (e) => {
    const r = banner.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };

  banner.addEventListener("pointerdown", (e) => {
    touching = true;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    set(...where(e));
    banner.classList.add("hc-on");
    kick();
  });
  banner.addEventListener("pointermove", (e) => {
    if (!touching && e.pointerType === "touch") return;
    touching = true;
    set(...where(e));
    banner.classList.add("hc-on");
    kick();
  });
  const end = (e) => {
    const tap = down && e.type === "pointerup" && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 450;
    down = null;
    touching = false;
    banner.classList.remove("hc-on");
    if (tap) {
      flipT += 180;
      haptic("medium");
      banner.classList.toggle("hc-flipped", Math.round(flipT / 180) % 2 === 1);
    }
    kick();
  };
  banner.addEventListener("pointerup", end);
  banner.addEventListener("pointercancel", end);
  banner.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") end(e); });

  const stop = gyro((beta, gamma) => {
    if (!banner.isConnected) { stop(); return; }
    gx = Math.max(-MAX, Math.min(MAX, -beta * 0.5));
    gy = Math.max(-MAX, Math.min(MAX, gamma * 0.6));
    kick();
  });
  whenGone(banner, () => { stop(); if (raf) cancelAnimationFrame(raf); });
  return banner;
}
