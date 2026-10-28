// A phone carrying the bot's real Mini App screens (common/assets/app_*.png), lit in 3-D.
import * as G from '../lib/gl.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const { THREE } = G;
const tex = (src) => new Promise((res) => new THREE.TextureLoader().load(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }));

// screens: names of app_<name>.png; o.screen picks one by index each frame
export async function phoneSet(screens = ['review', 'killers']) {
  const maps = await Promise.all(screens.map((s) => tex(`../common/assets/app_${s}.png`)));
  const scene = new THREE.Scene(), cam = G.camera(32, 0.1, 100);
  scene.environment = G.ENV; scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2); key.position.set(-3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe6b858, 4); rim.position.set(4, 1, -4); scene.add(rim);
  const W = 2.2, SH = W * 1688 / 780, H = SH + 0.16;
  const group = new THREE.Group(); scene.add(group);
  const body = new THREE.Mesh(new RoundedBoxGeometry(W + 0.14, H + 0.1, 0.2, 6, 0.2),
    new THREE.MeshPhysicalMaterial({ color: 0x1a1a1e, metalness: 0.85, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }));
  group.add(body);
  const screenMat = new THREE.MeshBasicMaterial({ map: maps[0], toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, SH), screenMat);
  screen.position.z = 0.101; group.add(screen);
  const sheenTex = G.canvasTexture(256, 512);
  sheenTex.draw((c, w, h) => { const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.14)'); g.addColorStop(0.65, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h); });
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(W, SH), new THREE.MeshBasicMaterial({ map: sheenTex, transparent: true, depthWrite: false }));
  sheen.position.z = 0.103; group.add(sheen);
  return { scene, camera: cam,
    update(t, u, o) {
      G.lookFrom(cam, o.cam || [0, 0, 9], o.target || [0, 0, 0]);
      group.position.set(...o.pos); group.rotation.set(...o.rot);
      if (o.scale) group.scale.setScalar(o.scale); else group.scale.setScalar(1);
      screenMat.map = maps[o.screen || 0];
      sheenTex.offset.set(0, (o.rot[1] || 0) * 0.3);
    } };
}
