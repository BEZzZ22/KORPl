// Угадай героя по 3 предметам: инвентарь из трёх слотов, отсчёт 3-2-1, ответ золотыми 3-D буквами. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, text } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

const ROUNDS = [
  { at: 4, items: ['BATTLE FURY', 'MANTA STYLE', 'ABYSSAL BLADE'], hero: 'ANTI-MAGE' },
  { at: 10, items: ['RADIANCE', 'BLADE MAIL', 'HEART OF TARRASQUE'], hero: 'SPECTRE' },
  { at: 16, items: ['BLINK DAGGER', 'BLACK KING BAR', 'REFRESHER ORB'], hero: 'ENIGMA' },
];
const BONUS = { at: 30, items: ['AETHER LENS', 'DAGON', 'ETHEREAL BLADE'] };
const PITCH = ['B5', 'D6', 'F#6'];

const HITS = [
  [0, 'hook', 'impact'], [0.6, 'угадай', 'pop', { pitch: 'B5' }], [1.3, 'по 3 предметам', 'pop', { pitch: 'F#6' }],
  ...ROUNDS.flatMap((r, i) => [
    [r.at, `раунд ${i + 1}`, 'click'],
    ...r.items.map((_, j) => [r.at + 0.5 + j * 0.5, r.items[j], 'pop', { pitch: PITCH[j] }]),
    [r.at + 2.5, '3', 'tick'], [r.at + 3, '2', 'tick'], [r.at + 3.5, '1', 'tick'], [r.at + 4, r.hero, 'impact'],
  ]),
  [22, 'сколько угадал', 'pop', { pitch: 'B6' }],
  ...K.botHits(24),
  [30, 'бонус', 'impact'], ...BONUS.items.map((_, j) => [30.8 + j * 0.5, BONUS.items[j], 'pop', { pitch: PITCH[j] }]),
  [33, 'ответ в комменты', 'thud'],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'F#6' }], [40, 'pill', 'bell', { pitch: 'B5' }],
];

let TYPE = null, PHONE = null;

// one inventory slot: a dark tile with a gold rim and the item's name, landing with a spin
function slot(ctx, name, x, y, w, h, u, a, out) {
  card(ctx, x, y, w, h, u, a, out, (c, ww, hh, k) => {
    const g = c.createLinearGradient(0, -hh / 2, 0, hh / 2);
    g.addColorStop(0, 'rgba(230,184,88,0.18)'); g.addColorStop(1, 'rgba(230,184,88,0.02)');
    rrect(c, -ww / 2 + 8, -hh / 2 + 8, ww - 16, hh - 16, 20); c.fillStyle = g; c.fill();
    const words = name.split(' ');
    const size = Math.min(78, Math.floor((ww - 40) / Math.max(...words.map((s) => s.length)) * 1.55));
    words.forEach((wd, i) => text(c, wd, 0, (i - (words.length - 1) / 2) * size * 1.05 + size * 0.35, font(size, 900, D), C.text, 'center'));
  }, { fromY: 500, rot: 0.6, r: 26, stroke: 'rgba(230,184,88,0.85)', spring: SPRING.bouncy });
}

function inventory(ctx, items, u, a, out) {
  const w = (S.w - 40) / 3, h = w * 1.05, y = H * 0.3;
  items.forEach((it, j) => slot(ctx, it, S.x + j * (w + 20), y, w, h, u, a + 0.5 + j * 0.5, out));
  items.forEach((_, j) => sparks(ctx, S.x + j * (w + 20) + w / 2, y + h / 2, u, a + 0.5 + j * 0.5, 16, 70 + j, { speed: 900 }));
}

