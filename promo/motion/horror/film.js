// Страшилки для Стража: пять кошмаров в красном свете, Аегис в темноте, мерцание и скримеры. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { aegisSet } from '../common/sets/aegis.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, hash01, noise1, font } = M;
const { C, UI, D, S, CX, line, pill, bands, rays, sparks, speed, glitch, flash, glow } = K;

const FEARS = [
  ['КЕРРИ ФАРМИТ ЛЕС', 'на 45-й минуте, а у вас нет трона'],
  ['САППОРТ БЕЗ ВАРДОВ', 'и без ТП. И без надежды'],
  ['ПУДЖ НА МИДЕ', 'первым пиком. В ранговой'],
  ['У ВРАГОВ РОШАН', 'а вы спорите в чате, кто виноват'],
  ['«Я В СВОЕЙ ИГРЕ»', 'пишет ваш керри на 10-й минуте'],
];
const AT = [4, 8, 12, 16, 20];

const HITS = [
  [0, 'scream', 'impact'], [0.6, 'страшилки', 'thud', { pitch: 60 }], [1.4, 'для стража', 'thud', { pitch: 45 }],
  ...AT.flatMap((a, i) => [[a, `#${5 - i}`, 'impact'], [a + 0.6, 'fear line', 'type', { len: 0.9, n: 9 }]]),
  ...K.botHits(24),
  [30, 'самое страшное', 'sub'], [31.5, 'не знать', 'thud', { pitch: 50 }], [33, 'почему слил', 'impact'],
  [36, 'end', 'impact'], [38, 'comments', 'blip', { pitch: 'C#5' }], [40, 'pill', 'bell', { pitch: 'C#5' }],
];

let AEGIS = null, PHONE = null;

function dark(ctx, u, t, o = {}) {
  ctx.fillStyle = '#060404'; ctx.fillRect(0, 0, W, H);
  // a red light that breathes with the heartbeat
  const beat = Math.exp(-((u % 4) * 2.2)) * 0.6 + 0.4;
  glow(ctx, CX, H * 0.55, 1000, 0.32 * beat, '160,20,24');
  // fog layers drifting
  for (let i = 0; i < 6; i++) {
    const x = ((hash01(i, 3) * W * 1.6 + u * 18 * (i % 2 ? 1 : -1)) % (W * 1.6)) - W * 0.3;
    glow(ctx, x, H * (0.3 + hash01(i, 5) * 0.6), 500, 0.07, '200,180,180');
  }
  const ry = 0.25 * Math.sin(t * 0.5) + (o.spin || 0), dist = o.dist ?? 6.5;
  G.renderSet(ctx, AEGIS, t, u, {
    cam: [(o.cx || 0) + 0.6 * noise1(u * 0.6, 3), (o.cy || 0) + 0.2 + 0.3 * noise1(u * 0.5, 4), dist, 0, 0, 0], roll: 0.06 * noise1(u * 0.4, 5),
    shields: [{ y: 0, ry, rx: 0.1 * Math.sin(t * 0.7), scale: o.scale || 1, ring: -1 }], light: 0.55,
  });
  // grade the 3-D red
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(255,110,110)'; ctx.fillRect(0, 0, W, H); ctx.restore();
}

// a scary caption that types on letter by letter, with a jitter
function typed(ctx, str, x, y, size, color, u, u0, u1, face = UI) {
  const n = Math.floor(clamp((u - u0) / 0.9) * str.length);
  if (u < u0 || u > u1 + 0.3) return;
  const s = str.slice(0, n);
  ctx.save();
  ctx.globalAlpha = 1 - prog(u, u1, u1 + 0.3);
  ctx.translate(2 * noise1(u * 30, 1), 2 * noise1(u * 30, 2));
  M.text(ctx, s, x, y, font(size, 700, face), color, 'center');
  ctx.restore();
}

function sceneHook(ctx, u, t) {
  dark(ctx, u, t, { dist: lerp(4.2, 6.5, E.outCubic(prog(u, 0, 3))) });
  bands(ctx, 600, 1350);
  line(ctx, 'СТРАШИЛКИ', CX, S.y + 140, K.fit(ctx, 'СТРАШИЛКИ', 170), C.red, u, -0.3, 3.6, { stagger: 0.02, from: 2.2, spring: SPRING.snappy, rot: -0.2 });
  line(ctx, 'ДЛЯ СТРАЖА', CX, S.y + 260, 110, C.text, u, 1.4, 3.6, { stagger: 0.03, from: 2 });
  typed(ctx, 'смотреть с выключенным светом', CX, S.y + S.h, 44, C.muted, u, 2.0, 3.6);
}

