// «Гоша. 30 дней до Легенды», серия 2: подписчики выбрали «смерти». Гоша открывает вкладку «Реплей»,
// бот по записи игры показывает, какие смерти можно было не отдавать (настоящий экран приложения,
// common/assets/app_replay.png), Гоша клеит на монитор три правила. Сцены привязаны к фразам озвучки.
import * as M from '../common/lib/motion.js';
import * as T from '../common/toon.js';
const { W, H, E, lerp, clamp, rrect, font } = M;
const { CX, INK, GOLD, RED, GREEN, TEAL, WHITE, pt, springT, caption } = T;

const IMG = {};
let ST = null;
const t0 = (i) => ST.phrases[i].t0, t1 = (i) => ST.phrases[i].t1;

function cam(ctx, t, cut, z, fx, fy, o = {}) {
  const k = springT(t, cut, { stiffness: 180, damping: 17 });
  const z0 = z * (o.punch ?? 1.12);
  const zz = z0 * (z / z0) ** k * (1 + (o.push ?? 0.025) * (t - cut));
  ctx.translate(CX, H / 2); ctx.scale(zz, zz); ctx.rotate((o.roll || 0) * (1 - k)); ctx.translate(-fx, -fy);
}
const GX = 540, GY = 1010, GS = 1.05;
function gosha(ctx, t, S) { ctx.save(); ctx.translate(GX + (S.dx || 0), GY + (S.dy || 0)); ctx.scale(GS, GS); T.drawGosha(ctx, { t, glow: 1, blink: T.blinkAt(t), lookX: 0, lookY: 0, ...S }); ctx.restore(); }
const set = (ctx, t, o) => T.roomGosha(ctx, t, o);
const desk = (ctx, t) => T.deskGosha(ctx, t, 1500);

function skull(ctx, t) {
  ctx.save(); ctx.translate(0, Math.sin(t * 4) * 6);
  T.blob(ctx, [[0, -95], [80, -60], [85, 20], [50, 60], [50, 95], [-50, 95], [-50, 60], [-85, 20], [-80, -60]]); T.fs(ctx, '#fff', INK, 7);
  for (const s of [-1, 1]) { T.ell(ctx, s * 36, 0, 26, 30); T.fs(ctx, INK, null); }
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(-12, 55); ctx.lineTo(12, 55); ctx.closePath(); T.fs(ctx, INK, null);
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 22, 70); ctx.lineTo(i * 22, 95); T.fs(ctx, null, INK, 6); }
  ctx.restore();
}
function lane(ctx, t) {
  ctx.save(); ctx.rotate(Math.sin(t * 3) * 0.05);
  for (const s of [-1, 1]) { ctx.save(); ctx.rotate(s * 0.7); rrect(ctx, -10, -110, 20, 170, 6); T.fs(ctx, '#e8eef6', INK, 6); rrect(ctx, -40, 50, 80, 18, 6); T.fs(ctx, GOLD, INK, 5); rrect(ctx, -8, 68, 16, 40, 5); T.fs(ctx, '#7a4a2a', INK, 5); ctx.restore(); }
  ctx.restore();
}

