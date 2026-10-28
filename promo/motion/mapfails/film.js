// 5 смертельных ошибок на карте: карта Доты из приложения (docs/img/map.webp) столом в 3-D, ты — зелёная точка,
// враги — красные, камера летает между ситуациями. 120 BPM, 44 beats. Situations are illustrations, not a replay.
import * as M from '../common/lib/motion.js';
import * as G from '../common/lib/gl.js';
import { phoneSet } from '../common/sets/phone.js';
import * as K from '../common/kit.js';

const { W, H, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, hash01 } = M;
const { C, UI, S, CX, line, pill, card, bands, rays, sparks, speed, glitch, flash, background, glow } = K;
const { THREE } = G;

const MW = 10;
const wp = ([mx, my]) => [(mx - 0.5) * MW, (my - 0.5) * MW];
// each fail: where you are (path), where they come from, and the copy
const FAILS = [
  { at: 4, t1: 'ИДЁШЬ В РЕКУ', t2: 'без варда и без ТП', you: [[0.36, 0.64], [0.5, 0.52]], foes: [[0.62, 0.42], [0.6, 0.6], [0.47, 0.36]] },
  { at: 8, t1: 'ФАРМИШЬ ЛЕС ВРАГА', t2: 'один, на 25-й минуте', you: [[0.62, 0.42], [0.7, 0.3]], foes: [[0.85, 0.2], [0.9, 0.38], [0.62, 0.12], [0.8, 0.45]] },
  { at: 12, t1: 'МИД ПРОПАЛ', t2: 'а ты дальше стоишь на линии', you: [[0.8, 0.86], [0.84, 0.86]], foes: [[0.5, 0.5], [0.68, 0.8]] },
  { at: 16, t1: 'НЕ СМОТРИШЬ', t2: 'на миникарту. Вообще', you: [[0.2, 0.7], [0.24, 0.72]], foes: [[0.35, 0.55], [0.3, 0.85], [0.12, 0.55], [0.42, 0.72], [0.22, 0.95]] },
  { at: 20, t1: 'ЛЕЗЕШЬ 1 ПРОТИВ 5', t2: 'потому что «я же керри»', you: [[0.42, 0.56], [0.5, 0.5]], foes: [[0.58, 0.44], [0.6, 0.52], [0.55, 0.58], [0.5, 0.4], [0.62, 0.48]] },
];

const HITS = [
  [0, 'hook', 'impact'], [0.6, '5 ошибок', 'pop', { pitch: 'D6' }], [1.3, 'карта', 'pop', { pitch: 'A6' }],
  ...FAILS.flatMap((f, i) => [[f.at, `#${5 - i}`, 'impact'], [f.at + 1.6, 'foes', 'blip', { pitch: 'A5' }], [f.at + 2.4, 'death', 'thud']]),
  ...K.botHits(24),
  [30, 'где умираешь', 'impact'], [31, 'marks', 'type', { len: 1.5, n: 14 }], [33, 'бот покажет', 'bell', { pitch: 'D6' }],
  [36, 'end', 'impact'], [38, 'comments', 'pop', { pitch: 'A6' }], [40, 'pill', 'bell', { pitch: 'D6' }],
];

let SET = null, PHONE = null;
const DEATHS = Array.from({ length: 22 }, (_, i) => {   // an illustrative cluster for the "where you die" beat
  const c = [[0.5, 0.5], [0.66, 0.3], [0.3, 0.75]][i % 3];
  return [c[0] + (hash01(i, 3) - 0.5) * 0.12, c[1] + (hash01(i, 4) - 0.5) * 0.12];
});

