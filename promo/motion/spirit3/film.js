// Три Аегиса Spirit: pure function of time. window.seek(t) paints frame t (lib/motion.js).
// 120 BPM, 44 beats. Plan: docs/shotlist.md. 3-D: sets/aegis.js (the app's own Aegis), sets/phone.js (real bot screens).
import * as M from './lib/motion.js';
import * as G from './lib/gl.js';
import { aegisSet } from './sets/aegis.js';
import { phoneSet } from './sets/phone.js';

const { W, H, FORMAT, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, ring, font, layout, glyph, text, fill, rrect, fitSize } = M;

// Brand: the app's v2 tokens (docs/v2.css). One accent: Aegis gold.
const C = { ink: '#09090b', slab: '#111113', text: '#f4f4f5', muted: '#8d8d96', gold: '#e6b858' };
const D = 'Display', UI = 'UI';
const S = FORMAT.safe;
const CX = W / 2;

const HITS = [
  [0, 'hook: SPIRIT', 'impact'],
  [0.5, 'первые с тремя', 'pop', { pitch: 'C#6' }],
  [1, 'АЕГИСАМИ', 'pop', { pitch: 'F#6' }],
  [4, 'Aegis 2021 slams', 'thud'],
  [7.2, 'Aegis 2023 falls', 'whoosh', { len: 0.6, from: 2400, to: 500 }],
  [8, 'Aegis 2023 lands', 'thud'],
  [11.2, 'Aegis 2026 falls', 'whoosh', { len: 0.6, from: 2400, to: 500 }],
  [12, 'Aegis 2026 lands', 'impact'],
  [14, 'pull back: column', 'whoosh', { len: 0.5, from: 500, to: 2000 }],
  [16, 'ФИНАЛ TI 2026', 'click'],
  [17, 'score 3', 'thud'],
  [17.5, 'score 2', 'thud', { pitch: 70 }],
  [20, 'пятая карта', 'click'],
  [20.2, 'counter runs', 'type', { len: 1.6, n: 14 }],
  [22, '64 lands', 'bell', { pitch: 'F#6' }],
  [24, 'into the bot', 'whoosh', { len: 0.5 }],
  [24.6, 'phone lands', 'thud'],
  [27, 'phone flips', 'whoosh', { len: 0.45, from: 700, to: 2600 }],
  [28, '@DotaRazbor_bot', 'bell', { pitch: 'C#6' }],
  [30, 'YATORO', 'impact'],
  [31, 'COLLAPSE', 'thud'],
  [32, 'первые игроки', 'pop', { pitch: 'A5' }],
  [36, 'end: четвёртый?', 'impact'],
  [38, 'пиши в комменты', 'pop', { pitch: 'C#6' }],
  [40, 'bot pill', 'bell', { pitch: 'F#6' }],
];