// poll result: the two cards from day 1, the lane card is knocked away, the skull card wins
function pollResult(ctx, t, a) {
  const cards = [['СМЕРТИ', skull, -1, '#3b82f6'], ['ЛАЙН', lane, 1, '#22c55e']];
  const win = pt(t, a + 0.7, a + 1.3);
  cards.forEach(([label, art, s, col], i) => {
    const k = springT(t, a + i * 0.1, M.SPRING.bouncy);
    const lose = i === 1 ? E.inCubic(win) : 0, grow = i === 0 ? E.outBack(win) : 0;
    const x = lerp(CX + s * 245, i === 0 ? CX : CX + 900, i === 0 ? grow * 0.95 : lose), y = 720 + lose * 500;
    const w = 420, h = 470;
    ctx.save(); ctx.translate(lerp(x + s * 700, x, k), y); ctx.rotate(s * 0.06 * (1 - grow) + lose * 1.2 + (1 - k) * s * 0.5); ctx.scale(1 + 0.25 * grow, 1 + 0.25 * grow);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
    rrect(ctx, -w / 2, -h / 2, w, h, 40); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
    rrect(ctx, -w / 2 + 18, -h / 2 + 18, w - 36, h * 0.6, 28); ctx.fillStyle = col; ctx.fill();
    ctx.save(); ctx.translate(0, -h / 2 + 18 + h * 0.3); art(ctx, t); ctx.restore();
    rrect(ctx, -w / 2, -h / 2, w, h, 40); T.fs(ctx, null, INK, 8);
    ctx.fillStyle = INK; ctx.font = font(68, 900, T.D); ctx.textAlign = 'center'; ctx.fillText(label, 0, h / 2 - 70);
    ctx.restore();
  });
}

// sticky note with a strip of tape
function note(ctx, t, tin, x, y, rot, col, lines) {
  const k = springT(t, tin, { stiffness: 380, damping: 15 }); if (k <= 0.001) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot + (1 - k) * 0.6); ctx.scale(lerp(2.2, 1, k), lerp(2.2, 1, k)); ctx.globalAlpha = clamp(k * 3);
  const w = 760, h = 300;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
  ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2, h / 2 - 50); ctx.lineTo(w / 2 - 50, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.shadowColor = 'transparent'; T.fs(ctx, null, INK, 6);
  ctx.beginPath(); ctx.moveTo(w / 2, h / 2 - 50); ctx.lineTo(w / 2 - 50, h / 2 - 50); ctx.lineTo(w / 2 - 50, h / 2); ctx.closePath(); T.fs(ctx, 'rgba(0,0,0,0.18)', INK, 5);
  ctx.save(); ctx.rotate(-0.04); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-110, -h / 2 - 26, 220, 52); ctx.restore();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.font = font(78, 900, T.D);
  lines.forEach((s, i) => ctx.fillText(s, 0, -h / 2 + 125 + i * 95 - (lines.length - 1) * 20));
  ctx.restore();
}

// monitor bezel filling the frame: the replay screen glowing behind the notes
function monitor(ctx, t) {
  ctx.fillStyle = '#0d1222'; ctx.fillRect(0, 0, W, H);
  rrect(ctx, 30, 140, W - 60, 1640, 40); T.fs(ctx, '#15161d', INK, 10);
  ctx.save(); rrect(ctx, 70, 180, W - 140, 1560, 18); ctx.clip();
  if (IMG.replay) { ctx.globalAlpha = 0.16; ctx.drawImage(IMG.replay, 0, 300, 780, 1170, 70, 180, W - 140, 1560); ctx.globalAlpha = 1; }
  const g = ctx.createLinearGradient(0, 180, 0, 1740); g.addColorStop(0, 'rgba(56,217,201,0.10)'); g.addColorStop(1, 'rgba(255,95,162,0.10)'); ctx.fillStyle = g; ctx.fillRect(70, 180, W - 140, 1560);
  ctx.restore();
}

// highlight frame on a card of the phone screen (screen coords)
function frame(ctx, t, a, b, x, y, w, h, col = RED) {
  if (t < a || t > b + 0.3) return;
  const k = springT(t, a, { stiffness: 320, damping: 16 }), out = pt(t, b, b + 0.3);
  ctx.save(); ctx.globalAlpha = (1 - out) * clamp(k * 2);
  const s = lerp(1.15, 1, k); ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s);
  rrect(ctx, -w / 2, -h / 2, w, h, 26); ctx.lineWidth = 10; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 30; ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- scenes