function mapSet() {
  const scene = new THREE.Scene(), cam = G.camera(36, 0.1, 200);
  const tex = new THREE.TextureLoader().load('../common/assets/map.webp'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(MW, MW), new THREE.MeshBasicMaterial({ map: tex, color: 0xb8b8b8 }));
  plane.rotation.x = -Math.PI / 2; scene.add(plane);
  // a thin gold frame under the map
  const frame = new THREE.Mesh(new THREE.BoxGeometry(MW + 0.3, 0.25, MW + 0.3), new THREE.MeshBasicMaterial({ color: 0x3a2c14 }));
  frame.position.y = -0.14; scene.add(frame);
  const dot = (col, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
  const ringM = (col) => new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
  const beamM = (col) => new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  const you = dot(0x3fcf8e, 0.13), youRing = ringM(0x3fcf8e), youBeam = beamM(0x3fcf8e);
  [you, youRing, youBeam].forEach((m) => scene.add(m));
  youRing.rotation.x = -Math.PI / 2;
  const foes = Array.from({ length: 5 }, () => { const d = dot(0xf0585d, 0.12), r = ringM(0xf0585d); r.rotation.x = -Math.PI / 2; scene.add(d); scene.add(r); return [d, r]; });
  const danger = ringM(0xf0585d); danger.rotation.x = -Math.PI / 2; scene.add(danger);
  const marks = DEATHS.map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: 0xf0585d, toneMapped: false }));
    const m2 = m.clone(); m.rotation.y = Math.PI / 4; m2.rotation.y = -Math.PI / 4; const g = new THREE.Group(); g.add(m); g.add(m2); scene.add(g); return g; });
  const v = new THREE.Vector3();
  return { scene, camera: cam,
    project(x, y, z) { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; },
    update(t, u, o) {
      G.lookFrom(cam, o.cam.slice(0, 3), o.cam.slice(3), o.roll || 0);
      const f = o.fail;
      [you, youRing, youBeam].forEach((m) => (m.visible = !!f));
      foes.forEach(([d, r]) => { d.visible = r.visible = false; });
      danger.visible = false;
      if (f) {
        const p = E.inOutCubic(prog(u, f.at + 0.3, f.at + 2.2));
        const [x0, z0] = wp(f.you[0]), [x1, z1] = wp(f.you[1]);
        const x = lerp(x0, x1, p), z = lerp(z0, z1, p);
        const dead = u > f.at + 2.4;
        you.position.set(x, 0.18, z); you.material.color.set(dead ? 0x555555 : 0x3fcf8e);
        youRing.position.set(x, 0.02, z); youRing.scale.setScalar(0.3 + 0.25 * ((u * 2) % 1)); youRing.material.opacity = 1 - ((u * 2) % 1);
        youBeam.position.set(x, 1.5, z); youBeam.visible = !dead;
        f.foes.forEach((fp, j) => {
          const [d, r] = foes[j]; const k = springU(u, f.at + 1.6 + j * 0.08, SPRING.bouncy);
          if (k <= 0.01) return;
          const [fx, fz] = wp(fp), q = E.inOutCubic(prog(u, f.at + 1.6, f.at + 2.4));
          d.visible = r.visible = true;
          d.position.set(lerp(fx, x, q * 0.8), 0.18, lerp(fz, z, q * 0.8)); d.scale.setScalar(k);
          r.position.set(d.position.x, 0.02, d.position.z); r.scale.setScalar(0.25 + 0.3 * ((u * 2 + j * 0.3) % 1)); r.material.opacity = 1 - ((u * 2 + j * 0.3) % 1);
        });
        const dk = prog(u, f.at + 2.4, f.at + 3.6);
        danger.visible = dk > 0 && dk < 1; danger.position.set(x, 0.03, z); danger.scale.setScalar(0.3 + 2.2 * E.outCubic(dk)); danger.material.opacity = 1 - dk;
      }
      marks.forEach((g, i) => { const k = o.marks ? springU(u, 31 + i * 0.07, SPRING.bouncy) : 0; g.visible = k > 0.01; const [mx, mz] = wp(DEATHS[i]); g.position.set(mx, 0.08, mz); g.scale.setScalar(k * 1.3); });
    } };
}

function camFor(u) {
  const keys = [[0, [0, 9, 9, 0, 0, 0]], ...FAILS.map((f) => { const [x, z] = wp(f.you[1]); return [f.at - 0.4, [x + 1.4, 5, z + 5.4, x, 0, z]]; }), [22.6, [0, 11, 8, 0, 0, 0]]];
  return springKeys(u, keys, { stiffness: 120, damping: 18 });
}

function sceneFails(ctx, u, t) {
  const f = u < 4 ? null : FAILS[clamp(Math.floor((u - 4) / 4), 0, 4)];
  const cam = camFor(u);
  const death = f ? Math.exp(-Math.max(0, u - f.at - 2.4) * 2) * (u >= f.at + 2.4 ? 1 : 0) : 0;
  background(ctx, u, CX, H * 0.5, 0.12 + death * 0.4, { color: death > 0.05 ? '240,88,93' : undefined });
  G.renderSet(ctx, SET, t, u, { cam, fail: f, roll: 0.05 * Math.sin(u * 0.5) });
  if (f) { const [x, z] = wp(f.you[1]); const [px, py] = SET.project(x, 0.2, z); sparks(ctx, px, py, u, f.at + 2.4, 40, 10 + f.at, { speed: 1200 }); }
  bands(ctx, 560, 1350);
  if (!f) {
    line(ctx, '5 ОШИБОК', CX, S.y + 130, 150, 'GOLD', u, -0.4, 3.6, { stagger: 0.04, rot: -0.3 });
    line(ctx, 'НА КАРТЕ', CX, S.y + 250, 110, C.text, u, 0.6, 3.6, { stagger: 0.03 });
    line(ctx, 'из-за которых ты Страж', CX, S.y + S.h - 20, 52, C.muted, u, 1.3, 3.6, { face: UI, weight: 700, track: 0, stagger: 0.01 });
    return;
  }
  const i = FAILS.indexOf(f), out = f.at + 3.65;
  line(ctx, `#${5 - i}`, CX, S.y + 180, 200, C.red, u, f.at - 0.05, out, { from: 2.4, spring: SPRING.snappy, stagger: 0.05, rot: 0.3 });
  line(ctx, f.t1, CX, S.y + S.h - 100, K.fit(ctx, f.t1, 100), C.text, u, f.at + 0.2, out, { stagger: 0.02, from: 1.6 });
  line(ctx, f.t2, CX, S.y + S.h - 10, 50, '#f0c4c4', u, f.at + 0.6, out, { face: UI, weight: 700, track: 0, stagger: 0.008 });
  if (u > f.at + 2.4 && u < out) pill(ctx, 'ТЕБЯ УБИЛИ', CX, H * 0.5, 54, u, f.at + 2.4, out - 0.2, { bg: C.red, color: C.text });
}