function sceneFears(ctx, u, t) {
  const i = clamp(Math.floor((u - 4) / 4), 0, 4), a = AT[i];
  const V = [[-2.5, 1, 4.2, 6], [2.5, -1.5, 7.5, 5.5], [0, 2.5, 3.6, 5], [-1.8, -2, 6.5, 8], [1.5, 0.5, 3.4, 4.6]][i];
  dark(ctx, u, t, { spin: E.inOutCubic(prog(u, a, a + 0.6)) * Math.PI * 2, dist: lerp(V[2], V[3], E.outCubic(prog(u, a, a + 4))), cx: V[0], cy: V[1] });
  bands(ctx, 650, 1300);
  // the number slams, red, with a shake
  M.shake(ctx, u, a, 40);
  line(ctx, `#${5 - i}`, CX, S.y + 250, 280, C.red, u, a - 0.05, a + 3.6, { from: 2.6, spring: SPRING.snappy, stagger: 0.05, rot: 0.3 });
  const [l1, l2] = FEARS[i];
  line(ctx, l1, CX, S.y + S.h - 110, K.fit(ctx, l1, 100), C.text, u, a + 0.3, a + 3.6, { stagger: 0.02, from: 1.6 });
  typed(ctx, l2, CX, S.y + S.h - 10, 54, '#f0c4c4', u, a + 0.9, a + 3.6);
  sparks(ctx, CX, H * 0.5, u, a, 30, 50 + i, { speed: 1100, gravity: -300 });
}

function sceneTwist(ctx, u, t) {
  dark(ctx, u, t, { dist: 7.5 });
  ctx.fillStyle = 'rgba(6,4,4,0.6)'; ctx.fillRect(0, 0, W, H);
  line(ctx, 'НО САМОЕ', CX, H * 0.36, 110, C.text, u, 29.8, 35.6, { stagger: 0.03 });
  line(ctx, 'СТРАШНОЕ —', CX, H * 0.36 + 120, 110, C.text, u, 30.3, 35.6, { stagger: 0.03 });
  line(ctx, 'НЕ ЗНАТЬ,', CX, H * 0.36 + 300, 120, C.red, u, 31.5, 35.6, { stagger: 0.03, from: 2 });
  line(ctx, 'ПОЧЕМУ СЛИЛ', CX, H * 0.36 + 430, K.fit(ctx, 'ПОЧЕМУ СЛИЛ', 130), C.red, u, 33, 35.6, { stagger: 0.03, from: 2.4, spring: SPRING.snappy });
}

function sceneEnd(ctx, u, t) {
  dark(ctx, u, t, { dist: lerp(5, 6.5, prog(u, 36, 44)), spin: E.inOutCubic(prog(u, 36, 38)) * Math.PI * 2 });
  bands(ctx, 560, 1250);
  line(ctx, 'А ТЕБЯ', CX, S.y + 80, 110, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'ЧТО ПУГАЕТ?', CX, S.y + 210, K.fit(ctx, 'ЧТО ПУГАЕТ?', 140), C.red, u, 36.4, null, { stagger: 0.03, rot: 0.3 });
  line(ctx, 'пиши в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 0.9 });
    [AEGIS, PHONE] = await Promise.all([aegisSet(1, 72), phoneSet(['deaths', 'killers'])]);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 34], [33, 30], [36, 26]]) M.shake(ctx, u, b, amp);
    if (u < 4) sceneHook(ctx, u, t);
    else if (u < 24) sceneFears(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ЧТОБЫ НЕ БЫЛО СТРАШНО', l2: 'ЗАПУСТИ РАЗБОР', l3: 'кинь матч — бот покажет, где умирал' });
    else if (u < 36) sceneTwist(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 0, 0.7, '255,60,60'); flash(ctx, u, 33, 0.5, '255,60,60');
    for (const b of [0, ...AT, 33, 36]) glitch(ctx, u, b, 60, 0.5);
    // flicker: a dead bulb
    const f = hash01(Math.floor(u * 12), 77);
    if (f > 0.9 && !(u >= 24 && u < 30)) { ctx.fillStyle = `rgba(0,0,0,${(f - 0.9) * 5})`; ctx.fillRect(0, 0, W, H); }
    K.vignette(ctx); K.vignette(ctx); K.grain(ctx, u, 0.08);
  },
});
