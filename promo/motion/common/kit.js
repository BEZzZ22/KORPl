// Shared look for the Dota shorts: brand tokens, kinetic type, light FX, the bot insert and the end card.
// Everything is a pure function of (u, t): seeded noise only.
import * as M from './lib/motion.js';
import * as G from './lib/gl.js';
const { W, H, FORMAT, E, prog, lerp, clamp, springU, SPRING, font, layout, glyph, text, fill, rrect, hash01, noise1 } = M;

export const C = { ink: '#09090b', slab: '#111113', text: '#f4f4f5', muted: '#8d8d96', gold: '#e6b858', red: '#f0585d', green: '#3fcf8e', blue: '#5a8fd6' };
export const D = 'Display', UI = 'UI';
export const S = FORMAT.safe;
export const CX = W / 2;
export const FONTS = [font(100, 900, D), font(100, 800, D), font(40, 600, UI), font(40, 700, UI), font(40, 800, UI)];

// metallic gold fill for a glyph drawn at baseline 0
function goldFill(ctx, size) {
  const g = ctx.createLinearGradient(0, -size * 0.78, 0, size * 0.05);
  g.addColorStop(0, '#fff3cf'); g.addColorStop(0.45, '#f0c86a'); g.addColorStop(0.55, '#c8913a'); g.addColorStop(1, '#f6d58a');
  return g;
}

// One line of type, per-glyph spring in, optional exit. color 'GOLD' = metallic gradient.
// o: align, face, weight, track, stagger, spring, from (start scale), rise (px), rot (start rotation), shadow
export function line(ctx, str, x, y, size, color, u, uIn, uOut = null, o = {}) {
  const f = font(size, o.weight ?? 900, o.face ?? D), track = (o.track ?? -0.03) * size;
  const L = layout(ctx, str, f, track);
  const x0 = o.align === 'left' ? x : o.align === 'right' ? x - L.width : x - L.width / 2;
  const st = o.stagger ?? 0.03;
  L.glyphs.forEach((g, j) => {
    const k = springU(u, uIn + j * st, o.spring ?? SPRING.bouncy);
    if (k <= 0.001) return;
    const ex = uOut == null ? 0 : E.inBack(prog(u, uOut + j * 0.012, uOut + 0.32 + j * 0.012), 1.6);
    if (ex >= 1) return;
    ctx.save();
    ctx.globalAlpha = clamp(k * 2.5) * (1 - clamp(ex * 1.4 - 0.4)) * (o.alpha ?? 1);
    const sc = lerp(o.from ?? 0.5, 1, k);
    const gx = x0 + g.cx, gy = y + (1 - k) * (o.rise ?? size * 0.55) - ex * size * 1.4;
    if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.04; }
    ctx.translate(gx, gy); ctx.rotate((1 - k) * (o.rot ?? 0)); ctx.scale(sc, sc);
    ctx.font = f; ctx.textAlign = 'center';
    ctx.fillStyle = color === 'GOLD' ? goldFill(ctx, size) : color;
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  });
  return L.width;
}
export const fit = (ctx, str, max, w = S.w, weight = 900, face = D) => M.fitSize(ctx, str, weight, face, w, max, -0.03);

