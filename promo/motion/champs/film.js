// Все чемпионы TI: 15 Аегисов на спирали, камера спускается по годам. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { aegisSet } from '../common/sets/aegis.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, springKeys, SPRING, ring } = M;
const { C, UI, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background } = K;

const TI = [
  ['2011', 'TI1', 'NATUS VINCERE'], ['2012', 'TI2', 'INVICTUS GAMING'], ['2013', 'TI3', 'ALLIANCE'],
  ['2014', 'TI4', 'NEWBEE'], ['2015', 'TI5', 'EVIL GENIUSES'], ['2016', 'TI6', 'WINGS GAMING'],
  ['2017', 'TI7', 'TEAM LIQUID'], ['2018', 'TI8', 'OG'], ['2019', 'TI9', 'OG'],
  ['2021', 'TI10', 'TEAM SPIRIT'], ['2022', 'TI11', 'TUNDRA'], ['2023', 'TI12', 'TEAM SPIRIT'],
  ['2024', 'TI13', 'TEAM LIQUID'], ['2025', 'TI14', 'TEAM FALCONS'], ['2026', 'TI 2026', 'TEAM SPIRIT'],
];
const N = TI.length, STEP = 1.3, U0 = 4;
const at = (i) => U0 + i * STEP;
const PITCH = ['A5', 'C6', 'E6', 'A6'];

