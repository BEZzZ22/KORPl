// Три Аегиса Spirit v2: the approved cut, with more motion (light rays, embers, speed lines, glitch hits,
// metallic type). 120 BPM, 44 beats. 3-D: common/sets/aegis.js (the app's own Aegis), common/sets/phone.js.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { aegisSet } from '../common/sets/aegis.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, ring, font } = M;
const { C, D, UI, S, CX, line, pill, glow, bands, rays, sparks, speed, glitch, flash, background } = K;

const HITS = [
  [0, 'hook: SPIRIT', 'impact'],
  [0.5, 'первые в истории', 'pop', { pitch: 'C#6' }],
  [1, 'С ТРЕМЯ АЕГИСАМИ', 'pop', { pitch: 'F#6' }],
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
  ...K.botHits(24),
  [30, 'YATORO', 'impact'],
  [31, 'COLLAPSE', 'thud'],
  [32, 'первые игроки', 'pop', { pitch: 'A5' }],
  [36, 'end: четвёртый?', 'impact'],
  [38, 'пиши в комменты', 'pop', { pitch: 'C#6' }],
  [40, 'bot pill', 'bell', { pitch: 'F#6' }],
];

const LAND = [4, 8, 12];
const YEAR = ['2021', '2023', '2026'];
const WHERE = ['TI10 · БУХАРЕСТ', 'TI12 · СИЭТЛ', 'TI 2026 · ШАНХАЙ'];
let AEGIS = null, PHONE = null;

