// 5 привычек, которые держат в Страже: 3-D цифры, карточки-диагнозы со штампом и «Страж-метр», который
// наполняется к пятой привычке. Потом зелёный список «Титан делает наоборот». 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD, RED, GREEN } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, text } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

const HABITS = [
  ['ВИНИШЬ ТИММЕЙТОВ', 'а свой реплей не открываешь'],
  ['«ПРОСТО НЕ ПОВЕЗЛО»', 'после каждого слива'],
  ['ИГРАЕШЬ НА ТИЛЬТЕ', '«ещё одну и спать» — в 4 утра'],
  ['НОВЫЙ ГЕРОЙ КАЖДУЮ КАТКУ', 'и ни на одном не умеешь'],
  ['НЕ ЗНАЕШЬ, ПОЧЕМУ СЛИЛ', 'значит, сольёшь так же'],
];
const AT = [4, 8, 12, 16, 20];
const TITAN = ['смотрит свои реплеи', 'играет 2–3 героев', 'стопает после двух лузов', 'ищет свои ошибки, не чужие'];

const HITS = [
  [0, 'hook', 'impact'], [0.6, '5 привычек', 'pop', { pitch: 'F5' }], [1.4, 'держат в страже', 'thud'],
  ...AT.flatMap((a, i) => [[a, `${i + 1}`, 'impact'], [a + 0.5, 'card', 'whoosh'], [a + 2, 'stamp', 'thud'], [a + 2.6, 'meter', 'blip', { pitch: ['F5', 'G#5', 'C6', 'D#6', 'F6'][i] }]]),
  [22.6, 'страж 100%', 'impact'],
  ...K.botHits(24),
  [30, 'титан', 'impact'], ...TITAN.map((_, i) => [31 + i * 0.75, 'check', 'pop', { pitch: ['C6', 'D#6', 'F6', 'G#6'][i] }]),
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'C6' }], [40, 'pill', 'bell', { pitch: 'F5' }],
];

let TYPE = null, PHONE = null;

// the "Страж-метр": a bar at the bottom that fills a fifth per habit
function meter(ctx, u) {
  const k = springU(u, 3.6, SPRING.snappy);
  if (k <= 0) return;
  const lvl = AT.reduce((s, a) => s + 0.2 * springU(u, a + 2.6, SPRING.bouncy), 0);
  const x = S.x + 20, w = S.w - 40, y = S.y + S.h - 40, h = 34;
  ctx.save(); ctx.globalAlpha = clamp(k * 2); ctx.translate(0, (1 - k) * 200);
  text(ctx, 'СТРАЖ-МЕТР', x, y - 26, font(30, 800, UI), C.muted, 'left');
  text(ctx, `${Math.round(lvl * 100)}%`, x + w, y - 26, font(40, 900, D), lvl > 0.99 ? C.red : C.text, 'right');
  rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  if (lvl > 0.005) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#e6b858'); g.addColorStop(1, '#f0585d');
    rrect(ctx, x, y, Math.max(h, w * lvl), h, h / 2); ctx.fillStyle = g; ctx.fill();
    glow(ctx, x + w * lvl, y + h / 2, 120, 0.5, '240,88,93');
  }
  ctx.restore();
}

// a red rubber stamp that slams onto the card
function stamp(ctx, str, x, y, u, u0, u1) {
  if (u < u0 || (u1 != null && u > u1)) return;
  const k = springU(u, u0, SPRING.snappy), s = lerp(2.6, 1, clamp(k));
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.16); ctx.scale(s, s); ctx.globalAlpha = clamp(k * 3) * (u1 ? 1 - prog(u, u1 - 0.2, u1) : 1);
  ctx.font = font(46, 900, D); const w = ctx.measureText(str).width + 50;
  ctx.lineWidth = 7; ctx.strokeStyle = C.red; rrect(ctx, -w / 2, -42, w, 84, 12); ctx.stroke();
  text(ctx, str, 0, 16, font(46, 900, D), C.red, 'center');
  ctx.restore();
}