const PH = { x: CX, y: 860, w: 620 }; // phone; screen scale 564/780
const SC = 564 / 780, SY = PH.y - (PH.w * 2.05) / 2 + PH.w * 0.045, SX = CX - 282;
function draw(ctx, u, t) {
  ctx.fillStyle = '#0d1222'; ctx.fillRect(0, 0, W, H);
  const pct = 3 + 3 * E.outCubic(pt(t, t0(12), t0(12) + 1));
  ctx.save();
  if (t < t0(1) - 0.1) {
    // S0: day 2, Gosha at the desk
    cam(ctx, t, 0, 1.6, 540, 1000, { punch: 1.3 });
    set(ctx, t, { clock: true }); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true }); desk(ctx, t);
    ctx.restore();
    caption(ctx, '*День 2*', t, t0(0), t1(0) + 0.2, { size: 150, y: H * 0.68 });
  } else if (t < t0(2) - 0.1) {
    // S1: poll result
    const cut = t0(1) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.sly, pose: 'keys', dy: 120 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,10,18,0.45)'; ctx.fillRect(0, 0, W, H);
    T.burst(ctx, CX, 720, t, 0.6 * pt(t, t0(1) + 0.7, t0(1) + 1.1));
    pollResult(ctx, t, cut);
    T.stamp(ctx, t, t0(1) + 1.2, t1(1) + 0.3, 'ВЫБОР ПОДПИСЧИКОВ', CX, 1110, { size: 62, color: GOLD, rot: -0.06, bg: 'rgba(20,16,6,0.92)' });
    caption(ctx, 'Подписчики решили: чиним *смерти*', t, t0(1), t1(1) + 0.15, { y: H * 0.74, size: 84 });
  } else if (t < t0(3) - 0.1) {
    // S2: brother trolls
    const cut = t0(2) - 0.1;
    M.shake(ctx, t * 2, (t0(2) + 1.4) * 2, 10);
    cam(ctx, t, cut, 1.3, 540, 1060);
    set(ctx, t); gosha(ctx, t, { X: t > t0(2) + 1.3 ? T.EXPR.angry : T.EXPR.neutral, pose: 'phone', lookY: -0.6, blush: t > t0(2) + 1.3 ? 1 : 0 }); desk(ctx, t);
    ctx.restore();
    T.notif(ctx, t, t0(2) + 0.1, t1(2) + 0.6, { app: 'TELEGRAM', who: 'Брат', body: 'Уже освобождаю место под твой комп. Тумбочку купил', icon: '#2aa3e0', y: 420 });
    caption(ctx, 'А *брат* уже освобождает место под *Гошин комп*', t, t0(2), t1(2) + 0.15, { size: 80 });
  } else if (t < t0(8) - 0.1) {
    // S3-S7: the bot. Replay tab on the phone, real screen
    const cut = t0(3) - 0.1;
    const whip = E.inOutCubic(pt(t, t0(3) + 0.3, t0(3) + 0.8));
    cam(ctx, t, cut, lerp(1.25, 2.6, whip), 540, lerp(1060, 1480, whip), { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.determined, pose: 'phone', lookY: 0.7 }); desk(ctx, t);
    ctx.restore();
    if (whip > 0) { ctx.fillStyle = `rgba(8,10,18,${0.78 * whip})`; ctx.fillRect(0, 0, W, H); T.burst(ctx, CX, 860, t, 0.45 * whip, '56,217,201'); }
    const kph = springT(t, t0(3) + 0.4, { stiffness: 200, damping: 18 });
    // scroll targets: headline -> 5:13 card -> 13:54 card
    const s1 = E.inOutCubic(pt(t, t0(6) - 0.1, t0(6) + 0.5)), s2 = E.inOutCubic(pt(t, t0(7) - 0.1, t0(7) + 0.5));
    const scroll = 300 * s1 + 270 * s2;
    const img = IMG.replay, crop = [0, 0, 780, 2250];
    const sweep = pt(t, t0(3) + 1.05, t0(3) + 1.6);
    if (kph > 0.001) T.phone(ctx, PH.x, lerp(2400, PH.y, kph), PH.w, img, crop, { rot: (1 - kph) * 0.4 + 0.02 * Math.sin(t * 1.5), scroll, sweep: sweep > 0 && sweep < 1 ? sweep : null });
    const sy = (y) => SY + (y - scroll) * SC;
    // tab pill
    if (t < t0(4)) T.bubble(ctx, t, t0(3) + 1.0, t1(3) + 0.1, CX, 200, 'ВКЛАДКА «РЕПЛЕЙ»', { color: GOLD, size: 54 });
    if (t > t0(4) - 0.1 && t < t0(5)) T.stamp(ctx, t, t0(4) + 0.5, t1(4) + 0.15, 'ПОСЕКУНДНО', CX, 190, { size: 96, color: TEAL, rot: -0.06, bg: 'rgba(6,24,24,0.92)' });
    frame(ctx, t, t0(5), t1(5) + 0.2, SX + 20, sy(70), 524, (405 - 70) * SC, RED);
    if (t > t0(5) - 0.1 && t < t0(6)) T.stamp(ctx, t, t0(5) + 0.35, t1(5) + 0.2, '7 ИЗ 19', CX, 1520, { size: 150, color: RED, rot: -0.08, bg: 'rgba(30,8,10,0.92)' });
    frame(ctx, t, t0(6) + 0.45, t1(6) + 0.2, SX + 20, sy(529), 524, (962 - 529) * SC, GOLD);
    if (t > t0(6)) T.stamp(ctx, t, t0(6) + 1.2, t1(6) + 0.2, '14% ХП', 860, 520, { size: 90, color: RED, rot: 0.1, bg: 'rgba(30,8,10,0.92)' });
    frame(ctx, t, t0(7) + 0.45, t1(7) + 0.25, SX + 20, sy(1502), 524, (2065 - 1502) * SC, GOLD);
    if (t > t0(7)) T.stamp(ctx, t, t0(7) + 1.0, t1(7) + 0.2, '6 СЕКУНД', CX, 200, { size: 100, color: GOLD, rot: -0.07, bg: 'rgba(24,18,6,0.92)' });
    T.botTag(ctx, t, t0(4) + 0.2, t1(4), 1700, null);
    T.botTag(ctx, t, t0(6) + 0.3, t1(7) + 0.2, 1720, null);
    caption(ctx, 'Открывает вкладку *Реплей*', t, t0(3), t1(3) + 0.1, { y: 1640, size: 70 });
    caption(ctx, 'Бот пересмотрел *запись игры*', t, t0(4), t1(4) + 0.1, { y: 1560, size: 70 });
    caption(ctx, 'смертей можно было *не отдавать*', t, t0(5) + 0.5, t1(5) + 0.1, { y: 1730, size: 60, hl: RED });
    caption(ctx, '*5:13* — на линии с 14% хп', t, t0(6), t1(6) + 0.1, { y: 1600, size: 70 });
    caption(ctx, '*13:54* — Бистмастер шёл на виду', t, t0(7), t1(7) + 0.1, { y: 1600, size: 66 });
  } else if (t < t0(9) - 0.1) {
    // S8: died with ult ready
    const cut = t0(8) - 0.1;
    M.shake(ctx, t * 2, (t0(8) + 1.4) * 2, 22);
    cam(ctx, t, cut, 2.0, 540, 960, { punch: 1.45 });
    set(ctx, t); gosha(ctx, t, { X: t > t0(8) + 1.4 ? T.EXPR.shock : T.EXPR.sad, pose: t > t0(8) + 1.4 ? 'facepalm' : 'cheeks', sweat: 1, blush: 0.6, blink: 0 }); desk(ctx, t);
    ctx.restore();
    T.speedLines(ctx, t, 0.8 * pt(t, t0(8) + 1.4, t0(8) + 1.6), '255,90,95');
    T.stamp(ctx, t, t0(8) + 1.5, t1(8) + 0.3, 'УЛЬТ БЫЛ ГОТОВ', CX, 520, { size: 92, color: RED, rot: -0.08, bg: 'rgba(30,8,10,0.92)' });
    caption(ctx, 'Гоша *остался*.', t, t0(8), t0(8) + 1.4);
    caption(ctx, 'И умер с *готовым ультом*', t, t0(8) + 1.5, t1(8) + 0.2, { hl: RED });
  } else if (t < t0(10) - 0.1) {
    // S9: Gosha takes the sticky notes
    const cut = t0(9) - 0.1;
    cam(ctx, t, cut, 1.2, 540, 1040);
    set(ctx, t);
    T.burst(ctx, 540, 900, t, 0.55 * pt(t, cut, cut + 0.3));
    gosha(ctx, t, { X: T.EXPR.determined, pose: 'fist', fistK: E.outBack(pt(t, cut + 0.1, cut + 0.5)) }); desk(ctx, t);
    ctx.restore();
    note(ctx, t, t0(9) + 0.6, CX, 560, -0.05, '#ffe066', ['3 ПРАВИЛА']);
    caption(ctx, 'Три *правила* на монитор', t, t0(9), t1(9) + 0.15);
  } else if (t < t0(13) - 0.1) {
    // S10: the notes on the monitor
    const cut = t0(10) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 960, { punch: 1.15 });
    monitor(ctx, t);
    ctx.restore();
    note(ctx, t, t0(10), CX - 20, 600, -0.05, '#ffe066', ['МАЛО ХП —', 'НА БАЗУ']);
    note(ctx, t, t0(11), CX + 20, 960, 0.04, '#7ee8d8', ['ВИДИШЬ ВРАГА —', 'ОТХОДИ']);
    note(ctx, t, t0(12), CX - 10, 1320, -0.03, '#ff9ec4', ['ВОЗРОДИЛСЯ —', 'НЕ БЕГИ ОДИН']);
    T.confetti(ctx, t, t0(12) + 0.3, CX, 1340, 50);
    caption(ctx, 'Правило *1*', t, t0(10), t1(10), { y: 1600, size: 80 });
    caption(ctx, 'Правило *2*', t, t0(11), t1(11), { y: 1600, size: 80 });
    caption(ctx, 'Правило *3*', t, t0(12), t1(12) + 0.15, { y: 1600, size: 80 });
  } else {
    // S11: forecast + subscribe
    const cut = t0(13) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true, dy: 120 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,10,18,0.45)'; ctx.fillRect(0, 0, W, H);
    const k = springT(t, t0(13) + 0.1, M.SPRING.bouncy);
    ctx.save(); ctx.translate(CX - 230, 640); ctx.scale(1.4 * k, 1.4 * k); skull(ctx, t); ctx.restore();
    T.stamp(ctx, t, t0(13) + 0.4, ST.duration, 'БЫЛО 19', CX - 230, 870, { size: 70, color: RED, rot: -0.06, bg: 'rgba(30,8,10,0.92)' });
    const kq = springT(t, t0(13) + 0.8, M.SPRING.bouncy);
    if (kq > 0.01) { ctx.save(); ctx.translate(CX + 230, 700); ctx.scale(kq, kq); ctx.rotate(0.08 + 0.05 * Math.sin(t * 3)); ctx.font = font(380, 900, T.D); ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 40; ctx.strokeStyle = INK; ctx.strokeText('?', 0, 130); ctx.fillStyle = GOLD; ctx.fillText('?', 0, 130); ctx.restore(); }
    T.stamp(ctx, t, t0(13) + 1.0, ST.duration, 'СТАНЕТ', CX + 230, 870, { size: 70, color: GREEN, rot: 0.06, bg: 'rgba(6,26,16,0.92)' });
    caption(ctx, 'Сколько смертей в *следующей* катке?', t, t0(13), t0(13) + 3.3, { y: H * 0.74, size: 82 });
    caption(ctx, 'Пиши *прогноз*', t, t0(13) + 3.4, t1(13) + 0.1, { y: H * 0.74, size: 110 });
    caption(ctx, 'Подпишись на *день 3*', t, t0(14), ST.duration, { y: H * 0.74, size: 100 });
    T.botTag(ctx, t, t0(14) + 0.8, ST.duration, 1560, 'разбери свою катку');
  }
  const hideHud = t > t0(3) + 0.2 && t < t0(8) - 0.1;
  if (!hideHud) T.hud(ctx, t, t < t0(8) ? 0.3 : t0(8) - 0.1, { day: 2, of: 30, label: 'СТРАЖ → ЛЕГЕНДА', pct });
}

