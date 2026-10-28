// 10 000 часов в Доте — это сколько? Золотое 3-D «10000», счётчики, сетки дней и каток, которые
// заполняются на глазах. Только арифметика: 10 000 / 24 = 416 дней, 10 000 * 60 / 40 = 15 000 каток. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD, RED } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, text, hash01 } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

const HITS = [
  [0, 'hook', 'impact'], [0.6, '10000', 'thud'], [1.6, 'это сколько', 'pop', { pitch: 'C6' }],
  [4, 'дни', 'impact'], [4.6, 'roll', 'type', { len: 3, n: 30 }], [8, '416', 'impact'], [9, 'без сна', 'pop', { pitch: 'G5' }],
  [12, 'катки', 'impact'], [12.6, 'roll', 'type', { len: 3, n: 30 }], [16, '15000', 'impact'], [17, 'по 40 минут', 'pop', { pitch: 'G5' }],
  [20, '4 часа', 'impact'], [21, '7 лет', 'thud'], [22, 'лет', 'pop', { pitch: 'C6' }],
  ...K.botHits(24),
  [30, 'не титан', 'impact'], [31.5, 'strike', 'whoosh', { len: 0.4 }], [32, 'crack', 'thud'], [33.5, 'если', 'pop', { pitch: 'D#6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'G6' }], [40, 'pill', 'bell', { pitch: 'C6' }],
];

let TYPE = null, PHONE = null;
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// a counter that rolls from 0 to n between u0 and u1 (ease-out), drawn in gold
function counter(ctx, n, x, y, size, u, u0, u1, suffix = '') {
  if (u < u0 - 0.3) return;
  const v = n * E.outCubic(prog(u, u0, u1));
  const k = springU(u, u0 - 0.3, SPRING.bouncy), pop = u >= u1 ? 1 + 0.12 * wobble(u - u1, 2, 4) : 1;
  ctx.save(); ctx.translate(x, y); ctx.scale(k * pop, k * pop);
  M.text(ctx, fmt(v) + suffix, 0, 0, font(size, 900, D), C.gold, 'center');
  ctx.restore();
}

// a grid of cells that fill with p; win/loss colours when wl
function grid(ctx, cols, rows, x, y, w, p, u, u0, wl) {
  const cs = w / cols, n = cols * rows, on = Math.floor(p * n);
  for (let i = 0; i < n; i++) {
    const cx = x + (i % cols) * cs, cy = y + Math.floor(i / cols) * cs;
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
    if (i < on) {
      const fresh = clamp((on - i) / (n * 0.04));
      ctx.fillStyle = wl ? (hash01(i, 5) > 0.5 ? C.green : C.red) : C.gold;
      const s = (cs - 2) * lerp(1.6, 1, fresh);
      ctx.globalAlpha = lerp(1, 0.85, fresh); ctx.fillRect(cx + cs / 2 - s / 2, cy + cs / 2 - s / 2, s, s); ctx.globalAlpha = 1;
    }
  }
}

function sceneMath(ctx, u, t) {
  const hits = [0, 8, 16, 21].map((b) => (u >= b ? Math.exp(-(u - b) * 2) : 0)).reduce((a, b) => a + b, 0);
  background(ctx, u, CX, H * 0.45, 0.14 + hits * 0.4);
  rays(ctx, CX, H * 0.45, u, 0.25 + hits * 0.5, 18);
  // the 3-D number: big in the hook, then parked small at the top
  const park = E.inOutCubic(prog(u, 3.4, 4.4));
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ x: 0, y: lerp(0.3, 3.0, park), z: lerp(1.5, 0, park), ry: lerp(0.4 * Math.sin(t * 1.2), 0.15 * Math.sin(t), park) + (1 - E.outCubic(prog(u, -0.2, 1.2))) * Math.PI * 2, in: -0.4, stagger: 0.06, scale: lerp(0.7, 0.55, park), spring: SPRING.bouncy }, { in: 999 }] });
  if (u < 4) {
    sparks(ctx, CX, H * 0.47, u, 0.6, 70, 3, { speed: 1800 });
    bands(ctx, 560, 1300, 0.8);
    line(ctx, 'ЧАСОВ В ДОТЕ', CX, S.y + 100, K.fit(ctx, 'ЧАСОВ В ДОТЕ', 120), C.text, u, -0.3, 3.6, { stagger: 0.02 });
    line(ctx, 'ЭТО СКОЛЬКО?', CX, S.y + S.h - 100, K.fit(ctx, 'ЭТО СКОЛЬКО?', 130), 'GOLD', u, 1.6, 3.6, { stagger: 0.03, rot: -0.3 });
    return;
  }
  line(ctx, 'ЧАСОВ — ЭТО', CX, S.y + 230, 54, C.muted, u, 4, null, { face: UI, weight: 800, track: 0.14, stagger: 0.01 });
  if (u < 12) {
    counter(ctx, 416, CX, H * 0.37, 240, u, 4.6, 8, '');
    line(ctx, 'ДНЕЙ БЕЗ СНА', CX, H * 0.37 + 120, 90, C.text, u, 8.8, 11.7, { stagger: 0.02 });
    card(ctx, S.x, H * 0.47, S.w, 600, u, 4.2, 11.8, (c, w, h) => grid(c, 26, 16, -w / 2 + 24, -h / 2 + 24, w - 48, prog(u, 4.6, 8), u, 4.6, false), { fromY: 900, rot: 0.2, r: 28, stroke: 'rgba(230,184,88,0.4)' });
    line(ctx, '1 клетка = 1 день', CX, S.y + S.h - 10, 44, C.muted, u, 5, 11.7, { face: UI, weight: 700, track: 0, stagger: 0.008 });
  } else if (u < 20) {
    counter(ctx, 15000, CX, H * 0.37, 210, u, 12.6, 16, '');
    line(ctx, 'КАТОК', CX, H * 0.37 + 120, 100, C.text, u, 16.4, 19.7, { stagger: 0.02 });
    card(ctx, S.x, H * 0.47, S.w, 600, u, 12.2, 19.8, (c, w, h) => grid(c, 50, 30, -w / 2 + 24, -h / 2 + 24, w - 48, prog(u, 12.6, 16), u, 12.6, true), { fromX: 900, fromY: 0, rot: 0.2, r: 28, stroke: 'rgba(230,184,88,0.4)' });
    line(ctx, 'по 40 минут, 1 клетка = 10 каток', CX, S.y + S.h - 10, 44, C.muted, u, 17, 19.7, { face: UI, weight: 700, track: 0, stagger: 0.008 });
  } else {
    line(ctx, 'ЕСЛИ ИГРАТЬ', CX, H * 0.36, 100, C.text, u, 19.9, 23.7, { stagger: 0.02 });
    line(ctx, 'ПО 4 ЧАСА В ДЕНЬ', CX, H * 0.36 + 110, K.fit(ctx, 'ПО 4 ЧАСА В ДЕНЬ', 90), C.text, u, 20.2, 23.7, { stagger: 0.02 });
    line(ctx, 'ПОЧТИ', CX, H * 0.58, 70, C.muted, u, 21, 23.7, { face: UI, weight: 800, track: 0.2, stagger: 0.02 });
    counter(ctx, 7, CX - 110, H * 0.72, 340, u, 20.8, 21.2);
    line(ctx, 'ЛЕТ', CX + 150, H * 0.72 - 10, 150, 'GOLD', u, 22, 23.7, { stagger: 0.04, from: 2, spring: SPRING.snappy });
    sparks(ctx, CX, H * 0.68, u, 21.2, 70, 21, { speed: 1800 });
  }
}

