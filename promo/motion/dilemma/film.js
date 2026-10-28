// Выбери одно: экран рвётся по диагонали на А (красное) и Б (синее), посередине крутится золотое 3-D «ИЛИ».
// Пять дилемм дотера, зритель пишет свои буквы в комменты. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, font, text } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

const PAIRS = [
  [['ВСЕГДА', 'МИД'], ['ВСЕГДА', 'ПЯТЁРКА']],
  [['+1000', 'ММР'], ['ВСЕ ТИММЕЙТЫ', 'АДЕКВАТНЫЕ']],
  [['РАПИРА', 'НА 20-Й'], ['АЕГИС', 'НА 10-Й']],
  [['НИКОГДА', 'НЕ ТИЛЬТИТЬ'], ['ВСЕГДА', 'ВЫИГРЫВАТЬ ЛАЙН']],
  [['ПАТИ', 'С ТИТАНОМ'], ['ЗНАТЬ, ПОЧЕМУ', 'ТЫ СЛИЛ']],
];
const LAST = [['ВСЮ ЖИЗНЬ', 'ТОЛЬКО ПУДЖ'], ['ВСЮ ЖИЗНЬ', 'БЕЗ ПУДЖА']];
const AT = [4, 8, 12, 16, 20];
const RED = '240,88,93', BLUE = '90,143,214';

const HITS = [
  [0, 'hook', 'impact'], [0.6, 'выбери', 'pop', { pitch: 'A5' }], [1.3, 'одно', 'pop', { pitch: 'E6' }],
  ...AT.flatMap((a, i) => [[a, `${i + 1} A`, 'whoosh', { len: 0.4 }], [a + 0.4, 'B', 'whoosh', { len: 0.4, from: 900, to: 2600 }], [a + 0.9, 'или', 'impact'], [a + 2.8, 'tick', 'tick'], [a + 3.2, 'tick', 'tick']]),
  ...K.botHits(24),
  [30, 'финал', 'impact'], [30.9, 'или', 'impact'], [33, 'самый сложный', 'pop', { pitch: 'E6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'A6' }], [40, 'pill', 'bell', { pitch: 'E6' }],
];

let TYPE = null, PHONE = null;

// one half: a slanted slab sliding in from its side, with a ghost letter and the option text
function half(ctx, top, lines, rgb, letter, u, a, out) {
  const k = springU(u, a, SPRING.snappy), ko = out != null ? E.inCubic(prog(u, out - 0.35, out)) : 0;
  if (k <= 0.001 || ko >= 1) return;
  const dir = top ? -1 : 1, off = (1 - k) * W * 1.2 * dir + ko * W * 1.2 * -dir;
  const y0 = top ? 0 : H / 2 + 50, y1 = top ? H / 2 - 50 : H, sl = 90;
  ctx.save(); ctx.translate(off, 0);
  ctx.beginPath();
  if (top) { ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.lineTo(W, y1 - sl); ctx.lineTo(0, y1 + sl); }
  else { ctx.moveTo(0, y0 + sl); ctx.lineTo(W, y0 - sl); ctx.lineTo(W, y1); ctx.lineTo(0, y1); }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(top ? 0 : 1, `rgba(${rgb},0.05)`); g.addColorStop(top ? 1 : 0, `rgba(${rgb},0.42)`);
  ctx.fillStyle = '#0d0d10'; ctx.fill(); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.stroke();
  ctx.save(); ctx.clip();
  text(ctx, letter, top ? S.x + 10 : S.x + S.w - 10, top ? y1 - 140 : y0 + 330, font(420, 900, D), `rgba(${rgb},0.22)`, top ? 'left' : 'right');
  ctx.restore();
  ctx.restore();
  const cy = top ? H * 0.27 : H * 0.73;
  lines.forEach((s, j) => line(ctx, s, CX + off, cy + (j - 0.5) * 120 + 40, K.fit(ctx, s, 112, S.w - 40), j ? `rgb(${rgb === RED ? '255,150,150' : '160,195,255'})` : C.text, u, a + 0.1 + j * 0.15, out != null ? out - 0.3 : null, { stagger: 0.015 }));
}

function ili(ctx, u, t, a, out) {
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ x: 0, y: 0, z: 2, ry: (1 - E.outCubic(prog(u, a, a + 0.7))) * Math.PI * 3 + 0.25 * Math.sin(t * 1.5), rx: 0.1 * Math.sin(t), in: a, out, stagger: 0.03, scale: 0.6, spring: SPRING.bouncy }] });
}

