// Какой ты саппорт: пять коллекционных карточек (редкость, статы-пипсы) переворачиваются по биту,
// в конце веером «выбирай свою». Мемный тест, зовёт в комменты. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, text, hash01 } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

const PURPLE = '#a970ff';
const CARDS = [
  { name: 'ВАРД-МАСТЕР', rare: 'ОБЫЧНЫЙ', col: C.green, desc: ['25 вардов за игру', 'и ноль киллов'], stats: [['ВАРДЫ', 5], ['КИЛЛЫ', 0], ['НЕРВЫ', 3]] },
  { name: 'САППОРТ-КЕРРИ', rare: 'РЕДКИЙ', col: C.blue, desc: ['Мидас на 12-й минуте', 'и «мне нужен фарм»'], stats: [['ФАРМ', 5], ['ВАРДЫ', 0], ['КАРМА', 1]] },
  { name: 'КАМИКАДЗЕ', rare: 'РЕДКИЙ', col: C.blue, desc: ['первый в драке,', 'первый в таверне'], stats: [['ИНИЦИАЦИЯ', 5], ['ВЫЖИВАНИЕ', 0], ['СМЕЛОСТЬ', 5]] },
  { name: 'ПРИЗРАК', rare: 'ЭПИЧЕСКИЙ', col: PURPLE, desc: ['весь бой «стакал кемп»', 'где ты был, брат?'], stats: [['СТАКИ', 5], ['ПОЛЬЗА', 1], ['СКРЫТНОСТЬ', 5]] },
  { name: 'ТРЕНЕР ИЗ ЧАТА', rare: 'ЛЕГЕНДАРНЫЙ', col: C.gold, desc: ['300 сообщений', 'и ни одного смока'], stats: [['ЧАТ', 5], ['СМОКИ', 0], ['СОВЕТЫ', 5]] },
];
const AT = [4, 8, 12, 16, 20];

