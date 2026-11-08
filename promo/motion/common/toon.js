// Flat cartoon kit for the story shorts (gosha, zina): characters drawn in code, rooms, captions,
// notification banner, day HUD, chat bubbles, choice cards, phone with real app screens.
// Everything is a pure function of time (seeded noise only), drawn on a 1080x1920 canvas.
import * as M from './lib/motion.js';
const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, rrect, font, layout, hash01, noise1, TAU } = M;

export const D = 'Display', UI = 'UI';
export const INK = '#1d1420';
export const GOLD = '#ffc94a', RED = '#ff5a5f', GREEN = '#3fd68f', TEAL = '#38d9c9', WHITE = '#ffffff';
export const CX = W / 2;

// ---------------------------------------------------------------- timeline
// story.json: phrases [{i, text, t0, t1}] placed by the VO edit. P(i) gives one, at(t) the index.
export let STORY = null;
export async function loadStory() { STORY = await fetch('story.json').then((r) => r.json()); return STORY; }
export const P = (i) => STORY.phrases[i];
export const T0 = (i) => STORY.phrases[i].t0;
// seconds -> springs: spring() works in seconds, so use springT(t, t0)
export const springT = (t, t0, cfg = SPRING.bouncy) => M.spring(t - t0, cfg);
export const pt = (t, a, b) => clamp((t - a) / (b - a));

// ---------------------------------------------------------------- helpers
export function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }
export function fs(ctx, fill, stroke = INK, lw = 7) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke && lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}
function poly(ctx, pts, close = true) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (close) ctx.closePath(); }
// smooth closed blob through points (Catmull-Rom -> bezier)
export function blob(ctx, pts, close = true) {
  const n = pts.length; ctx.beginPath();
  const g = (i) => pts[close ? (i + n) % n : clamp(i, 0, n - 1)];
  ctx.moveTo(...g(0));
  for (let i = 0; i < (close ? n : n - 1); i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  if (close) ctx.closePath();
}

// seeded blinks
const BL = (() => { const o = []; let t = 0.7; for (let k = 0; t < 120; k++) { o.push(t); t += 1.8 + 2.4 * hash01(k, 51); } return o; })();
export function blinkAt(t) {
  let b = 0;
  for (const bt of BL) { const d = t - bt; if (d < 0 || d > 0.22) continue; b = Math.max(b, d < 0.06 ? d / 0.06 : 1 - (d - 0.06) / 0.16); }
  return b;
}

// ---------------------------------------------------------------- faces
// Expression presets: brow angle (+ = angry inner-down), browY, eye open, pupil size, mouth shape.
export const EXPR = {
  neutral: { brow: 0, browY: 0, eye: 1, pupil: 1, mouth: 'flat' },
  smug: { brow: 0.15, browY: 4, eye: 0.62, pupil: 1, mouth: 'smirk' },
  tired: { brow: -0.1, browY: 6, eye: 0.5, pupil: 0.95, mouth: 'flat' },
  angry: { brow: 0.45, browY: 10, eye: 0.8, pupil: 0.8, mouth: 'shout' },
  shock: { brow: -0.35, browY: -26, eye: 1.35, pupil: 0.55, mouth: 'O' },
  sad: { brow: -0.4, browY: 0, eye: 0.85, pupil: 1.1, mouth: 'frown' },
  happy: { brow: -0.1, browY: -8, eye: 1, pupil: 1, mouth: 'grin', happyEyes: 1 },
  determined: { brow: 0.35, browY: 6, eye: 0.85, pupil: 0.9, mouth: 'smirk' },
  proud: { brow: -0.05, browY: -6, eye: 0.7, pupil: 1, mouth: 'grin' },
  sly: { brow: 0.2, browY: 2, eye: 0.55, pupil: 1, mouth: 'smirk', lookX: 0.7 },
};
export function exprMix(a, b, k) {
  const A = EXPR[a], B = EXPR[b];
  const o = {};
  for (const key of ['brow', 'browY', 'eye', 'pupil']) o[key] = lerp(A[key], B[key], k);
  o.mouth = k < 0.5 ? A.mouth : B.mouth; o.happyEyes = lerp(A.happyEyes || 0, B.happyEyes || 0, k);
  o.lookX = lerp(A.lookX || 0, B.lookX || 0, k);
  return o;
}

// eye at (x,y), white radius r; side -1 left / +1 right
function eye(ctx, x, y, r, side, S, X) {
  const open = clamp(X.eye * (1 - S.blink), 0, 1.5);
  const ry = r * 1.12 * open;
  if (X.happyEyes > 0.5) { // ^ ^
    ctx.beginPath(); ctx.moveTo(x - r * 0.8, y + r * 0.25); ctx.quadraticCurveTo(x, y - r * 0.85, x + r * 0.8, y + r * 0.25);
    fs(ctx, null, INK, 9); return;
  }
  if (open < 0.08) { ctx.beginPath(); ctx.moveTo(x - r * 0.85, y); ctx.quadraticCurveTo(x, y + r * 0.25, x + r * 0.85, y); fs(ctx, null, INK, 8); return; }
  ell(ctx, x, y, r, ry); fs(ctx, '#fff', INK, 6);
  ctx.save(); ell(ctx, x, y, r, ry); ctx.clip();
  const px = x + (S.lookX + (X.lookX || 0)) * r * 0.38, py = y + S.lookY * r * 0.3;
  const pr = r * 0.48 * X.pupil;
  ell(ctx, px, py, pr, pr); ctx.fillStyle = S.iris || '#3a2a22'; ctx.fill();
  ell(ctx, px, py, pr * 0.55, pr * 0.55); ctx.fillStyle = '#120c0c'; ctx.fill();
  ell(ctx, px - pr * 0.35, py - pr * 0.4, pr * 0.28, pr * 0.28); ctx.fillStyle = '#fff'; ctx.fill();
  // upper lid shade when half-open
  if (open < 0.9) { ctx.fillStyle = S.lid || 'rgba(120,70,60,0.35)'; ctx.fillRect(x - r, y - ry - 2, r * 2, ry * (0.9 - open) * 1.4); }
  ctx.restore();
  ell(ctx, x, y, r, ry); fs(ctx, null, INK, 6);
}
function brow(ctx, x, y, w, side, X, color, thick = 16) {
  const a = -X.brow * side; // inner end down when angry
  ctx.save(); ctx.translate(x, y + X.browY); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(-w / 2, 4); ctx.quadraticCurveTo(0, -8, w / 2, 4);
  ctx.lineWidth = thick; ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.stroke();
  ctx.restore();
}
function mouth(ctx, x, y, w, X, S) {
  const talk = S.talk || 0; // 0..1 extra opening while speaking
  const shape = talk > 0.15 && (X.mouth === 'flat' || X.mouth === 'smirk') ? 'talk' : X.mouth;
  ctx.save(); ctx.translate(x, y);
  if (shape === 'flat') { ctx.beginPath(); ctx.moveTo(-w * 0.35, 0); ctx.quadraticCurveTo(0, 4, w * 0.35, 0); fs(ctx, null, INK, 8); }
  else if (shape === 'smirk') { ctx.beginPath(); ctx.moveTo(-w * 0.35, 2); ctx.quadraticCurveTo(w * 0.05, 10, w * 0.4, -12); fs(ctx, null, INK, 8); }
  else if (shape === 'frown') { ctx.beginPath(); ctx.moveTo(-w * 0.35, 10); ctx.quadraticCurveTo(0, -14, w * 0.35, 10); fs(ctx, null, INK, 8); }
  else {
    let mw, mh;
    if (shape === 'O') { mw = w * 0.32; mh = w * 0.42 + talk * 10; }
    else if (shape === 'shout') { mw = w * 0.5; mh = w * 0.34 + talk * 12; }
    else if (shape === 'grin') { mw = w * 0.55; mh = w * 0.3 + talk * 10; }
    else { mw = w * 0.36; mh = w * (0.08 + 0.3 * talk); }
    ctx.beginPath();
    if (shape === 'grin') { ctx.moveTo(-mw, -mh * 0.25); ctx.quadraticCurveTo(0, -mh * 0.05, mw, -mh * 0.25); ctx.quadraticCurveTo(mw * 0.8, mh * 1.2, 0, mh * 1.1); ctx.quadraticCurveTo(-mw * 0.8, mh * 1.2, -mw, -mh * 0.25); }
    else if (shape === 'shout') { ctx.moveTo(-mw, mh * 0.2); ctx.quadraticCurveTo(0, -mh * 0.9, mw, mh * 0.2); ctx.quadraticCurveTo(mw * 0.6, mh * 1.1, 0, mh); ctx.quadraticCurveTo(-mw * 0.6, mh * 1.1, -mw, mh * 0.2); }
    else ctx.ellipse(0, 0, mw, mh, 0, 0, TAU);
    ctx.closePath();
    ctx.save(); ctx.fillStyle = '#5a1620'; ctx.fill(); ctx.clip();
    if (shape === 'grin' || shape === 'shout') { ctx.fillStyle = '#fff'; ctx.fillRect(-mw, shape === 'grin' ? -mh * 0.4 : -mh, mw * 2, mh * (shape === 'grin' ? 0.55 : 0.45)); }
    ell(ctx, 0, mh * 0.9, mw * 0.6, mh * 0.45); ctx.fillStyle = '#e8616c'; ctx.fill();
    ctx.restore();
    fs(ctx, null, INK, 7);
  }
  ctx.restore();
}
function sweatDrops(ctx, k, t, x, y) {
  if (k <= 0) return;
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.9 + i * 0.33) % 1;
    const dx = x + (i - 1) * 70 + (i === 1 ? 30 : 0), dy = y + ph * 120;
    ctx.save(); ctx.globalAlpha = k * (1 - ph);
    ctx.beginPath(); ctx.moveTo(dx, dy - 26); ctx.quadraticCurveTo(dx + 16, dy, dx, dy + 12); ctx.quadraticCurveTo(dx - 16, dy, dx, dy - 26);
    fs(ctx, '#8fd8ff', INK, 4); ctx.restore();
  }
}

