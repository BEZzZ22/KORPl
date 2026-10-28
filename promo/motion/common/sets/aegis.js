// The app's own Aegis (docs/aegis.js geometry: curved face with boss, concave back, rounded rim),
// rebuilt as a three.js mesh so it can be lit, fall, spin and stack in a column of three.
import * as G from '../lib/gl.js';
import * as M from '../lib/motion.js';
import { OUTLINE } from '../lib/aegis_shape.js';
const { THREE } = G;

const SHAPE = { bendY: [0.15, 0.12], bendX: [0.05, 0.03], radius: 0.85, edge: 0.035,
  boss: { x: 0.065, y: -0.028, dome: 0.165, height: 0.12, petals: 0.225, lift: 0.024 } };
let GRID = 80;
const bend = (v) => Math.max(-0.3, 1 - (v * v) / (SHAPE.radius * SHAPE.radius));
function bossLift(x, y) {
  const b = SHAPE.boss, d = Math.hypot(x - b.x, y - b.y);
  return (d < b.dome ? b.height * Math.pow(1 - (d / b.dome) ** 2, 0.6) : 0) + (d < b.petals ? b.lift * (1 - (d / b.petals) ** 6) : 0);
}
const zFront = (x, y) => SHAPE.bendY[0] * bend(y) + SHAPE.bendX[0] * bend(x) + SHAPE.edge / 2 + bossLift(x, y) - 0.1;
const zBack = (x, y) => SHAPE.bendY[1] * bend(y) + SHAPE.bendX[1] * bend(x) - SHAPE.edge / 2 - 0.1;