function shields(u, t, spinAll = null) {
  return [0, 1, 2].map((i) => {
    const slot = AEGIS.SLOT[i], L = LAND[i];
    let y, ry, rx = 0, vis = true;
    if (i === 0) {
      ry = 0.9 * Math.exp(-(u + 0.5) * 0.8) * Math.cos(2.4 * (u + 0.5));
      const lift = E.outCubic(prog(u, 2.6, 3.5)) * 0.35 - E.inQuad(prog(u, 3.5, 4)) * 0.35;
      y = slot + 0.25 + lift - 0.25 * prog(u, 3.5, 4);
    } else {
      const p = E.inQuad(prog(u, L - 0.8, L));
      vis = u >= L - 0.8;
      y = slot + 3.6 * (1 - p);
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

// ---------------------------------------------------------------- hook + three drops (u 0..16)
function sceneAegis(ctx, u, t) {
  const cam = springKeys(u, CAM_KEYS, SPRING.gentle);
  const roll = 0.05 * Math.sin(u * 0.4) + 0.04 * ring(u - 12, 1.2, 2);
  const sh = shields(u, t);
  AEGIS.update(t, u, { cam, shields: sh, roll });
  const fi = u < 6 ? 0 : u < 10 ? 1 : 2;
  const [fx, fy] = AEGIS.project(0, sh[fi].y, 0);
  const pulse = LAND.reduce((a, L) => a + 0.35 * Math.exp(-Math.max(0, u - L) * 1.6) * (u >= L ? 1 : 0), 0);
  const gx = u < 13.6 ? fx : CX, gy = u < 13.6 ? fy : H * 0.5;
  background(ctx, u, gx, gy, 0.16 + pulse * 0.6);
  rays(ctx, gx, gy, u, 0.25 + pulse * 0.9 + (u > 13.6 ? 0.2 : 0), 16);
  // speed lines while an Aegis falls
  speed(ctx, u, Math.max(M.bump(u, 7.6, 0.5), M.bump(u, 11.6, 0.5)), -1);
  G.renderSet(ctx, AEGIS, t, u, { cam, shields: sh, roll });
  for (let i = 0; i < 3; i++) {
    const [sx, sy] = AEGIS.project(0, AEGIS.SLOT[i] - 0.85, 0);
    sparks(ctx, sx, sy, u, LAND[i], i === 2 ? 70 : 44, 3 + i, { up: true, spread: 2.4, speed: i === 2 ? 1900 : 1400 });
  }

  line(ctx, 'SPIRIT', CX, S.y + 170, 200, C.text, u, -0.7, 3.5, { stagger: 0.04, rot: -0.4 });
  line(ctx, 'ПЕРВЫЕ В ИСТОРИИ', CX, S.y + 270, 70, C.text, u, 0.5, 3.55, { weight: 800, track: 0 });
  line(ctx, 'С ТРЕМЯ АЕГИСАМИ', CX, S.y + 385, 108, 'GOLD', u, 1, 3.6, { stagger: 0.025, rot: 0.3 });

  for (let i = 0; i < 3; i++) {
    const L = LAND[i], end = i < 2 ? LAND[i + 1] - 1.1 : 13.4;
    if (u < L - 0.1 || u > end + 0.6) continue;
    line(ctx, `АЕГИС ${i + 1} / 3`, CX, S.y + 70, 64, C.gold, u, L - 0.05, end, { face: UI, weight: 800, track: 0.12, stagger: 0.015 });
    line(ctx, YEAR[i], CX, S.y + 270, 220, 'GOLD', u, L, end, { from: 1.9, spring: SPRING.snappy, stagger: 0.05, rot: 0.25 });
    line(ctx, WHERE[i], CX, S.y + 350, 46, C.muted, u, L + 0.3, end, { face: UI, weight: 700, track: 0.06, stagger: 0.012 });
  }
  if (u > 13.6) bands(ctx, 520, 1250, prog(u, 13.6, 14));
  line(ctx, 'ТАКОГО НЕ БЫЛО', CX, S.y + 110, K.fit(ctx, 'ТАКОГО НЕ БЫЛО', 104), C.text, u, 14, 15.7, { stagger: 0.02 });
  line(ctx, 'НИ У ОДНОЙ КОМАНДЫ', CX, S.y + S.h - 20, 76, 'GOLD', u, 14.5, 15.75, { stagger: 0.018 });
}

// ---------------------------------------------------------------- the final (u 16..24)
function sceneFinal(ctx, u, t) {
  background(ctx, u, CX, H * 0.42, 0.1);
  const orbit = (u - 16) * 0.07;
  G.renderSet(ctx, AEGIS, t, u, { cam: [7 * Math.sin(orbit + 0.5), 0.6, 11 * Math.cos(orbit + 0.5), 0, 0.2, 0], shields: shields(u, t), light: 0.5 });
  ctx.fillStyle = 'rgba(9,9,11,0.72)'; ctx.fillRect(0, 0, W, H);
  const up = springU(u, 19.6, SPRING.gentle);
  const by = lerp(H * 0.40, S.y + 330, up), sc = lerp(1, 0.55, up);
  rays(ctx, CX - 230 * sc, by + 20, u, 0.5 * Math.exp(-Math.max(0, u - 17) * 0.8) * (u >= 17 ? 1 : 0), 12);
  line(ctx, 'ФИНАЛ TI 2026', CX, lerp(H * 0.40 - 360, S.y + 50, up), 60, C.gold, u, 16, 23.6, { face: UI, weight: 800, track: 0.12, stagger: 0.015 });
  line(ctx, 'ШАНХАЙ · 23 АВГУСТА', CX, lerp(H * 0.40 - 290, S.y + 105, up), 42, C.muted, u, 16.3, 23.6, { face: UI, weight: 600, track: 0.06, stagger: 0.01 });
  ctx.save(); ctx.translate(CX, by); ctx.scale(sc, sc); ctx.translate(-CX, -by);
  line(ctx, '3', CX - 230, by + 130, 400, 'GOLD', u, 17, 23.6, { from: 2.2, spring: SPRING.snappy, rot: -0.5 });
  line(ctx, ':', CX, by + 100, 260, C.muted, u, 17.25, 23.6);
  line(ctx, '2', CX + 230, by + 130, 400, C.text, u, 17.5, 23.6, { from: 2.2, spring: SPRING.snappy, rot: 0.5 });
  line(ctx, 'SPIRIT', CX - 230, by + 230, 64, C.gold, u, 17.1, 23.6, { face: UI, weight: 800, track: 0.08 });
  line(ctx, 'VISION', CX + 230, by + 230, 64, C.muted, u, 17.6, 23.6, { face: UI, weight: 800, track: 0.08 });
  ctx.restore();
  sparks(ctx, CX - 230, by + 20, u, 17, 36, 8, { spread: Math.PI * 2, speed: 1200 });

  line(ctx, 'ПЯТАЯ КАРТА ШЛА', CX, H * 0.47 - 110, 72, C.text, u, 20, 23.6, { stagger: 0.02 });
  const n = Math.round(64 * E.outExpo(prog(u, 20.2, 21.95)));
  if (u >= 20.15) {
    const k = springU(u, 20.15, SPRING.snappy), land = 0.12 * wobble(u - 22, 2.5, 4);
    const ex = E.inBack(prog(u, 23.6, 23.95), 1.6);
    const cy = H * 0.47 + 370 - ex * 900;
    rays(ctx, CX, cy - 180, u, 0.6 * clamp((u - 21.9) * 3) * (1 - ex), 18);
    ctx.save(); ctx.translate(CX, cy); ctx.scale(k * (1 + land), k * (1 - land));
    glow(ctx, 0, -150, 520, 0.25 * clamp((u - 21.9) * 3) * (1 - ex));
    ctx.textAlign = 'center'; ctx.font = font(520, 900, D); ctx.letterSpacing = '-20px';
    const g = ctx.createLinearGradient(0, -400, 0, 20);
    g.addColorStop(0, '#fff3cf'); g.addColorStop(0.45, '#f0c86a'); g.addColorStop(0.55, '#c8913a'); g.addColorStop(1, '#f6d58a');
    ctx.fillStyle = g; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 50;
    ctx.fillText(String(n), 0, 0); ctx.letterSpacing = '0px';
    ctx.restore();
    sparks(ctx, CX, cy - 180, u, 22, 60, 12, { speed: 1700 });
  }
  line(ctx, 'МИНУТЫ', CX, H * 0.47 + 480, 92, C.text, u, 22, 23.65, { stagger: 0.03 });
  line(ctx, 'Vision вели — Spirit вырвали', CX, S.y + S.h - 20, 46, C.muted, u, 22.5, 23.7, { face: UI, weight: 600, track: 0, stagger: 0.008 });
}

// ---------------------------------------------------------------- the players (u 30..36)
function sceneNames(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.12);
  const a = (u - 30) * 0.1;
  G.renderSet(ctx, AEGIS, t, u, { cam: [6 * Math.sin(-a - 0.4), -0.6, 9 * Math.cos(-a - 0.4), 0, 0.2, 0], shields: shields(u, t), light: 0.6 });
  ctx.fillStyle = 'rgba(9,9,11,0.6)'; ctx.fillRect(0, 0, W, H);
  rays(ctx, CX, H * 0.42, u, 0.3, 14);
  speed(ctx, u, 0.5 * Math.exp(-(u - 30) * 1.2), 1);
  const pushIn = 1 + 0.03 * (u - 30);
  ctx.save(); M.zoomAbout(ctx, pushIn, CX, H * 0.45);
  const s1 = K.fit(ctx, 'YATORO', 230), s2 = K.fit(ctx, 'COLLAPSE', 230);
  line(ctx, 'YATORO', CX, H * 0.36, s1, C.text, u, 29.8, 35.6, { from: 1.8, spring: SPRING.snappy, stagger: 0.025, rot: -0.3 });
  line(ctx, 'И', CX, H * 0.36 + 120, 70, C.muted, u, 30.6, 35.6);
  line(ctx, 'COLLAPSE', CX, H * 0.36 + 120 + s2 * 0.95, s2, C.text, u, 31, 35.6, { from: 1.8, spring: SPRING.snappy, stagger: 0.025, rot: 0.3 });
  ctx.restore();
  line(ctx, 'ПЕРВЫЕ ИГРОКИ В ДОТЕ', CX, H * 0.36 + 470, 64, 'GOLD', u, 32, 35.65, { stagger: 0.015 });
  line(ctx, 'С ТРЕМЯ АЕГИСАМИ', CX, H * 0.36 + 550, 64, 'GOLD', u, 32.3, 35.7, { stagger: 0.015 });
  line(ctx, 'Larl · not me · rue · тренер Miposhka', CX, S.y + S.h - 10, 40, C.muted, u, 33.5, 35.7, { face: UI, weight: 600, track: 0, stagger: 0.006 });
}

// ---------------------------------------------------------------- end card (u 36..44)
function sceneEnd(ctx, u, t) {
  const pull = E.outCubic(prog(u, 36, 44));
  background(ctx, u, CX, H * 0.52, 0.22 + 0.4 * Math.exp(-(u - 36) * 1.5));
  rays(ctx, CX, H * 0.5, u, 0.55, 18);
  const spin = (i) => E.inOutCubic(prog(u, 36 + i * 0.4, 39 + i * 0.4)) * Math.PI * 2;
  G.renderSet(ctx, AEGIS, t, u, { cam: [0.3, 0.2, lerp(10.8, 12, pull), 0, 0.15, 0], shields: shields(u, t, spin), light: 1.1 });
  sparks(ctx, CX, H * 0.5, u, 36, 70, 21, { speed: 1800 });
  bands(ctx, 500, 1250);
  line(ctx, 'БУДЕТ', CX, S.y + 70, 100, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'ЧЕТВЁРТЫЙ?', CX, S.y + 190, 130, 'GOLD', u, 36.5, null, { stagger: 0.03, rot: 0.4 });
  line(ctx, 'пиши в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS,
  hits: HITS,
  samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    [AEGIS, PHONE] = await Promise.all([aegisSet(3), phoneSet(['review', 'killers'])]);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 26], [4, 18], [8, 18], [12, 34], [17, 12], [17.5, 12], [22, 14], [30, 22], [31, 16], [36, 26]]) M.shake(ctx, u, b, amp);
    if (u < 16) sceneAegis(ctx, u, t);
    else if (u < 24) sceneFinal(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24);
    else if (u < 36) sceneNames(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 12, 0.45); flash(ctx, u, 36, 0.35);
    for (const b of [0, 12, 30, 36]) glitch(ctx, u, b, 46);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
