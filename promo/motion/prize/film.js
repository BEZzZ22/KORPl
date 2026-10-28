// Куда делись 40 миллионов: призовые TI столбами из золота, пик 2021 и обвал. 120 BPM, 44 beats.
// Numbers: GosuGamers "The rise and fall of The International's prize pool" (2011–2023); 2026 sources differ, so "≈3".
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble } = M;
const { C, UI, S, CX, line, pill, glow, bands, rays, sparks, speed, glitch, flash, background } = K;
const { THREE } = G;

const DATA = [
  ['2011', 1.6], ['2012', 1.6], ['2013', 2.87], ['2014', 10.93], ['2015', 18.43], ['2016', 20.77], ['2017', 24.79],
  ['2018', 25.53], ['2019', 34.33], ['2021', 40.02], ['2022', 18.93], ['2023', 3.38], ['2026', 3.0],
];
const AT = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17.5];
const PEAK = 9, NB = DATA.length;
const money = (v) => `$${(v === 2.87 || v === 3.38 ? v.toFixed(2) : v.toFixed(1)).replace('.', ',')} МЛН`.replace('$3,0 МЛН', '≈ $3 МЛН');

const HITS = [
  [0, 'было 40', 'impact'], [1.5, 'стало 3', 'thud', { pitch: 50 }],
  ...DATA.map((d, i) => [AT[i], d[0], i === PEAK ? 'impact' : i > PEAK ? 'thud' : 'coins']),
  [16, 'crash glitch', 'sub'],
  [19, 'почему', 'click'], [20, 'battle pass', 'pop', { pitch: 'D6' }],
  ...K.botHits(24),
  [30, '40 018 195', 'impact'], [30.2, 'counter', 'type', { len: 1.6, n: 16 }], [33, '18 млн', 'coins'],
  [36, 'end', 'impact'], [38, 'да/нет', 'pop', { pitch: 'A5' }], [40, 'pill', 'bell', { pitch: 'D6' }],
];

let BARS = null, PHONE = null;
function barsSet() {
  const scene = new THREE.Scene(), cam = G.camera(38, 0.1, 200);
  scene.environment = G.ENV; scene.environmentIntensity = 1.0;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.5); key.position.set(-6, 10, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc46b, 3); rim.position.set(8, 4, -8); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x120c06, 0.4));
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xe6b858, metalness: 1, roughness: 0.25, clearcoat: 0.7 });
  const peak = new THREE.MeshPhysicalMaterial({ color: 0xffd27a, metalness: 1, roughness: 0.15, clearcoat: 1, emissive: 0x6a4410, emissiveIntensity: 0.6 });
  const red = new THREE.MeshPhysicalMaterial({ color: 0xf0585d, metalness: 0.6, roughness: 0.3, clearcoat: 1, emissive: 0x3a0808 });
  const geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.08);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshBasicMaterial({ color: 0x0b0b0d }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const bars = DATA.map((d, i) => { const m = new THREE.Mesh(geo, i === PEAK ? peak : i > PEAK ? red : gold); scene.add(m); return m; });
  const v = new THREE.Vector3();
  return { scene, camera: cam, X: (i) => (i - PEAK) * 1.5,
    project(x, y, z) { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; },
    height: (i, u) => { const hook = u < 4 && (i === PEAK || i === NB - 1); const k = hook ? springU(u, i === PEAK ? -0.6 : 1.4, SPRING.bouncy) * (1 - prog(u, 3.4, 3.9)) : springU(u, AT[i] - 0.2, SPRING.bouncy); return Math.max(0.02, DATA[i][1] * 0.2 * k); },
    update(t, u, o) {
      G.lookFrom(cam, o.cam.slice(0, 3), o.cam.slice(3), o.roll || 0);
      bars.forEach((m, i) => {
        const h = this.height(i, u);
        m.scale.set(1.05, h, 1.05); m.position.set(this.X(i), h / 2, 0);
        m.rotation.y = 0.15 * wobble(u - AT[i], 1.6, 3);
      });
    } };
}

