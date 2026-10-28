// Тир-лист самых бесящих героев: 3-D буквы тиров, карточки героев влетают по биту, снизу вверх до S. 120 BPM, 44 beats.
// Opinion piece: the ranking is ours and the video says so; viewers argue in the comments.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD, IVORY, RED, GREEN } from '../common/sets/type3d.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font } = M;
const { C, UI, D, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;

// rows top to bottom: S, A, B, C; revealed bottom-up
const ROWS = [
  { t: 'S', mat: RED, col: C.red, tag: 'ВЫКЛЮЧАЮ ИГРУ', heroes: ['TECHIES', 'MEEPO', 'BROODMOTHER'], at: 16 },
  { t: 'A', mat: GOLD, col: C.gold, tag: 'ПИШУ В ЧАТ', heroes: ['ARC WARDEN', 'RIKI', 'SNIPER'], at: 12 },
  { t: 'B', mat: IVORY, col: C.text, tag: 'ВЗДЫХАЮ', heroes: ['PUDGE', 'ZEUS', 'PHANTOM ASSASSIN'], at: 8 },
  { t: 'C', mat: GREEN, col: C.green, tag: 'ТЕРПИМО', heroes: ['CRYSTAL MAIDEN', 'WRAITH KING', 'OGRE MAGI'], at: 4 },
];
const WY = [2.4, 0.95, -0.5, -1.95];

const HITS = [
  [0, 'hook', 'impact'], [0.6, 'тир-лист', 'pop', { pitch: 'G5' }], [1.3, 'бесящих', 'pop', { pitch: 'D6' }],
  ...ROWS.flatMap((r) => [[r.at, r.t, r.t === 'S' ? 'impact' : 'thud'], ...r.heroes.map((_, j) => [r.at + 0.6 + j * 0.5, r.heroes[j], 'click'])]),
  [20, 'согласен', 'pop', { pitch: 'G6' }],
  ...K.botHits(24),
  [30, 'чемпион', 'impact'], [31, 'techies', 'thud'], [32.5, 'reason', 'pop', { pitch: 'D6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'G6' }], [40, 'pill', 'bell', { pitch: 'D6' }],
];

let TYPE = null, PHONE = null;
const CAM = [0, 0, 13];

function sceneTiers(ctx, u, t, end = false) {
  const sHit = Math.exp(-Math.max(0, u - 16) * 1.2) * (u >= 16 ? 1 : 0);
  background(ctx, u, CX, H * 0.25, 0.14 + sHit * 0.4, { color: u >= 16 ? '240,88,93' : undefined });
  // row slabs (2-D) behind the letters
  ROWS.forEach((r, i) => {
    const y = H / 2 - WY[i] * 241.5;
    const k = springU(u, r.at - 0.2, SPRING.snappy);
    if (k <= 0) return;
    ctx.save(); ctx.globalAlpha = clamp(k * 2) * 0.9;
    rrect(ctx, lerp(-W, S.x - 20, k), y - 165, S.w + 40, 330, 30);
    ctx.fillStyle = 'rgba(17,17,19,0.85)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = r.col + '88'; ctx.stroke();
    ctx.restore();
    if (r.t === 'S') glow(ctx, S.x + 120, y, 400, 0.4 * sHit + 0.1, '240,88,93');
  });
  const words = ROWS.map((r, i) => (u < 4 && i === 0) ? { x: 0, y: -1.3, z: 1.5, ry: u * 1.6, in: -0.6, out: 3.3, stagger: 0, scale: 1.9 } : ({ x: -1.6, y: WY[i] - 0.45, z: 0.2, ry: 0.35 * Math.sin(t * 1.2 + i) + 0.2 * wobble(u - r.at, 1.5, 3), in: r.at - 0.15, stagger: 0, spring: SPRING.bouncy }));
  if (u < 4) rays(ctx, CX, H * 0.62, u, 0.5, 16, '255,120,120');
  G.renderSet(ctx, TYPE, t, u, { cam: CAM, words });
  ROWS.forEach((r, i) => {
    const y = H / 2 - WY[i] * 241.5;
    line(ctx, r.tag, S.x + 300, y - 110, 30, r.col, u, r.at + 0.2, null, { face: UI, weight: 800, track: 0.14, align: 'left', stagger: 0.008, shadow: false });
    r.heroes.forEach((h, j) => {
      const a = r.at + 0.6 + j * 0.5;
      card(ctx, S.x + 290, y - 85 + j * 88, S.w - 320, 76, u, a, null, (c, w, hh) => {
        line(c, h, -w / 2 + 24, 16, 44, C.text, u, a, null, { align: 'left', stagger: 0.006, shadow: false });
      }, { fromX: 700, fromY: 0, rot: 0.1, r: 18, stroke: r.col + '55' });
    });
    if (r.t === 'S') sparks(ctx, S.x + 150, y, u, r.at, 70, 4, { speed: 1800 });
  });
  if (u < 4) {
    bands(ctx, 760, H, 0.95);
    line(ctx, 'ТИР-ЛИСТ', CX, S.y + 120, 150, 'GOLD', u, -0.4, 3.6, { stagger: 0.04, rot: -0.3 });
    line(ctx, 'САМЫХ БЕСЯЧИХ', CX, S.y + 240, K.fit(ctx, 'САМЫХ БЕСЯЧИХ', 110), C.text, u, 0.6, 3.6, { stagger: 0.02 });
    line(ctx, 'ГЕРОЕВ ДОТЫ', CX, S.y + 350, 110, C.red, u, 1.3, 3.6, { stagger: 0.025, from: 1.8 });
  }
  if (u >= 19.8 && !end) {
    ctx.fillStyle = `rgba(9,9,11,${0.5 * prog(u, 19.8, 20.2)})`; ctx.fillRect(0, 0, W, H);
    pill(ctx, 'СОГЛАСЕН?', CX, H * 0.5, 80, u, 20, 23.6, { bg: C.red, color: C.text });
  }
}

function sceneChamp(ctx, u, t) {
  background(ctx, u, CX, H * 0.45, 0.25, { color: '240,88,93' });
  rays(ctx, CX, H * 0.45, u, 0.55, 18, '255,120,120');
  // the S drops in close and spins
  const words = ROWS.map((r, i) => ({ x: 0, y: i === 0 ? 0.6 : 99, z: 2, ry: (u - 30) * 1.4, in: i === 0 ? 29.8 : 999, stagger: 0, scale: 2.2 }));
  G.renderSet(ctx, TYPE, t, u, { cam: CAM, words });
  sparks(ctx, CX, H * 0.4, u, 30, 70, 9, { speed: 1800 });
  line(ctx, 'ЧЕМПИОН БЕСЯЧЕСТИ', CX, S.y + 70, K.fit(ctx, 'ЧЕМПИОН БЕСЯЧЕСТИ', 84), C.text, u, 29.8, 35.6, { stagger: 0.015 });
  line(ctx, 'TECHIES', CX, H * 0.66, 190, C.red, u, 31, 35.6, { stagger: 0.04, from: 2.4, spring: SPRING.snappy, rot: 0.3 });
  line(ctx, 'умираешь, а кто убил — непонятно', CX, H * 0.66 + 110, 46, C.muted, u, 32.5, 35.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

function sceneEnd(ctx, u, t) {
  sceneTiers(ctx, 23, t, true);   // the full list, held
  ctx.fillStyle = 'rgba(9,9,11,0.55)'; ctx.fillRect(0, 0, W, H);
  bands(ctx, 0, 1150);
  line(ctx, 'КОГО ЗАБЫЛИ?', CX, S.y + S.h - 230, K.fit(ctx, 'КОГО ЗАБЫЛИ?', 120), 'GOLD', u, 35.8, null, { stagger: 0.03, rot: 0.3 });
  line(ctx, 'пиши своего в комменты', CX, S.y + S.h - 140, 50, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 30, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    TYPE = typeSet(ROWS.map((r) => ({ str: r.t, size: 1.15, depth: 0.45, mat: r.mat, bevel: 0.05 })));
    PHONE = await phoneSet(['killers', 'deaths']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], [4, 10], [8, 12], [12, 14], [16, 30], [30, 26], [31, 18], [36, 20]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneTiers(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ЗЛИШЬСЯ НА ТЕХИСА?', l2: 'УЗНАЙ, КТО ТЕБЯ УБИВАЛ', l3: 'кинь матч — бот покажет, кто слил' });
    else if (u < 36) sceneChamp(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, 16, 0.4, '255,90,90');
    for (const b of [0, 16, 30, 36]) glitch(ctx, u, b, 44);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
