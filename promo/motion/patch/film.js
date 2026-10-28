// Где 7.42, Valve? 3-D "7.42" in gold, a loading bar stuck at 99%, the facts as of late October 2026.
// Facts: 7.41f is the latest entry (15 Sept 2026), 7.41 came out more than half a year ago, no 7.42 date (cyber.sports.ru, oopsdota.com).
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD, IVORY, RED } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, text } = M;
const { C, UI, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background } = K;

const HITS = [
  [0, 'VALVE', 'impact'], [0.6, 'ГДЕ', 'pop', { pitch: 'E6' }], [1.2, '7.42', 'impact'],
  [4, 'последний патч', 'click'], [5, '7.41f', 'thud'], [6, '15 сентября', 'pop', { pitch: 'B5' }],
  [8, 'полгода', 'thud'], [10, 'загрузка', 'whoosh', { len: 0.5 }], [10.5, 'bar runs', 'type', { len: 2.5, n: 22 }],
  [13, '99%', 'tick'], [14, 'stuck glitch', 'sub'], [16, 'ни даты', 'thud'], [17, 'ни анонса', 'thud'],
  [18, 'что ждём', 'click'], [19, 'chip 1', 'pop', { pitch: 'E6' }], [20, 'chip 2', 'pop', { pitch: 'G6' }], [21, 'chip 3', 'pop', { pitch: 'B6' }],
  ...K.botHits(24),
  [30, 'прогноз', 'impact'], [31, 'ноябрь', 'pop', { pitch: 'E6' }], [32, 'декабрь', 'pop', { pitch: 'G6' }], [33, '2027', 'pop', { pitch: 'B6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'E6' }], [40, 'pill', 'bell', { pitch: 'E6' }],
];

let TYPE = null, PHONE = null;

function scene3D(ctx, u, t, o = {}) {
  // the "7.42" hovers and turns; drops in on the hook, glitch-shudders when the bar sticks
  const shudder = 0.25 * wobble(u - 14, 6, 3) + 0.15 * wobble(u - 1.2, 3, 2.5);
  const ry = 0.5 * Math.sin(t * 0.7) + shudder + (o.spin || 0);
  G.renderSet(ctx, TYPE, t, u, {
    cam: o.cam || [0, 0.3, 11], target: [0, o.ty ?? 0, 0], roll: 0.05 * Math.sin(u * 0.4),
    words: [{ x: 0, y: o.y ?? 0, z: 0, ry, rx: 0.15 * Math.sin(t * 0.9), in: -0.4, stagger: 0.12, scale: o.scale || 0.62 },
      { x: 2.75 * (o.scale || 0.62), y: (o.y ?? 0) + 1.25 * (o.scale || 0.62), z: 0.4, ry: -0.3 + 0.4 * Math.sin(t * 2), in: o.qIn ?? 2.0, out: o.qOut ?? null, scale: o.scale || 0.62, spin: 0.2 }],
  });
}

function sceneHook(ctx, u, t) {
  background(ctx, u, CX, H * 0.52, 0.25 + 0.4 * Math.exp(-Math.max(0, u - 1.2) * 1.5));
  rays(ctx, CX, H * 0.52, u, 0.5, 18);
  scene3D(ctx, u, t, { y: -0.4, cam: [0, 0.2, lerp(15, 11, E.outCubic(prog(u, 0, 4)))] });
  sparks(ctx, CX, H * 0.52, u, 1.2, 60, 3, { speed: 1700 });
  line(ctx, 'VALVE,', CX, S.y + 120, 150, C.text, u, -0.6, 3.6, { stagger: 0.04, rot: -0.4 });
  line(ctx, 'ГДЕ ПАТЧ?', CX, S.y + 250, 110, 'GOLD', u, 0.6, 3.6, { stagger: 0.03 });
}

function sceneFacts(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.18);
  scene3D(ctx, u, t, { y: 2.6, cam: [0, 0.4, 14], ty: 0.4, scale: 0.48, qIn: 2, qOut: null });
  bands(ctx, 0, 1400);
  // card 1: the last patch
  if (u < 10.2) {
    card(ctx, S.x, H * 0.47, S.w, 380, u, 4, 9.6, (c, w, h) => {
      line(c, 'ПОСЛЕДНИЙ ПАТЧ', 0, -110, 46, C.muted, u, 4.1, null, { face: UI, weight: 800, track: 0.12, stagger: 0.01, shadow: false });
      line(c, '7.41f', 0, 40, 170, 'GOLD', u, 5, null, { from: 1.8, spring: SPRING.snappy, stagger: 0.04 });
      line(c, '15 СЕНТЯБРЯ', 0, 130, 64, C.text, u, 6, null, { stagger: 0.02, shadow: false });
    }, { fromY: 600, rot: -0.15 });
    line(ctx, 'А САМ 7.41 ВЫШЕЛ', CX, S.y + S.h - 90, 64, C.text, u, 7.5, 9.6, { stagger: 0.015 });
    line(ctx, 'БОЛЬШЕ ПОЛГОДА НАЗАД', CX, S.y + S.h + 10, K.fit(ctx, 'БОЛЬШЕ ПОЛГОДА НАЗАД', 80), C.red, u, 8, 9.6, { stagger: 0.015, from: 1.6 });
  }
  // the loading bar that never finishes
  if (u >= 9.8 && u < 18.2) {
    const k = springU(u, 10, SPRING.snappy), ex = E.inBack(prog(u, 17.6, 18), 1.5);
    const p = E.outCubic(prog(u, 10.5, 13)) * 0.99;
    const y = H * 0.55 - ex * 900;
    ctx.save(); ctx.globalAlpha = clamp(k * 2);
    line(ctx, 'ЗАГРУЗКА 7.42', CX, y - 70, 70, C.text, u, 10, 17.6, { stagger: 0.02 });
    const bw = S.w * lerp(0.3, 1, k), bx = CX - bw / 2;
    M.shake(ctx, u, 14, 30);
    rrect(ctx, bx, y, bw, 70, 35); ctx.fillStyle = '#18181b'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(230,184,88,0.6)'; ctx.stroke();
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#c8913a'); g.addColorStop(1, '#fff3cf');
    rrect(ctx, bx + 8, y + 8, Math.max(0, (bw - 16) * p), 54, 27); ctx.fillStyle = u > 14 ? (Math.floor(u * 8) % 2 ? C.red : '#c8913a') : g; ctx.fill();
    ctx.textBaseline = 'alphabetic';
    text(ctx, `${Math.floor(p * 100)}%`, CX, y + 200, font(150, 900, K.D), u > 14 ? C.red : C.gold, 'center');
    ctx.restore();
    line(ctx, 'НИ ДАТЫ', CX, S.y + S.h - 90, 90, C.text, u, 16, 17.6, { stagger: 0.03, from: 1.8 });
    line(ctx, 'НИ АНОНСА', CX, S.y + S.h + 10, 90, C.red, u, 17, 17.6, { stagger: 0.03, from: 1.8 });
  }
  // what we hope for: framed as questions, not leaks
  if (u >= 17.8) {
    line(ctx, 'ЧЕГО ЖДЁМ?', CX, H * 0.45, 110, 'GOLD', u, 18, 23.6, { stagger: 0.03, rot: -0.3 });
    [['НОВЫЙ ГЕРОЙ?', 19], ['НОВЫЕ ПРЕДМЕТЫ?', 20], ['ПЕРЕДЕЛКА КАРТЫ?', 21]].forEach(([s, a], i) => {
      card(ctx, S.x + 40, H * 0.5 + i * 150, S.w - 80, 120, u, a, 23.6 + i * 0.05, (c, w, h) => {
        line(c, s, 0, 22, 60, C.text, u, a, null, { stagger: 0.01, shadow: false });
      }, { fromX: i % 2 ? 900 : -900, fromY: 0, rot: i % 2 ? 0.2 : -0.2 });
    });
  }
}

function scenePoll(ctx, u, t) {
  background(ctx, u, CX, H * 0.4, 0.2);
  scene3D(ctx, u, t, { y: 2.8, cam: [0, 0.4, 14], ty: 0.4, scale: 0.48, qIn: 0, spin: (u - 30) * 0.4 });
  bands(ctx, 0, 1300);
  line(ctx, 'ТВОЙ ПРОГНОЗ:', CX, H * 0.45, 100, C.text, u, 29.8, 35.6, { stagger: 0.025 });
  [['НОЯБРЬ', 31, C.text], ['ДЕКАБРЬ', 32, C.text], ['УЖЕ В 2027', 33, C.red]].forEach(([s, a, col], i) => {
    card(ctx, S.x + 40, H * 0.5 + i * 160, S.w - 80, 130, u, a, 35.6 + i * 0.05, (c, w, h) => {
      line(c, s, 0, 26, 72, col, u, a, null, { stagger: 0.015, shadow: false });
    }, { fromX: i % 2 ? 900 : -900, fromY: 0, rot: i % 2 ? 0.2 : -0.2 });
  });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.52, 0.25 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.52, u, 0.55, 18);
  scene3D(ctx, u, t, { y: -0.3, cam: [0, 0.2, 11.5], qIn: 0, spin: E.inOutCubic(prog(u, 36, 38.5)) * Math.PI * 2 });
  bands(ctx, 520, 1300);
  line(ctx, 'КОГДА ВЫЙДЕТ', CX, S.y + 80, K.fit(ctx, 'КОГДА ВЫЙДЕТ', 120), C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, '7.42?', CX, S.y + 220, 150, 'GOLD', u, 36.4, null, { stagger: 0.05, rot: 0.4 });
  line(ctx, 'пиши дату в комменты', CX, S.y + S.h - 200, 50, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet([{ str: '7.42', size: 2.2, depth: 0.6, mat: GOLD, bevel: 0.06 }, { str: '?', size: 1.6, depth: 0.5, mat: RED, bevel: 0.05 }]);
    PHONE = await phoneSet(['home', 'coach']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], [1.2, 30], [5, 14], [16, 16], [17, 16], [30, 20], [36, 24]]) M.shake(ctx, u, b, amp);
    if (u < 4) sceneHook(ctx, u, t);
    else if (u < 24) sceneFacts(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ПОКА ЖДЁШЬ ПАТЧ', l2: 'РАЗБЕРИ СВОИ КАТКИ', l3: 'кинь матч — бот покажет ошибки' });
    else if (u < 36) scenePoll(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 1.2, 0.4);
    for (const b of [0, 1.2, 30, 36]) glitch(ctx, u, b, 40);
    glitch(ctx, u, 14, 90, 1.2, 7);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