function shieldGeometry() {
  const n = OUTLINE.length / 2;
  const P = (i) => [OUTLINE[2 * (i % n)], OUTLINE[2 * (i % n) + 1]];
  const inside = (x, y) => { let hit = false;
    for (let i = 0, j = n - 1; i < n; j = i++) { const [xi, yi] = P(i), [xj, yj] = P(j);
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit; }
    return hit; };
  const pos = [], nrm = [], uv = [], idx = { front: [], back: [], rim: [] };
  const push = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nrm.push(nx, ny, nz); uv.push((x + 1) / 2, (y + 1) / 2); return pos.length / 3 - 1; };
  const e = 1e-3;
  for (const side of ['front', 'back']) {
    const z = side === 'front' ? zFront : zBack, sign = side === 'front' ? 1 : -1;
    const at = [], keep = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
      const x = -1 + (2 * i) / GRID, y = -1 + (2 * j) / GRID;
      const gx = (z(x + e, y) - z(x - e, y)) / (2 * e), gy = (z(x, y + e) - z(x, y - e)) / (2 * e), l = Math.hypot(gx, gy, 1);
      at.push(push(x, y, z(x, y), (-gx * sign) / l, (-gy * sign) / l, sign / l));
      keep.push(inside(x * 0.97, y * 0.97));
    }
    const k = (i, j) => j * (GRID + 1) + i;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      if (!(keep[k(i, j)] || keep[k(i + 1, j)] || keep[k(i, j + 1)] || keep[k(i + 1, j + 1)])) continue;
      const a = at[k(i, j)], b = at[k(i + 1, j)], c = at[k(i + 1, j + 1)], d = at[k(i, j + 1)];
      if (side === 'front') idx.front.push(a, b, c, a, c, d); else idx.back.push(a, c, b, a, d, c);
    }
  }
  const edge = (i) => { const [x0, y0] = P(i), [x1, y1] = P(i + 1), l = Math.hypot(x1 - x0, y1 - y0) || 1; return [(y1 - y0) / l, -(x1 - x0) / l]; };
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = edge((i + n - 1) % n), b = edge(i), l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    const ox = (a[0] + b[0]) / l, oy = (a[1] + b[1]) / l, [x, y] = P(i);
    const zf = zFront(x, y), zb = zBack(x, y), s = Math.SQRT1_2;
    rings.push([push(x, y, zf, ox * s, oy * s, s), push(x + ox * 0.006, y + oy * 0.006, (zf + zb) / 2, ox, oy, 0), push(x, y, zb, ox * s, oy * s, -s)]);
  }
  for (let i = 0; i < n; i++) { const A = rings[i], B = rings[(i + 1) % n];
    for (let r = 0; r < 2; r++) idx.rim.push(A[r + 1], B[r + 1], B[r], A[r + 1], B[r], A[r]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const all = [...idx.front, ...idx.back, ...idx.rim];
  g.setIndex(all);
  g.addGroup(0, idx.front.length, 0);
  g.addGroup(idx.front.length, idx.back.length, 1);
  g.addGroup(idx.front.length + idx.back.length, idx.rim.length, 2);
  return g;
}

const tex = (src, srgb = true) => new Promise((res) => new THREE.TextureLoader().load(src, (t) => {
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }));

export async function aegisSet(count = 3, grid = 80) {
  GRID = grid;
  const [front, back, fn, bn] = await Promise.all([tex('../common/assets/aegis_still.webp'), tex('../common/assets/aegis_back.webp'),
    tex('../common/assets/aegis_front_n.webp', false), tex('../common/assets/aegis_back_n.webp', false)]);
  const scene = new THREE.Scene(), cam = G.camera(36, 0.1, 100);
  scene.environment = G.ENV; scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4); key.position.set(-3, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc46b, 3.2); rim.position.set(4, 2, -5); scene.add(rim);
  const under = new THREE.PointLight(0xe6b858, 0, 6, 1.6); scene.add(under);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x120c06, 0.35));
  const geo = shieldGeometry();
  const mats = [
    new THREE.MeshStandardMaterial({ map: front, normalMap: fn, normalScale: new THREE.Vector2(1.2, 1.2), metalness: 0.55, roughness: 0.38,
      emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 0.32, transparent: true, alphaTest: 0.04, side: THREE.FrontSide }),
    new THREE.MeshStandardMaterial({ map: back, alphaMap: front, normalMap: bn, metalness: 0.6, roughness: 0.4, color: 0xcfa878,
      emissive: 0x3a2814, emissiveIntensity: 0.4, transparent: true, alphaTest: 0.04, side: THREE.FrontSide }),
    new THREE.MeshStandardMaterial({ color: 0x9a6e3e, metalness: 0.9, roughness: 0.3, emissive: 0x2a1a08 }),
  ];
  const shields = Array.from({ length: count }, (_, k) => k).map(() => { const m = new THREE.Mesh(geo, mats); scene.add(m); return m; });
  // landing shockwave: a thin gold ring per slot
  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const rings = Array.from({ length: count }, (_, k) => k).map(() => { const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 128), ringMat()); scene.add(r); return r; });
  const SLOT = [-2.25, 0, 2.25];     // 2021 bottom, 2023 middle, 2026 crowns the column
  const v = new THREE.Vector3();
  const set = { scene, camera: cam, SLOT,
    // project a world point to canvas pixels (for 2-D glow / labels pinned to an Aegis)
    project(x, y, z) { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * M.W, (1 - v.y) / 2 * M.H, v.z]; },
    update(t, u, o) {
      const c = o.cam; // [x, y, z, tx, ty, tz]
      G.lookFrom(cam, [c[0], c[1], c[2]], [c[3], c[4], c[5]], o.roll || 0);
      cam.fov = o.fov || 36; cam.updateProjectionMatrix();
      shields.forEach((m, i) => {
        const s = o.shields[i];
        m.visible = !!s && s.vis !== false;
        if (!m.visible) return;
        m.position.set(s.x || 0, s.y, s.z || 0);
        m.rotation.set(s.rx || 0, s.ry || 0, s.rz || 0);
        m.scale.setScalar(s.scale || 1);
        const r = rings[i], rk = s.ring ?? -1;
        r.visible = rk >= 0 && rk < 1;
        if (r.visible) {
          r.position.set(s.x || 0, s.y, (s.z || 0) - 0.25); r.rotation.set(0, 0, 0);
          r.scale.setScalar(1.0 + 1.6 * M.E.outCubic(rk)); r.material.opacity = 0.9 * (1 - rk) ** 1.5;
        }
      });
      under.intensity = o.under || 0; under.position.set(0, o.underY ?? 0, 1.4);
      key.intensity = 2.4 * (o.light ?? 1); rim.intensity = 3.2 * (o.light ?? 1);
    } };
  return set;
}