// ---------------------------------------------------------------- Gosha
// Model units: head centre (0,0), head ~ 300 wide. Body below to y ~ 700.
export const GOSHA = { skin: '#f4c7a1', skinSh: '#e3a982', hair: '#2e211d', hairHi: '#4a3730', hood: '#2fae9a', hoodSh: '#228675', hoodDk: '#1a6b5e', cup: '#ff5a5f', cupDk: '#c63c43', band: '#2a2a33' };
export function drawGosha(ctx, S) {
  const c = GOSHA, X = S.X || EXPR.neutral, t = S.t || 0;
  const br = Math.sin(t * 2.2) * 4 * (S.breathe ?? 1);
  // ---- body
  ctx.save(); ctx.translate(0, br * 0.5);
  // hood behind neck
  blob(ctx, [[-170, 175], [0, 140], [170, 175], [150, 250], [-150, 250]]); fs(ctx, c.hoodSh);
  // torso
  ctx.beginPath(); ctx.moveTo(-120, 200); ctx.bezierCurveTo(-260, 215, -300, 330, -310, 760); ctx.lineTo(310, 760); ctx.bezierCurveTo(300, 330, 260, 215, 120, 200); ctx.closePath(); fs(ctx, c.hood);
  // shading side
  ctx.save(); ctx.clip(); ctx.fillStyle = c.hoodSh; ctx.beginPath(); ctx.ellipse(250, 520, 120, 360, 0.1, 0, TAU); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.moveTo(-120, 200); ctx.bezierCurveTo(-260, 215, -300, 330, -310, 760); ctx.lineTo(310, 760); ctx.bezierCurveTo(300, 330, 260, 215, 120, 200); fs(ctx, null);
  // neck
  ctx.beginPath(); ctx.moveTo(-55, 120); ctx.lineTo(-62, 215); ctx.quadraticCurveTo(0, 245, 62, 215); ctx.lineTo(55, 120); fs(ctx, c.skinSh);
  // hood rim around neck
  ctx.beginPath(); ctx.moveTo(-125, 195); ctx.quadraticCurveTo(0, 290, 125, 195); ctx.lineWidth = 26; ctx.strokeStyle = c.hoodDk; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-125, 195); ctx.quadraticCurveTo(0, 290, 125, 195); fs(ctx, null, INK, 6);
  // drawstrings
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 45, 250); ctx.quadraticCurveTo(s * 52, 320, s * 40 + Math.sin(t * 2 + s) * 6, 390); ctx.lineWidth = 9; ctx.strokeStyle = '#f2f2f2'; ctx.stroke(); }
  // chest print: a small sword emblem
  ctx.save(); ctx.translate(0, 470); ctx.rotate(-0.6); ctx.fillStyle = c.hoodDk; ctx.fillRect(-8, -80, 16, 130); ctx.fillRect(-36, 30, 72, 14); ctx.restore();
  ctx.restore();
  // ---- arms (pose)
  drawArms(ctx, S, c.hood, c.hoodSh, c.skin, t);
  // ---- head
  const yaw = S.yaw || 0, nod = S.nod || 0;
  ctx.save(); ctx.translate(0, br + nod); ctx.rotate(S.roll || 0);
  // headset band behind hair
  // ears
  for (const s of [-1, 1]) { ell(ctx, s * 150, 20, 30, 42); fs(ctx, c.skin); }
  // head
  blob(ctx, [[0, -165], [120, -140], [160, -40], [150, 70], [95, 150], [0, 175], [-95, 150], [-150, 70], [-160, -40], [-120, -140]]); fs(ctx, c.skin);
  ctx.save(); blob(ctx, [[0, -165], [120, -140], [160, -40], [150, 70], [95, 150], [0, 175], [-95, 150], [-150, 70], [-160, -40], [-120, -140]]); ctx.clip();
  ell(ctx, 150, 60, 60, 160); ctx.fillStyle = c.skinSh; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
  // monitor light on face
  if (S.glow) { const g = ctx.createLinearGradient(0, -170, 0, 180); g.addColorStop(0, `rgba(90,200,255,${0.0})`); g.addColorStop(1, `rgba(90,200,255,${0.28 * S.glow})`); ctx.fillStyle = g; ctx.fillRect(-170, -170, 340, 350); }
  ctx.restore();
  // stubble dots + pimple
  ctx.fillStyle = 'rgba(70,40,30,0.35)';
  for (let i = 0; i < 26; i++) { const a = hash01(i, 3) * Math.PI - 0.0, rr = 120 + hash01(i, 4) * 30; const x = Math.cos(a) * rr * 0.75, y = 60 + Math.sin(a) * rr * 0.6; ell(ctx, x, y, 3, 3); ctx.fill(); }
  ell(ctx, -95, 75, 9, 9); fs(ctx, '#ef8a7a', null);
  ell(ctx, 105, -95, 7, 7); fs(ctx, '#ef8a7a', null);
  // cheeks blush (shock/angry)
  if (S.blush) { for (const s of [-1, 1]) { ell(ctx, s * 95, 70, 34, 18); ctx.fillStyle = `rgba(255,110,110,${0.4 * S.blush})`; ctx.fill(); } }
  const ex = yaw * 30;
  // eye bags
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(ex + s * 58 - 36, 42); ctx.quadraticCurveTo(ex + s * 58, 62, ex + s * 58 + 36, 42); fs(ctx, null, 'rgba(110,70,120,0.6)', 7); }
  eye(ctx, ex - 58, 5, 40, -1, S, X); eye(ctx, ex + 58, 5, 40, 1, S, X);
  brow(ctx, ex - 60, -60, 82, -1, X, c.hair, 18); brow(ctx, ex + 60, -60, 82, 1, X, c.hair, 18);
  // nose
  ctx.beginPath(); ctx.moveTo(ex + 4, 30); ctx.quadraticCurveTo(ex + 26, 72, ex - 2, 80); fs(ctx, null, '#b8775a', 7);
  mouth(ctx, ex, 115, 120, X, S);
  sweatDrops(ctx, S.sweat || 0, t, ex + 0, -40);
  // hair: messy spikes
  const sw = (S.hairSway || 0);
  blob(ctx, [[-170, -10], [-175, -100], [-150, -170], [-90, -215], [-20, -232], [60, -228], [130, -200], [175, -130], [178, -20], [150, -60], [120, -110], [70, -95], [40, -125], [0, -95], [-40, -128], [-80, -92], [-120, -120], [-150, -60]]);
  fs(ctx, c.hair);
  // spikes on top
  for (let i = 0; i < 6; i++) {
    const x0 = -130 + i * 52, a = -0.5 + i * 0.2 + sw * 0.5 + 0.04 * Math.sin(t * 3 + i);
    ctx.save(); ctx.translate(x0, -200 + Math.abs(i - 2.5) * 10); ctx.rotate(a);
    poly(ctx, [[-26, 10], [0, -70 - (i % 2) * 18], [26, 10]]); fs(ctx, c.hair, INK, 6); ctx.restore();
  }
  // re-stroke top mass (cover spike bases)
  blob(ctx, [[-150, -150], [-80, -205], [0, -220], [80, -212], [150, -160], [120, -130], [0, -150], [-120, -130]]); fs(ctx, c.hair, null);
  ctx.beginPath(); ctx.moveTo(-80, -190); ctx.quadraticCurveTo(-20, -205, 30, -195); fs(ctx, null, c.hairHi, 10);
  // headset
  ctx.beginPath(); ctx.ellipse(0, -10, 178, 215, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.lineWidth = 30; ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = 18; ctx.strokeStyle = c.band; ctx.stroke();
  for (const s of [-1, 1]) { rrect(ctx, s * 168 - 34, -40, 68, 110, 30); fs(ctx, c.cup); rrect(ctx, s * 168 - 18, -18, 36, 66, 16); fs(ctx, c.cupDk, null); }
  // mic boom
  ctx.beginPath(); ctx.moveTo(-168, 50); ctx.quadraticCurveTo(-150, 150, -60, 140); fs(ctx, null, INK, 14); ctx.beginPath(); ctx.moveTo(-168, 50); ctx.quadraticCurveTo(-150, 150, -60, 140); fs(ctx, null, c.band, 7);
  ell(ctx, -55, 140, 16, 13); fs(ctx, c.cupDk);
  ctx.restore();
}