// camera rides along the bars, then pulls back to the skyline
function camFor(u) {
  const i = clamp((u - 3.6) / 1.0, 0, NB - 1);
  const xi = (Math.min(i, NB - 1) - PEAK) * 1.5;
  const hi = DATA[Math.round(Math.min(i, NB - 1))][1] * 0.2;
  const back = E.inOutCubic(prog(u, 18.2, 20));
  const ride = [xi + 1.6, hi * 0.6 + 1.2, 7 + hi * 2.3, xi, hi * 0.5 + 0.5, 0];
  const wide = [-1.2, 5.5, 25, -1.8, 3.6, 0];
  return ride.map((v, k) => lerp(v, wide[k], back));
}

function sceneBars(ctx, u, t) {
  const cam = u < 4 ? [2.25 + 1.5 * (1 - prog(u, 0, 4)), 4.5, 26 - 3 * prog(u, 0, 4), 2.25, 4.2, 0] : camFor(u);
  BARS.update(t, u, { cam });
  const i = clamp(Math.round((u - 3.6) / 1.0), 0, NB - 1);
  const pk = Math.exp(-Math.max(0, u - AT[PEAK]) * 0.8) * (u >= AT[PEAK] ? 1 : 0);
  const [px, py] = BARS.project(BARS.X(PEAK), BARS.height(PEAK, u), 0);
  background(ctx, u, px, py, 0.16 + pk * 0.5);
  rays(ctx, px, py, u, (u >= AT[PEAK] ? 0.3 : 0) + pk * 0.8, 18);
  G.renderSet(ctx, BARS, t, u, { cam });
  sparks(ctx, px, py, u, AT[PEAK], 80, 13, { up: true, spread: 2.2, speed: 1900 });
  // year + amount pinned to the bar the camera is on
  if (u >= 3.8 && u < 18.4) DATA.forEach((d, j) => {
    const a = AT[j], b = j < NB - 1 ? AT[j + 1] - 0.3 : 18.2;
    if (u < a - 0.2 || u > b + 0.5) return;
    const [x, y] = BARS.project(BARS.X(j), BARS.height(j, u) + 0.35, 0);
    const col = j === PEAK ? 'GOLD' : j > PEAK ? C.red : C.text;
    line(ctx, money(d[1]), clamp(x, 330, W - 330), clamp(y - 30, S.y + 380, H), 72, col, u, a, b, { stagger: 0.012, from: 1.5 });
  });
  bands(ctx, 520, 1400);
  if (u < 4) {
    line(ctx, 'БЫЛО $40 МЛН', CX, S.y + 120, K.fit(ctx, 'БЫЛО $40 МЛН', 140), 'GOLD', u, -0.6, 3.6, { stagger: 0.03, rot: -0.3 });
    line(ctx, 'СТАЛО ≈ $3 МЛН', CX, S.y + 250, K.fit(ctx, 'СТАЛО ≈ $3 МЛН', 110), C.red, u, 1.5, 3.6, { stagger: 0.03, from: 1.8 });
    line(ctx, 'куда делись деньги TI?', CX, S.y + 330, 48, C.muted, u, 2.2, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  } else if (u < 18.4) {
    DATA.forEach((d, j) => {
      const a = AT[j], b = j < NB - 1 ? AT[j + 1] - 0.3 : 18.2;
      if (u < a - 0.25 || u > b + 0.5) return;
      line(ctx, d[0], CX, S.y + 190, 200, j === PEAK ? 'GOLD' : j > PEAK ? C.red : C.text, u, a - 0.15, b, { from: 1.7, spring: SPRING.snappy, stagger: 0.03 });
      const tag = j === PEAK ? 'РЕКОРД · TI10' : j === NB - 1 ? 'TI 2026 · ИСТОЧНИКИ РАСХОДЯТСЯ' : j === NB - 2 ? 'ОБВАЛ' : 'ПРИЗОВОЙ ФОНД TI';
      line(ctx, tag, CX, S.y + 265, 44, j >= NB - 2 ? C.red : C.gold, u, a, b, { face: UI, weight: 800, track: 0.1, stagger: 0.01 });
    });
  } else {
    line(ctx, 'ПОЧЕМУ?', CX, S.y + 120, 150, C.text, u, 18.8, 23.6, { stagger: 0.04, rot: -0.3 });
    line(ctx, 'В 2023 VALVE УБРАЛИ', CX, S.y + S.h - 130, K.fit(ctx, 'В 2023 VALVE УБРАЛИ', 80), C.text, u, 19.8, 23.6, { stagger: 0.015 });
    line(ctx, 'БАТЛ ПАСС', CX, S.y + S.h - 10, 120, 'GOLD', u, 20.3, 23.6, { stagger: 0.03, from: 1.8 });
  }
  speed(ctx, u, M.bump(u, 16.2, 0.6), 1);
}

function sceneRecord(ctx, u, t) {
  background(ctx, u, CX, H * 0.48, 0.25);
  const cam = [6 * Math.sin((u - 30) * 0.15), 7, 14, BARS.X(PEAK), 4, 0];
  G.renderSet(ctx, BARS, t, u, { cam });
  ctx.fillStyle = 'rgba(9,9,11,0.7)'; ctx.fillRect(0, 0, W, H);
  rays(ctx, CX, H * 0.45, u, 0.6, 18);
  line(ctx, 'TI10 · 2021', CX, S.y + 80, 60, C.gold, u, 29.8, 35.6, { face: UI, weight: 800, track: 0.14, stagger: 0.01 });
  const v = Math.round(40018195 * E.outExpo(prog(u, 30.2, 31.9)));
  const s = '$' + v.toLocaleString('ru-RU').replace(/ /g, ' ');
  if (u >= 30) line(ctx, s, CX, H * 0.42, K.fit(ctx, '$40 018 195', 170), 'GOLD', u, 30, 35.6, { stagger: 0, from: 1, spring: SPRING.snappy });
  line(ctx, 'БОЛЬШЕ НИ ОДНА TI', CX, H * 0.42 + 120, 70, C.text, u, 31.8, 35.6, { stagger: 0.015 });
  line(ctx, 'ДАЖЕ БЛИЗКО НЕ ДОТЯНУЛА', CX, H * 0.42 + 200, K.fit(ctx, 'ДАЖЕ БЛИЗКО НЕ ДОТЯНУЛА', 70), C.text, u, 32.1, 35.6, { stagger: 0.015 });
  line(ctx, 'Spirit тогда забрали $18 млн', CX, S.y + S.h - 30, 50, C.muted, u, 33, 35.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
  sparks(ctx, CX, H * 0.4, u, 32, 70, 33, { speed: 1800 });
}

function sceneEnd(ctx, u, t) {
  const cam = [-1.2 + (u - 36) * 0.3, 5.5, 23, -1.8, 3.6, 0];
  background(ctx, u, CX, H * 0.55, 0.22 + 0.3 * Math.exp(-(u - 36)));
  G.renderSet(ctx, BARS, t, u, { cam });
  bands(ctx, 560, 1250);
  line(ctx, 'ВЕРНУТЬ', CX, S.y + 80, 120, C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'БАТЛ ПАСС?', CX, S.y + 210, K.fit(ctx, 'БАТЛ ПАСС?', 140), 'GOLD', u, 36.4, null, { stagger: 0.03, rot: 0.4 });
  line(ctx, 'да или нет — в комменты', CX, S.y + S.h - 200, 50, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    BARS = barsSet();
    PHONE = await phoneSet(['graphs', 'review']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 24], [AT[PEAK], 34], [16, 26], [30, 20], [36, 24]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneBars(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ДЕНЕГ НЕ ОБЕЩАЕМ', l2: 'НО ОШИБКИ ПОКАЖЕМ', l3: 'кинь матч — бот покажет, где слил' });
    else if (u < 36) sceneRecord(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, AT[PEAK], 0.45); flash(ctx, u, 16, 0.35, '240,88,93');
    for (const b of [0, AT[PEAK], 16, 30, 36]) glitch(ctx, u, b, b === 16 ? 80 : 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