// ------------------------------------------------------------------ type helpers
// One line, per-glyph spring in from below, optional exit up. Returns the line's width.
function line(ctx, str, x, y, size, color, u, uIn, uOut = null, o = {}) {
  const f = font(size, o.weight ?? 900, o.face ?? D), track = (o.track ?? -0.03) * size;
  const L = layout(ctx, str, f, track);
  const x0 = o.align === 'left' ? x : x - L.width / 2;
  const st = o.stagger ?? 0.03;
  L.glyphs.forEach((g, j) => {
    const k = springU(u, uIn + j * st, o.spring ?? SPRING.bouncy);
    if (k <= 0.001) return;
    const ex = uOut == null ? 0 : E.inBack(prog(u, uOut + j * 0.012, uOut + 0.32 + j * 0.012), 1.6);
    if (ex >= 1) return;
    ctx.save();
    ctx.globalAlpha = clamp(k * 2.5) * (1 - clamp(ex * 1.4 - 0.4));
    const sc = lerp(o.from ?? 0.5, 1, k);
    glyph(ctx, g.ch, x0 + g.cx, y + (1 - k) * size * 0.55 - ex * size * 1.4, f, color, sc, sc);
    ctx.restore();
  });
  return L.width;
}
function pill(ctx, str, cx, cy, size, u, uIn, uOut = null) {
  const k = springU(u, uIn, SPRING.bouncy);
  if (k <= 0.001) return;
  const ex = uOut == null ? 0 : E.inBack(prog(u, uOut, uOut + 0.35), 1.5);
  const f = font(size, 800, UI);
  const L = layout(ctx, str, f, 0);
  const w = L.width + size * 1.4, h = size * 1.9;
  ctx.save();
  ctx.translate(cx, cy - ex * 500); ctx.scale(lerp(0.3, 1, k), lerp(0.3, 1, k)); ctx.globalAlpha = clamp(k * 3);
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = C.gold; ctx.fill();
  ctx.textBaseline = 'middle';
  text(ctx, str, 0, size * 0.04, f, C.ink, 'center');
  ctx.restore();
}
function glow(ctx, x, y, r, a, color = '230,184,88') {
  if (a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

// darken the top and bottom so copy reads over the 3-D
function bands(ctx, top, bottom) {
  let g = ctx.createLinearGradient(0, 0, 0, top);
  g.addColorStop(0, 'rgba(9,9,11,0.92)'); g.addColorStop(0.7, 'rgba(9,9,11,0.75)'); g.addColorStop(1, 'rgba(9,9,11,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, top);
  g = ctx.createLinearGradient(0, bottom, 0, H);
  g.addColorStop(0, 'rgba(9,9,11,0)'); g.addColorStop(0.3, 'rgba(9,9,11,0.8)'); g.addColorStop(1, 'rgba(9,9,11,0.95)');
  ctx.fillStyle = g; ctx.fillRect(0, bottom, W, H - bottom);
}

// ------------------------------------------------------------------ the Aegis column
const LAND = [4, 8, 12];
const YEAR = ['2021', '2023', '2026'];
const WHERE = ['TI10 · БУХАРЕСТ', 'TI12 · СИЭТЛ', 'TI 2026 · ШАНХАЙ'];
let AEGIS = null, PHONE = null;

function shields(u, t, spinAll = 0) {
  return [0, 1, 2].map((i) => {
    const slot = AEGIS.SLOT[i], L = LAND[i];
    let y, ry, rx = 0, vis = true;
    if (i === 0) {
      // hook: hovering and spinning, settles, lifts and slams into its slot on beat 4
      ry = 0.9 * Math.exp(-(u + 0.5) * 0.8) * Math.cos(2.4 * (u + 0.5));
      const lift = E.outCubic(prog(u, 2.6, 3.5)) * 0.35 - E.inQuad(prog(u, 3.5, 4)) * 0.35;
      y = slot + 0.25 + lift - 0.25 * prog(u, 3.5, 4);
    } else {
      const p = E.inQuad(prog(u, L - 0.8, L));
      vis = u >= L - 0.8;
      y = slot + 7 * (1 - p);
      ry = (1 - p) * Math.PI * 4;
      rx = (1 - p) * 0.5;
    }
    const after = u - L;
    if (after >= 0) { y -= 0.1 * wobble(after, 2.4, 4) * (after < 2 ? 1 : 0); ry += 0.4 * ring(after, 0.9, 1.4); }
    ry += 0.16 * Math.sin(t * 1.1 + i * 2) * clamp(after);
    if (spinAll) ry += spinAll(i);
    return { y, ry, rx, rz: 0.04 * Math.sin(t * 0.8 + i), vis, ring: after >= 0 ? prog(u, L, L + 1.6) : -1 };
  });
}
const CAM_KEYS = [
  [0, [0.9, -1.55, 6.0, 0, -1.6, 0]],
  [4.2, [0.5, -1.6, 5.4, 0, -1.6, 0]],
  [6.7, [-0.8, 0.5, 6.3, 0, 0.6, 0]],
  [8.2, [-0.5, 0.5, 5.6, 0, 0.6, 0]],
  [10.7, [0.8, 2.8, 6.3, 0, 2.85, 0]],
  [13.6, [0.4, 0.3, 11.2, 0, 0.1, 0]],
];

function bg(ctx, u, gx = CX, gy = H * 0.5, a = 0.16) {
  fill(ctx, C.ink);
  glow(ctx, gx, gy, 900, a);
}

// ---------------------------------------------------------------- S1+S2 hook and three drops (u 0..16)
function sceneAegis(ctx, u, t) {
  const cam = springKeys(u, CAM_KEYS, SPRING.gentle);
  const sh = shields(u, t);
  AEGIS.update(t, u, { cam, shields: sh });  // to project; renderSet calls update again
  // focus = the Aegis the camera is on
  const fi = u < 6 ? 0 : u < 10 ? 1 : 2;
  const [fx, fy] = AEGIS.project(0, sh[fi].y, 0);
  const pulse = LAND.reduce((a, L) => a + 0.35 * Math.exp(-Math.max(0, u - L) * 1.6) * (u >= L ? 1 : 0), 0);
  bg(ctx, u, u < 13.6 ? fx : CX, u < 13.6 ? fy : H * 0.5, 0.16 + pulse * 0.6);

  G.renderSet(ctx, AEGIS, t, u, { cam, shields: sh, under: 0, light: 1 });

  // hook copy
  line(ctx, 'SPIRIT', CX, S.y + 170, 200, C.text, u, -0.7, 3.5, { stagger: 0.04 });
  line(ctx, 'ПЕРВЫЕ В ИСТОРИИ', CX, S.y + 270, 70, C.text, u, 0.5, 3.55, { face: D, weight: 800, track: 0 });
  line(ctx, 'С ТРЕМЯ АЕГИСАМИ', CX, S.y + 385, 108, C.gold, u, 1, 3.6, { stagger: 0.025 });

  // captions under each Aegis as it lands: counter + where
  for (let i = 0; i < 3; i++) {
    const L = LAND[i], end = i < 2 ? LAND[i + 1] - 1.1 : 13.4;
    if (u < L - 0.1 || u > end + 0.6) continue;
    line(ctx, `АЕГИС ${i + 1} / 3`, CX, S.y + 70, 64, C.gold, u, L - 0.05, end, { face: UI, weight: 800, track: 0.12, stagger: 0.015 });
    line(ctx, YEAR[i], CX, S.y + 270, 220, C.text, u, L, end, { from: 1.9, spring: SPRING.snappy, stagger: 0.05 });
    line(ctx, WHERE[i], CX, S.y + 350, 46, C.muted, u, L + 0.3, end, { face: UI, weight: 700, track: 0.06, stagger: 0.012 });
  }
  // the column: the claim
  if (u > 13.6) { ctx.save(); ctx.globalAlpha = prog(u, 13.6, 14); bands(ctx, 520, 1250); ctx.restore(); }
  line(ctx, 'ТАКОГО НЕ БЫЛО', CX, S.y + 110, fitSize(ctx, 'ТАКОГО НЕ БЫЛО', 900, D, S.w, 104, -0.03), C.text, u, 14, 15.7, { stagger: 0.02 });
  line(ctx, 'НИ У ОДНОЙ КОМАНДЫ', CX, S.y + S.h - 20, 76, C.gold, u, 14.5, 15.75, { stagger: 0.018 });
}

// ---------------------------------------------------------------- S3 the final (u 16..24)
function sceneFinal(ctx, u, t) {
  bg(ctx, u, CX, H * 0.42, 0.1);
  const orbit = (u - 16) * 0.07;
  G.renderSet(ctx, AEGIS, t, u, { cam: [7 * Math.sin(orbit + 0.5), 0.6, 11 * Math.cos(orbit + 0.5), 0, 0.2, 0], shields: shields(u, t),
    light: 0.5 }, );
  ctx.fillStyle = 'rgba(9,9,11,0.72)'; ctx.fillRect(0, 0, W, H);

  const up = springU(u, 19.6, SPRING.gentle);           // the scoreboard rises to make room for the 64
  const by = lerp(H * 0.40, S.y + 330, up), sc = lerp(1, 0.55, up);
  line(ctx, 'ФИНАЛ TI 2026', CX, lerp(H * 0.40 - 360, S.y + 50, up), 60, C.gold, u, 16, 23.6, { face: UI, weight: 800, track: 0.12, stagger: 0.015 });
  line(ctx, 'ШАНХАЙ · 23 АВГУСТА', CX, lerp(H * 0.40 - 290, S.y + 105, up), 42, C.muted, u, 16.3, 23.6, { face: UI, weight: 600, track: 0.06, stagger: 0.01 });
  ctx.save(); ctx.translate(CX, by); ctx.scale(sc, sc); ctx.translate(-CX, -by);
  line(ctx, '3', CX - 230, by + 130, 400, C.gold, u, 17, 23.6, { from: 2.2, spring: SPRING.snappy });
  line(ctx, ':', CX, by + 100, 260, C.muted, u, 17.25, 23.6);
  line(ctx, '2', CX + 230, by + 130, 400, C.text, u, 17.5, 23.6, { from: 2.2, spring: SPRING.snappy });
  line(ctx, 'SPIRIT', CX - 230, by + 230, 64, C.gold, u, 17.1, 23.6, { face: UI, weight: 800, track: 0.08 });
  line(ctx, 'VISION', CX + 230, by + 230, 64, C.muted, u, 17.6, 23.6, { face: UI, weight: 800, track: 0.08 });
  ctx.restore();

  line(ctx, 'ПЯТАЯ КАРТА ШЛА', CX, H * 0.47 - 110, 72, C.text, u, 20, 23.6, { stagger: 0.02 });
  const n = Math.round(64 * E.outExpo(prog(u, 20.2, 21.95)));
  if (u >= 20.15) {
    const k = springU(u, 20.15, SPRING.snappy), land = 0.12 * wobble(u - 22, 2.5, 4);
    const ex = E.inBack(prog(u, 23.6, 23.95), 1.6);
    ctx.save(); ctx.translate(CX, H * 0.47 + 370 - ex * 900); ctx.scale(k * (1 + land), k * (1 - land));
    glow(ctx, 0, -150, 520, 0.25 * clamp((u - 21.9) * 3) * (1 - ex));
    ctx.textAlign = 'center'; ctx.font = font(520, 900, D); ctx.letterSpacing = '-20px'; ctx.fillStyle = C.gold;
    ctx.fillText(String(n), 0, 0); ctx.letterSpacing = '0px';
    ctx.restore();
  }
  line(ctx, 'МИНУТЫ', CX, H * 0.47 + 480, 92, C.text, u, 22, 23.65, { stagger: 0.03 });
  line(ctx, 'Vision вели — Spirit вырвали', CX, S.y + S.h - 20, 46, C.muted, u, 22.5, 23.7, { face: UI, weight: 600, track: 0, stagger: 0.008 });
}

// ---------------------------------------------------------------- S4 the bot (u 24..30)
function sceneBot(ctx, u, t) {
  bg(ctx, u, CX, H * 0.62, 0.2);
  const k = springU(u, 23.9, { stiffness: 140, damping: 15 });
  const flip = E.inOutCubic(prog(u, 26.6, 27.4));
  const exit = E.inBack(prog(u, 29.55, 30), 1.4);
  const pos = [0, lerp(-9, -0.55, k) + exit * 9, 0];
  const rot = [lerp(-0.9, -0.08, k) + 0.05 * Math.sin(t * 1.2), lerp(-1.4, -0.22, k) + 0.18 * Math.sin(t * 0.9) + flip * Math.PI * 2, lerp(0.4, 0.04, k)];
  G.renderSet(ctx, PHONE, t, u, { cam: [0, 0.2, 12.5], pos, rot, screen: flip > 0.5 ? 1 : 0 });
  line(ctx, 'А ТВОЯ КАТКА', CX, S.y + 70, 110, C.text, u, 23.75, 29.5, { stagger: 0.02 });
  line(ctx, 'НА СКОЛЬКО ТЯНЕТ?', CX, S.y + 175, 86, C.gold, u, 24.4, 29.55, { stagger: 0.02 });
  if (u >= 27.8) { ctx.save(); ctx.globalAlpha = prog(u, 27.8, 28.2) * (1 - prog(u, 29.6, 30)); bands(ctx, 1, 1150); ctx.restore(); }
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 110, 64, u, 28, 29.6);
  line(ctx, 'кинь матч — разберёт, кто слил', CX, S.y + S.h + 10, 44, C.text, u, 28.4, 29.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

// ---------------------------------------------------------------- S5 the players (u 30..36)
function sceneNames(ctx, u, t) {
  bg(ctx, u, CX, H * 0.5, 0.12);
  const a = (u - 30) * 0.1;
  G.renderSet(ctx, AEGIS, t, u, { cam: [6 * Math.sin(-a - 0.4), -0.6, 9 * Math.cos(-a - 0.4), 0, 0.2, 0], shields: shields(u, t), light: 0.6 });
  ctx.fillStyle = 'rgba(9,9,11,0.6)'; ctx.fillRect(0, 0, W, H);
  const pushIn = 1 + 0.03 * (u - 30);
  ctx.save(); M.zoomAbout(ctx, pushIn, CX, H * 0.45);
  const s1 = fitSize(ctx, 'YATORO', 900, D, S.w, 230, -0.03), s2 = fitSize(ctx, 'COLLAPSE', 900, D, S.w, 230, -0.03);
  line(ctx, 'YATORO', CX, H * 0.36, s1, C.text, u, 29.8, 35.6, { from: 1.8, spring: SPRING.snappy, stagger: 0.025 });
  line(ctx, 'И', CX, H * 0.36 + 120, 70, C.muted, u, 30.6, 35.6);
  line(ctx, 'COLLAPSE', CX, H * 0.36 + 120 + s2 * 0.95, s2, C.text, u, 31, 35.6, { from: 1.8, spring: SPRING.snappy, stagger: 0.025 });
  ctx.restore();
  line(ctx, 'ПЕРВЫЕ ИГРОКИ В ДОТЕ', CX, H * 0.36 + 470, 64, C.gold, u, 32, 35.65, { stagger: 0.015 });
  line(ctx, 'С ТРЕМЯ АЕГИСАМИ', CX, H * 0.36 + 550, 64, C.gold, u, 32.3, 35.7, { stagger: 0.015 });
  line(ctx, 'Larl · not me · rue · тренер Miposhka', CX, S.y + S.h - 10, 40, C.muted, u, 33.5, 35.7, { face: UI, weight: 600, track: 0, stagger: 0.006 });
}

// ---------------------------------------------------------------- S6 end card (u 36..44)
function sceneEnd(ctx, u, t) {
  const pull = E.outCubic(prog(u, 36, 44));
  bg(ctx, u, CX, H * 0.52, 0.22 + 0.4 * Math.exp(-(u - 36) * 1.5));
  const spin = (i) => E.inOutCubic(prog(u, 36 + i * 0.4, 39 + i * 0.4)) * Math.PI * 2;
  G.renderSet(ctx, AEGIS, t, u, { cam: [0.3, 0.2, lerp(10.8, 12, pull), 0, 0.15, 0], shields: shields(u, t, spin), light: 1.1 });
  bands(ctx, 500, 1250);
  line(ctx, 'БУДЕТ', CX, S.y + 70, 100, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'ЧЕТВЁРТЫЙ?', CX, S.y + 190, 130, C.gold, u, 36.5, null, { stagger: 0.03 });
  line(ctx, 'пиши в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: [font(100, 900, D), font(100, 800, D), font(40, 600, UI), font(40, 700, UI), font(40, 800, UI)],
  hits: HITS,
  samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    [AEGIS, PHONE] = await Promise.all([aegisSet(), phoneSet()]);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 26], [4, 18], [8, 18], [12, 30], [17, 10], [17.5, 10], [30, 22], [36, 26]]) M.shake(ctx, u, b, amp);
    if (u < 16) sceneAegis(ctx, u, t);
    else if (u < 24) sceneFinal(ctx, u, t);
    else if (u < 30) sceneBot(ctx, u, t);
    else if (u < 36) sceneNames(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    // vignette + fine grain (after the blur, so it stays crisp)
    const v = ctx.createRadialGradient(CX, H / 2, H * 0.35, CX, H / 2, H * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  },
});