// arms: pose 'keys' (on keyboard), 'phone' (holding phone up at chest), 'fist' (raised fist), 'shrug', 'facepalm', 'none'
function drawArms(ctx, S, sleeve, sleeveSh, skin, t) {
  const pose = S.pose || 'keys';
  const typ = S.typing ? Math.sin(t * 28) * 8 : 0;
  const arm = (pts, hand, hr = 46) => {
    ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.bezierCurveTo(...pts[1], ...pts[2], ...pts[3]);
    ctx.lineWidth = 102; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = 88; ctx.strokeStyle = sleeve; ctx.stroke();
    ell(ctx, hand[0], hand[1], hr, hr * 0.85); fs(ctx, skin);
  };
  if (pose === 'keys') {
    arm([[-250, 330], [-330, 520], [-260, 690], [-150, 700 + typ]], [-140, 700 + typ]);
    arm([[250, 330], [330, 520], [260, 690], [150, 700 - typ]], [140, 700 - typ]);
  } else if (pose === 'phone') {
    arm([[-250, 330], [-330, 520], [-200, 560], [-70, 470]], [-70, 470]);
    arm([[250, 330], [330, 520], [200, 560], [70, 480]], [70, 480]);
  } else if (pose === 'fist') {
    arm([[-250, 330], [-330, 520], [-260, 690], [-150, 700]], [-140, 700]);
    const k = S.fistK ?? 1;
    arm([[250, 330], [360, 300 - 100 * k], [330, 120 - 200 * k], [260, 60 - 180 * k]], [260, 50 - 180 * k], 56);
  } else if (pose === 'cheeks') {
    arm([[-250, 330], [-360, 420], [-280, 200], [-150, 80]], [-150, 80], 54);
    arm([[250, 330], [360, 420], [280, 200], [150, 80]], [150, 80], 54);
  } else if (pose === 'facepalm') {
    arm([[-250, 330], [-330, 520], [-260, 690], [-150, 700]], [-140, 700]);
    arm([[250, 330], [330, 380], [200, 200], [50, 20]], [40, 10], 60);
  }
}

