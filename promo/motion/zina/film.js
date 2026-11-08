// «Баба Зина в Доте», серия 1. Внук уехал и оставил бабушке свой комп и рейтинг; первая катка слита,
// в чате её назвали нубом, она закидывает катку в бота и начинает выигрывать. В конце ей пишет Титан —
// продолжение в серии 2. Сцены привязаны к фразам озвучки (story.json), всё рисуется кодом (common/toon.js).
import * as M from '../common/lib/motion.js';
import * as T from '../common/toon.js';
const { W, H, E, lerp, clamp, rrect, font } = M;
const { CX, INK, GOLD, RED, GREEN, WHITE, pt, springT, caption } = T;

const IMG = {};
let ST = null;
const t0 = (i) => ST.phrases[i].t0, t1 = (i) => ST.phrases[i].t1;

function cam(ctx, t, cut, z, fx, fy, o = {}) {
  const k = springT(t, cut, { stiffness: 180, damping: 17 });
  const z0 = z * (o.punch ?? 1.12);
  const zz = z0 * (z / z0) ** k * (1 + (o.push ?? 0.025) * (t - cut));
  ctx.translate(CX, H / 2); ctx.scale(zz, zz); ctx.rotate((o.roll || 0) * (1 - k)); ctx.translate(-fx, -fy);
}
const ZX = 540, ZY = 1010, ZS = 1.05;
function zina(ctx, t, S) { ctx.save(); ctx.translate(ZX + (S.dx || 0), ZY + (S.dy || 0)); ctx.rotate(S.sway || 0); ctx.scale(ZS, ZS); T.drawZina(ctx, { t, blink: T.blinkAt(t + 0.4), lookX: 0, lookY: 0, ...S }); ctx.restore(); }
const set = (ctx, t) => T.roomZina(ctx, t);
const desk = (ctx, t) => T.deskZina(ctx, t, 1500);

// big number with label (screen space)
function bigNum(ctx, t, a, b, num, label, y = 520, col = GOLD) {
  if (t < a || t > b + 0.3) return;
  const k = springT(t, a, M.SPRING.bouncy), out = E.inBack(pt(t, b, b + 0.3), 1.5);
  ctx.save(); ctx.translate(CX, y); ctx.scale(lerp(0.3, 1, k) * (1 - out), lerp(0.3, 1, k) * (1 - out)); ctx.rotate(-0.05);
  T.burst(ctx, 0, 0, t, 0.7 * k);
  ctx.font = font(260, 900, T.D); ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.lineWidth = 40; ctx.strokeStyle = INK; ctx.strokeText(num, 0, 60); ctx.fillStyle = col; ctx.fillText(num, 0, 60);
  ctx.font = font(84, 900, T.D); ctx.lineWidth = 22; ctx.strokeText(label, 0, 170); ctx.fillStyle = WHITE; ctx.fillText(label, 0, 170);
  ctx.restore();
}
// a sticky note from the grandson
function note(ctx, t, a, b) {
  if (t < a || t > b + 0.3) return;
  const k = springT(t, a, { stiffness: 220, damping: 15 }), out = E.inBack(pt(t, b, b + 0.3), 1.5);
  ctx.save(); ctx.translate(CX, lerp(-400, 520, k) - out * 900); ctx.rotate(-0.07 + (1 - k) * 0.5);
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
  ctx.fillStyle = '#ffe46b'; ctx.fillRect(-380, -250, 760, 500); ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(-380, -250, 760, 70);
  rrect(ctx, -80, -280, 160, 60, 6); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
  ctx.fillStyle = '#1b2a6b'; ctx.textAlign = 'center'; ctx.font = font(66, 800, T.UI);
  ctx.fillText('БА, ТОЛЬКО', 0, -70); ctx.fillText('НЕ ТРОГАЙ', 0, 15); ctx.fillText('МОЙ РЕЙТИНГ!!!', 0, 100);
  ctx.font = font(44, 700, T.UI); ctx.fillText('твой внук', 180, 190);
  // underline
  ctx.beginPath(); ctx.moveTo(-250, 125); ctx.quadraticCurveTo(0, 140, 250, 118); ctx.lineWidth = 8; ctx.strokeStyle = RED; ctx.stroke();
  ctx.restore();
}
// glasses glint
function glint(ctx, t, a, x, y) {
  const p = pt(t, a, a + 0.5); if (p <= 0 || p >= 1) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(p * 2); const s = Math.sin(p * Math.PI) * 1.4;
  ctx.scale(s, s); ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 30;
  ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 14 : 90, an = i * Math.PI / 4; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); } ctx.closePath(); ctx.fill();
  ctx.restore();
}

