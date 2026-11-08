// «Гоша. 30 дней до Легенды», серия 1. Мультяшная ИИ-история под озвучку: Страж поспорил с братом,
// что апнет Легенду за 30 дней, и первым делом закидывает катку в бота. Сцены привязаны к фразам
// озвучки (story.json, common/vo_edit.py), всё рисуется кодом (common/toon.js).
import * as M from '../common/lib/motion.js';
import * as T from '../common/toon.js';
const { W, H, E, lerp, clamp, rrect, font, hash01 } = M;
const { CX, INK, GOLD, RED, GREEN, WHITE, pt, springT, caption } = T;

const IMG = {};
let ST = null;
const p = (i) => ST.phrases[i];
const t0 = (i) => ST.phrases[i].t0, t1 = (i) => ST.phrases[i].t1;
const env = (t) => { const i = Math.floor(t * 100); return ST.env[i] || 0; };

// ---------------------------------------------------------------- camera
// zoom in log space; each shot starts a little closer and springs back (a punch on every cut)
function cam(ctx, t, cut, z, fx, fy, o = {}) {
  const k = springT(t, cut, { stiffness: 180, damping: 17 });
  const z0 = z * (o.punch ?? 1.12);
  const zz = z0 * (z / z0) ** k * (1 + (o.push ?? 0.025) * (t - cut));
  ctx.translate(CX, H / 2); ctx.scale(zz, zz); ctx.rotate((o.roll || 0) * (1 - k)); ctx.translate(-fx, -fy);
}
const GX = 540, GY = 1010, GS = 1.05; // Gosha in world space
function gosha(ctx, t, S) { ctx.save(); ctx.translate(GX + (S.dx || 0), GY + (S.dy || 0)); ctx.scale(GS, GS); T.drawGosha(ctx, { t, glow: 1, blink: T.blinkAt(t), lookX: 0, lookY: 0, ...S }); ctx.restore(); }
function set(ctx, t, o = {}) { T.roomGosha(ctx, t, o); }
function desk(ctx, t) { T.deskGosha(ctx, t, 1500); }

// counter "4000 ЧАСОВ" (screen space)
function counter(ctx, t, a, b) {
  if (t < a || t > b + 0.3) return;
  const k = springT(t, a, M.SPRING.bouncy), out = E.inBack(pt(t, b, b + 0.3), 1.5);
  const v = Math.round(4000 * E.outCubic(pt(t, a, a + 1.3)));
  ctx.save(); ctx.translate(CX, 520); ctx.scale(lerp(0.3, 1, k) * (1 - out), lerp(0.3, 1, k) * (1 - out)); ctx.rotate(-0.05);
  T.burst(ctx, 0, 0, t, 0.8 * k);
  ctx.font = font(250, 900, T.D); ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.lineWidth = 40; ctx.strokeStyle = INK; ctx.strokeText(String(v), 0, 60); ctx.fillStyle = GOLD; ctx.fillText(String(v), 0, 60);
  ctx.font = font(84, 900, T.D); ctx.lineWidth = 22; ctx.strokeText('ЧАСОВ В ДОТЕ', 0, 170); ctx.fillStyle = WHITE; ctx.fillText('ЧАСОВ В ДОТЕ', 0, 170);
  ctx.restore();
}