// ---------------------------------------------------------------- Baba Zina
export const ZINA = { skin: '#f6cfb3', skinSh: '#e8ae8e', hair: '#d9d6df', hairSh: '#b3afbd', cardi: '#c4473f', cardiSh: '#9c342e', shawl: '#f2b84b', shawlSh: '#d39532', frame: '#7a4a2a' };
export function drawZina(ctx, S) {
  const c = ZINA, X = S.X || EXPR.neutral, t = S.t || 0;
  const br = Math.sin(t * 2.0) * 4;
  // bun behind
  ctx.save(); ctx.translate(0, br);
  ell(ctx, 0, -205, 95, 80); fs(ctx, c.hair);
  ctx.beginPath(); ctx.arc(0, -205, 55, 3.6, 5.6); fs(ctx, null, c.hairSh, 8);
  // pins
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 30, -270); ctx.lineTo(s * 70, -180); fs(ctx, null, '#3a3340', 7); }
  ctx.restore();
  // body: cardigan
  ctx.save(); ctx.translate(0, br * 0.5);
  ctx.beginPath(); ctx.moveTo(-110, 190); ctx.bezierCurveTo(-280, 210, -320, 330, -330, 760); ctx.lineTo(330, 760); ctx.bezierCurveTo(320, 330, 280, 210, 110, 190); ctx.closePath(); fs(ctx, c.cardi);
  ctx.save(); ctx.clip(); ctx.fillStyle = c.cardiSh; ell(ctx, 270, 520, 120, 360, 0.1); ctx.fill();
  // knit stripes
  ctx.globalAlpha = 0.25; for (let y = 260; y < 760; y += 34) { ctx.beginPath(); ctx.moveTo(-340, y); ctx.lineTo(340, y + 6); ctx.lineWidth = 4; ctx.strokeStyle = '#5c1b17'; ctx.stroke(); } ctx.globalAlpha = 1;
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(-110, 190); ctx.bezierCurveTo(-280, 210, -320, 330, -330, 760); ctx.lineTo(330, 760); ctx.bezierCurveTo(320, 330, 280, 210, 110, 190); fs(ctx, null);
  // blouse V + buttons
  poly(ctx, [[-70, 190], [0, 360], [70, 190]]); fs(ctx, '#f4efe6');
  ctx.beginPath(); ctx.moveTo(0, 360); ctx.lineTo(0, 760); fs(ctx, null, INK, 6);
  for (let i = 0; i < 4; i++) { ell(ctx, 22, 410 + i * 80, 12, 12); fs(ctx, '#f2d27a', INK, 4); }
  // neck
  ctx.beginPath(); ctx.moveTo(-52, 120); ctx.lineTo(-58, 200); ctx.quadraticCurveTo(0, 230, 58, 200); ctx.lineTo(52, 120); fs(ctx, c.skinSh);
  // shawl over shoulders
  ctx.beginPath(); ctx.moveTo(-300, 330); ctx.bezierCurveTo(-240, 200, -130, 175, -80, 200); ctx.lineTo(-30, 330); ctx.bezierCurveTo(-120, 300, -220, 330, -300, 420); ctx.closePath(); fs(ctx, c.shawl);
  ctx.beginPath(); ctx.moveTo(300, 330); ctx.bezierCurveTo(240, 200, 130, 175, 80, 200); ctx.lineTo(30, 330); ctx.bezierCurveTo(120, 300, 220, 330, 300, 420); ctx.closePath(); fs(ctx, c.shawl);
  // shawl dots
  ctx.fillStyle = '#c4473f'; for (let i = 0; i < 10; i++) { const s = i % 2 ? 1 : -1, k = Math.floor(i / 2); ell(ctx, s * (110 + k * 35), 250 + k * 18 + (k % 2) * 10, 8, 8); ctx.fill(); }
  ctx.restore();
  drawArms(ctx, S, c.cardi, c.cardiSh, c.skin, t);
  // head
  ctx.save(); ctx.translate(0, br + (S.nod || 0)); ctx.rotate(S.roll || 0);
  for (const s of [-1, 1]) { ell(ctx, s * 150, 30, 28, 40); fs(ctx, c.skin); ell(ctx, s * 152, 78, 9, 9); fs(ctx, GOLD, INK, 4); }
  const head = [[0, -160], [115, -140], [155, -40], [150, 70], [100, 150], [0, 178], [-100, 150], [-150, 70], [-155, -40], [-115, -140]];
  blob(ctx, head); fs(ctx, c.skin);
  ctx.save(); blob(ctx, head); ctx.clip(); ell(ctx, 150, 60, 60, 160); ctx.fillStyle = c.skinSh; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
  if (S.glow) { const g = ctx.createLinearGradient(0, -170, 0, 180); g.addColorStop(0, 'rgba(90,200,255,0)'); g.addColorStop(1, `rgba(90,200,255,${0.08 * S.glow})`); ctx.fillStyle = g; ctx.fillRect(-170, -170, 340, 350); }
  ctx.restore();
  // cheeks
  for (const s of [-1, 1]) { ell(ctx, s * 92, 75, 36, 22); ctx.fillStyle = `rgba(240,110,110,${0.35 + 0.3 * (S.blush || 0)})`; ctx.fill(); }
  // wrinkles
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 120, -10); ctx.quadraticCurveTo(s * 132, 5, s * 125, 20); fs(ctx, null, 'rgba(150,90,70,0.6)', 5); ctx.beginPath(); ctx.moveTo(s * 50, 95); ctx.quadraticCurveTo(s * 62, 125, s * 50, 150); fs(ctx, null, 'rgba(150,90,70,0.5)', 5); }
  ctx.beginPath(); ctx.moveTo(-40, -95); ctx.quadraticCurveTo(0, -102, 40, -95); fs(ctx, null, 'rgba(150,90,70,0.45)', 5);
  const ex = (S.yaw || 0) * 30;
  // eyes (magnified by glasses)
  eye(ctx, ex - 60, 12, 36, -1, S, X); eye(ctx, ex + 60, 12, 36, 1, S, X);
  brow(ctx, ex - 62, -52, 70, -1, X, c.hairSh, 13); brow(ctx, ex + 62, -52, 70, 1, X, c.hairSh, 13);
  // glasses
  for (const s of [-1, 1]) { ell(ctx, ex + s * 62, 12, 56, 52); ctx.fillStyle = 'rgba(200,235,255,0.18)'; ctx.fill(); fs(ctx, null, c.frame, 10);
    ctx.save(); ell(ctx, ex + s * 62, 12, 56, 52); ctx.clip(); ctx.beginPath(); ctx.moveTo(ex + s * 62 - 50, -10); ctx.lineTo(ex + s * 62 - 10, -50); ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke(); ctx.restore(); }
  ctx.beginPath(); ctx.moveTo(ex - 8, 5); ctx.quadraticCurveTo(ex, -4, ex + 8, 5); fs(ctx, null, c.frame, 8);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(ex + s * 118, 5); ctx.lineTo(s * 150, 0); fs(ctx, null, c.frame, 8); }
  // nose
  ctx.beginPath(); ctx.moveTo(ex + 2, 55); ctx.quadraticCurveTo(ex + 28, 88, ex - 2, 95); fs(ctx, null, '#c07c62', 7);
  mouth(ctx, ex, 128, 110, X, S);
  sweatDrops(ctx, S.sweat || 0, t, ex, -30);
  // hair front: waves
  blob(ctx, [[-160, 0], [-168, -90], [-120, -160], [-40, -185], [40, -185], [120, -160], [168, -90], [160, 0], [135, -60], [95, -110], [40, -120], [0, -105], [-40, -120], [-95, -110], [-135, -60]]); fs(ctx, c.hair);
  ctx.beginPath(); ctx.moveTo(-110, -130); ctx.quadraticCurveTo(-60, -165, 0, -150); fs(ctx, null, c.hairSh, 7);
  ctx.beginPath(); ctx.moveTo(110, -130); ctx.quadraticCurveTo(60, -165, 0, -150); fs(ctx, null, c.hairSh, 7);
  // optional gamer headset (later scenes)
  if (S.headset) {
    ctx.beginPath(); ctx.ellipse(0, -10, 175, 205, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.lineWidth = 30; ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = 18; ctx.strokeStyle = '#ff7ab8'; ctx.stroke();
    for (const s of [-1, 1]) { rrect(ctx, s * 165 - 34, -30, 68, 110, 30); fs(ctx, '#ff7ab8'); rrect(ctx, s * 165 - 18, -8, 36, 66, 16); fs(ctx, '#d14d8f', null); }
    // cat ears on headset
    for (const s of [-1, 1]) { poly(ctx, [[s * 70, -190], [s * 120, -275], [s * 140, -175]]); fs(ctx, '#ff7ab8'); }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- props
export function monitorBack(ctx, x, y, w, h, t, o = {}) {
  // a monitor seen from behind, with RGB glow rim
  const hue = o.rgb ? (t * 90) % 360 : null;
  ctx.save(); ctx.translate(x, y);
  if (o.rgb) { ctx.shadowColor = `hsl(${hue},90%,60%)`; ctx.shadowBlur = 60; }
  rrect(ctx, -w / 2, -h / 2, w, h, 22); fs(ctx, '#2b2f3d'); ctx.shadowBlur = 0;
  rrect(ctx, -w / 2 + 16, -h / 2 + 16, w - 32, h - 32, 14); fs(ctx, '#353a4b', null);
  ctx.beginPath(); ctx.moveTo(-30, h / 2); ctx.lineTo(-45, h / 2 + 70); ctx.lineTo(45, h / 2 + 70); ctx.lineTo(30, h / 2); fs(ctx, '#2b2f3d');
  ctx.restore();
}
export function can(ctx, x, y, s, color, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  rrect(ctx, -32, -90, 64, 180, 14); fs(ctx, color);
  ctx.fillStyle = '#111'; ctx.fillRect(-32, -30, 64, 46); ctx.fillStyle = color === '#111' ? GREEN : '#fff';
  ctx.beginPath(); ctx.moveTo(-12, -24); ctx.lineTo(10, -24); ctx.lineTo(-4, 0); ctx.lineTo(12, 0); ctx.lineTo(-14, 12); ctx.lineTo(-2, -10); ctx.lineTo(-16, -10); ctx.closePath(); ctx.fill();
  rrect(ctx, -32, -90, 64, 180, 14); fs(ctx, null);
  ell(ctx, 0, -90, 28, 8); fs(ctx, '#cfd3da', INK, 5);
  ctx.restore();
}
export function pizzaBox(ctx, x, y, w, rot = 0, open = false) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  rrect(ctx, -w / 2, -w * 0.12, w, w * 0.24, 8); fs(ctx, '#e3b778');
  ctx.fillStyle = '#c0392b'; ctx.font = font(w * 0.12, 900, D); ctx.textAlign = 'center'; ctx.fillText('ПИЦЦА', 0, w * 0.045);
  ctx.restore();
}
export function mug(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.arc(52, 0, 30, -1.4, 1.4); fs(ctx, null, INK, 16); ctx.beginPath(); ctx.arc(52, 0, 30, -1.4, 1.4); fs(ctx, null, '#fff', 7);
  rrect(ctx, -55, -60, 110, 120, 16); fs(ctx, '#fff');
  for (let i = 0; i < 5; i++) { ell(ctx, -30 + i * 15, -10 + (i % 2) * 22, 8, 8); ctx.fillStyle = '#3b6fd1'; ctx.fill(); }
  ell(ctx, 0, -60, 52, 12); fs(ctx, '#8a4b1f', INK, 5);
  ctx.restore();
}
export function steam(ctx, x, y, t, a = 1) {
  ctx.save(); ctx.globalAlpha = 0.5 * a;
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.5 + i / 3) % 1;
    ctx.beginPath(); ctx.moveTo(x + (i - 1) * 24, y - ph * 120);
    ctx.bezierCurveTo(x + (i - 1) * 24 + 20, y - ph * 120 - 30, x + (i - 1) * 24 - 20, y - ph * 120 - 60, x + (i - 1) * 24, y - ph * 120 - 90);
    ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.strokeStyle = `rgba(255,255,255,${1 - ph})`; ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- rooms
export function roomGosha(ctx, t, o = {}) {
  // wall
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#141a2e'); g.addColorStop(1, '#0d1222'); ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, H * 3);
  // vertical panel stripes
  ctx.fillStyle = 'rgba(255,255,255,0.025)'; for (let x = -W; x < W * 2; x += 120) ctx.fillRect(x, -H, 60, H * 3);
  // LED strip along top (teal -> pink)
  const led = ctx.createLinearGradient(0, 0, W, 0); led.addColorStop(0, '#2de0d0'); led.addColorStop(1, '#ff5fa2');
  ctx.fillStyle = led; ctx.fillRect(-W, 120, W * 3, 10);
  const lg = ctx.createLinearGradient(0, 130, 0, 520); lg.addColorStop(0, 'rgba(56,217,201,0.22)'); lg.addColorStop(1, 'rgba(56,217,201,0)'); ctx.fillStyle = lg; ctx.fillRect(-W, 130, W * 3, 390);
  // window with night city
  ctx.save(); ctx.translate(820, 520);
  rrect(ctx, -170, -210, 340, 420, 14); fs(ctx, '#0a1a3a');
  ctx.save(); rrect(ctx, -170, -210, 340, 420, 14); ctx.clip();
  const sky = ctx.createLinearGradient(0, -210, 0, 210); sky.addColorStop(0, '#0b1d4a'); sky.addColorStop(1, '#2a2160'); ctx.fillStyle = sky; ctx.fillRect(-170, -210, 340, 420);
  for (let i = 0; i < 7; i++) { const bx = -170 + i * 52, bh = 120 + hash01(i, 8) * 200; ctx.fillStyle = '#0a1028'; ctx.fillRect(bx, 210 - bh, 46, bh);
    for (let k = 0; k < 14; k++) { if (hash01(i * 31 + k, 9) > 0.55) { ctx.fillStyle = hash01(k, i) > 0.5 ? '#ffd76a' : '#9fd8ff'; ctx.fillRect(bx + 8 + (k % 3) * 12, 210 - bh + 14 + Math.floor(k / 3) * 26, 7, 12); } } }
  ctx.restore();
  ctx.fillStyle = INK; ctx.fillRect(-6, -210, 12, 420); ctx.fillRect(-170, -6, 340, 12);
  rrect(ctx, -170, -210, 340, 420, 14); fs(ctx, null, '#2a3350', 14);
  ctx.restore();
  // poster left: abstract sword + "GG WP"
  ctx.save(); ctx.translate(230, 470); ctx.rotate(-0.05);
  rrect(ctx, -130, -180, 260, 360, 8); fs(ctx, '#b8323a');
  ctx.fillStyle = '#ffd76a'; ctx.save(); ctx.rotate(0.6); ctx.fillRect(-10, -150, 20, 230); ctx.fillRect(-50, 60, 100, 18); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = font(64, 900, D); ctx.textAlign = 'center'; ctx.fillText('GG WP', 0, 150);
  ctx.restore();
  // shelf with figurines
  ctx.fillStyle = '#3a2a22'; ctx.fillRect(380, 300, 260, 16);
  for (let i = 0; i < 3; i++) { ell(ctx, 430 + i * 80, 268, 22, 32); fs(ctx, ['#7a6bff', '#ffcf4a', '#ff6b6b'][i], INK, 5); }
  // wall clock
  if (o.clock) {
    ctx.save(); ctx.translate(560, 560); ell(ctx, 0, 0, 70, 70); fs(ctx, '#f4f0e6', INK, 8);
    const hA = t * 6, mA = t * 40; for (const [a, L, w] of [[hA, 34, 9], [mA, 52, 6]]) { ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); fs(ctx, null, INK, w); ctx.restore(); }
    ctx.restore();
  }
}
export function deskGosha(ctx, t, y, o = {}) {
  // desk surface in front of the character (covers lower body)
  ctx.fillStyle = '#3b2a2a'; ctx.fillRect(-W, y, W * 3, H);
  ctx.fillStyle = '#4c3634'; ctx.fillRect(-W, y, W * 3, 26);
  ctx.beginPath(); ctx.moveTo(-W, y); ctx.lineTo(W * 2, y); fs(ctx, null, INK, 8);
  // keyboard glow
  const kb = ctx.createLinearGradient(CX - 260, 0, CX + 260, 0); kb.addColorStop(0, '#2de0d0'); kb.addColorStop(0.5, '#a66bff'); kb.addColorStop(1, '#ff5fa2');
  ctx.save(); ctx.translate(CX, y + 70); rrect(ctx, -270, -26, 540, 60, 12); fs(ctx, '#22242e'); ctx.globalAlpha = 0.75; rrect(ctx, -255, -16, 510, 40, 8); ctx.fillStyle = kb; ctx.fill(); ctx.restore();
  // cans + pizza + mouse
  can(ctx, 130, y + 10, 0.9, '#111', -0.08); can(ctx, 215, y + 30, 0.8, GREEN, 0.15); can(ctx, 60, y + 60, 0.75, '#111', 1.4);
  pizzaBox(ctx, 900, y + 80, 300, -0.06); pizzaBox(ctx, 920, y + 30, 290, 0.04);
  ell(ctx, 790, y + 150, 40, 28); fs(ctx, '#22242e');
}
export function roomZina(ctx, t, o = {}) {
  // warm wallpaper with pattern
  ctx.fillStyle = '#e9cf9f'; ctx.fillRect(-W, -H, W * 3, H * 3);
  ctx.fillStyle = 'rgba(160,100,60,0.18)';
  for (let y = -40; y < H; y += 110) for (let x = -40; x < W + 80; x += 110) { const ox = (Math.floor(y / 110) % 2) * 55; ctx.save(); ctx.translate(x + ox, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-12, -12, 24, 24); ctx.restore(); }
  // wall carpet behind
  ctx.save(); ctx.translate(CX, 640);
  rrect(ctx, -440, -380, 880, 700, 10); fs(ctx, '#8e1f2b');
  rrect(ctx, -400, -340, 800, 620, 6); fs(ctx, '#b83240', '#e9b24a', 10);
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, -300); ctx.lineTo(300, -30); ctx.lineTo(0, 240); ctx.lineTo(-300, -30); ctx.closePath(); fs(ctx, '#1f3f6b', '#e9b24a', 10);
  ctx.beginPath(); ctx.moveTo(0, -170); ctx.lineTo(160, -30); ctx.lineTo(0, 110); ctx.lineTo(-160, -30); ctx.closePath(); fs(ctx, '#e9b24a', INK, 6);
  ell(ctx, 0, -30, 50, 50); fs(ctx, '#8e1f2b', INK, 6); ctx.restore();
  for (const [x, y] of [[-330, -270], [330, -270], [-330, 210], [330, 210]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#e9b24a'; ctx.fillRect(-26, -26, 52, 52); ctx.restore(); }
  // fringe
  ctx.strokeStyle = '#e9b24a'; ctx.lineWidth = 5; for (let x = -430; x <= 430; x += 18) { ctx.beginPath(); ctx.moveTo(x, 320); ctx.lineTo(x + 3, 350); ctx.stroke(); }
  ctx.restore();
  // lamp top left
  ctx.save(); ctx.translate(130, 260); ctx.beginPath(); ctx.moveTo(0, -260); ctx.lineTo(0, -80); fs(ctx, null, INK, 6);
  poly(ctx, [[-80, 0], [-50, -90], [50, -90], [80, 0]]); fs(ctx, '#f6e39a');
  const lg = ctx.createRadialGradient(0, 40, 10, 0, 40, 380); lg.addColorStop(0, 'rgba(255,230,150,0.35)'); lg.addColorStop(1, 'rgba(255,230,150,0)'); ctx.fillStyle = lg; ctx.fillRect(-400, -40, 800, 500);
  ctx.restore();
}
export function deskZina(ctx, t, y, o = {}) {
  ctx.fillStyle = '#7a4a2e'; ctx.fillRect(-W, y, W * 3, H);
  ctx.fillStyle = '#93603d'; ctx.fillRect(-W, y, W * 3, 26);
  // lace doily
  ctx.save(); ctx.translate(250, y + 70); ell(ctx, 0, 0, 160, 40); fs(ctx, '#fbf6ee', null);
  for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; ell(ctx, Math.cos(a) * 160, Math.sin(a) * 40, 14, 6); ctx.fillStyle = '#fbf6ee'; ctx.fill(); } ctx.restore();
  ctx.beginPath(); ctx.moveTo(-W, y); ctx.lineTo(W * 2, y); fs(ctx, null, INK, 8);
  mug(ctx, 250, y + 10, 0.9); steam(ctx, 250, y - 60, t);
  // keyboard (grandson's, RGB)
  const kb = ctx.createLinearGradient(CX - 260, 0, CX + 260, 0); kb.addColorStop(0, '#2de0d0'); kb.addColorStop(0.5, '#a66bff'); kb.addColorStop(1, '#ff5fa2');
  ctx.save(); ctx.translate(CX + 60, y + 90); rrect(ctx, -250, -26, 500, 60, 12); fs(ctx, '#22242e'); ctx.globalAlpha = 0.7; rrect(ctx, -235, -16, 470, 40, 8); ctx.fillStyle = kb; ctx.fill(); ctx.restore();
  // knitting yarn ball
  ctx.save(); ctx.translate(900, y + 40); ell(ctx, 0, 0, 62, 62); fs(ctx, '#5aa0e6');
  ctx.strokeStyle = '#3a78b8'; ctx.lineWidth = 6; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(0, 0, 60, 20 + Math.abs(i) * 5, i * 0.6, 0, Math.PI); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-40, -50); ctx.lineTo(60, -110); ctx.moveTo(-20, -60); ctx.lineTo(80, -100); fs(ctx, null, '#c9a46a', 8); ctx.restore();
}