function draw(ctx, u, t) {
  ctx.fillStyle = '#e9cf9f'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (t < t0(1) - 0.1) {
    cam(ctx, t, 0, 2.2, 540, 960, { punch: 1.3 });
    set(ctx, t); zina(ctx, t, { X: T.EXPR.happy, pose: 'keys' }); desk(ctx, t);
    ctx.restore();
    caption(ctx, 'Это *баба Зина*.', t, t0(0), t1(0) + 0.15);
  } else if (t < t0(2) - 0.1) {
    cam(ctx, t, t0(1) - 0.1, 1.0, 540, 1000, { punch: 1.18 });
    set(ctx, t); zina(ctx, t, { X: T.EXPR.proud, pose: 'keys' }); desk(ctx, t);
    ctx.restore();
    bigNum(ctx, t, t0(1) - 0.05, t1(1) + 0.2, '72', 'ГОДА');
    caption(ctx, '*72* года.', t, t0(1), t1(1) + 0.15);
  } else if (t < t0(3) - 0.1) {
    // the grandson's PC appears
    const cut = t0(2) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1000, { punch: 1.12 });
    set(ctx, t);
    const k = springT(t, t0(2) + 1.3, M.SPRING.bouncy);
    T.burst(ctx, 820, 1050, t, 0.5 * k, '120,200,255');
    zina(ctx, t, { X: k > 0.5 ? T.EXPR.shock : T.EXPR.neutral, pose: 'keys', dx: -170, lookX: k > 0.5 ? 0.9 : 0, sweat: 0 });
    T.pcTower(ctx, 840, lerp(2300, 1180, k), 0.95, t);
    desk(ctx, t);
    ctx.restore();
    caption(ctx, 'Внук уехал на месяц и оставил ей свой *компьютер*.', t, t0(2), t1(2) + 0.15, { size: 80 });
  } else if (t < t0(4) - 0.1) {
    cam(ctx, t, t0(3) - 0.1, 1.3, 540, 1060);
    set(ctx, t); zina(ctx, t, { X: T.EXPR.sly, pose: 'keys', lookY: -0.7 }); desk(ctx, t);
    ctx.restore();
    note(ctx, t, t0(3) + 0.2, t1(3) + 0.2);
    caption(ctx, 'И записку: только не трогай мой *рейтинг*.', t, t0(3), t1(3) + 0.15, { size: 82, hl: RED });
  } else if (t < t0(5) - 0.1) {
    // she touches it: headset on
    const cut = t0(4) - 0.1;
    M.shake(ctx, t * 2, (t0(4) + 0.5) * 2, 14);
    cam(ctx, t, cut, 1.25, 540, 1040, { punch: 1.3, roll: 0.08 });
    set(ctx, t);
    T.burst(ctx, 540, 900, t, 0.6);
    zina(ctx, t, { X: T.EXPR.determined, pose: 'fist', fistK: E.outBack(pt(t, cut + 0.1, cut + 0.5)), headset: true, glow: 1 });
    desk(ctx, t);
    ctx.restore();
    caption(ctx, 'Баба Зина *тронула*.', t, t0(4), t1(4) + 0.2);
  } else if (t < t0(6) - 0.1) {
    // first game: defeat
    const cut = t0(5) - 0.1;
    cam(ctx, t, cut, 1.15, 540, 1060);
    set(ctx, t); zina(ctx, t, { X: t > t0(5) + 1.2 ? T.EXPR.sad : T.EXPR.determined, pose: 'keys', typing: t < t0(5) + 1.2, headset: true, glow: 1 }); desk(ctx, t);
    ctx.restore();
    if (t > t0(5) + 1.2) { ctx.fillStyle = `rgba(80,0,10,${0.35 * pt(t, t0(5) + 1.2, t0(5) + 1.5)})`; ctx.fillRect(0, 0, W, H); }
    T.stamp(ctx, t, t0(5) + 1.25, t1(5) + 0.3, 'ПОРАЖЕНИЕ', CX, 470, { size: 110, color: RED, rot: -0.09, bg: 'rgba(30,8,10,0.92)' });
    T.stamp(ctx, t, t0(5) + 1.6, t1(5) + 0.3, '20:00', CX, 640, { size: 80, color: '#fff', rot: 0.05, bg: 'rgba(30,8,10,0.92)' });
    caption(ctx, 'Первая катка. Проиграна за *20 минут*.', t, t0(5), t1(5) + 0.15, { hl: RED });
  } else if (t < t0(7) - 0.1) {
    const cut = t0(6) - 0.1;
    cam(ctx, t, cut, 1.15, 540, 1060);
    set(ctx, t); zina(ctx, t, { X: T.EXPR.sad, pose: 'keys', headset: true, glow: 1 }); desk(ctx, t);
    ctx.restore();
    T.bubble(ctx, t, t0(6) + 0.15, t1(6) + 0.6, 300, 380, 'НУБ', { color: '#ffd9d9', side: 1, rot: -0.08, size: 60 });
    T.bubble(ctx, t, t0(6) + 0.45, t1(6) + 0.6, 740, 470, 'УДАЛИ ДОТУ', { color: '#fff3c4', side: -1, rot: 0.06 });
    T.bubble(ctx, t, t0(6) + 0.8, t1(6) + 0.6, 380, 610, 'ТЫ ЧЁ, БАБКА?', { color: '#d9f0ff', side: 1, rot: 0.04 });
    caption(ctx, 'В чате её назвали *нубом*.', t, t0(6), t1(6) + 0.3, { hl: RED });
  } else if (t < t0(8) - 0.1) {
    // "Зря." extreme close-up, glint
    const cut = t0(7) - 0.15;
    cam(ctx, t, cut, 2.6, 540, 930, { punch: 1.35 });
    set(ctx, t); zina(ctx, t, { X: T.EXPR.determined, pose: 'keys', headset: true, glow: 0.6, blink: 0 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
    glint(ctx, t, t0(7) + 0.05, 330, 830);
    caption(ctx, '*Зря.*', t, t0(7), t0(8) - 0.2, { size: 170, y: H * 0.74 });
  } else if (t < t0(10) - 0.1) {
    // the bot (native insert)
    const cut = t0(8) - 0.1;
    const whip = E.inOutCubic(pt(t, t0(8) + 0.9, t0(8) + 1.3));
    cam(ctx, t, cut, lerp(1.25, 2.6, whip), 540, lerp(1060, 1480, whip), { punch: 1.1 });
    set(ctx, t); zina(ctx, t, { X: T.EXPR.determined, pose: 'phone', lookY: 0.7, headset: true }); desk(ctx, t);
    ctx.restore();
    if (whip > 0) { ctx.fillStyle = `rgba(20,12,8,${0.78 * whip})`; ctx.fillRect(0, 0, W, H); T.burst(ctx, CX, 860, t, 0.5 * whip); }
    const kph = springT(t, t0(8) + 0.95, { stiffness: 200, damping: 18 });
    if (kph > 0.001) {
      let img = IMG.home, crop = [0, 0, 780, 1688];
      const s1 = t0(9) + 0.3, s2 = t0(9) + 1.5;
      if (t > s1) { img = IMG.deaths; crop = [0, 60, 780, 1688]; }
      if (t > s2) { img = IMG.killers; crop = [0, 0, 780, 1688]; }
      const sw = t > s2 ? pt(t, s2, s2 + 0.6) : pt(t, s1, s1 + 0.6);
      T.phone(ctx, CX, lerp(2400, 860, kph), 620, img, crop, { rot: (1 - kph) * 0.4 + 0.03 * Math.sin(t * 1.5), sweep: sw > 0 && sw < 1 ? sw : null });
      if (t < s1) {
        const tp = pt(t, t0(8) + 1.6, t0(8) + 2.1);
        if (tp > 0 && tp < 1) { ctx.save(); ctx.globalAlpha = 1 - tp; T.ell(ctx, CX + 17, 860 + (690 - 844) * 0.76, 40 + 60 * tp, 40 + 60 * tp); ctx.lineWidth = 8; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.restore(); }
      }
    }
    // the three things, as chips ticking in with the voice
    const chips = [['ГДЕ УМИРАЛА', t0(9) + 0.9], ['КТО СЛИЛ', t0(9) + 1.6], ['ЧТО КУПИТЬ', t0(9) + 2.3]];
    chips.forEach(([s, a], i) => T.bubble(ctx, t, a, t1(9) + 0.2, [250, 540, 830][i], 390 + (i % 2) * 70, s, { color: ['#d9f0ff', '#ffd9d9', '#e2ffd9'][i], size: 42, side: i === 2 ? -1 : 1 }));
    T.botTag(ctx, t, t0(8) + 1.4, t1(9) + 0.3, 1680);
    caption(ctx, 'Закинула катку в *Дота Разбор*', t, t0(8), t0(8) + 1.0, { size: 84 });
    if (t > t0(8) + 1.3) caption(ctx, 'Бот всё *разложил*', t, t0(8) + 1.3, t1(9), { y: 1560, size: 70 });
  } else if (t < t0(12) - 0.1) {
    // wins
    const second = t > t0(11) - 0.1;
    const cut = second ? t0(11) - 0.1 : t0(10) - 0.1;
    cam(ctx, t, cut, second ? 1.2 : 1.05, 540, second ? 1040 : 1060, { punch: 1.2, roll: second ? -0.06 : 0.06 });
    set(ctx, t);
    T.burst(ctx, 540, 900, t, 0.55, '255,201,74');
    zina(ctx, t, { X: T.EXPR.happy, pose: 'fist', fistK: 1, headset: true, sway: second ? 0.08 * Math.sin(t * 9) : 0, dy: second ? -20 * Math.abs(Math.sin(t * 9)) : 0 });
    desk(ctx, t);
    ctx.restore();
    const win = second ? t0(11) : t0(10);
    T.stamp(ctx, t, win + 0.75, ST.phrases[second ? 11 : 10].t1 + 0.3, 'ПОБЕДА', CX, 480, { size: 140, color: GREEN, rot: -0.08, bg: 'rgba(10,30,20,0.9)' });
    if (second) T.stamp(ctx, t, win + 1.1, t1(11) + 0.3, '2 ПОДРЯД', CX, 660, { size: 70, color: GOLD, rot: 0.05, bg: 'rgba(30,22,8,0.9)' });
    T.confetti(ctx, t, win + 0.75, CX, 600, 70, second ? 9 : 3);
    caption(ctx, 'Вторая катка. *Победа*.', t, t0(10), t1(10) + 0.15, { hl: GREEN });
    caption(ctx, 'Третья катка. Опять *победа*.', t, t0(11), t1(11) + 0.15, { hl: GREEN });
  } else if (t < t0(14) - 0.1) {
    // the stranger
    const cut = t0(12) - 0.1;
    const evening = pt(t, cut, cut + 0.6);
    cam(ctx, t, cut, 1.3, 540, 1060);
    set(ctx, t); zina(ctx, t, { X: t > t0(13) ? T.EXPR.shock : T.EXPR.neutral, pose: 'phone', lookY: -0.6, headset: true, glow: 1 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = `rgba(10,14,40,${0.45 * evening})`; ctx.fillRect(0, 0, W, H);
    T.notif(ctx, t, t0(12) + 0.2, ST.duration, { app: 'ДОТА · ЛИЧНЫЕ', who: 'Незнакомец · ранг Титан', body: 'Бабуль, кто тебя тренирует?', icon: '#6b5bd6', y: 250 });
    const k = springT(t, t0(12) + 1.9, M.SPRING.bouncy);
    if (k > 0.01) { T.rankShield(ctx, 860, 640, 0.6 * k, 3, '', t); }
    caption(ctx, 'А вечером ей пишет *незнакомец*.', t, t0(12), t0(12) + 1.6, { size: 84 });
    caption(ctx, 'Ранг — *Титан*.', t, t0(12) + 1.7, t1(12) + 0.15, { hl: '#c77dff' });
    caption(ctx, '«Бабуль, кто тебя *тренирует*?»', t, t0(13), t1(13) + 0.15, { size: 84 });
  } else {
    // cliffhanger
    const cut = t0(14) - 0.1;
    cam(ctx, t, cut, 1.9, 540, 960, { punch: 1.15, push: 0.04 });
    set(ctx, t); zina(ctx, t, { X: T.EXPR.sly, pose: 'phone', headset: true, glow: 1 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(10,14,40,0.55)'; ctx.fillRect(0, 0, W, H);
    caption(ctx, 'Что ответит *баба Зина*?', t, t0(14), t0(14) + 1.3, { size: 86, y: 400 });
    T.stamp(ctx, t, t0(14) + 1.3, ST.duration, 'СЕРИЯ 2 — СКОРО', CX, 420, { size: 86, color: GOLD, rot: -0.06, bg: 'rgba(20,16,8,0.9)' });
    caption(ctx, 'Подпишись, чтобы не *пропустить*', t, t0(14) + 1.6, ST.duration, { size: 70, y: 1430 });
    T.botTag(ctx, t, t0(14) + 0.8, ST.duration, 1640, 'разбери свою катку');
  }
}

const HITS = [];
M.film({
  fonts: [font(100, 900, T.D), font(40, 700, T.UI), font(40, 800, T.UI), font(40, 600, T.UI)],
  samples: 4, hits: HITS,
  async init() {
    ST = await T.loadStory();
    await Promise.all(['home', 'killers', 'deaths'].map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = res; im.src = `../common/assets/app_${n}.png`; })));
    const b = (s) => s * 2, P = ST.phrases;
    HITS.push(
      [b(P[0].t0), 'это', 'impact'], [b(P[1].t0 - 0.1), 'wide', 'whoosh'], [b(P[1].t0), '72', 'bell', { pitch: 'C6' }],
      [b(P[2].t0 + 1.3), 'pc', 'boing'], [b(P[3].t0 + 0.2), 'note', 'whoosh'], [b(P[3].t0 + 1.0), 'note', 'tok', { pitch: 'E5' }],
      [b(P[4].t0 - 0.1), 'тронула', 'impact'], [b(P[5].t0 + 1.25), 'defeat', 'thud'], [b(P[5].t0 + 1.6), '20', 'thud'],
      [b(P[6].t0 + 0.15), 'b1', 'pop', { pitch: 'C6' }], [b(P[6].t0 + 0.45), 'b2', 'pop', { pitch: 'E6' }], [b(P[6].t0 + 0.8), 'b3', 'pop', { pitch: 'G6' }],
      [b(P[7].t0 - 0.15), 'зря', 'impact'], [b(P[7].t0 + 0.05), 'glint', 'bell', { pitch: 'B6' }],
      [b(P[8].t0 + 0.9), 'phone', 'whoosh'], [b(P[8].t0 + 1.4), 'bot', 'bell', { pitch: 'B5' }], [b(P[8].t0 + 1.6), 'tap', 'click'],
      [b(P[9].t0 + 0.3), 'scr', 'click'], [b(P[9].t0 + 0.9), 'c1', 'pop', { pitch: 'C6' }], [b(P[9].t0 + 1.5), 'scr', 'click'], [b(P[9].t0 + 1.6), 'c2', 'pop', { pitch: 'E6' }], [b(P[9].t0 + 2.3), 'c3', 'pop', { pitch: 'G6' }],
      [b(P[10].t0 + 0.75), 'win', 'coins'], [b(P[10].t0 + 0.75), 'win', 'impact'], [b(P[11].t0 + 0.75), 'win2', 'coins'], [b(P[11].t0 + 1.1), 'streak', 'bell', { pitch: 'E6' }],
      [b(P[12].t0 + 0.2), 'notif', 'blip', { pitch: 'A6' }], [b(P[12].t0 + 1.9), 'titan', 'thud'], [b(P[13].t0), 'shock', 'boing'],
      [b(P[14].t0 - 0.1), 'end', 'sub'], [b(P[14].t0 + 1.3), 'серия 2', 'impact'],
    );
  },
  draw(ctx, u, t) { draw(ctx, u, t); },
  post(ctx, u, t) { T.vignette(ctx, 0.4); T.grain(ctx, t, 0.03); },
});