function sceneHabits(ctx, u, t) {
  const i = u < 4 ? -1 : clamp(Math.floor((u - 4) / 4), 0, 4);
  const hit = i >= 0 ? Math.exp(-Math.max(0, u - AT[i]) * 2) : 0;
  const full = u >= 22.6 ? Math.exp(-(u - 22.6) * 1.5) : 0;
  background(ctx, u, CX, H * 0.3, 0.14 + hit * 0.25 + full * 0.5, { color: u >= 22.6 ? '240,88,93' : undefined });
  rays(ctx, CX, H * 0.3, u, 0.2 + hit * 0.5, 16);
  if (i >= 0) speed(ctx, u, hit * 0.7, i % 2 ? 1 : -1, 30 + i);
  // 3-D digits: each flies in from the side with a full spin, the previous one is gone
  const words = [0, 1, 2, 3, 4].map((j) => (u < 4 && j === 4) ? { x: 0, y: 0.5, z: 1.5, ry: u * 1.4, in: -0.5, out: 3.6, stagger: 0, scale: 2.4 } : ({ x: 0, y: 1.45, z: 1, ry: 0.3 * Math.sin(t * 1.4) + (1 - E.outCubic(prog(u, AT[j], AT[j] + 0.8))) * Math.PI * 2 * (j % 2 ? 1 : -1), in: AT[j] - 0.1, out: AT[j] + 3.75, stagger: 0, scale: 1.6, spring: SPRING.bouncy }));
    G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [...words, { in: 999 }] });
  if (u < 4) {
    bands(ctx, 700, 1450);
    line(ctx, '5 ПРИВЫЧЕК', CX, S.y + 120, K.fit(ctx, '5 ПРИВЫЧЕК', 140), 'GOLD', u, -0.4, 3.6, { stagger: 0.03, rot: -0.3 });
    line(ctx, 'КОТОРЫЕ ДЕРЖАТ', CX, S.y + S.h - 190, K.fit(ctx, 'КОТОРЫЕ ДЕРЖАТ', 100), C.text, u, 0.9, 3.6, { stagger: 0.02 });
    line(ctx, 'В СТРАЖЕ', CX, S.y + S.h - 80, 120, C.red, u, 1.4, 3.6, { stagger: 0.03, from: 2, spring: SPRING.snappy });
    sparks(ctx, CX, H * 0.45, u, 0, 60, 3, { speed: 1600 });
    return;
  }
  const a = AT[i], out = a + 3.75, [l1, l2] = HABITS[i];
  sparks(ctx, CX, H * 0.3, u, a, 50, 40 + i, { speed: 1500 });
  card(ctx, S.x, H * 0.5, S.w, 330, u, a + 0.4, out, (c, w, h) => {
    line(c, l1, 0, -30, K.fit(c, l1, 80, w - 60), C.text, u, a + 0.5, null, { stagger: 0.012, shadow: false });
    line(c, l2, 0, 60, 46, C.muted, u, a + 0.9, null, { face: UI, weight: 700, track: 0, stagger: 0.006, shadow: false });
  }, { fromX: i % 2 ? 900 : -900, fromY: 0, rot: i % 2 ? 0.25 : -0.25, r: 32, stroke: 'rgba(240,88,93,0.5)' });
  stamp(ctx, 'ЭТО Я', S.x + S.w - 150, H * 0.5 + 330, u, a + 2, out);
  meter(ctx, u);
  if (u >= 22.6) pill(ctx, 'ДИАГНОЗ: СТРАЖ', CX, H * 0.43, 64, u, 22.6, 23.8, { bg: C.red, color: C.text });
}

function sceneTitan(ctx, u, t) {
  background(ctx, u, CX, H * 0.3, 0.2, { color: '63,207,142' });
  rays(ctx, CX, H * 0.25, u, 0.35, 16, '120,255,190');
  line(ctx, 'А ТИТАН', CX, S.y + 90, 120, C.text, u, 29.8, 35.6, { stagger: 0.03 });
  line(ctx, 'ДЕЛАЕТ НАОБОРОТ', CX, S.y + 200, K.fit(ctx, 'ДЕЛАЕТ НАОБОРОТ', 100), C.green, u, 30.2, 35.6, { stagger: 0.02, from: 1.8 });
  TITAN.forEach((s, i) => {
    const a = 31 + i * 0.75, y = H * 0.4 + i * 170;
    card(ctx, S.x, y, S.w, 140, u, a, 35.6, (c, w, h) => {
      const k = springU(u, a + 0.15, SPRING.bouncy);
      c.save(); c.translate(-w / 2 + 70, 0); c.scale(k, k);
      c.beginPath(); c.arc(0, 0, 38, 0, Math.PI * 2); c.fillStyle = C.green; c.fill();
      c.lineWidth = 9; c.strokeStyle = C.ink; c.lineCap = 'round'; c.beginPath(); c.moveTo(-16, 1); c.lineTo(-4, 14); c.lineTo(18, -12); c.stroke(); c.restore();
      line(c, s, -w / 2 + 130, 16, 48, C.text, u, a + 0.1, null, { align: 'left', face: UI, weight: 800, track: 0, stagger: 0.006, shadow: false });
    }, { fromX: 900, fromY: 0, rot: 0.15, r: 26, stroke: 'rgba(63,207,142,0.55)' });
    sparks(ctx, S.x + 70, y + 70, u, a + 0.15, 14, 90 + i, { speed: 700 });
  });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.45, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.45, u, 0.5, 18);
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ in: 999 }, { in: 999 }, { in: 999 }, { in: 999 }, { in: 999 }, { x: 0, y: 0.35, z: 1.5, ry: (u - 36) * 1.1, in: 35.9, stagger: 0, scale: 1.2 }] });
  bands(ctx, 520, 1300);
  line(ctx, 'СКОЛЬКО ИЗ 5', CX, S.y + 80, K.fit(ctx, 'СКОЛЬКО ИЗ 5', 120), C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'ПРО ТЕБЯ?', CX, S.y + 210, 140, 'GOLD', u, 36.4, null, { stagger: 0.03, rot: 0.4 });
  line(ctx, 'честно, в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet([...['1', '2', '3', '4', '5'].map((s, i) => ({ str: s, size: 1.2, depth: 0.5, mat: i === 4 ? RED : GOLD, bevel: 0.05 })), { str: '?', size: 1.6, depth: 0.5, mat: GOLD, bevel: 0.05 }]);
    PHONE = await phoneSet(['review', 'coach']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], ...AT.map((a) => [a + 2, 16]), [22.6, 30], [30, 20], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneHabits(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'УЗНАЙ, ПОЧЕМУ СЛИЛ', l2: 'БОТ РАЗБЕРЁТ КАТКУ', l3: 'кинь матч — разбор бесплатно' });
    else if (u < 36) sceneTitan(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 22.6, 0.45, '255,90,90');
    for (const b of [0, ...AT, 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