// ---------------------------------------------------------------- overlays
// Caption: "Ранг — *Страж*." ; *word* is highlighted with hl colour. Words pop in one by one between t0 and t0+dur.
export function caption(ctx, str, t, t0, t1, o = {}) {
  if (t < t0 - 0.05 || t > t1 + 0.35) return;
  const size = o.size || 92, hl = o.hl || GOLD, y0 = o.y ?? H * 0.72, maxW = o.maxW || 940;
  const f = font(size, 900, D);
  ctx.font = f;
  const words = str.split(' ').map((w) => { const h = w.includes('*'); return { w: w.replace(/\*/g, ''), h }; });
  // greedy wrap
  const lines = [[]]; let lw = 0; const sp = size * 0.3;
  for (const wd of words) { const ww = ctx.measureText(wd.w.toUpperCase()).width; if (lw + ww > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push({ ...wd, ww }); lw += ww + sp; }
  const lh = size * 1.08, n = words.length;
  const dur = Math.max(0.2, Math.min(t1 - t0, 1.6) * 0.7);
  const out = E.inBack(pt(t, t1 + 0.05, t1 + 0.3), 1.4);
  let wi = 0;
  lines.forEach((L, li) => {
    const tw = L.reduce((a, w) => a + w.ww, 0) + sp * (L.length - 1);
    let x = CX - tw / 2; const y = y0 + (li - (lines.length - 1) / 2) * lh;
    for (const wd of L) {
      const tin = t0 + (wi / Math.max(1, n)) * dur;
      const k = springT(t, tin, { stiffness: 420, damping: 16 });
      wi++;
      if (k <= 0.001) { x += wd.ww + sp; continue; }
      ctx.save(); ctx.translate(x + wd.ww / 2, y - size * 0.35); ctx.scale(lerp(0.4, 1, k) * (1 - out * 0.6), lerp(0.4, 1, k) * (1 - out)); ctx.rotate((1 - k) * (wi % 2 ? -0.2 : 0.2));
      ctx.globalAlpha = clamp(k * 3) * (1 - out);
      ctx.font = f; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.2; ctx.strokeStyle = INK; ctx.strokeText(wd.w.toUpperCase(), 0, size * 0.35);
      ctx.fillStyle = wd.h ? hl : WHITE; ctx.fillText(wd.w.toUpperCase(), 0, size * 0.35);
      ctx.restore();
      x += wd.ww + sp;
    }
  });
}

// iOS-ish notification banner from the top
export function notif(ctx, t, t0, t1, { app = 'СООБЩЕНИЯ', who, body, icon = GREEN, y = 150 } = {}) {
  if (t < t0 || t > t1 + 0.5) return;
  const k = springT(t, t0, { stiffness: 260, damping: 20 }), out = E.inCubic(pt(t, t1, t1 + 0.4));
  const w = 980, h = 280, x = CX - w / 2, yy = lerp(-h - 40, y, k) - out * (h + 200);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  rrect(ctx, x, yy, w, h, 44); ctx.fillStyle = 'rgba(245,245,248,0.97)'; ctx.fill(); ctx.shadowColor = 'transparent';
  rrect(ctx, x + 34, yy + 34, 84, 84, 22); ctx.fillStyle = icon; ctx.fill();
  ctx.fillStyle = '#fff'; ell(ctx, x + 76, yy + 72, 26, 22); ctx.fill(); poly(ctx, [[x + 60, yy + 86], [x + 56, yy + 104], [x + 76, yy + 92]]); ctx.fill();
  ctx.fillStyle = '#6b6b75'; ctx.font = font(34, 700, UI); ctx.textAlign = 'left'; ctx.fillText(app, x + 140, yy + 66);
  ctx.textAlign = 'right'; ctx.fillText('сейчас', x + w - 40, yy + 66); ctx.textAlign = 'left';
  ctx.fillStyle = '#111'; ctx.font = font(42, 800, UI); ctx.fillText(who, x + 140, yy + 120);
  ctx.font = font(40, 600, UI); ctx.fillStyle = '#222';
  wrapText(ctx, body, x + 40, yy + 182, w - 80, 50, 2);
  ctx.restore();
}
export function wrapText(ctx, str, x, y, maxW, lh, maxLines = 3) {
  const words = str.split(' '); let line = '', n = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y + n * lh); n++; line = w; if (n >= maxLines) return; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, y + n * lh);
}