const HITS = [
  [0, 'hook', 'impact'], [0.6, 'какой ты', 'pop', { pitch: 'G5' }], [1.3, 'саппорт', 'pop', { pitch: 'D6' }],
  ...AT.flatMap((a, i) => [[a, `#${i + 1}`, 'whoosh'], [a + 0.8, 'flip', 'impact'], ...[0, 1, 2].map((j) => [a + 1.6 + j * 0.3, 'stat', 'blip', { pitch: ['G5', 'B5', 'D6'][j] }])]),
  ...K.botHits(24),
  [30, 'fan', 'whoosh'], ...AT.map((_, i) => [30.4 + i * 0.25, 'card', 'click']), [32.5, 'выбирай', 'pop', { pitch: 'D6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'G6' }], [40, 'pill', 'bell', { pitch: 'D6' }],
];

let TYPE = null, PHONE = null;
const CW = 640, CHh = 900;

function back(c) {
  const g = c.createLinearGradient(0, -CHh / 2, 0, CHh / 2); g.addColorStop(0, '#1c1a14'); g.addColorStop(1, '#0d0d0f');
  rrect(c, -CW / 2, -CHh / 2, CW, CHh, 40); c.fillStyle = g; c.fill();
  c.lineWidth = 8; c.strokeStyle = 'rgba(230,184,88,0.8)'; c.stroke();
  c.save(); c.globalAlpha = 0.18; c.strokeStyle = C.gold; c.lineWidth = 2;
  for (let y = -CHh / 2 + 60; y < CHh / 2; y += 70) for (let x = -CW / 2 + 40 + ((y / 70) % 2 ? 35 : 0); x < CW / 2; x += 70) {
    c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; c[k ? 'lineTo' : 'moveTo'](x + 26 * Math.cos(a), y + 26 * Math.sin(a)); } c.closePath(); c.stroke();
  }
  c.restore();
  text(c, '?', 0, 110, font(330, 900, D), C.gold, 'center');
}

function front(c, d, i, u, a) {
  const g = c.createLinearGradient(0, -CHh / 2, 0, CHh / 2); g.addColorStop(0, '#18181b'); g.addColorStop(1, '#0b0b0d');
  rrect(c, -CW / 2, -CHh / 2, CW, CHh, 40); c.fillStyle = g; c.fill();
  c.lineWidth = 10; c.strokeStyle = d.col; c.stroke();
  // art panel: a big glowing number
  rrect(c, -CW / 2 + 36, -CHh / 2 + 110, CW - 72, 330, 26); c.fillStyle = 'rgba(255,255,255,0.04)'; c.fill();
  c.save(); c.globalCompositeOperation = 'lighter'; const r = c.createRadialGradient(0, -CHh / 2 + 275, 0, 0, -CHh / 2 + 275, 260);
  r.addColorStop(0, d.col + '66'); r.addColorStop(1, d.col + '00'); c.fillStyle = r; c.fillRect(-CW / 2, -CHh / 2 + 110, CW, 330); c.restore();
  text(c, String(i + 1), 0, -CHh / 2 + 380, font(300, 900, D), d.col, 'center');
  text(c, d.rare, -CW / 2 + 40, -CHh / 2 + 70, font(30, 800, UI), d.col, 'left');
  c.font = font(64, 900, D); const fs = Math.min(64, 64 * (CW - 80) / c.measureText(d.name).width);
  text(c, d.name, 0, -CHh / 2 + 530, font(fs, 900, D), C.text, 'center');
  d.desc.forEach((s, j) => text(c, s, 0, -CHh / 2 + 590 + j * 44, font(36, 600, UI), C.muted, 'center'));
  d.stats.forEach(([lab, v], j) => {
    const y = -CHh / 2 + 720 + j * 56;
    text(c, lab, -CW / 2 + 50, y + 10, font(28, 800, UI), C.text, 'left');
    for (let p = 0; p < 5; p++) {
      const k = springU(u, a + 1.6 + j * 0.3 + p * 0.05, SPRING.bouncy) * (p < v ? 1 : 0);
      rrect(c, 20 + p * 54, y - 14, 44, 28, 8); c.fillStyle = 'rgba(255,255,255,0.08)'; c.fill();
      if (k > 0) { c.save(); c.translate(42 + p * 54, y); c.scale(k, k); rrect(c, -22, -14, 44, 28, 8); c.fillStyle = d.col; c.fill(); c.restore(); }
    }
  });
}

// a card at (x,y): flip 1 = back up, 0 = face up
function tcard(ctx, i, x, y, s, flip, rot, u, a) {
  const ang = flip * Math.PI, sx = Math.cos(ang);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * Math.max(0.02, Math.abs(sx)), s);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30; rrect(ctx, -CW / 2, -CHh / 2, CW, CHh, 40); ctx.fillStyle = '#0b0b0d'; ctx.fill(); ctx.restore();
  if (sx < 0) back(ctx); else front(ctx, CARDS[i], i, u, a);
  ctx.restore();
}

