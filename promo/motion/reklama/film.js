// Реклама @DotaRazbor_bot, 9:16, 32 с, 120 BPM (64 доли). Хук из 3-D букв «ОПЯТЬ СЛИЛ?», телефон с
// главной (поле для ID матча) ныряет экраном в камеру, дальше камера летит по галерее настоящих экранов:
// оценка, «Кто слил», Реплей, живая карта, видеоразбор (кадры настоящего ролика), тренер. Потом 3-D
// «БЕСПЛАТНО» и финал с ником бота. Озвучка: audio/vo.wav (vo_place.py), бит: audio/score.py.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import { typeSet, GOLD, IVORY, RED } from '../common/sets/type3d.js';
import { gallerySet } from './gallery.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING } = M;
const { C, UI, S, CX, line, pill, bands, rays, sparks, speed, glitch, background } = K;
const A = '../common/assets/';

const FEATS = [
  { src: A + 'app_review.png', crop: [0, 230, 780, 570], t1: 'ОЦЕНКА КАТКИ', t2: 'и главные ошибки по-человечески' },
  { src: A + 'app_killers.png', crop: [0, 80, 780, 640], t1: 'КТО СЛИЛ', t2: 'честно и с цифрами', c: 'RED' },
  { src: 'assets/replay.png', crop: [0, 0, 780, 820], t1: 'РЕПЛЕЙ', t2: 'туман войны и причина каждой смерти' },
  { src: 'assets/mapev.png', crop: [0, 30, 640, 840], t1: 'ЖИВАЯ КАРТА', t2: 'вся катка: кто, где и когда', c: 'GREEN' },
  { frames: Array.from({ length: 48 }, (_, i) => `assets/vr/${String(i + 1).padStart(2, '0')}.jpg`), t1: 'ВИДЕОРАЗБОР', t2: 'твоя катка роликом с озвучкой' },
  { src: A + 'app_chat.png', crop: [0, 480, 780, 680], t1: 'ТРЕНЕР', t2: 'ответит на любой вопрос по катке' },
];
const EXTRAS = ['graphs', 'build', 'phases', 'deaths', 'draft', 'profile', 'friends', 'hero', 'draftgrid', 'coach'].map((n) => `${A}app_${n}.png`);
const AT = FEATS.map((_, i) => 12 + i * 6); // 12 18 24 30 36 42
const COL = { RED: C.red, GREEN: C.green };

// words in the one 3-D type set
const WORDS = [
  { str: 'ОПЯТЬ', size: 1, depth: 0.3, mat: IVORY },
  { str: 'СЛИЛ?', size: 1, depth: 0.45, mat: RED },
  { str: '-25 ММР', size: 1, depth: 0.3, mat: RED },
  { str: 'БЕСПЛАТНО', size: 1, depth: 0.4, mat: GOLD },
  { str: 'ДОТА', size: 1, depth: 0.4, mat: GOLD },
  { str: 'РАЗБОР', size: 1, depth: 0.4, mat: GOLD },
];

const HITS = [
  [0, 'СЛИЛ', 'impact'], [0.15, 'ОПЯТЬ', 'pop', { pitch: 'C#5' }], [2.6, '-25', 'thud'],
  [4.95, 'words out', 'whoosh', { len: 0.4 }], [5.2, 'phone', 'whoosh', { len: 0.5, from: 500, to: 2200 }], [6.8, 'lands', 'thud'],
  [8.2, '@DotaRazbor_bot', 'bell', { pitch: 'F#6' }], [11.1, 'dive', 'whoosh', { len: 0.6, from: 400, to: 3000 }],
  ...AT.flatMap((a, i) => [...(i ? [[a - 0.8, `fly ${i}`, 'whoosh', { len: 0.45, from: 700, to: 2600 }]] : []), [a, FEATS[i].t1, 'impact'], [a + 0.9, 'sub', 'pop', { pitch: ['F#6', 'A6', 'C#7', 'E7', 'F#7', 'A7'][i] }]]),
  [47.2, 'out', 'whoosh', { len: 0.5 }], [48, 'БЕСПЛАТНО', 'impact'], [48.8, 'первая катка', 'pop', { pitch: 'C#6' }], [50.4, 'всегда', 'click'],
  [54, 'ДОТА', 'impact'], [54.5, 'РАЗБОР', 'pop', { pitch: 'F#5' }], [56, 'pill', 'bell', { pitch: 'C#6' }], [57, 'профиль', 'click'],
];

let PHONE = null, GAL = null, TYPE = null;

// fit a 3-D word to a world width
const fitW = (i, w) => w / TYPE.words[i].width;

