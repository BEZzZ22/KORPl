// Что бот найдёт в твоей катке: 3-D телефон с настоящими экранами Mini App, на каждую фичу телефон
// крутится, а нужный кусок экрана вылетает из него крупной карточкой. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, text } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

const SCREENS = ['home', 'review', 'killers', 'deaths', 'phases', 'chat', 'map'];
// feature: screen index, crop [y0, h] of the 780x1688 screenshot, copy
const FEATS = [
  { s: 1, crop: [280, 540], t1: 'ОЦЕНКА КАТКИ', t2: 'и главные ошибки, по-человечески' },
  { s: 2, crop: [90, 650], t1: 'КТО СЛИЛ', t2: 'и какой вклад был у тебя' },
  { s: 3, crop: [80, 560], t1: 'ГДЕ ТЫ УМИРАЛ', t2: 'и какие смерти повторялись' },
  { s: 4, crop: [1140, 600], t1: 'ИГРА ПО ФАЗАМ', t2: 'лайн, мидгейм, поздняя игра' },
  { s: 5, crop: [500, 640], t1: 'СПРОСИ ТРЕНЕРА', t2: 'про свою катку, своими словами' },
];
const AT = [4, 8, 12, 16, 20];
const MAPCROP = [200, 640];

const HITS = [
  [0, 'hook', 'impact'], [0.6, 'что бот', 'pop', { pitch: 'E5' }], [1.3, 'найдёт', 'pop', { pitch: 'B5' }], [2, 'phone', 'thud'],
  ...AT.flatMap((a, i) => [[a, `#${i + 1}`, 'whoosh', { len: 0.45, from: 700, to: 2600 }], [a + 1.2, 'card out', 'impact'], [a + 1.8, 'label', 'pop', { pitch: ['E6', 'G6', 'B6', 'D7', 'E7'][i] }]]),
  [24, 'how', 'impact'], [24.8, 'step 1', 'click'], [25.6, 'step 2', 'click'], [26.4, 'step 3', 'click'], [28, '@DotaRazbor_bot', 'bell', { pitch: 'E6' }],
  [30, 'а ещё', 'whoosh'], [31, 'карта', 'impact'], [32.6, 'реплей', 'pop', { pitch: 'B5' }],
  [36, 'end', 'impact'], [38, 'free', 'pop', { pitch: 'E6' }], [40, 'pill', 'bell', { pitch: 'B5' }],
];

let PHONE = null;
const IMG = {};

// a crop of the real screenshot as a floating card
function popCard(ctx, name, [y0, h], cx, cy, u, a, out) {
  const im = IMG[name]; if (!im) return;
  const k = springU(u, a, SPRING.bouncy), ko = out != null ? E.inBack(prog(u, out - 0.4, out), 1.6) : 0;
  if (k <= 0.001 || ko >= 1) return;
  const w = S.w - 60, hh = w * h / 780, s = lerp(0.25, 1, k) * (1 - ko);
  ctx.save(); ctx.translate(cx, lerp(H * 0.62, cy, k) - ko * 300); ctx.rotate((1 - k) * -0.3 + 0.02 * wobble(u - a, 1.5, 3)); ctx.scale(s, s);
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 40;
  rrect(ctx, -w / 2, -hh / 2, w, hh, 32); ctx.fillStyle = '#0b0b0d'; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.save(); rrect(ctx, -w / 2, -hh / 2, w, hh, 32); ctx.clip();
  ctx.drawImage(im, 0, y0, 780, h, -w / 2, -hh / 2, w, hh);
  // light sweep across the card
  const sx = lerp(-w, w, prog(u, a + 0.3, a + 1.3));
  const g = ctx.createLinearGradient(sx - 150, 0, sx + 150, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -hh / 2, w, hh);
  ctx.restore();
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(230,184,88,0.9)'; rrect(ctx, -w / 2, -hh / 2, w, hh, 32); ctx.stroke();
  ctx.restore();
}

function phone(ctx, u, t, o) {
  G.renderSet(ctx, PHONE, t, u, { cam: [0, 0.2, 12.5], pos: o.pos, rot: o.rot, scale: o.scale, screen: o.screen });
}

