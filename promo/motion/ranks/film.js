// Все ранги Доты: 8 неоновых 3-D медалей (цвета — как в профиле приложения, docs/medal3d.js), камера поднимается
// от Рекрута до Титана. 120 BPM, 44 beats.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, hexRgb } = M;
const { C, UI, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;
const { THREE } = G;

const MEDALS = ['РЕКРУТ', 'СТРАЖ', 'РЫЦАРЬ', 'ГЕРОЙ', 'ЛЕГЕНДА', 'ВЛАСТЕЛИН', 'БОЖЕСТВО', 'ТИТАН'];
const NEON = ['#ffb38a', '#b8ff6a', '#5dffb0', '#7aa8ff', '#e07bff', '#4ff3ff', '#ffe27a', '#ff6a3d'];
const AT = MEDALS.map((_, i) => 4 + i * 2);
const STEP = 3.0;
const rgbStr = (hex) => hexRgb(hex).join(',');

const HITS = [
  [0, 'hook', 'impact'], [0.6, 'все 8', 'pop', { pitch: 'F5' }], [1.3, 'а ты где', 'pop', { pitch: 'C6' }],
  ...MEDALS.map((m, i) => [AT[i], m, i === 7 ? 'impact' : 'blip', { pitch: ['F5', 'G5', 'A5', 'C6', 'D6', 'F6', 'G6', 'A6'][i] }]),
  [20, 'потолок', 'thud'], [21, 'лидерборд', 'pop', { pitch: 'C6' }],
  ...K.botHits(24),
  [30, 'а ты где', 'impact'], ...MEDALS.map((_, i) => [30.6 + i * 0.3, 'grid ' + i, 'tick']),
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'C6' }], [40, 'pill', 'bell', { pitch: 'F6' }],
];

let SET = null, PHONE = null;
function star(r1, r2) {
  const s = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? r2 : r1; k ? s.lineTo(r * Math.cos(a), r * Math.sin(a)) : s.moveTo(r * Math.cos(a), r * Math.sin(a)); }
  return s;
}
function medalSet() {
  const scene = new THREE.Scene(), cam = G.camera(34, 0.1, 200);
  scene.environment = G.ENV; scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(-3, 5, 7); scene.add(key);
  const medals = MEDALS.map((_, i) => {
    const col = new THREE.Color(NEON[i]);
    const neon = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const g = new THREE.Group();
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.18, 64), new THREE.MeshPhysicalMaterial({ color: 0x15151a, metalness: 0.9, roughness: 0.25, clearcoat: 1 }));
    disk.rotation.x = Math.PI / 2; g.add(disk);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.06, 12, 96), neon); g.add(rim);
    const rim2 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.025, 8, 96), neon); rim2.position.z = 0.1; g.add(rim2);
    const emblem = new THREE.Mesh(new THREE.ExtrudeGeometry(star(0.55, 0.24), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2 }), neon);
    emblem.position.z = 0.1; g.add(emblem);
    // five small rank stars on an arc under the emblem (Titan has none)
    if (i < 7) for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.32;
      const st = new THREE.Mesh(new THREE.ExtrudeGeometry(star(0.09, 0.04), { depth: 0.04, bevelEnabled: false }), neon);
      st.position.set(1.28 * Math.cos(a), 1.28 * Math.sin(a), 0.05); g.add(st);
    }
    // orbit ring
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.012, 6, 128), neon); orbit.rotation.x = 1.25; g.add(orbit);
    g.userData.orbit = orbit;
    scene.add(g);
    return g;
  });
  const v = new THREE.Vector3();
  return { scene, camera: cam,
    project(x, y, z) { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; },
    update(t, u, o) {
      G.lookFrom(cam, o.cam.slice(0, 3), o.cam.slice(3), o.roll || 0);
      medals.forEach((g, i) => {
        const m = o.medals[i];
        g.visible = !!m && m.vis !== false;
        if (!g.visible) return;
        g.position.set(m.x || 0, m.y || 0, m.z || 0);
        g.rotation.set(m.rx || 0, m.ry || 0, 0);
        g.scale.setScalar(Math.max(0.001, m.scale ?? 1));
        g.userData.orbit.rotation.z = t * 1.2 + i;
      });
    } };
}

const ladder = (u, t) => MEDALS.map((_, i) => {
  const k = springU(u, AT[i] - 0.6, SPRING.bouncy);
  return { y: i * STEP, ry: (1 - k) * Math.PI * 2 + 0.35 * Math.sin(t * 1.1 + i), scale: k, vis: u > AT[i] - 0.4 || i === 0 };
});