// skull + tower icons for the choice cards
function skull(ctx, t) {
  ctx.save(); ctx.translate(0, Math.sin(t * 4) * 6);
  T.blob(ctx, [[0, -95], [80, -60], [85, 20], [50, 60], [50, 95], [-50, 95], [-50, 60], [-85, 20], [-80, -60]]); T.fs(ctx, '#fff', INK, 7);
  for (const s of [-1, 1]) { T.ell(ctx, s * 36, 0, 26, 30); T.fs(ctx, INK, null); }
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(-12, 55); ctx.lineTo(12, 55); ctx.closePath(); T.fs(ctx, INK, null);
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 22, 70); ctx.lineTo(i * 22, 95); T.fs(ctx, null, INK, 6); }
  ctx.restore();
}
function lane(ctx, t) {
  ctx.save();
  ctx.rotate(Math.sin(t * 3) * 0.05);
  for (const s of [-1, 1]) { ctx.save(); ctx.rotate(s * 0.7); rrect(ctx, -10, -110, 20, 170, 6); T.fs(ctx, '#e8eef6', INK, 6); rrect(ctx, -40, 50, 80, 18, 6); T.fs(ctx, GOLD, INK, 5); rrect(ctx, -8, 68, 16, 40, 5); T.fs(ctx, '#7a4a2a', INK, 5); ctx.restore(); }
  ctx.restore();
}