// a short label in a gold (or any) pill
export function pill(ctx, str, cx, cy, size, u, uIn, uOut = null, o = {}) {
  const k = springU(u, uIn, SPRING.bouncy);
  if (k <= 0.001) return;
  const ex = uOut == null ? 0 : E.inBack(prog(u, uOut, uOut + 0.35), 1.5);
  const f = font(size, 800, UI);
  const L = layout(ctx, str, f, 0);
  const w = L.width + size * 1.4, h = size * 1.9;
  ctx.save();
  ctx.translate(cx, cy - ex * 500); ctx.rotate((1 - k) * 0.3); ctx.scale(lerp(0.3, 1, k), lerp(0.3, 1, k)); ctx.globalAlpha = clamp(k * 3);
  ctx.shadowColor = 'rgba(230,184,88,0.45)'; ctx.shadowBlur = 40;
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = o.bg || C.gold; ctx.fill();
  ctx.shadowBlur = 0;
  // a light sweep across the pill
  const sw = ((u * 0.5) % 2) - 0.5;
  ctx.save(); rrect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.clip();
  const gr = ctx.createLinearGradient(-w / 2 + sw * w - 120, 0, -w / 2 + sw * w + 120, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  ctx.textBaseline = 'middle';
  text(ctx, str, 0, size * 0.04, f, o.color || C.ink, 'center');
  ctx.restore();
}
// a rounded card with a label (lists, tiers)
export function card(ctx, x, y, w, h, u, uIn, uOut, draw, o = {}) {
  const k = springU(u, uIn, o.spring || SPRING.snappy);
  if (k <= 0.001) return;
  const ex = uOut == null ? 0 : E.inBack(prog(u, uOut, uOut + 0.35), 1.5);
  ctx.save();
  ctx.translate(x + w / 2 + (1 - k) * (o.fromX ?? 0) - ex * (o.exitX ?? 0), y + h / 2 + (1 - k) * (o.fromY ?? 140) - ex * (o.exitY ?? 900));
  ctx.rotate((1 - k) * (o.rot ?? 0.12)); ctx.scale(lerp(0.6, 1, k), lerp(0.6, 1, k));
  ctx.globalAlpha = clamp(k * 2.5);
  rrect(ctx, -w / 2, -h / 2, w, h, o.r ?? 28);
  ctx.fillStyle = o.bg || 'rgba(17,17,19,0.92)'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = o.stroke || 'rgba(230,184,88,0.35)'; ctx.stroke();
  draw(ctx, w, h, k);
  ctx.restore();
}

export function glow(ctx, x, y, r, a, color = '230,184,88') {
  if (a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${Math.min(1, a)})`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}
// darken the top and bottom so copy reads over the 3-D
export function bands(ctx, top, bottom, a = 1) {
  ctx.save(); ctx.globalAlpha = a;
  if (top > 0) { const g = ctx.createLinearGradient(0, 0, 0, top);
    g.addColorStop(0, 'rgba(9,9,11,0.92)'); g.addColorStop(0.7, 'rgba(9,9,11,0.75)'); g.addColorStop(1, 'rgba(9,9,11,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, top); }
  if (bottom < H) { const g = ctx.createLinearGradient(0, bottom, 0, H);
    g.addColorStop(0, 'rgba(9,9,11,0)'); g.addColorStop(0.3, 'rgba(9,9,11,0.8)'); g.addColorStop(1, 'rgba(9,9,11,0.95)');
    ctx.fillStyle = g; ctx.fillRect(0, bottom, W, H - bottom); }
  ctx.restore();
}

// ------------------------------------------------------------------ FX
// slow rotating light beams from a point (behind a hero object)
export function rays(ctx, x, y, u, a, n = 14, color = '255,214,140', len = 1400) {
  if (a <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * M.TAU + u * 0.06 + hash01(i, 7) * 0.3;
    const wdt = 0.04 + hash01(i, 3) * 0.06, aa = a * (0.35 + 0.65 * hash01(i, 5)) * (0.7 + 0.3 * Math.sin(u * 1.3 + i));
    const g = ctx.createRadialGradient(x, y, 0, x, y, len);
    g.addColorStop(0, `rgba(${color},${aa * 0.5})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y);
    ctx.arc(x, y, len, ang - wdt, ang + wdt); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
// embers thrown from an impact at beat u0: streaks along their velocity, gravity, fade
export function sparks(ctx, x, y, u, u0, n = 46, seed = 1, o = {}) {
  const tt = (u - u0) * M.GRID.period;
  if (tt < 0 || tt > 1.6) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const r1 = hash01(i, seed), r2 = hash01(i, seed + 11), r3 = hash01(i, seed + 23);
    const ang = (o.up ? -Math.PI / 2 : 0) + (r1 - 0.5) * (o.spread ?? Math.PI * 2);
    const sp = (o.speed ?? 1500) * (0.35 + r2 * 0.9), life = 0.5 + r3 * 0.9;
    if (tt > life) continue;
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp, gg = o.gravity ?? 1400;
    const px = x + vx * tt, py = y + vy * tt + 0.5 * gg * tt * tt;
    const dvx = vx, dvy = vy + gg * tt, dl = 0.035;
    const fade = (1 - tt / life) ** 1.4;
    ctx.strokeStyle = `rgba(255,${190 + r2 * 60 | 0},${110 + r3 * 80 | 0},${fade})`;
    ctx.lineWidth = 2 + r3 * 4;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - dvx * dl, py - dvy * dl); ctx.stroke();
  }
  ctx.restore();
}
// dust motes drifting in depth (parallax by layer)
export function dust(ctx, u, a = 0.5, n = 60, seed = 4) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const z = 0.3 + hash01(i, seed) * 0.7, r = 1 + z * 3.5;
    const x = (hash01(i, seed + 1) * W + noise1(u * 0.1 + i, 3) * 60) % W;
    const y = ((hash01(i, seed + 2) * H - u * 22 * z) % H + H) % H;
    ctx.fillStyle = `rgba(255,220,160,${a * z * (0.5 + 0.5 * Math.sin(u + i))})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, M.TAU); ctx.fill();
  }
  ctx.restore();
}
// speed lines while something moves fast (vertical by default)
export function speed(ctx, u, a, dir = 1, seed = 9) {
  if (a <= 0.01) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const x = hash01(i, seed) * W, len = 200 + hash01(i, seed + 1) * 600;
    const y = ((hash01(i, seed + 2) * H * 1.5 + dir * u * 900) % (H * 1.5) + H * 1.5) % (H * 1.5) - len;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, 'rgba(255,230,180,0)'); g.addColorStop(0.5, `rgba(255,230,180,${a * 0.35})`); g.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, 2 + hash01(i, 4) * 3, len);
  }
  ctx.restore();
}
// RGB-split slice glitch for a few frames after an accent (call in post)
export function glitch(ctx, u, u0, amp = 40, dur = 0.45, seed = 2) {
  const p = (u - u0) / dur;
  if (p < 0 || p > 1) return;
  const a = amp * (1 - p) ** 2, fr = Math.floor(u * 30);
  for (let i = 0; i < 7; i++) {
    const y = hash01(i + fr * 13, seed) * H, h = 20 + hash01(i + fr, seed + 1) * 140;
    const dx = (hash01(i + fr * 7, seed + 2) - 0.5) * 2 * a;
    ctx.drawImage(ctx.canvas, 0, y, W, h, dx, y, W, h);
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 * (1 - p);
  ctx.drawImage(ctx.canvas, a * 0.4, 0); ctx.restore();
}
// short gold/white wash on a structural hit
export function flash(ctx, u, u0, a = 0.6, color = '255,240,210') {
  const p = (u - u0) / 0.35;
  if (p < 0 || p > 1) return;
  ctx.fillStyle = `rgba(${color},${a * (1 - p) ** 2})`; ctx.fillRect(0, 0, W, H);
}
export function background(ctx, u, gx = CX, gy = H * 0.5, a = 0.16, o = {}) {
  fill(ctx, C.ink);
  // faint hex grid drifting for depth
  ctx.save(); ctx.globalAlpha = o.grid ?? 0.06; ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5;
  const s = 90, off = (u * 6) % (s * 1.5);
  for (let r = -2; r < H / (s * 0.866) + 2; r++) for (let c = -1; c < W / (s * 1.5) + 2; c++) {
    const x = c * s * 1.5 + (r % 2 ? s * 0.75 : 0), y = r * s * 0.866 - off;
    ctx.beginPath(); for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3; ctx.lineTo(x + s * 0.48 * Math.cos(an), y + s * 0.48 * Math.sin(an)); } ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
  glow(ctx, gx, gy, 950, a, o.color);
  dust(ctx, u, 0.45);
}
export function vignette(ctx) {
  const v = ctx.createRadialGradient(CX, H / 2, H * 0.35, CX, H / 2, H * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}
export function grain(ctx, u, a = 0.05) {
  const fr = Math.floor(u * 15);
  ctx.save(); ctx.globalAlpha = a;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = hash01(i, fr) > 0.5 ? '#fff' : '#000';
    ctx.fillRect(hash01(i, fr + 1) * W, hash01(i, fr + 2) * H, 2, 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ the bot insert (u0 .. u0+6)
// The phone flies in with a real screen, flips to a second screen, the bot handle lands.
export function botInsert(ctx, u, t, PHONE, u0, o = {}) {
  background(ctx, u, CX, H * 0.62, 0.22);
  const k = springU(u, u0 - 0.1, { stiffness: 140, damping: 15 });
  const flip = E.inOutCubic(prog(u, u0 + 2.6, u0 + 3.4));
  const exit = E.inBack(prog(u, u0 + 5.55, u0 + 6), 1.4);
  const pos = [lerp(3, 0, k), lerp(-9, -0.55, k) + exit * 9, 0];
  const rot = [lerp(-0.9, -0.08, k) + 0.05 * Math.sin(t * 1.2), lerp(-1.4, -0.22, k) + 0.18 * Math.sin(t * 0.9) + flip * Math.PI * 2, lerp(0.4, 0.04, k)];
  const [px, py] = [CX, H * 0.6];
  rays(ctx, px, py, u, 0.35 * k * (1 - exit), 16);
  G.renderSet(ctx, PHONE, t, u, { cam: [0, 0.2, 12.5], pos, rot, screen: flip > 0.5 ? (o.screen2 ?? 1) : (o.screen1 ?? 0) });
  sparks(ctx, CX, H * 0.62, u, u0 + 0.6, 30, 5, { up: true, spread: 1.6, speed: 1300 });
  line(ctx, o.l1 || 'А ТВОЯ КАТКА', CX, S.y + 70, fit(ctx, o.l1 || 'А ТВОЯ КАТКА', 110), C.text, u, u0 - 0.25, u0 + 5.5, { stagger: 0.02 });
  line(ctx, o.l2 || 'НА СКОЛЬКО ТЯНЕТ?', CX, S.y + 175, fit(ctx, o.l2 || 'НА СКОЛЬКО ТЯНЕТ?', 86), 'GOLD', u, u0 + 0.4, u0 + 5.55, { stagger: 0.02 });
  if (u >= u0 + 3.8) bands(ctx, 0, 1150, prog(u, u0 + 3.8, u0 + 4.2) * (1 - prog(u, u0 + 5.6, u0 + 6)));
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 110, 64, u, u0 + 4, u0 + 5.6);
  line(ctx, o.l3 || 'кинь матч — разберёт, кто слил', CX, S.y + S.h + 10, 44, C.text, u, u0 + 4.4, u0 + 5.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}
export const botHits = (u0) => [[u0, 'into the bot', 'whoosh', { len: 0.5 }], [u0 + 0.6, 'phone lands', 'thud'],
  [u0 + 3, 'phone flips', 'whoosh', { len: 0.45, from: 700, to: 2600 }], [u0 + 4, '@DotaRazbor_bot', 'bell', { pitch: 'C#6' }]];