const HITS = [];
M.film({
  fonts: [font(100, 900, T.D), font(40, 700, T.UI), font(40, 800, T.UI), font(40, 600, T.UI)],
  samples: 4, hits: HITS,
  async init() {
    ST = await T.loadStory();
    await Promise.all(['replay'].map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = res; im.src = `../common/assets/app_${n}.png`; })));
    const b = (s) => s * 2; // seconds -> beats (120 BPM)
    const P = ST.phrases;
    HITS.push(
      [b(P[0].t0), 'день 2', 'impact'], [b(0.3), 'hud', 'click'],
      [b(P[1].t0 - 0.1), 'cards', 'whoosh'], [b(P[1].t0 + 0.7), 'lane out', 'whoosh'], [b(P[1].t0 + 1.2), 'выбор', 'impact'],
      [b(P[2].t0 + 0.1), 'notif', 'blip', { pitch: 'A6' }], [b(P[2].t0 + 1.3), 'angry', 'boing'],
      [b(P[3].t0 + 0.4), 'phone', 'whoosh'], [b(P[3].t0 + 1.0), 'tab', 'pop', { pitch: 'E6' }], [b(P[3].t0 + 1.1), 'screen', 'click'],
      [b(P[4].t0 + 0.2), 'bot', 'bell', { pitch: 'B5' }], [b(P[4].t0 + 0.5), 'посекундно', 'thud'],
      [b(P[5].t0), 'frame', 'tok', { pitch: 'G5' }], [b(P[5].t0 + 0.35), '7 из 19', 'impact'],
      [b(P[6].t0 - 0.1), 'scroll', 'whoosh'], [b(P[6].t0 + 0.45), 'frame', 'tok', { pitch: 'A5' }], [b(P[6].t0 + 1.2), '14%', 'thud'],
      [b(P[7].t0 - 0.1), 'scroll', 'whoosh'], [b(P[7].t0 + 0.45), 'frame', 'tok', { pitch: 'B5' }], [b(P[7].t0 + 1.0), '6 сек', 'thud'],
      [b(P[8].t0 - 0.1), 'cut', 'whoosh'], [b(P[8].t0 + 1.5), 'ульт', 'impact'],
      [b(P[9].t0 - 0.1), 'fist', 'whoosh'], [b(P[9].t0 + 0.6), 'note', 'pop', { pitch: 'C6' }],
      [b(P[10].t0 - 0.1), 'monitor', 'whoosh'], [b(P[10].t0), 'n1', 'pop', { pitch: 'C6' }], [b(P[11].t0), 'n2', 'pop', { pitch: 'E6' }], [b(P[12].t0), 'n3', 'pop', { pitch: 'G6' }], [b(P[12].t0 + 0.3), 'conf', 'bell', { pitch: 'C7' }],
      [b(P[13].t0 - 0.1), 'cut', 'whoosh'], [b(P[13].t0 + 0.4), 'было', 'thud'], [b(P[13].t0 + 0.8), '?', 'boing'],
      [b(P[14].t0 + 0.8), 'tag', 'bell', { pitch: 'E6' }],
    );
  },
  draw(ctx, u, t) { draw(ctx, u, t); },
  post(ctx, u, t) { T.vignette(ctx, 0.45); T.grain(ctx, t, 0.03); },
});