function sceneRounds(ctx, u, t) {
  const r = u < 4 ? null : ROUNDS[clamp(Math.floor((u - 4) / 6), 0, 2)];
  const reveal = r ? Math.exp(-Math.max(0, u - r.at - 4) * 1.4) * (u >= r.at + 4 ? 1 : 0) : 0;
  background(ctx, u, CX, H * 0.62, 0.16 + reveal * 0.5);
  rays(ctx, CX, H * 0.68, u, 0.25 + reveal * 0.8, 18);
  if (u < 4) {
    line(ctx, 'УГАДАЙ ГЕРОЯ', CX, S.y + 140, K.fit(ctx, 'УГАДАЙ ГЕРОЯ', 140), 'GOLD', u, -0.4, 3.6, { stagger: 0.03, rot: -0.3 });
    line(ctx, 'ПО 3 ПРЕДМЕТАМ', CX, S.y + 250, K.fit(ctx, 'ПО 3 ПРЕДМЕТАМ', 100), C.text, u, 1.3, 3.6, { stagger: 0.02 });
    inventory(ctx, ['?', '?', '?'], u, -0.2, 3.6);
    line(ctx, 'Страж угадает один. А ты?', CX, S.y + S.h - 20, 48, C.muted, u, 2, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
    return;
  }
  const i = ROUNDS.indexOf(r), a = r.at, out = a + 5.6;
  line(ctx, `РАУНД ${i + 1}`, CX, S.y + 90, 70, C.gold, u, a - 0.1, out, { face: UI, weight: 800, track: 0.14, stagger: 0.02 });
  line(ctx, ['ЛЁГКИЙ', 'СРЕДНИЙ', 'ДЛЯ ТИТАНОВ'][i], CX, S.y + 190, 90, C.text, u, a + 0.1, out, { stagger: 0.02 });
  inventory(ctx, r.items, u, a, out);
  // countdown ring
  if (u >= a + 2.4 && u < a + 4) {
    const n = 3 - Math.floor((u - a - 2.5) / 0.5), p = ((u - a - 2.5) % 0.5) / 0.5;
    const cy = H * 0.66;
    ctx.save(); ctx.lineWidth = 14; ctx.strokeStyle = C.gold; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(CX, cy, 120, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - clamp(p))); ctx.stroke(); ctx.restore();
    if (n >= 1 && n <= 3) { const k = springU(u, a + 2.5 + (3 - n) * 0.5, SPRING.snappy); ctx.save(); ctx.translate(CX, cy + 55); ctx.scale(k, k); text(ctx, String(n), 0, 0, font(160, 900, D), C.text, 'center'); ctx.restore(); }
  }
  // the answer in 3-D gold
  const words = ROUNDS.map((rr, j) => ({ x: 0, y: -1.5, z: 1, ry: 0.25 * Math.sin(t * 1.3), in: rr.at + 3.85, out: rr.at + 5.6, stagger: 0.04, scale: Math.min(1, 3.9 / TYPE.words[j].width) }));
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [...words, { in: 999 }] });
  sparks(ctx, CX, H * 0.68, u, a + 4, 70, 80 + i, { speed: 1800 });
  if (u >= a + 4) line(ctx, 'ОТВЕТ', CX, H * 0.58, 44, C.muted, u, a + 4, out, { face: UI, weight: 800, track: 0.2, stagger: 0.01 });
  if (u >= 21.8) {
    ctx.fillStyle = `rgba(9,9,11,${0.6 * prog(u, 21.8, 22.2)})`; ctx.fillRect(0, 0, W, H);
    pill(ctx, 'СКОЛЬКО УГАДАЛ?', CX, H * 0.5, 72, u, 22, 23.6);
  }
}

function sceneBonus(ctx, u, t) {
  background(ctx, u, CX, H * 0.6, 0.22, { color: '240,88,93' });
  rays(ctx, CX, H * 0.68, u, 0.4, 18, '255,120,120');
  line(ctx, 'БОНУС', CX, S.y + 90, 70, C.red, u, 29.8, 35.6, { face: UI, weight: 800, track: 0.2, stagger: 0.02 });
  line(ctx, 'ДЛЯ САМЫХ УМНЫХ', CX, S.y + 190, K.fit(ctx, 'ДЛЯ САМЫХ УМНЫХ', 90), C.text, u, 30, 35.6, { stagger: 0.02 });
  inventory(ctx, BONUS.items, u, 30.3, 35.6);
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ in: 999 }, { in: 999 }, { in: 999 }, { x: 0, y: -1.2, z: 1, ry: (u - 33) * 1.2, in: 33, out: 35.6, stagger: 0, scale: 1.1 }] });
  line(ctx, 'ответ пиши в комменты', CX, S.y + S.h - 20, 52, C.text, u, 33.4, 35.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.55, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.55, u, 0.5, 18);
  G.renderSet(ctx, TYPE, t, u, { cam: [0, 0, 13], words: [{ in: 999 }, { in: 999 }, { in: 999 }, { x: 0, y: -0.2, z: 1, ry: (u - 36) * 0.9, in: 35.9, stagger: 0, scale: 1.6 }] });
  bands(ctx, 520, 1300);
  line(ctx, 'СКОЛЬКО', CX, S.y + 80, 120, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'ИЗ ЧЕТЫРЁХ?', CX, S.y + 210, K.fit(ctx, 'ИЗ ЧЕТЫРЁХ?', 140), 'GOLD', u, 36.4, null, { stagger: 0.03, rot: 0.4 });
  line(ctx, 'пиши счёт в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet([...ROUNDS.map((r) => ({ str: r.hero, size: 0.95, depth: 0.35, mat: GOLD, bevel: 0.04 })), { str: '?', size: 2.2, depth: 0.6, mat: GOLD, bevel: 0.06 }]);
    PHONE = await phoneSet(['review', 'killers']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], [8, 24], [14, 24], [20, 24], [30, 22], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneRounds(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'А ТВОЯ СБОРКА', l2: 'ТОЧНО НОРМ?', l3: 'кинь матч — бот покажет ошибки' });
    else if (u < 36) sceneBonus(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    for (const b of [0, 8, 14, 20, 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