function sceneHook(ctx, u, t) {
  background(ctx, u, CX, H * 0.6, 0.22);
  rays(ctx, CX, H * 0.62, u, 0.45, 16);
  const k = springU(u, 1.6, { stiffness: 140, damping: 14 });
  phone(ctx, u, t, { pos: [0, lerp(-9, -0.9, k), 0], rot: [lerp(-0.8, -0.1, k), lerp(-3, -0.25, k) + 0.15 * Math.sin(t), lerp(0.5, 0.03, k)], scale: 0.9, screen: 0 });
  sparks(ctx, CX, H * 0.6, u, 2, 50, 7, { up: true, spread: 1.6, speed: 1500 });
  bands(ctx, 620, H, 0.9);
  line(ctx, 'ЧТО БОТ НАЙДЁТ', CX, S.y + 100, K.fit(ctx, 'ЧТО БОТ НАЙДЁТ', 112), C.text, u, -0.4, 3.6, { stagger: 0.02 });
  line(ctx, 'В ТВОЕЙ КАТКЕ', CX, S.y + 220, K.fit(ctx, 'В ТВОЕЙ КАТКЕ', 120), 'GOLD', u, 0.6, 3.6, { stagger: 0.03, rot: -0.3 });
}

function sceneFeats(ctx, u, t) {
  const i = clamp(Math.floor((u - 4) / 4), 0, 4), a = AT[i], f = FEATS[i];
  const hit = Math.exp(-Math.max(0, u - a - 1.2) * 2) * (u >= a + 1.2 ? 1 : 0);
  background(ctx, u, CX, H * 0.55, 0.16 + hit * 0.4);
  rays(ctx, CX, H * 0.55, u, 0.25 + hit * 0.6, 18);
  speed(ctx, u, Math.exp(-Math.max(0, u - a) * 3) * 0.8, i % 2 ? 1 : -1, 60 + i);
  // full spin, the new screen shows from the half-turn on
  const sp = E.inOutCubic(prog(u, a - 0.2, a + 0.7)), dir = i % 2 ? -1 : 1;
  const prev = i === 0 ? 0 : FEATS[i - 1].s;
  const push = E.outCubic(prog(u, a + 0.7, a + 4));
  phone(ctx, u, t, { pos: [0, -1.1, push * 1.2], rot: [-0.06 + 0.04 * Math.sin(t), dir * sp * Math.PI * 2 + 0.12 * Math.sin(t * 0.8), 0.02 * Math.sin(t * 0.6)], scale: 0.9, screen: sp > 0.5 ? f.s : prev });
  ctx.fillStyle = `rgba(9,9,11,${0.45 * clamp(springU(u, a + 1.1, SPRING.snappy)) * (1 - prog(u, a + 3.4, a + 3.9))})`; ctx.fillRect(0, 0, W, H);
  popCard(ctx, SCREENS[f.s], f.crop, CX, H * 0.5, u, a + 1.2, a + 3.9);
  sparks(ctx, CX, H * 0.55, u, a + 1.2, 50, 30 + i, { speed: 1700 });
  bands(ctx, 520, H, 0.9);
  line(ctx, `${i + 1} / 5`, CX, S.y + 40, 54, C.gold, u, a - 0.1, a + 3.8, { face: UI, weight: 800, track: 0.14, stagger: 0.02 });
  line(ctx, f.t1, CX, S.y + 160, K.fit(ctx, f.t1, 110), C.text, u, a + 0.1, a + 3.8, { stagger: 0.02, from: 1.6 });
  line(ctx, f.t2, CX, S.y + S.h - 20, 50, C.text, u, a + 1.8, a + 3.8, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

function sceneHow(ctx, u, t) {
  background(ctx, u, CX, H * 0.55, 0.22);
  rays(ctx, CX, H * 0.6, u, 0.4, 16);
  const k = springU(u, 23.9, SPRING.snappy), ex = E.inBack(prog(u, 29.5, 30), 1.4);
  phone(ctx, u, t, { pos: [0, -1.3 - ex * 9, 0], rot: [-0.08, lerp(-1.2, -0.2, k) + 0.12 * Math.sin(t), 0.03], scale: 0.75, screen: 0 });
  line(ctx, 'КАК ЭТО РАБОТАЕТ', CX, S.y + 70, K.fit(ctx, 'КАК ЭТО РАБОТАЕТ', 96), C.text, u, 23.8, 29.6, { stagger: 0.02 });
  ['открой @DotaRazbor_bot', 'кинь ID матча или ссылку', 'получи разбор бесплатно'].forEach((s, j) => {
    const a = 24.8 + j * 0.8;
    card(ctx, S.x, S.y + 170 + j * 120, S.w, 100, u, a, 29.6, (c, w, h) => {
      text(c, String(j + 1), -w / 2 + 50, 18, font(52, 900, D), C.gold, 'center');
      line(c, s, -w / 2 + 100, 16, 44, C.text, u, a + 0.1, null, { align: 'left', face: UI, weight: 800, track: 0, stagger: 0.006, shadow: false });
    }, { fromX: j % 2 ? -900 : 900, fromY: 0, rot: 0.15, r: 24, stroke: 'rgba(230,184,88,0.5)' });
  });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 40, 64, u, 28, 29.6);
}

function sceneMap(ctx, u, t) {
  const hit = Math.exp(-Math.max(0, u - 31) * 2) * (u >= 31 ? 1 : 0);
  background(ctx, u, CX, H * 0.55, 0.18 + hit * 0.4, { color: '63,207,142' });
  rays(ctx, CX, H * 0.55, u, 0.3 + hit * 0.5, 18, '120,255,190');
  const sp = E.inOutCubic(prog(u, 29.9, 30.8));
  phone(ctx, u, t, { pos: [0, -1.1, 0.4], rot: [-0.06, sp * Math.PI * 2 + 0.1 * Math.sin(t), 0.02], scale: 0.9, screen: sp > 0.5 ? 6 : 0 });
  ctx.fillStyle = `rgba(9,9,11,${0.4 * clamp(springU(u, 31, SPRING.snappy)) * (1 - prog(u, 35.4, 36))})`; ctx.fillRect(0, 0, W, H);
  popCard(ctx, 'map', MAPCROP, CX, H * 0.5, u, 31, 35.9);
  sparks(ctx, CX, H * 0.56, u, 31, 60, 77, { speed: 1800 });
  bands(ctx, 520, H, 0.9);
  line(ctx, 'А ЕЩЁ', CX, S.y + 40, 54, C.green, u, 29.9, 35.8, { face: UI, weight: 800, track: 0.14, stagger: 0.02 });
  line(ctx, 'ПОВТОР НА КАРТЕ', CX, S.y + 160, K.fit(ctx, 'ПОВТОР НА КАРТЕ', 110), C.text, u, 30.2, 35.8, { stagger: 0.02, from: 1.6 });
  line(ctx, 'вся катка: кто, где и когда', CX, S.y + S.h - 20, 50, C.text, u, 32.6, 35.8, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.6, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.6, u, 0.5, 18);
  const k = springU(u, 35.9, SPRING.bouncy);
  phone(ctx, u, t, { pos: [0, -0.6, 0], rot: [-0.08, lerp(Math.PI * 2, -0.2, k) + 0.12 * Math.sin(t), 0.03], scale: 0.72, screen: 0 });
  bands(ctx, 520, 1250);
  line(ctx, 'ПРОВЕРЬ', CX, S.y + 80, 130, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'СВОЮ КАТКУ', CX, S.y + 210, K.fit(ctx, 'СВОЮ КАТКУ', 140), 'GOLD', u, 36.4, null, { stagger: 0.03, rot: 0.4 });
  line(ctx, 'бесплатно, прямо в Телеграме', CX, S.y + S.h - 200, 50, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    PHONE = await phoneSet(SCREENS);
    await Promise.all(SCREENS.map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = res; im.src = `../common/assets/app_${n}.png`; })));
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 20], [2, 14], ...AT.map((a) => [a + 1.2, 18]), [24, 16], [31, 20], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 4) sceneHook(ctx, u, t);
    else if (u < 24) sceneFeats(ctx, u, t);
    else if (u < 30) sceneHow(ctx, u, t);
    else if (u < 36) sceneMap(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    for (const b of [0, ...AT, 24, 30, 36]) glitch(ctx, u, b, 36);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