// day HUD: [ДЕНЬ n/30] [label ---- pct%]
export function hud(ctx, t, t0, { day = 1, of = 30, label = 'СТРАЖ → ЛЕГЕНДА', pct = 0, color = GOLD } = {}) {
  if (t < t0) return;
  const k = springT(t, t0, { stiffness: 300, damping: 18 });
  const y = lerp(-140, 260, k);
  ctx.save();
  rrect(ctx, 50, y, 210, 110, 26); fs(ctx, 'rgba(15,15,24,0.92)', 'rgba(255,255,255,0.15)', 4);
  ctx.fillStyle = '#9aa0b4'; ctx.font = font(30, 700, UI); ctx.textAlign = 'center'; ctx.fillText('ДЕНЬ', 155, y + 42);
  ctx.fillStyle = '#fff'; ctx.font = font(56, 900, D); ctx.fillText(`${day}/${of}`, 155, y + 96);
  rrect(ctx, 280, y, 750, 110, 26); fs(ctx, 'rgba(15,15,24,0.92)', 'rgba(255,255,255,0.15)', 4);
  ctx.fillStyle = '#9aa0b4'; ctx.font = font(30, 700, UI); ctx.textAlign = 'left'; ctx.fillText(label, 310, y + 42);
  ctx.textAlign = 'right'; ctx.fillStyle = color; ctx.font = font(34, 900, D); ctx.fillText(`${Math.round(pct)}%`, 1005, y + 42);
  rrect(ctx, 310, y + 62, 690, 26, 13); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
  if (pct > 0) { rrect(ctx, 310, y + 62, Math.max(26, 690 * pct / 100), 26, 13); ctx.fillStyle = color; ctx.fill(); }
  ctx.restore();
}

