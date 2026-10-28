// 3-D type in the display face: gold (or any) extruded words whose glyphs fly in on their own springs.
import * as G from '../lib/gl.js';
import * as M from '../lib/motion.js';
const { THREE } = G;

export const GOLD = () => new THREE.MeshPhysicalMaterial({ color: 0xe6b858, metalness: 1, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 });
export const IVORY = () => new THREE.MeshPhysicalMaterial({ color: 0xf4f4f5, metalness: 0.2, roughness: 0.35, clearcoat: 1 });
export const RED = () => new THREE.MeshPhysicalMaterial({ color: 0xf0585d, metalness: 0.5, roughness: 0.3, clearcoat: 1 });
export const GREEN = () => new THREE.MeshPhysicalMaterial({ color: 0x3fcf8e, metalness: 0.5, roughness: 0.3, clearcoat: 1 });

// words: [{ str, size, depth, mat }]; update(o.words[i] = { x, y, z, ry, rx, in: u0, out: u1|null, spin })
export function typeSet(words) {
  const scene = new THREE.Scene(), cam = G.camera(34, 0.1, 200);
  scene.environment = G.ENV; scene.environmentIntensity = 1.0;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6); key.position.set(-3, 5, 7); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc46b, 3.5); rim.position.set(5, 2, -6); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x120c06, 0.4));
  const W = words.map((w) => { const g = G.glyphs3D(w.str, w.size || 1, w.depth || 0.3, (w.mat || GOLD)(), w.bevel ?? 0.03); scene.add(g.group); return g; });
  return { scene, camera: cam, words: W,
    update(t, u, o) {
      G.lookFrom(cam, o.cam || [0, 0, 10], o.target || [0, 0, 0], o.roll || 0);
      W.forEach((w, i) => {
        const s = o.words[i];
        w.group.visible = !!s && u >= (s.in ?? 0) - 0.01 && (s.out == null || u < s.out + 0.6);
        if (!w.group.visible) return;
        w.group.position.set(s.x || 0, s.y || 0, s.z || 0);
        w.group.rotation.set(s.rx || 0, s.ry || 0, s.rz || 0);
        w.group.scale.setScalar(s.scale || 1);
        w.glyphs.forEach((m, j) => {
          const k = M.springU(u, (s.in ?? 0) + j * (s.stagger ?? 0.05), s.spring || M.SPRING.bouncy);
          const ex = s.out == null ? 0 : M.E.inBack(M.prog(u, s.out + j * 0.02, s.out + 0.45 + j * 0.02), 1.6);
          const h = m.userData.home;
          m.position.set(h.x, h.y + (1 - k) * -3 + ex * 6, h.z + (1 - k) * 4);
          m.rotation.set((1 - k) * -1.6 + ex * 1.2, (1 - k) * 0.8 + (s.spin ? s.spin * Math.sin(t * 2 + j) : 0), 0);
          m.scale.setScalar(Math.max(0.001, k));
        });
      });
    } };
}