function sceneTwist(ctx, u, t) {
  const crack = u >= 32 ? Math.exp(-(u - 32) * 2) : 0;
  background(ctx, u, CX, H * 0.45, 0.2 + crack * 0.4, { color: '240,88,93' });
  rays(ctx, CX, H * 0.45, u, 0.3 + crack * 0.5, 16, '255,120,120');
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ x: 0, y: 0.6, z: 1, ry: 0.2 * Math.sin(t), rz: u >= 32 ? -0.08 : 0, in: 29.8, stagger: 0.04, scale: 0.72 }, { in: 999 }] });
  // the red strike across the number
  const p = E.outCubic(prog(u, 31.5, 32));
  if (p > 0) { ctx.save(); ctx.translate(CX, H / 2 - 0.6 * 241.5); ctx.rotate(-0.12); ctx.fillStyle = C.red; ctx.shadowColor = 'rgba(240,88,93,0.8)'; ctx.shadowBlur = 40; ctx.fillRect(-W * 0.45, -14, W * 0.9 * p, 28); ctx.restore(); }
  sparks(ctx, CX, H / 2 - 145, u, 32, 70, 33, { speed: 1800 });
  line(ctx, '10 000 ЧАСОВ', CX, S.y + 80, K.fit(ctx, '10 000 ЧАСОВ', 110), C.text, u, 29.8, 35.6, { stagger: 0.02 });
  line(ctx, 'НЕ ДЕЛАЮТ ТИТАНОМ', CX, S.y + 190, K.fit(ctx, 'НЕ ДЕЛАЮТ ТИТАНОМ', 90), C.red, u, 30.3, 35.6, { stagger: 0.02, from: 1.8 });
  line(ctx, 'если 15 000 раз', CX, H * 0.62, 64, C.text, u, 33.5, 35.6, { face: UI, weight: 800, track: 0, stagger: 0.01 });
  line(ctx, 'ПОВТОРЯТЬ ОДНУ ОШИБКУ', CX, H * 0.62 + 100, K.fit(ctx, 'ПОВТОРЯТЬ ОДНУ ОШИБКУ', 80), 'GOLD', u, 34, 35.6, { stagger: 0.015 });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.5, u, 0.5, 18);
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ x: 0, y: 0.3, z: 1, ry: 0.5 * Math.sin((u - 36) * 0.8), in: 35.9, stagger: 0.05, scale: 0.6, spring: SPRING.bouncy }, { in: 999 }] });
  bands(ctx, 520, 1300);
  line(ctx, 'А У ТЕБЯ', CX, S.y + 80, 120, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'СКОЛЬКО?', CX, S.y + 210, 150, 'GOLD', u, 36.4, null, { stagger: 0.04, rot: 0.4 });
  line(ctx, 'часы и ранг — в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet([{ str: '10000', size: 1.2, depth: 0.45, mat: GOLD, bevel: 0.05 }, { str: '?', size: 1.6, depth: 0.5, mat: GOLD, bevel: 0.05 }]);
    PHONE = await phoneSet(['deaths', 'review']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], [8, 18], [16, 18], [21, 22], [32, 28], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneMath(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'А СКОЛЬКО РАЗ', l2: 'ТЫ ПОВТОРИЛ ОДНУ ОШИБКУ?', l3: 'кинь матч — бот найдёт её' });
    else if (u < 36) sceneTwist(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 32, 0.4, '255,90,90');
    for (const b of [0, 4, 12, 20, 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