// chat bubble flying out
export function bubble(ctx, t, t0, t1, x, y, str, { color = '#fff', tc = '#111', size = 46, side = 1, rot = 0 } = {}) {
  if (t < t0 || t > t1 + 0.4) return;
  const k = springT(t, t0, SPRING.bouncy), out = E.inBack(pt(t, t1, t1 + 0.35), 1.5);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot + (1 - k) * 0.3 * side); ctx.scale(lerp(0.2, 1, k) * (1 - out), lerp(0.2, 1, k) * (1 - out));
  ctx.font = font(size, 800, UI); const w = ctx.measureText(str).width + size * 1.2, h = size * 1.7;
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2); fs(ctx, color, INK, 6);
  poly(ctx, [[side * w * 0.25, h / 2 - 4], [side * w * 0.38, h / 2 + 30], [side * w * 0.12, h / 2 - 4]]); fs(ctx, color, null);
  ctx.beginPath(); ctx.moveTo(side * w * 0.25, h / 2); ctx.lineTo(side * w * 0.38, h / 2 + 30); ctx.lineTo(side * w * 0.12, h / 2 + 2); fs(ctx, null, INK, 6);
  ctx.fillStyle = tc; ctx.textAlign = 'center'; ctx.fillText(str, 0, size * 0.36);
  ctx.restore();
}

// two choice cards with VS
export function choice(ctx, t, t0, a, b, drawA, drawB) {
  if (t < t0) return;
  const cards = [[a, drawA, -1, '#3b82f6'], [b, drawB, 1, '#22c55e']];
  cards.forEach(([label, art, s, col], i) => {
    const k = springT(t, t0 + i * 0.12, SPRING.bouncy);
    const x = CX + s * 245, y = 560, w = 420, h = 470;
    ctx.save(); ctx.translate(lerp(x + s * 700, x, k), y); ctx.rotate(s * 0.06 + (1 - k) * s * 0.5 + 0.02 * Math.sin(t * 3 + i));
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
    rrect(ctx, -w / 2, -h / 2, w, h, 40); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
    rrect(ctx, -w / 2 + 18, -h / 2 + 18, w - 36, h * 0.6, 28); ctx.fillStyle = col; ctx.fill();
    ctx.save(); ctx.translate(0, -h / 2 + 18 + h * 0.3); art(ctx, t); ctx.restore();
    rrect(ctx, -w / 2, -h / 2, w, h, 40); fs(ctx, null, INK, 8);
    ctx.fillStyle = INK; ctx.font = font(68, 900, D); ctx.textAlign = 'center'; ctx.fillText(label, 0, h / 2 - 70);
    ctx.fillStyle = col; ctx.font = font(32, 800, UI); ctx.fillText('ПЕРВЫМ?', 0, h / 2 - 28);
    ctx.restore();
  });
  const kv = springT(t, t0 + 0.3, SPRING.bouncy);
  if (kv > 0.01) { ctx.save(); ctx.translate(CX, 600); ctx.scale(kv, kv); ctx.rotate(-0.12); ctx.font = font(120, 900, D); ctx.textAlign = 'center'; ctx.lineWidth = 22; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText('VS', 0, 40); ctx.fillStyle = GOLD; ctx.fillText('VS', 0, 40); ctx.restore(); }
}

// big stamp / badge text (e.g. rank) with impact
export function stamp(ctx, t, t0, t1, str, x, y, { size = 130, color = RED, rot = -0.12, bg = null } = {}) {
  if (t < t0 || t > t1 + 0.4) return;
  const k = M.spring(t - t0, { stiffness: 500, damping: 22 }), out = E.inBack(pt(t, t1, t1 + 0.3), 1.5);
  const s = lerp(3, 1, k) * (1 - out);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s); ctx.globalAlpha = clamp(k * 2) * (1 - out);
  ctx.font = font(size, 900, D); const w = ctx.measureText(str).width + size * 0.7, h = size * 1.3;
  if (bg) { rrect(ctx, -w / 2, -h / 2, w, h, 22); ctx.fillStyle = bg; ctx.fill(); }
  rrect(ctx, -w / 2, -h / 2, w, h, 22); ctx.lineWidth = 14; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(str, 0, size * 0.36);
  ctx.restore();
}

// generic rank shield (own design, not a game asset)
export function rankShield(ctx, x, y, s, tier, label, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const cols = [['#8c9aa8', '#5b6874'], ['#5aa0e6', '#2d6aa8'], ['#ffd25a', '#d39a1f'], ['#c77dff', '#7b3fbf']][tier];
  ctx.shadowColor = cols[0]; ctx.shadowBlur = 50;
  ctx.beginPath(); ctx.moveTo(0, -160); ctx.lineTo(130, -110); ctx.lineTo(115, 40); ctx.quadraticCurveTo(80, 130, 0, 175); ctx.quadraticCurveTo(-80, 130, -115, 40); ctx.lineTo(-130, -110); ctx.closePath();
  const g = ctx.createLinearGradient(0, -160, 0, 175); g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]); ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0; fs(ctx, null, INK, 10);
  ctx.beginPath(); ctx.moveTo(0, -110); ctx.lineTo(80, -78); ctx.lineTo(70, 25); ctx.quadraticCurveTo(48, 85, 0, 115); ctx.quadraticCurveTo(-48, 85, -70, 25); ctx.lineTo(-80, -78); ctx.closePath(); fs(ctx, 'rgba(0,0,0,0.25)', 'rgba(255,255,255,0.5)', 5);
  for (let i = 0; i < tier + 1; i++) { ctx.save(); ctx.translate((i - tier / 2) * 44, 0); poly(ctx, [[0, -26], [8, -8], [27, -8], [12, 4], [18, 24], [0, 12], [-18, 24], [-12, 4], [-27, -8], [-8, -8]]); fs(ctx, '#fff', INK, 4); ctx.restore(); }
  ctx.restore();
}

// phone held in front, showing an app screenshot crop; screen = Image, crop = [sx,sy,sw,sh]
export function phone(ctx, x, y, w, img, crop, o = {}) {
  const h = w * 2.05;
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot || 0);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30;
  rrect(ctx, -w / 2, -h / 2, w, h, w * 0.13); ctx.fillStyle = '#16161c'; ctx.fill(); ctx.shadowColor = 'transparent';
  rrect(ctx, -w / 2, -h / 2, w, h, w * 0.13); fs(ctx, null, INK, 8);
  const m = w * 0.045; const sx = -w / 2 + m, sy = -h / 2 + m, sw = w - 2 * m, sh = h - 2 * m;
  ctx.save(); rrect(ctx, sx, sy, sw, sh, w * 0.1); ctx.clip(); ctx.fillStyle = '#0b0b0e'; ctx.fillRect(sx, sy, sw, sh);
  if (img) {
    const [cx0, cy0, cw, ch] = crop || [0, 0, img.width, img.height];
    const scale = sw / cw; ctx.drawImage(img, cx0, cy0 + (o.scroll || 0), cw, sh / scale, sx, sy, sw, sh);
  }
  if (o.sweep != null) { const xx = lerp(sx - sw, sx + 2 * sw, o.sweep); const g = ctx.createLinearGradient(xx - 120, 0, xx + 120, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(sx, sy, sw, sh); }
  ctx.restore();
  rrect(ctx, -w * 0.14, -h / 2 + m + 10, w * 0.28, w * 0.07, w * 0.035); ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();
}