// ---------------------------------------------------------------- scenes
function draw(ctx, u, t) {
  ctx.fillStyle = '#0d1222'; ctx.fillRect(0, 0, W, H);
  const talk = 0; // narrator speaks, Gosha doesn't
  let hudOn = t >= t0(9) - 0.1;
  ctx.save();
  if (t < t0(1) - 0.1) {
    // S0: extreme close-up
    cam(ctx, t, 0, 2.3, 540, 960, { punch: 1.3 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.tired, pose: 'keys', typing: true }); desk(ctx, t);
    ctx.restore();
    caption(ctx, 'Это *Гоша*.', t, t0(0), t1(0) + 0.15);
  } else if (t < t0(3) - 0.1) {
    // S1: wide, typing, hours counter
    const cut = t0(1) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1000, { punch: 1.18 });
    set(ctx, t, { clock: true }); gosha(ctx, t, { X: T.EXPR.tired, pose: 'keys', typing: true }); desk(ctx, t);
    ctx.restore();
    counter(ctx, t, t0(2) - 0.05, t1(2) + 0.2);
    caption(ctx, '*19* лет.', t, t0(1), t1(1) + 0.15);
    caption(ctx, '*4000* часов в Доте.', t, t0(2), t1(2) + 0.15);
  } else if (t < t0(4) - 0.1) {
    // S2: rank
    const cut = t0(3) - 0.1;
    cam(ctx, t, cut, 1.35, 540, 1050, { roll: 0.06 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.smug, pose: 'keys' }); desk(ctx, t);
    ctx.restore();
    const k = springT(t, t0(3) + 0.25, { stiffness: 260, damping: 14 });
    T.burst(ctx, CX, 520, t, 0.6 * k, '170,190,210');
    T.rankShield(ctx, CX, lerp(-300, 520, k), 1.25, 0, '', t);
    T.stamp(ctx, t, t0(3) + 0.45, t1(3) + 0.3, 'СТРАЖ', CX, 760, { size: 100, color: '#cfd8e3', rot: -0.08, bg: 'rgba(20,24,36,0.9)' });
    caption(ctx, 'Ранг — *Страж*.', t, t0(3), t1(3) + 0.15, { hl: '#9fb3c8' });
  } else if (t < t0(5) - 0.1) {
    // S3: angry at teammates
    const cut = t0(4) - 0.1;
    M.shake(ctx, t * 2, (t0(4) + 0.6) * 2, 10);
    cam(ctx, t, cut, 1.15, 540, 1080);
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.angry, pose: 'keys', typing: true, blush: 1, talk: 0.6 + 0.4 * Math.sin(t * 18) }); desk(ctx, t);
    ctx.restore();
    T.bubble(ctx, t, t0(4) + 0.3, t1(4) + 0.3, 300, 360, 'РЕПОРТ КЕРРИ', { color: '#ffd9d9', side: 1, rot: -0.08 });
    T.bubble(ctx, t, t0(4) + 0.7, t1(4) + 0.3, 760, 470, 'САППЫ ГДЕ??', { color: '#fff3c4', side: -1, rot: 0.06 });
    T.bubble(ctx, t, t0(4) + 1.1, t1(4) + 0.3, 360, 620, 'МИД ОПЯТЬ СЛИЛ', { color: '#d9f0ff', side: 1, rot: 0.04 });
    caption(ctx, 'Во всех сливах виноваты *тиммейты*.', t, t0(4), t1(4) + 0.15, { hl: RED });
  } else if (t < t0(7) - 0.1) {
    // S4: brother's message
    const cut = t0(5) - 0.1;
    const shocked = t > t0(6) + 0.3;
    cam(ctx, t, cut, shocked ? 1.6 : 1.3, 540, shocked ? 1000 : 1060, { punch: shocked ? 1.0 : 1.12 });
    set(ctx, t); gosha(ctx, t, { X: shocked ? T.EXPR.shock : T.EXPR.neutral, pose: 'phone', lookY: -0.6, sweat: shocked ? 1 : 0 }); desk(ctx, t);
    ctx.restore();
    if (shocked) T.speedLines(ctx, t, 0.5 * pt(t, t0(6) + 0.3, t0(6) + 0.5));
    T.notif(ctx, t, t0(5) + 0.15, t1(6) + 0.6, { app: 'TELEGRAM', who: 'Брат', body: 'Спорим, за 30 дней не апнешь Легенду? Проиграешь — комп мой', icon: '#2aa3e0', y: 250 });
    caption(ctx, 'И тут пишет *брат*.', t, t0(5), t1(5) + 0.15);
    caption(ctx, 'Спорим, за *30 дней* ты не апнешь *Легенду*?', t, t0(6), t1(6) + 0.15);
  } else if (t < t0(8) - 0.1) {
    // S5: the stake: his PC
    const cut = t0(7) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 960, { punch: 1.25, roll: -0.05 });
    set(ctx, t);
    T.burst(ctx, 540, 900, t, 0.5);
    T.pcTower(ctx, 540, 1000, 1.3, t);
    T.tag(ctx, 540 + 160, 600, t, t0(7) + 0.25, 'СТАВКА');
    ctx.fillStyle = '#3b2a2a'; ctx.fillRect(-W, 1400, W * 3, H);
    ctx.restore();
    caption(ctx, 'На кону — *Гошин компьютер*.', t, t0(7), t1(7) + 0.15, { hl: GOLD, y: H * 0.78 });
  } else if (t < t0(9) - 0.1) {
    // S6: deal
    const cut = t0(8) - 0.1;
    cam(ctx, t, cut, 1.2, 540, 1040);
    set(ctx, t);
    T.burst(ctx, 540, 900, t, 0.55 * pt(t, cut, cut + 0.3));
    gosha(ctx, t, { X: T.EXPR.determined, pose: 'fist', fistK: E.outBack(pt(t, cut + 0.1, cut + 0.5)) }); desk(ctx, t);
    ctx.restore();
    T.stamp(ctx, t, t0(8) + 0.4, t1(8) + 0.3, 'ПРИНЯТО', CX, 520, { size: 120, color: GREEN, rot: -0.1, bg: 'rgba(10,30,20,0.85)' });
    caption(ctx, 'Гоша *поспорил*.', t, t0(8), t1(8) + 0.15);
  } else if (t < t0(12) - 0.1) {
    // S7: the bot (native insert)
    const cut = t0(9) - 0.1;
    const close = t > t0(9) + 1.4;           // whip from Gosha to the phone
    const whip = E.inOutCubic(pt(t, t0(9) + 1.15, t0(9) + 1.55));
    // background: room blurred dark with gold rays once close
    cam(ctx, t, cut, lerp(1.25, 2.6, whip), 540, lerp(1060, 1480, whip), { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: whip > 0.5 ? T.EXPR.neutral : T.EXPR.determined, pose: 'phone', lookY: 0.7 }); desk(ctx, t);
    ctx.restore();
    if (whip > 0) { ctx.fillStyle = `rgba(8,10,18,${0.75 * whip})`; ctx.fillRect(0, 0, W, H); T.burst(ctx, CX, 860, t, 0.5 * whip); }
    // phone flies up
    const kph = springT(t, t0(9) + 1.2, { stiffness: 200, damping: 18 });
    if (kph > 0.001) {
      let img = IMG.home, crop = [0, 0, 780, 1688], scroll = 0;
      if (t > t0(10) - 0.05) { img = IMG.killers; crop = [0, 420, 780, 1688]; }
      if (t > t0(11) - 0.05) { img = IMG.deaths; crop = [0, 60, 780, 1688]; }
      const sweep = pt(t, t0(10) - 0.05, t0(10) + 0.6) || pt(t, t0(11) - 0.05, t0(11) + 0.6);
      T.phone(ctx, CX, lerp(2400, 860, kph), 620, img, crop, { rot: (1 - kph) * 0.4 + 0.03 * Math.sin(t * 1.5), sweep: sweep > 0 && sweep < 1 ? sweep : null, scroll });
      // tap on "Разобрать" on the home screen
      if (t < t0(10)) {
        const tp = pt(t, t0(9) + 2.4, t0(9) + 2.9);
        if (tp > 0 && tp < 1) { ctx.save(); ctx.globalAlpha = 1 - tp; T.ell(ctx, CX + 17, 860 + (690 - 844) * 0.76, 40 + 60 * tp, 40 + 60 * tp); ctx.lineWidth = 8; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.restore(); }
      }
    }
    if (t > t0(10)) T.stamp(ctx, t, t0(10) + 0.9, t1(10) + 0.25, '30 / 100', CX, 470, { size: 120, color: RED, rot: -0.1, bg: 'rgba(30,8,10,0.9)' });
    if (t > t0(11)) {
      T.stamp(ctx, t, t0(11) + 0.15, t1(11) + 0.2, '19 СМЕРТЕЙ', CX, 420, { size: 100, color: RED, rot: 0.06, bg: 'rgba(30,8,10,0.9)' });
      T.bubble(ctx, t, t0(11) + 1.4, t1(11) + 0.2, CX, 1490, '8 — СРАЗУ ПОСЛЕ РЕСПА', { color: '#fff', size: 50, side: 1 });
    }
    T.botTag(ctx, t, t0(9) + 1.7, t1(11) + 0.3, 1680);
    caption(ctx, '*День 1*.', t, t0(9), t0(9) + 1.1, { y: H * 0.72, size: 130 });
    caption(ctx, 'Закидывает катку в *Дота Разбор*', t, t0(9) + 1.5, t1(9), { y: 1560, size: 66 });
  } else if (t < t0(13) - 0.1) {
    // S8: shock
    const cut = t0(12) - 0.1;
    M.shake(ctx, t * 2, (t0(12)) * 2, 22);
    cam(ctx, t, cut, 2.1, 540, 960, { punch: 1.5 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.shock, pose: 'cheeks', sweat: 1, blush: 0.8, blink: 0 }); desk(ctx, t);
    ctx.restore();
    T.speedLines(ctx, t, 0.85);
    caption(ctx, 'Гоша в *шоке*.', t, t0(12), t1(12) + 0.3, { hl: RED });
  } else if (t < t0(14) - 0.1) {
    // S9: choice
    const cut = t0(13) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.sly, pose: 'keys', dy: 120 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,10,18,0.35)'; ctx.fillRect(0, 0, W, H);
    T.choice(ctx, t, t0(13) + 0.1, 'СМЕРТИ', 'ЛАЙН', skull, lane);
    caption(ctx, 'Что чиним *первым*?', t, t0(13), t0(13) + 1.2, { y: H * 0.74 });
    caption(ctx, 'Пиши: *смерти* или *лайн*', t, t0(13) + 1.3, ST.duration, { y: H * 0.74 });
  } else {
    // S10: end
    const cut = t0(14) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.sly, pose: 'keys', dy: 120 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,10,18,0.35)'; ctx.fillRect(0, 0, W, H);
    T.choice(ctx, t, t0(13) + 0.1, 'СМЕРТИ', 'ЛАЙН', skull, lane);
    caption(ctx, 'Подпишись на *день 2*', t, t0(14), ST.duration, { y: H * 0.74, size: 100 });
    T.botTag(ctx, t, t0(14) + 0.9, ST.duration, 1560, 'разбери свою катку');
  }
  if (hudOn) T.hud(ctx, t, t0(9) - 0.1, { day: 1, of: 30, label: 'СТРАЖ → ЛЕГЕНДА', pct: t > t0(13) ? 3 * E.outCubic(pt(t, t0(13), t0(13) + 1)) : 0 });
}