function typeFrame(ctx, u, t, cam, words, target = [0, 0, 0], roll = 0) {
  G.renderSet(ctx, TYPE, t, u, { cam, target, roll, words });
}

// ---------------------------------------------------------------- 0-6 hook
function sceneHook(ctx, u, t) {
  background(ctx, u, CX, H * 0.48, 0.2 + 0.5 * Math.exp(-u * 1.5), { color: '240,88,93', grid: 0.04 });
  rays(ctx, CX, H * 0.48, u, 0.35, 16, '255,120,110');
  const z = 13 * (9.5 / 13) ** E.outCubic(prog(u, 0, 5.5));
  const ox = 1.2 * Math.sin(u * 0.5);
  const ws = [];
  ws[0] = { y: 1.55, in: -0.5, out: 4.9, scale: fitW(0, 2.6), stagger: 0.05 };
  ws[1] = { y: 0.1, in: -0.6, out: 5.0, scale: fitW(1, 3.0), stagger: 0.04, spring: { stiffness: 260, damping: 15 }, spin: 0.06 };
  ws[2] = { y: -1.6, in: 2.6, out: 5.05, scale: fitW(2, 2.2), stagger: 0.03 };
  typeFrame(ctx, u, t, [ox, 0.4, z], ws, [0, 0, 0], 0.04 * Math.sin(u * 0.4));
  sparks(ctx, CX, H * 0.5, u, 0, 60, 3, { speed: 1900 });
}

// ---------------------------------------------------------------- 6-12 phone with the match field
function scenePhone(ctx, u, t) {
  background(ctx, u, CX, H * 0.58, 0.22);
  rays(ctx, CX, H * 0.6, u, 0.35, 16);
  const k = springU(u, 5.1, { stiffness: 120, damping: 14 });
  const dive = E.inCubic(prog(u, 11.0, 12.0));
  const pos = [lerp(4, 0, k), lerp(-10, -1.0, k) + dive * 1.0, dive * 11.2];
  const rot = [lerp(-1.0, -0.1, k) * (1 - dive) + 0.04 * Math.sin(t), (lerp(-4.2, -0.28, k) + 0.15 * Math.sin(t * 0.8)) * (1 - dive), lerp(0.6, 0.04, k) * (1 - dive)];
  G.renderSet(ctx, PHONE, t, u, { cam: [0, 0.2, 12.5], pos, rot, scale: 0.85, screen: 0 });
  speed(ctx, u, dive * 0.9, -1, 21);
  if (dive < 0.6) {
    bands(ctx, 560, H, 1 - dive * 1.6);
    line(ctx, 'КИДАЙ НОМЕР', CX, S.y + 70, K.fit(ctx, 'КИДАЙ НОМЕР', 120), C.text, u, 6.1, 10.9, { stagger: 0.025 });
    line(ctx, 'МАТЧА В БОТА', CX, S.y + 190, K.fit(ctx, 'МАТЧА В БОТА', 120), 'GOLD', u, 6.6, 10.95, { stagger: 0.025, rot: -0.3 });
    pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 30, 64, u, 8.2, 10.9);
  }
}