// brand pill: "@DotaRazbor_bot" with a small "разбери свою катку" line
export function botTag(ctx, t, t0, t1, y = 1340, sub = 'разбери свою катку · бесплатно') {
  if (t < t0 || t > t1 + 0.4) return;
  const k = springT(t, t0, SPRING.bouncy), out = E.inBack(pt(t, t1, t1 + 0.35), 1.5);
  ctx.save(); ctx.translate(CX, y); ctx.scale(lerp(0.3, 1, k) * (1 - out), lerp(0.3, 1, k) * (1 - out)); ctx.globalAlpha = clamp(k * 3);
  ctx.font = font(58, 900, UI); const w = ctx.measureText('@DotaRazbor_bot').width + 150, h = 100;
  ctx.shadowColor = 'rgba(255,201,74,0.5)'; ctx.shadowBlur = 40;
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.shadowBlur = 0; fs(ctx, null, INK, 6);
  // telegram-like paper plane mark (simple)
  ctx.save(); ctx.translate(-w / 2 + 58, 0); poly(ctx, [[-24, 2], [26, -20], [12, 22], [2, 8]]); ctx.fillStyle = INK; ctx.fill(); ctx.restore();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText('@DotaRazbor_bot', 30, 20);
  if (sub) { ctx.font = font(40, 700, UI); ctx.fillStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText(sub, 0, 100); ctx.fillText(sub, 0, 100); }
  ctx.restore();
}

// screen effects
export function grain(ctx, t, a = 0.035) {
  const seed = Math.floor(t * 30);
  ctx.save(); ctx.globalAlpha = a;
  for (let i = 0; i < 260; i++) { ctx.fillStyle = hash01(i, seed) > 0.5 ? '#fff' : '#000'; ctx.fillRect(hash01(i, seed + 7) * W, hash01(i, seed + 13) * H, 3, 3); }
  ctx.restore();
}
export function vignette(ctx, a = 0.55) {
  const g = ctx.createRadialGradient(CX, H * 0.5, H * 0.3, CX, H * 0.5, H * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
export function speedLines(ctx, t, a = 1, color = '255,255,255', seed = 5) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  for (let i = 0; i < 46; i++) {
    const ang = hash01(i, seed) * TAU, r0 = 420 + hash01(i, seed + 1) * 200 + ((t * 900 + i * 37) % 300);
    ctx.beginPath(); ctx.moveTo(CX + Math.cos(ang) * r0, H * 0.45 + Math.sin(ang) * r0); ctx.lineTo(CX + Math.cos(ang) * (r0 + 500), H * 0.45 + Math.sin(ang) * (r0 + 500));
    ctx.lineWidth = 4 + hash01(i, seed + 2) * 10; ctx.strokeStyle = `rgba(${color},0.6)`; ctx.stroke();
  }
  ctx.restore();
}
// burst rays behind something
export function burst(ctx, x, y, t, a, col = '255,201,74', n = 16) {
  if (a <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.4); ctx.globalAlpha = a;
  for (let i = 0; i < n; i++) { ctx.rotate(TAU / n); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -1400); ctx.lineTo(90, -1400); ctx.closePath(); ctx.fillStyle = `rgba(${col},${i % 2 ? 0.16 : 0.08})`; ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- PC tower and swinging tag
export function pcTower(ctx, x, y, s, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  rrect(ctx, -210, -320, 420, 640, 26); fs(ctx, '#20222c');
  rrect(ctx, -180, -290, 300, 580, 16); fs(ctx, '#0b0d14', INK, 5);
  // glass reflection
  ctx.save(); rrect(ctx, -180, -290, 300, 580, 16); ctx.clip();
  // GPU
  rrect(ctx, -170, 40, 280, 90, 10); fs(ctx, '#2c3142', INK, 5);
  const hg = (t * 120) % 360; ctx.fillStyle = `hsl(${hg},90%,60%)`; ctx.fillRect(-160, 112, 260, 8);
  ctx.fillStyle = '#ffd76a'; ctx.font = font(30, 900, D); ctx.textAlign = 'left'; ctx.fillText('RTX', -150, 92);
  // RAM sticks
  for (let i = 0; i < 4; i++) { const h = (t * 160 + i * 40) % 360; rrect(ctx, -10 + i * 24, -240, 14, 120, 4); ctx.fillStyle = `hsl(${h},90%,60%)`; ctx.fill(); }
  // cpu cooler
  ell(ctx, -90, -170, 62, 62); ctx.fillStyle = '#1a1d28'; ctx.fill(); ctx.lineWidth = 10; ctx.strokeStyle = `hsl(${(hg + 120) % 360},90%,62%)`; ctx.stroke();
  ctx.save(); ctx.translate(-90, -170); ctx.rotate(t * 12); for (let b = 0; b < 5; b++) { ctx.rotate(Math.PI * 2 / 5); ell(ctx, 0, -26, 11, 24); ctx.fillStyle = '#3a3f52'; ctx.fill(); } ctx.restore();
  // bottom fans
  for (let i = 0; i < 2; i++) { ctx.save(); ctx.translate(-100 + i * 140, 220); const h = (t * 120 + i * 120) % 360; ctx.shadowColor = `hsl(${h},90%,60%)`; ctx.shadowBlur = 30; ell(ctx, 0, 0, 52, 52); ctx.lineWidth = 10; ctx.strokeStyle = `hsl(${h},90%,62%)`; ctx.stroke(); ctx.shadowBlur = 0; ctx.rotate(t * 14); for (let b = 0; b < 5; b++) { ctx.rotate(Math.PI * 2 / 5); ell(ctx, 0, -22, 10, 20); ctx.fillStyle = '#3a3f52'; ctx.fill(); } ctx.restore(); }
  ctx.beginPath(); ctx.moveTo(-180, -100); ctx.lineTo(-40, -290); ctx.lineTo(10, -290); ctx.lineTo(-180, -40); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
  ctx.restore();
  // front panel buttons
  ell(ctx, 165, -260, 14, 14); fs(ctx, '#3a3f52', INK, 4);
  ell2(ctx, 165, -215, 7, `hsl(${(t * 200) % 360},90%,60%)`);
  ctx.restore();
}
export function ell2(ctx, x, y, r, c) { ell(ctx, x, y, r, r); ctx.fillStyle = c; ctx.fill(); }

// a price tag hanging on a string, swinging
export function tag(ctx, x, y, t, tIn, str) {
  const k = springT(t, tIn, M.SPRING.bouncy); if (k <= 0.01) return;
  const sw = 0.35 * M.wobble(t - tIn, 1.3, 1.6);
  ctx.save(); ctx.translate(x, y); ctx.rotate(sw); ctx.scale(k, k);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 120); fs(ctx, null, INK, 6);
  ctx.translate(0, 120); ctx.rotate(-0.1);
  ctx.font = font(64, 900, D); const w = ctx.measureText(str).width + 90;
  ctx.beginPath(); ctx.moveTo(-w / 2 + 40, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2, 110); ctx.lineTo(-w / 2 + 40, 110); ctx.lineTo(-w / 2, 55); ctx.closePath(); fs(ctx, GOLD, INK, 7);
  ell(ctx, -w / 2 + 40, 55, 12, 12); fs(ctx, '#fff', INK, 4);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(str, 25, 78);
  ctx.restore();
}


// confetti burst from (x,y) at t0
export function confetti(ctx, t, t0, x, y, n = 60, seed = 3) {
  const d = t - t0; if (d < 0 || d > 3) return;
  const cols = [GOLD, RED, GREEN, TEAL, '#7aa7ff', '#ff7ab8'];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash01(i, seed) - 0.5) * 2.4, v = 900 + hash01(i, seed + 1) * 1300;
    const px = x + Math.cos(a) * v * d, py = y + Math.sin(a) * v * d + 1400 * d * d;
    ctx.save(); ctx.translate(px, py); ctx.rotate(d * (6 + 10 * hash01(i, seed + 2)));
    ctx.globalAlpha = clamp(1.6 - d * 0.6); ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-12, -7, 24, 14); ctx.restore();
  }
}
