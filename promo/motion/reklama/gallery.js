// Галерея экранов в 3-D: настоящие экраны Mini App висят в тёмном пространстве вдоль пути камеры.
// Шесть главных панелей (по одной на фичу) стоят на пути, вокруг — «город» из остальных экранов и
// золотые осколки для параллакса. Камера пролетает от панели к панели: при переходе обе на экране.
// update() — чистая функция (t, u, o): o.s — позиция на пути (0..5, дробная во время перелёта).
import * as G from '../common/lib/gl.js';
import * as M from '../common/lib/motion.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const { THREE } = G;

const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// crop of an image -> texture with rounded corners (transparent outside)
function cropTex(im, [sx, sy, sw, sh], r = 36) {
  const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
  const c = cv.getContext('2d');
  c.beginPath(); c.roundRect(0, 0, sw, sh, r); c.clip();
  c.fillStyle = '#0b0b0d'; c.fillRect(0, 0, sw, sh);
  c.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// a slab: gold rim + dark metal back + the screen face
function slab(tex, w, h, gold, dark) {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new RoundedBoxGeometry(w + 0.09, h + 0.09, 0.06, 4, 0.08), gold); rim.position.z = -0.045; g.add(rim);
  const back = new THREE.Mesh(new RoundedBoxGeometry(w + 0.02, h + 0.02, 0.1, 4, 0.07), dark); back.position.z = -0.02; g.add(back);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, alphaTest: 0.5 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); face.position.z = 0.032; g.add(face);
  g.userData.mat = mat;
  return g;
}

// feats: [{ src, crop, frames? }], extras: [src] (full screenshots 780x1688)
export async function gallerySet(feats, extras) {
  const scene = new THREE.Scene(), cam = G.camera(35, 0.1, 120);
  scene.environment = G.ENV; scene.environmentIntensity = 0.9;
  scene.fog = new THREE.Fog(0x09090b, 14, 46);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4); key.position.set(-4, 6, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe6b858, 5); rim.position.set(6, 2, -10); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x120c06, 0.35));
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xe6b858, metalness: 1, roughness: 0.25, clearcoat: 0.6 });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x17171b, metalness: 0.8, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });

  // stations along the path
  const P = feats.map((_, i) => new THREE.Vector3(Math.sin(i * 1.7) * 3.2, Math.cos(i * 1.1) * 1.6, -i * 22));
  const YAW = feats.map((_, i) => (i % 2 ? -0.32 : 0.32));
  const panels = [];
  for (const [i, f] of feats.entries()) {
    let texs;
    if (f.frames) texs = (await Promise.all(f.frames.map(img))).map((im) => cropTex(im, [0, 0, im.width, im.height], 28));
    else { const im = await img(f.src); texs = [cropTex(im, f.crop || [0, 0, im.width, im.height])]; }
    const iw = texs[0].image.width, ih = texs[0].image.height;
    const w = Math.min(3.3, 4.3 * iw / ih), h = w * ih / iw;
    const g = slab(texs[0], w, h, gold, dark);
    g.position.copy(P[i]); g.rotation.y = YAW[i];
    scene.add(g); panels.push({ g, texs, w, h });
  }
  // the city: other screens scattered around the path, slowly turning
  const ex = await Promise.all(extras.map(img));
  const city = [];
  for (let i = 0; i < 40; i++) {
    const im = ex[i % ex.length];
    const r = (k) => M.hash01(i, k);
    const g = slab(cropTex(im, [0, 0, im.width, im.height], 60), 2.0, 2.0 * im.height / im.width, gold, dark);
    const side = i % 2 ? 1 : -1, z = 6 - (i / 40) * 124;
    const home = new THREE.Vector3(side * (8.5 + r(2) * 6), (r(3) - 0.5) * 11, z);
    g.position.copy(home);
    city.push({ g, home, ry: side * -0.6 + (r(4) - 0.5) * 0.8, rx: (r(5) - 0.5) * 0.5, ph: r(6) * 6.28 });
    scene.add(g);
  }
  // gold shards for parallax
  const N = 240, shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), gold, N);
  const SH = Array.from({ length: N }, (_, i) => ({
    p: new THREE.Vector3((M.hash01(i, 11) - 0.5) * 16, (M.hash01(i, 12) - 0.5) * 14, 8 - M.hash01(i, 13) * 125),
    s: 0.03 + M.hash01(i, 14) ** 2 * 0.12, a: M.hash01(i, 15) * 6.28, w: 0.4 + M.hash01(i, 16) }));
  scene.add(shards);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();

  // camera station i: in front of panel i, on its facing axis
  const camAt = (i, d) => {
    const n = new THREE.Vector3(Math.sin(YAW[i]), 0, Math.cos(YAW[i]));
    return P[i].clone().addScaledVector(n, d);
  };
  return { scene, camera: cam, panels, P,
    update(t, u, o) {
      const s = M.clamp(o.s ?? 0, 0, feats.length - 1), i0 = Math.floor(s), i1 = Math.min(feats.length - 1, i0 + 1), k = s - i0;
      // parked distance: the panel fills ~88% of the width or ~70% of the height
      const dist = (p) => (o.dist ?? 1) * Math.max(p.w / 0.354 / 0.88, p.h / 0.63 / 0.7);
      const a = camAt(i0, dist(panels[i0])), b = camAt(i1, dist(panels[i1]));
      // swoop: the flight bows sideways and up between stations
      const c = a.clone().lerp(b, k);
      const bow = Math.sin(Math.PI * k);
      c.x += bow * (i0 % 2 ? -1.0 : 1.0); c.y += bow * 0.6;
      // idle orbit around the panel while parked
      const orb = o.orbit ?? 0;
      c.x += Math.sin(orb) * 1.4; c.y += Math.cos(orb * 0.7) * 0.3;
      const tg = P[i0].clone().lerp(P[i1], M.E.outCubic(k));
      tg.y += o.lookY ?? 0;
      G.lookFrom(cam, [c.x, c.y, c.z + (o.push ?? 0)], [tg.x, tg.y, tg.z], (o.roll ?? 0) + bow * (i0 % 2 ? 0.25 : -0.25));
      // video panel plays its frames
      panels.forEach((p, i) => {
        if (p.texs.length > 1) { const f = Math.floor(Math.max(0, (o.vt ?? 0)) * 15) % p.texs.length; p.g.userData.mat.map = p.texs[f]; }
        p.g.position.copy(P[i]); p.g.position.y += 0.06 * Math.sin(t * 1.3 + i);
        p.g.rotation.set(0.03 * Math.sin(t * 0.9 + i), YAW[i] + 0.04 * Math.sin(t * 0.7 + i), 0);
      });
      for (const cbox of city) {
        cbox.g.position.set(cbox.home.x, cbox.home.y + 0.3 * Math.sin(t * 0.5 + cbox.ph), cbox.home.z);
        cbox.g.rotation.set(cbox.rx, cbox.ry + 0.15 * Math.sin(t * 0.3 + cbox.ph), 0.05 * Math.sin(t * 0.4 + cbox.ph));
      }
      SH.forEach((d, i) => {
        pos.copy(d.p); pos.y += Math.sin(t * d.w + d.a) * 0.4;
        q.setFromEuler(e.set(t * d.w + d.a, t * d.w * 0.7, 0)); sc.setScalar(d.s);
        shards.setMatrixAt(i, m4.compose(pos, q, sc));
      });
      shards.instanceMatrix.needsUpdate = true;
    } };
}