// a timer bar along the seam: 2 beats to choose
function timer(ctx, u, a) {
  const p = prog(u, a + 1.6, a + 3.6); if (p <= 0 || p >= 1) return;
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(S.x, H / 2 + 150, S.w, 10);
  ctx.fillStyle = C.gold; ctx.fillRect(S.x, H / 2 + 150, S.w * (1 - p), 10); ctx.restore();
}

function sceneDilemmas(ctx, u, t) {
  background(ctx, u, CX, H / 2, 0.15);
  if (u < 4) {
    half(ctx, true, ['ВЫБЕРИ', 'ОДНО'], RED, 'А', u, -0.3, 3.8);
    half(ctx, false, ['5 ДИЛЕММ', 'ДОТЕРА'], BLUE, 'Б', u, 0.4, 3.8);
    ili(ctx, u, t, 1.0, 3.6);
    line(ctx, 'запоминай свои буквы', CX, H / 2 + 220, 44, C.text, u, 1.8, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
    return;
  }
  const i = clamp(Math.floor((u - 4) / 4), 0, 4), a = AT[i], [A, B] = PAIRS[i];
  rays(ctx, CX, H / 2, u, 0.3 * Math.exp(-Math.max(0, u - a - 0.9)), 16);
  half(ctx, true, A, RED, 'А', u, a, a + 3.95);
  half(ctx, false, B, BLUE, 'Б', u, a + 0.4, a + 3.95);
  ili(ctx, u, t, a + 0.85, a + 3.7);
  sparks(ctx, CX, H / 2, u, a + 0.9, 60, 10 + i, { speed: 1700 });
  timer(ctx, u, a);
  line(ctx, `${i + 1} / 5`, CX, S.y - 10, 44, C.gold, u, a, a + 3.8, { face: UI, weight: 800, track: 0.14, stagger: 0.02 });
}

function sceneFinal(ctx, u, t) {
  background(ctx, u, CX, H / 2, 0.2, { color: RED });
  rays(ctx, CX, H / 2, u, 0.4, 16, '255,120,120');
  half(ctx, true, LAST[0], RED, 'А', u, 29.9, null);
  half(ctx, false, LAST[1], BLUE, 'Б', u, 30.3, null);
  ili(ctx, u, t, 30.85, null);
  sparks(ctx, CX, H / 2, u, 30.9, 80, 99, { speed: 1900 });
  line(ctx, 'ФИНАЛ', CX, S.y - 10, 44, C.red, u, 29.9, 35.8, { face: UI, weight: 800, track: 0.2, stagger: 0.02 });
  if (u >= 33) pill(ctx, 'САМЫЙ СЛОЖНЫЙ ВЫБОР', CX, H / 2 + 220, 50, u, 33, 35.8, { bg: C.red, color: C.text });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.5, u, 0.5, 18);
  ili(ctx, u, t, 35.9, null);
  bands(ctx, 520, 1300);
  line(ctx, 'ПИШИ СВОИ', CX, S.y + 80, 120, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, '6 БУКВ', CX, S.y + 210, 150, 'GOLD', u, 36.4, null, { stagger: 0.04, rot: 0.4 });
  line(ctx, 'например: АБАББА', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet([{ str: 'ИЛИ', size: 1.1, depth: 0.4, mat: GOLD, bevel: 0.05 }]);
    PHONE = await phoneSet(['review', 'killers']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 20], ...AT.map((a) => [a + 0.9, 18]), [30.9, 24], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneDilemmas(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ПОСЛЕДНЕЕ — УЖЕ МОЖНО', l2: 'БОТ СКАЖЕТ, ПОЧЕМУ СЛИЛ', l3: 'кинь матч — разбор бесплатно' });
    else if (u < 36) sceneFinal(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 30.9, 0.35, '255,90,90');
    for (const b of [0, ...AT, 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