function sceneDeaths(ctx, u, t) {
  background(ctx, u, CX, H * 0.5, 0.15);
  const a = (u - 30) * 0.12;
  G.renderSet(ctx, SET, t, u, { cam: [7 * Math.sin(a), 10, 7 * Math.cos(a), 0, 0, 0], fail: null, marks: true });
  bands(ctx, 600, 1300);
  line(ctx, 'СТРАЖ УМИРАЕТ', CX, S.y + 100, K.fit(ctx, 'СТРАЖ УМИРАЕТ', 110), C.text, u, 29.8, 35.6, { stagger: 0.02 });
  line(ctx, 'В ОДНИХ И ТЕХ ЖЕ МЕСТАХ', CX, S.y + 190, K.fit(ctx, 'В ОДНИХ И ТЕХ ЖЕ МЕСТАХ', 76), C.red, u, 30.4, 35.6, { stagger: 0.015 });
  line(ctx, 'бот покажет твои — на карте', CX, S.y + S.h - 20, 50, C.text, u, 33, 35.6, { face: UI, weight: 700, track: 0, stagger: 0.008 });
}

function sceneEnd(ctx, u, t) {
  background(ctx, u, CX, H * 0.55, 0.22 + 0.3 * Math.exp(-(u - 36)));
  rays(ctx, CX, H * 0.55, u, 0.4, 16);
  G.renderSet(ctx, SET, t, u, { cam: [0.5 * Math.sin(u * 0.3), lerp(9, 11, prog(u, 36, 44)), 8, 0, 0, 0], fail: null, marks: false });
  bands(ctx, 560, 1250);
  line(ctx, 'КАКАЯ ИЗ ПЯТИ', CX, S.y + 80, K.fit(ctx, 'КАКАЯ ИЗ ПЯТИ', 110), C.text, u, 35.8, null, { stagger: 0.03 });
  line(ctx, 'ТВОЯ?', CX, S.y + 210, 150, 'GOLD', u, 36.4, null, { stagger: 0.05, rot: 0.4 });
  line(ctx, 'номер — в комменты', CX, S.y + S.h - 200, 52, C.text, u, 38, null, { face: UI, weight: 700, track: 0, stagger: 0.01 });
  pill(ctx, '@DotaRazbor_bot', CX, S.y + S.h - 70, 60, u, 40);
}

M.film({
  fonts: K.FONTS, hits: HITS, samples: 3,
  async init() {
    await G.initGL({ exposure: 1.0 });
    SET = mapSet();
    PHONE = await phoneSet(['map', 'deaths']);
  },
  draw(ctx, u, t) {
    for (const f of FAILS) M.shake(ctx, u, f.at + 2.4, 22);
    for (const [b, amp] of [[0, 20], [30, 20], [36, 22]]) M.shake(ctx, u, b, amp);
    if (u < 24) sceneFails(ctx, u, t);
    else if (u < 30) K.botInsert(ctx, u, t, PHONE, 24, { l1: 'ГДЕ ТЫ УМИРАЕШЬ?', l2: 'БОТ ПОКАЖЕТ НА КАРТЕ', l3: 'кинь матч — разбор смертей бесплатно' });
    else if (u < 36) sceneDeaths(ctx, u, t);
    else sceneEnd(ctx, u, t);
  },
  post(ctx, u) {
    for (const f of FAILS) glitch(ctx, u, f.at + 2.4, 50, 0.4);
    for (const b of [0, 30, 36]) glitch(ctx, u, b, 40);
    K.vignette(ctx); K.grain(ctx, u);
  },
});