function sceneLadder(ctx, u, t) {
  const s = u < 4 ? 0 : springKeys(u, [[3.7, 0], ...MEDALS.map((_, i) => [AT[i] - 0.3, i])], { stiffness: 160, damping: 20 });
  const back = E.inOutCubic(prog(u, 20, 21.6));
  const cy = s * STEP;
  const cam = [lerp(1.2 * Math.sin(u * 0.3), 6, back), cy + lerp(0.6, -2, back), lerp(u < 4 ? lerp(11, 6.5, E.outCubic(prog(u, 0, 4))) : 6.5, 16, back), 0, cy + lerp(-0.4, 0, back), 0];
  const i = clamp(Math.round(s), 0, 7), col = rgbStr(NEON[i]);
  const hit = Math.exp(-Math.max(0, u - AT[i]) * 2) * (u >= AT[i] ? 1 : 0);
  background(ctx, u, CX, H * 0.55, 0.2 + hit * 0.4, { color: col, grid: 0.08 });
  rays(ctx, CX, H * 0.56, u, 0.25 + hit * 0.6, 16, col);
  const ms = ladder(u, t);
  if (u < 4) ms.forEach((m, j) => { if (j) m.vis = false; else { m.scale = springU(u, -0.5, SPRING.bouncy); m.ry = u * 1.5; } });
  G.renderSet(ctx, SET, t, u, { cam, medals: ms, roll: 0.04 * Math.sin(u * 0.5) });
  if (u >= 4) sparks(ctx, CX, H * 0.55, u, AT[i], i === 7 ? 80 : 30, 20 + i, { speed: 1400 });
  bands(ctx, 520, 1350);
  if (u < 4) {
    line(ctx, 'ВСЕ 8 РАНГОВ', CX, S.y + 130, K.fit(ctx, 'ВСЕ 8 РАНГОВ', 140), 'GOLD', u, -0.4, 3.6, { stagger: 0.03, rot: -0.3 });
    line(ctx, 'ДОТЫ ПО ПОРЯДКУ', CX, S.y + 240, K.fit(ctx, 'ДОТЫ ПО ПОРЯДКУ', 90), C.text, u, 0.6, 3.6, { stagger: 0.02 });
    line(ctx, 'а ты где застрял?', CX, S.y + S.h - 20, 52, C.muted, u, 1.3, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
    return;
  }
  MEDALS.forEach((m, j) => {
    const a = AT[j], b = j < 7 ? AT[j + 1] - 0.2 : 19.8;
    if (u < a - 0.3 || u > b + 0.5) return;
    line(ctx, `${j + 1} / 8`, CX, S.y + 80, 52, NEON[j], u, a - 0.1, b, { face: UI, weight: 800, track: 0.16, stagger: 0.01 });
    line(ctx, m, CX, S.y + S.h - 30, K.fit(ctx, m, 150), NEON[j], u, a, b, { stagger: 0.03, from: 1.8, spring: SPRING.snappy, rot: 0.2 });
  });
  if (u >= 19.8) {
    line(ctx, 'ТИТАН — ПОТОЛОК', CX, S.y + 120, K.fit(ctx, 'ТИТАН — ПОТОЛОК', 110), NEON[7], u, 20, 23.6, { stagger: 0.02 });
    line(ctx, 'дальше только место', CX, S.y + S.h - 90, 56, C.text, u, 21, 23.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
    line(ctx, 'в таблице лидеров', CX, S.y + S.h - 20, 56, C.text, u, 21.3, 23.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  }
}

function sceneGrid(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.2);
  // all eight in a 2x4 grid, lighting up one after another
  const ms = MEDALS.map((_, i) => {
    const k = springU(u, 30.6 + i * 0.3, SPRING.bouncy);
    return { x: (i % 2 ? 1.6 : -1.6), y: 3.4 - Math.floor(i / 2) * 3.0, ry: 0.4 * Math.sin(t * 1.4 + i), scale: 0.95 * k, vis: true };
  });
  G.renderSet(ctx, SET, t, u, { cam: [0, -0.9, 23, 0, -0.9, 0], medals: ms });
  MEDALS.forEach((m, i) => {
    const [x, y] = SET.project(i % 2 ? 1.6 : -1.6, 3.4 - Math.floor(i / 2) * 3.0 - 1.35, 0);
    line(ctx, m, x, y + 30, 38, NEON[i], u, 30.7 + i * 0.3, 35.6, { face: UI, weight: 800, track: 0.08, stagger: 0.006, shadow: false });
  });
  line(ctx, 'А ТЫ ГДЕ?', CX, S.y + 40, 110, C.text, u, 29.8, 35.6, { stagger: 0.03, rot: -0.3 });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.55, 0.25, { color: rgbStr(NEON[7]) });
  rays(ctx, CX, H * 0.55, u, 0.5, 18, rgbStr(NEON[7]));
  const ms = MEDALS.map((_, i) => ({ y: i * STEP, ry: (u - 36) * 0.8 + i * 0.3, scale: 1, vis: true }));
  G.renderSet(ctx, SET, t, u, { cam: [8 * Math.sin((u - 36) * 0.12), 10.5, 24, 0, 10.5, 0], medals: ms });
  bands(ctx, 520, 1300);
  line(ctx, 'ПИШИ СВОЙ РАНГ', CX, S.y + 90, K.fit(ctx, 'ПИШИ СВОЙ РАНГ', 120), C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'В КОММЕНТЫ', CX, S.y + 210, 120, 'GOLD', u, 36.4, null, { stagger: 0.03, rot: 0.3 });
  line(ctx, 'посмотрим, кого больше', CX, S.y + S.h - 200, 50, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    SET = medalSet();
    PHONE = await phoneSet(['profile', 'review']);
  },
  draw(ctx, u, t) {
    for (const [b, amp] of [[0, 22], [AT[7], 30], [30, 20], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneLadder(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ХОЧЕШЬ РАНГ ВЫШЕ?', l2: 'НАЧНИ С РАЗБОРА', l3: 'кинь матч — бот покажет ошибки' });
    else if (u < 36) sceneGrid(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    flash(ctx, u, AT[7], 0.4, '255,106,61');
    for (const b of [0, AT[7], 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