const HITS = [];
M.film({
  fonts: [font(100, 900, T.D), font(40, 700, T.UI), font(40, 800, T.UI), font(40, 600, T.UI)],
  samples: 4, hits: HITS,
  async init() {
    ST = await T.loadStory();
    await Promise.all(['home', 'killers', 'deaths'].map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = res; im.src = `../common/assets/app_${n}.png`; })));
    const b = (s) => s * 2; // seconds -> beats (120 BPM)
    const P = ST.phrases;
    HITS.push(
      [b(P[0].t0), 'это гоша', 'impact'], [b(P[1].t0 - 0.1), 'wide', 'whoosh'], [b(P[2].t0), 'counter', 'type', { len: 1.2 }], [b(P[2].t0 + 1.3), '4000', 'bell', { pitch: 'E6' }],
      [b(P[3].t0 + 0.25), 'shield', 'thud'], [b(P[3].t0 + 0.45), 'страж', 'impact'],
      [b(P[4].t0 - 0.1), 'cut', 'whoosh'], [b(P[4].t0 + 0.3), 'b1', 'pop', { pitch: 'C6' }], [b(P[4].t0 + 0.7), 'b2', 'pop', { pitch: 'E6' }], [b(P[4].t0 + 1.1), 'b3', 'pop', { pitch: 'G6' }],
      [b(P[5].t0 + 0.15), 'notif', 'blip', { pitch: 'A6' }], [b(P[6].t0 + 0.3), 'shock', 'boing'],
      [b(P[7].t0 - 0.1), 'pc', 'impact'], [b(P[7].t0 + 0.25), 'tag', 'tok', { pitch: 'G5' }],
      [b(P[8].t0 - 0.1), 'fist', 'whoosh'], [b(P[8].t0 + 0.4), 'принято', 'impact'],
      [b(P[9].t0 - 0.1), 'hud', 'click'], [b(P[9].t0 + 1.2), 'phone', 'whoosh'], [b(P[9].t0 + 1.7), 'bot', 'bell', { pitch: 'B5' }], [b(P[9].t0 + 2.4), 'tap', 'click'],
      [b(P[10].t0), 'screen', 'click'], [b(P[10].t0 + 0.9), '30/100', 'thud'], [b(P[11].t0), 'screen2', 'click'], [b(P[11].t0 + 0.15), '19', 'thud'], [b(P[11].t0 + 1.4), 'bubble', 'pop', { pitch: 'E6' }],
      [b(P[12].t0 - 0.1), 'shock', 'impact'], [b(P[13].t0 + 0.1), 'card1', 'whoosh'], [b(P[13].t0 + 0.4), 'vs', 'thud'],
      [b(P[14].t0 + 0.9), 'tag', 'bell', { pitch: 'E6' }],
    );
  },
  draw(ctx, u, t) { draw(ctx, u, t); },
  post(ctx, u, t) { T.vignette(ctx, 0.45); T.grain(ctx, t, 0.03); },
});