const HITS = [
  [0, 'hook', 'impact'], [0.5, '15 аегисов', 'pop', { pitch: 'A5' }], [1.2, '11 команд', 'pop', { pitch: 'E6' }],
  ...TI.map((x, i) => [at(i), x[0], i === N - 1 ? 'impact' : 'tok', { pitch: PITCH[i % 4] }]),
  ...K.botHits(24),
  [30, 'больше одного', 'impact'], [31, 'OG', 'thud'], [32, 'Liquid', 'thud'], [33, 'Spirit x3', 'bell', { pitch: 'A6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'E6' }], [40, 'bot pill', 'bell', { pitch: 'A6' }],
];

let AEGIS = null, PHONE = null;
// spiral: each Aegis faces outward, the helix descends
const pos = (i) => { const a = i * 0.72; return [2.1 * Math.sin(a), -i * 1.55, 2.1 * Math.cos(a), a]; };
function shields(u, t) {
  return TI.map((_, i) => {
    const [x, y, z, a] = pos(i);
    const k = springU(u, at(i) - 0.35, SPRING.bouncy);
    const born = i === 0 ? 1 : clamp(k * 1.2);
    const spin = (1 - clamp(k)) * Math.PI * 2;
    return { x, y: y + (1 - clamp(k)) * 2.5 * (i > 0 ? 1 : 0), z, ry: a + spin + 0.15 * Math.sin(t + i), rx: 0, scale: 0.85 * Math.max(0.001, born),
      vis: i === 0 || u > at(i) - 0.5 || u >= 24, ring: u >= at(i) ? prog(u, at(i), at(i) + 1.4) : -1 };
  });
}
function camAt(s) {
  const a = s * 0.72, y = -s * 1.55;
  return [7.6 * Math.sin(a + 0.06), y + 0.5, 7.6 * Math.cos(a + 0.06), 2.1 * Math.sin(a), y - 0.15, 2.1 * Math.cos(a)];
}

// ---------------------------------------------------------------- hook (u 0..4)
function sceneHook(ctx, u, t) {
  background(ctx, u, CX, H * 0.6, 0.25);
  rays(ctx, CX, H * 0.62, u, 0.6, 18);
  const d = lerp(13, 7.6, E.outCubic(prog(u, -0.5, 3.8)));
  G.renderSet(ctx, AEGIS, t, u, { cam: [0.4, 0.3, d, 0, -0.6, 0], shields: shields(u, t).map((x, i) => i ? { ...x, vis: false } : { ...x, ry: x.ry + u * 0.9 }) });
  line(ctx, '15 АЕГИСОВ', CX, S.y + 150, K.fit(ctx, '15 АЕГИСОВ', 170), 'GOLD', u, -0.6, 3.6, { stagger: 0.035, rot: -0.3 });
  line(ctx, 'ВСЕГО 11 КОМАНД', CX, S.y + 255, 76, C.text, u, 1.0, 3.6, { stagger: 0.02 });
  line(ctx, 'вспомнишь всех?', CX, S.y + 330, 50, C.muted, u, 1.8, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
}

// ---------------------------------------------------------------- the spiral (u 4..24)
function sceneSpiral(ctx, u, t) {
  const keys = [[3.6, 0], ...TI.map((_, i) => [at(i) - 0.3, i])];
  const s = u < 22.6 ? springKeys(u, keys, { stiffness: 220, damping: 22 }) : (N - 1) - (N - 1) * 0.5 * E.inOutCubic(prog(u, 22.6, 24));
  const c = camAt(s);
  const back = E.inOutCubic(prog(u, 22.6, 24));
  const cam = [lerp(c[0], 13, back), c[1], lerp(c[2], 13, back), lerp(c[3], 0, back), c[4], lerp(c[5], 0, back)];
  const i = clamp(Math.round(s), 0, N - 1);
  const hit = Math.exp(-Math.max(0, u - at(i)) * 2.5) * (u >= at(i) ? 1 : 0);
  background(ctx, u, CX, H * 0.55, 0.18 + hit * 0.4);
  rays(ctx, CX, H * 0.56, u, 0.3 + hit * 0.7, 16);
  speed(ctx, u, 0.25, -1);
  G.renderSet(ctx, AEGIS, t, u, { cam, shields: shields(u, t), roll: 0.08 * Math.sin(u * 0.5) });
  sparks(ctx, CX, H * 0.62, u, at(i), i === N - 1 ? 70 : 26, 30 + i, { up: true, spread: 2.2, speed: 1300 });
  bands(ctx, 560, 1300);
  // the current year: label swaps on each entry
  TI.forEach((x, j) => {
    const a = at(j), b = j < N - 1 ? at(j + 1) - 0.12 : 23.7;
    if (u < a - 0.3 || u > b + 0.5) return;
    const spirit = x[2] === 'TEAM SPIRIT';
    line(ctx, x[1], CX, S.y + 60, 50, C.muted, u, a - 0.15, b, { face: UI, weight: 800, track: 0.14, stagger: 0.01 });
    line(ctx, x[0], CX, S.y + 245, 200, 'GOLD', u, a - 0.1, b, { from: 1.8, spring: SPRING.snappy, stagger: 0.03, rot: 0.2 });
    line(ctx, x[2], CX, S.y + S.h - 30, K.fit(ctx, x[2], 110), spirit ? C.gold : C.text, u, a, b, { stagger: 0.015, from: 1.4 });
  });
  // the gap year
  if (u > at(8) + 0.5 && u < at(9) - 0.2) line(ctx, '2020 — TI НЕ БЫЛО', CX, H * 0.5, 50, C.red, u, at(8) + 0.6, at(9) - 0.5, { face: UI, weight: 800, track: 0.05, stagger: 0.01 });
}

// ---------------------------------------------------------------- multiple winners (u 30..36)
function sceneMulti(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.14);
  const a = (u - 30) * 0.12;
  G.renderSet(ctx, AEGIS, t, u, { cam: [14 * Math.sin(a), -9, 14 * Math.cos(a), 0, -11, 0], shields: shields(u, t) });
  ctx.fillStyle = 'rgba(9,9,11,0.66)'; ctx.fillRect(0, 0, W, H);
  line(ctx, 'БОЛЬШЕ ОДНОГО', CX, S.y + 90, K.fit(ctx, 'БОЛЬШЕ ОДНОГО', 120), C.text, u, 29.8, 35.6, { stagger: 0.02, rot: -0.2 });
  line(ctx, 'АЕГИСА ВЗЯЛИ ТРОЕ', CX, S.y + 185, 72, 'GOLD', u, 30.3, 35.6, { stagger: 0.02 });
  const rows = [['OG', '2018 · 2019', 2, 31], ['TEAM LIQUID', '2017 · 2024', 2, 32], ['TEAM SPIRIT', '2021 · 2023 · 2026', 3, 33]];
  rows.forEach(([name, yrs, n, u0], r) => {
    const y = S.y + 330 + r * 250, last = r === 2;
    card(ctx, S.x, y, S.w, 210, u, u0, 35.6 + r * 0.05, (c, w, h, k) => {
      line(c, name, -w / 2 + 40, -10, 72, last ? C.gold : C.text, u, u0, null, { align: 'left', stagger: 0.01, shadow: false });
      line(c, yrs, -w / 2 + 42, 55, 40, C.muted, u, u0 + 0.2, null, { face: UI, weight: 700, track: 0.04, align: 'left', stagger: 0.008, shadow: false });
      line(c, '×' + n, w / 2 - 40, 40, 130, last ? 'GOLD' : C.text, u, u0 + 0.3, null, { align: 'right', from: 2, spring: SPRING.snappy, shadow: false });
    }, { fromX: r % 2 ? 900 : -900, fromY: 0, rot: r % 2 ? 0.2 : -0.2, stroke: last ? 'rgba(230,184,88,0.9)' : undefined });
    if (last) sparks(ctx, S.x + S.w - 120, y + 100, u, u0 + 0.3, 50, 41, { speed: 1400 });
  });
}

// ---------------------------------------------------------------- end (u 36..44)
function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.55, 0.3 * Math.exp(-(u - 36)) + 0.2);
  rays(ctx, CX, H * 0.55, u, 0.5, 18);
  const a = (u - 36) * 0.15;
  G.renderSet(ctx, AEGIS, t, u, { cam: [11 * Math.sin(a), -5, 11 * Math.cos(a), 0, -9.5, 0], shields: shields(u, t) });
  bands(ctx, 520, 1250);
  line(ctx, 'КТО ВОЗЬМЁТ', CX, S.y + 80, K.fit(ctx, 'КТО ВОЗЬМЁТ', 120), C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'АЕГИС 2027?', CX, S.y + 210, K.fit(ctx, 'АЕГИС 2027?', 140), 'GOLD', u, 36.4, null, { stagger: 0.03, rot: 0.4 });
  line(ctx, 'ставь в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    [AEGIS, PHONE] = await Promise.all([aegisSet(N, 44), phoneSet(['home', 'review'])]);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 24], [at(N - 1), 30], [30, 22], [33, 14], [36, 24]]) M.shake(ctx, u, b, amp);
    if (u < 4) sceneHook(ctx, u, t);
    else if (u < 24) sceneSpiral(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'А ТВОЙ АЕГИС', l2: 'НАЧИНАЕТСЯ С РАЗБОРА', l3: 'кинь матч — бот покажет ошибки' });
    else if (u < 36) sceneMulti(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, at(N - 1), 0.4);
    for (const b of [0, at(N - 1), 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