// ---------------------------------------------------------------- 12-48 the gallery flight
function sceneGallery(ctx, u, t) {
  const i = clamp(Math.floor((u - 12 + 0.8) / 6), 0, 5), a = AT[i], f = FEATS[i];
  const hit = u >= a ? Math.exp(-(u - a) * 2) : 0;
  const col = f.c === 'RED' ? '240,88,93' : f.c === 'GREEN' ? '63,207,142' : '230,184,88';
  background(ctx, u, CX, H * 0.6, 0.14 + hit * 0.35, { color: col, grid: 0.035 });
  let s = 0;
  for (let j = 1; j < 6; j++) s += E.inOutCubic(prog(u, AT[j] - 0.85, AT[j] + 0.1));
  // the very first panel: we come out of the phone screen, rushing back from close
  const enter = 1 - E.outCubic(prog(u, 12, 12.9));
  const park = prog(u, a, a + 6);
  G.renderSet(ctx, GAL, t, u, { s, dist: lerp(1.06, 0.95, E.inOutSine(park)) - enter * 0.45, orbit: (i % 2 ? -1 : 1) * lerp(-0.5, 0.5, park), lookY: 0.55, roll: 0.03 * Math.sin(u * 0.5), vt: (u - 36) * 0.5 + 0.4 });
  const fly = Math.max(...AT.slice(1).map((b) => M.bump(u, b - 0.35, 0.6)));
  speed(ctx, u, fly * 0.8, i % 2 ? 1 : -1, 40 + i);
  sparks(ctx, CX, H * 0.58, u, a, 36, 30 + i, { speed: 1500 });
  bands(ctx, 600, H + 1, 1);
  const out = i < 5 ? AT[i + 1] - 0.95 : 47.2;
  const fc = f.c ? COL[f.c] : 'GOLD';
  line(ctx, f.t1, CX, S.y + 95, K.fit(ctx, f.t1, 128), fc === 'GOLD' ? C.text : fc, u, a - 0.15, out, { stagger: 0.025, from: 1.7 });
  line(ctx, f.t2, CX, S.y + 185, K.fit(ctx, f.t2, 50, S.w, 700, UI), C.text, u, a + 0.8, out, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

// ---------------------------------------------------------------- 48-54 free
function sceneFree(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.25 + 0.4 * Math.exp(-(u - 48) * 1.5));
  rays(ctx, CX, H * 0.5, u, 0.55, 18);
  const orb = lerp(-0.5, 0.5, E.inOutSine(prog(u, 48, 54)));
  const ws = []; ws[3] = { y: 0, in: 47.4, out: 53.4, scale: fitW(3, 3.0), stagger: 0.035, spin: 0.08 };
  typeFrame(ctx, u, t, [Math.sin(orb) * 10.5, 0.5, Math.cos(orb) * 10.5], ws);
  sparks(ctx, CX, H * 0.5, u, 48, 70, 88, { speed: 2000 });
  line(ctx, 'ПЕРВАЯ КАТКА', CX, S.y + 250, K.fit(ctx, 'ПЕРВАЯ КАТКА', 100), C.text, u, 48.6, 53.4, { stagger: 0.025 });
  line(ctx, 'полностью', CX, S.y + 340, 56, C.gold, u, 49.2, 53.4, { face: UI, weight: 800, track: 0.02, stagger: 0.015 });
  line(ctx, 'а «Обзор» и «Кто слил»', CX, S.y + S.h - 230, K.fit(ctx, 'а «Обзор» и «Кто слил»', 54, S.w, 800, UI), C.text, u, 50.4, 53.4, { face: UI, weight: 800, track: 0, stagger: 0.01 });
  line(ctx, 'бесплатны всегда', CX, S.y + S.h - 160, 54, C.gold, u, 50.9, 53.4, { face: UI, weight: 800, track: 0, stagger: 0.012 });
}

// ---------------------------------------------------------------- 54-64 end card
function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.4, 0.25 + 0.4 * Math.exp(-(u - 54) * 1.5));
  rays(ctx, CX, H * 0.62, u, 0.4, 16);
  const k = springU(u, 55, { stiffness: 110, damping: 14 });
  G.renderSet(ctx, PHONE, t, u, { cam: [0, 0.2, 12.5], pos: [0, lerp(-9, -2.15, k), 0], rot: [-0.12, lerp(3.2, -0.25, k) + 0.18 * Math.sin(t * 0.7), 0.03], scale: 0.55, screen: 0 });
  const ws = [];
  ws[4] = { y: 2.75, in: 53.7, scale: fitW(4, 2.8), stagger: 0.05, spin: 0.05 };
  ws[5] = { y: 1.55, in: 54.1, scale: fitW(5, 3.9), stagger: 0.05, spin: 0.05 };
  typeFrame(ctx, u, t, [0.8 * Math.sin(u * 0.3), 0.3, 12.5], ws, [0, 0.3, 0]);
  sparks(ctx, CX, H * 0.3, u, 54, 60, 99, { speed: 1800 });
  pill(ctx, '@DotaRazbor_bot', CX, 880, 66, u, 56);
  line(ctx, 'ссылка в профиле', CX, 1010, 50, C.text, u, 57, null, { face: UI, weight: 700, track: 0, stagger: 0.012 });
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0, font: '../common/fonts/display.otf' });
    PHONE = await phoneSet(['home']);
    TYPE = typeSet(WORDS);
    GAL = await gallerySet(FEATS, EXTRAS);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 26], [2.6, 12], [6.8, 14], [12, 18], ...AT.slice(1).map((a) => [a, 12]), [48, 22], [54, 22]]) M.shake(ctx, u, b, amp);
    if (u < 5.6) sceneHook(ctx, u, t);
    else if (u < 12) scenePhone(ctx, u, t);
    else if (u < 48) sceneGallery(ctx, u, t);
    else if (u < 54) sceneFree(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    for (const b of [0, 12, 48, 54]) glitch(ctx, u, b, 36);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