function sceneCards(ctx, u, t) {
  const i = u < 4 ? -1 : clamp(Math.floor((u - 4) / 4), 0, 4);
  const a = i >= 0 ? AT[i] : 0, d = i >= 0 ? CARDS[i] : null;
  const pop = i >= 0 ? Math.exp(-Math.max(0, u - a - 0.8) * 2) * (u >= a + 0.8 ? 1 : 0) : 0;
  const rgb = d ? M.hexRgb(d.col).join(',') : undefined;
  background(ctx, u, CX, H * 0.5, 0.14 + pop * 0.5, { color: rgb });
  rays(ctx, CX, H * 0.52, u, 0.25 + pop * 0.8, 18, rgb);
  if (u < 4) {
    G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ x: 0, y: -0.9, z: 1, ry: u * 1.5, in: -0.5, out: 3.6, stagger: 0, scale: 1.4 }] });
    [-1, 0, 1].forEach((k) => { const kk = springU(u, 0.3 + (k + 1) * 0.2, SPRING.bouncy); if (kk > 0) tcard(ctx, 0, CX + k * 300 * kk, H * 0.62 + Math.abs(k) * 60, 0.5, 1, k * 0.3 * kk, u, 0); });
    bands(ctx, 520, 1400, 0.7);
    line(ctx, 'КАКОЙ ТЫ', CX, S.y + 110, 130, C.text, u, -0.4, 3.6, { stagger: 0.03 });
    line(ctx, 'САППОРТ?', CX, S.y + 240, 150, 'GOLD', u, 0.6, 3.6, { stagger: 0.04, rot: -0.3 });
    line(ctx, 'запомни номер своей карты', CX, S.y + S.h - 20, 50, C.muted, u, 1.6, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
    return;
  }
  // in from below back-up, flip on a+0.8, out to the side at a+3.6
  const kin = springU(u, a - 0.1, SPRING.snappy), kout = E.inCubic(prog(u, a + 3.55, a + 4));
  const flip = 1 - E.outBack(prog(u, a + 0.55, a + 1.0));
  const x = CX + kout * (i % 2 ? -1 : 1) * 1200, y = H * 0.53 + (1 - kin) * 1300;
  const s = 1 + 0.06 * wobble(u - a - 1, 2, 4);
  tcard(ctx, i, x, y, s, flip, (1 - kin) * 0.4 + kout * 0.5 * (i % 2 ? -1 : 1), u, a);
  sparks(ctx, CX, H * 0.53, u, a + 0.8, 60, 20 + i, { speed: 1700 });
  line(ctx, `КАРТА #${i + 1}`, CX, S.y + 40, 64, d.col, u, a - 0.1, a + 3.6, { face: UI, weight: 800, track: 0.14, stagger: 0.02 });
  if (u >= 21.8) {
    ctx.fillStyle = `rgba(9,9,11,${0.6 * prog(u, 21.8, 22.2)})`; ctx.fillRect(0, 0, W, H);
    pill(ctx, 'ЗАПОМНИЛ СВОЮ?', CX, H * 0.5, 72, u, 22, 23.6);
  }
}

function sceneFan(ctx, u, t) {
  background(ctx, u, CX, H * 0.6, 0.2);
  rays(ctx, CX, H * 0.62, u, 0.4, 18);
  CARDS.forEach((_, i) => {
    const k = springU(u, 30.4 + i * 0.25, SPRING.bouncy), ang = (i - 2) * 0.22 * k;
    const px = CX, py = H * 0.5 + 1000, r = 1000;
    tcard(ctx, i, px + Math.sin(ang) * r, py - Math.cos(ang) * r + (1 - k) * 900, 0.5, 0, ang, u, -10);
  });
  line(ctx, 'ВЫБИРАЙ', CX, S.y + 90, 130, C.text, u, 29.8, 35.6, { stagger: 0.03 });
  line(ctx, 'СВОЮ', CX, S.y + 220, 150, 'GOLD', u, 32.4, 35.6, { stagger: 0.04, rot: 0.3 });
  line(ctx, 'честно — кто ты в последней катке?', CX, S.y + S.h - 20, 46, C.text, u, 33, 35.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.5, u, 0.5, 18);
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ x: 0, y: 0.3, z: 1.5, ry: (u - 36) * 1.1, in: 35.9, stagger: 0, scale: 1.2 }] });
  bands(ctx, 520, 1300);
  line(ctx, 'А ТЫ КТО?', CX, S.y + 80, 130, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'НОМЕР — В КОММЕНТЫ', CX, S.y + 210, K.fit(ctx, 'НОМЕР — В КОММЕНТЫ', 90), 'GOLD', u, 36.4, null, { stagger: 0.02, rot: 0.4 });
  line(ctx, 'и отметь своего саппорта', CX, S.y + S.h - 200, 50, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet([{ str: '?', size: 1.6, depth: 0.5, mat: GOLD, bevel: 0.05 }]);
    PHONE = await phoneSet(['profile', 'review']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], ...AT.map((a) => [a + 0.8, 18]), [30, 16], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneCards(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'А КАКОЙ ТЫ НА САМОМ ДЕЛЕ?', l2: 'БОТ СКАЖЕТ ПО МАТЧУ', l3: 'кинь матч — разбор бесплатно' });
    else if (u < 36) sceneFan(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    for (const b of [0, ...AT.map((a) => a + 0.8), 36]) glitch(ctx, u, b, 36);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
