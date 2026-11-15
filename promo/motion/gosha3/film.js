// «Гоша. 30 дней до Легенды», серия 3: новая катка с тремя правилами. Бот помнит задачу с прошлого разбора
// и проверяет её (не вышло), Гоша спрашивает тренера в боте, получает новую задачу. Концовка — прямой
// призыв: кинь свою катку, первая разбирается полностью бесплатно. Экраны настоящие (app_coach, app_chat, app_home).
import * as M from '../common/lib/motion.js';
import * as T from '../common/toon.js';
const { W, H, E, lerp, clamp, rrect, font } = M;
const { CX, INK, GOLD, RED, GREEN, TEAL, pt, springT, caption } = T;

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

// a real app screen cut out as a floating panel; returns screen-space mapping for highlights
const CROP = {
  tasks: ['coach', [16, 1228, 748, 440]],
  chat: ['chat', [20, 488, 740, 752]],
  home: ['home', [0, 30, 780, 730]],
};
function panel(ctx, t, tin, key, cy, w = 960) {
  const [im, c] = CROP[key]; const img = IMG[im];
  const s = w / c[2], h = c[3] * s, k = springT(t, tin, { stiffness: 230, damping: 19 });
  const top = cy - h / 2;
  if (k > 0.001 && img) {
    ctx.save(); ctx.translate(CX, cy + (1 - k) * 900); ctx.rotate((1 - k) * 0.25); ctx.scale(lerp(0.7, 1, k), lerp(0.7, 1, k));
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 26;
    rrect(ctx, -w / 2, -h / 2, w, h, 40); ctx.fillStyle = '#0b0b0e'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.save(); rrect(ctx, -w / 2, -h / 2, w, h, 40); ctx.clip(); ctx.drawImage(img, c[0], c[1], c[2], c[3], -w / 2, -h / 2, w, h); ctx.restore();
    rrect(ctx, -w / 2, -h / 2, w, h, 40); T.fs(ctx, null, 'rgba(255,255,255,0.18)', 4);
    ctx.restore();
  }
  return { x: (x) => CX - w / 2 + (x - c[0]) * s, y: (y) => top + (y - c[1]) * s, s };
}
function frame(ctx, t, a, b, x, y, w, h, col = RED) {
  if (t < a || t > b + 0.3) return;
  const k = springT(t, a, { stiffness: 320, damping: 16 }), out = pt(t, b, b + 0.3);
  ctx.save(); ctx.globalAlpha = (1 - out) * clamp(k * 2);
  const sc = lerp(1.15, 1, k); ctx.translate(x + w / 2, y + h / 2); ctx.scale(sc, sc);
  rrect(ctx, -w / 2, -h / 2, w, h, 24); ctx.lineWidth = 10; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 30; ctx.stroke();
  ctx.restore();
}
function darkBg(ctx, t, col = '56,217,201') {
  ctx.fillStyle = '#0a0d18'; ctx.fillRect(0, 0, W, H);
  T.burst(ctx, CX, 900, t, 0.5, col);
}
// three small sticky notes stuck along the top of the frame (yesterday's rules)
function miniNotes(ctx, t, tin) {
  const cols = ['#ffe066', '#7ee8d8', '#ff9ec4'], txt = ['НА БАЗУ', 'ОТХОДИ', 'НЕ ОДИН'];
  for (let i = 0; i < 3; i++) {
    const k = springT(t, tin + i * 0.15, { stiffness: 380, damping: 15 }); if (k <= 0.001) continue;
    ctx.save(); ctx.translate(200 + i * 340, 520); ctx.rotate([-0.08, 0.05, -0.03][i] + (1 - k) * 0.5); ctx.scale(k, k);
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
    rrect(ctx, -140, -80, 280, 160, 6); ctx.fillStyle = cols[i]; ctx.fill(); ctx.shadowColor = 'transparent'; T.fs(ctx, null, INK, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-60, -96, 120, 30);
    ctx.fillStyle = INK; ctx.font = font(48, 900, T.D); ctx.textAlign = 'center'; ctx.fillText(txt[i], 0, 18);
    ctx.restore();
  }
}
function tap(ctx, t, a, x, y) {
  const tp = pt(t, a, a + 0.5); if (tp <= 0 || tp >= 1) return;
  ctx.save(); ctx.globalAlpha = 1 - tp; T.ell(ctx, x, y, 40 + 70 * tp, 40 + 70 * tp); ctx.lineWidth = 9; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.restore();
}

function draw(ctx, u, t) {
  ctx.fillStyle = '#0d1222'; ctx.fillRect(0, 0, W, H);
  let hudOn = true;
  ctx.save();
  if (t < t0(1) - 0.1) {
    cam(ctx, t, 0, 1.6, 540, 1000, { punch: 1.3 });
    set(ctx, t, { clock: true }); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true }); desk(ctx, t);
    ctx.restore();
    caption(ctx, '*День 3*', t, t0(0), t1(0) + 0.2, { size: 150, y: H * 0.68 });
  } else if (t < t0(2) - 0.1) {
    // new game with the rules on the monitor
    const cut = t0(1) - 0.1;
    cam(ctx, t, cut, 1.15, 540, 1080);
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true, talk: 0 }); desk(ctx, t);
    ctx.restore();
    miniNotes(ctx, t, t0(1) + 0.9);
    caption(ctx, 'Новая катка с *тремя правилами*', t, t0(1), t1(1) + 0.15, { size: 84 });
  } else if (t < t0(4) - 0.1) {
    // the bot remembers last time's task and checks it
    hudOn = false; ctx.restore();
    darkBg(ctx, t);
    const P = panel(ctx, t, t0(2) - 0.05, 'tasks', 820);
    frame(ctx, t, t0(2) + 0.8, t1(3) + 0.3, P.x(36), P.y(1250), P.x(710) - P.x(36), P.y(1438) - P.y(1250), GOLD);
    if (t > t0(3) - 0.1) {
      T.stamp(ctx, t, t0(3) + 0.2, t1(3) + 0.3, '2 СМЕРТИ', CX - 170, 330, { size: 96, color: RED, rot: -0.08, bg: 'rgba(30,8,10,0.92)' });
      T.stamp(ctx, t, t0(3) + 0.8, t1(3) + 0.3, 'НЕ ВЫШЛО', CX + 200, 470, { size: 84, color: RED, rot: 0.07, bg: 'rgba(30,8,10,0.92)' });
    }
    T.botTag(ctx, t, t0(2) + 0.4, t1(3) + 0.2, 1330, null);
    caption(ctx, 'Бот *помнит задачу* с прошлого разбора', t, t0(2), t1(2) + 0.1, { y: 1560, size: 70 });
    caption(ctx, 'Итог — *две*. Не вышло', t, t0(3), t1(3) + 0.2, { y: 1560, size: 84, hl: RED });
  } else if (t < t0(5) - 0.1) {
    // brother
    const cut = t0(4) - 0.1;
    M.shake(ctx, t * 2, (t0(4) + 1.2) * 2, 12);
    cam(ctx, t, cut, 1.3, 540, 1060);
    set(ctx, t); gosha(ctx, t, { X: t > t0(4) + 1.1 ? T.EXPR.angry : T.EXPR.neutral, pose: 'phone', lookY: -0.6, blush: t > t0(4) + 1.1 ? 1 : 0 }); desk(ctx, t);
    ctx.restore();
    T.notif(ctx, t, t0(4) + 0.1, t1(4) + 0.5, { app: 'TELEGRAM', who: 'Брат', body: 'Комп, считай, мой. Уже выбираю, куда поставить', icon: '#2aa3e0', y: 420 });
    caption(ctx, 'А *брат* уже пишет', t, t0(4), t1(4) + 0.15);
  } else if (t < t0(6) - 0.1) {
    // doesn't give up
    const cut = t0(5) - 0.1;
    cam(ctx, t, cut, 1.2, 540, 1040);
    set(ctx, t);
    T.burst(ctx, 540, 900, t, 0.55 * pt(t, cut, cut + 0.3));
    gosha(ctx, t, { X: T.EXPR.determined, pose: 'fist', fistK: E.outBack(pt(t, cut + 0.1, cut + 0.5)) }); desk(ctx, t);
    ctx.restore();
    caption(ctx, 'Гоша *не сдаётся*', t, t0(5), t0(5) + 1.15);
    caption(ctx, 'и спрашивает *тренера* в боте', t, t0(5) + 1.2, t1(5) + 0.15);
  } else if (t < t0(8) - 0.1) {
    // the coach chat: question, answer
    hudOn = false; ctx.restore();
    darkBg(ctx, t, '255,201,74');
    const P = panel(ctx, t, t0(6) - 0.1, 'chat', 800);
    frame(ctx, t, t0(6) + 0.2, t1(6) + 0.2, P.x(296), P.y(664), P.x(714) - P.x(296), P.y(764) - P.y(664), GOLD);
    frame(ctx, t, t0(7) + 0.1, t1(7) + 0.3, P.x(66), P.y(774), P.x(636) - P.x(66), P.y(956) - P.y(774), TEAL);
    T.stamp(ctx, t, t0(6) + 0.3, t1(7) + 0.3, 'СПРОСИ ТРЕНЕРА', CX, 250, { size: 80, color: GOLD, rot: -0.05, bg: 'rgba(24,18,6,0.92)' });
    caption(ctx, '«Что делать против *Тайни*?»', t, t0(6), t1(6) + 0.1, { y: 1640, size: 72 });
    caption(ctx, 'Держи *дистанцию* и ставь *обс* перед дракой', t, t0(7), t1(7) + 0.2, { y: 1640, size: 66, hl: TEAL });
  } else if (t < t0(9) - 0.1) {
    // new task for the next game
    hudOn = false; ctx.restore();
    darkBg(ctx, t);
    const P = panel(ctx, t, t0(8) - 0.1, 'tasks', 820);
    frame(ctx, t, t0(8) + 0.6, t1(8) + 0.3, P.x(30), P.y(1462), P.x(716) - P.x(30), P.y(1650) - P.y(1462), GOLD);
    T.stamp(ctx, t, t0(8) + 0.9, t1(8) + 0.3, 'НОВАЯ ЗАДАЧА', CX, 330, { size: 92, color: GOLD, rot: -0.06, bg: 'rgba(24,18,6,0.92)' });
    caption(ctx, '*Форс Стафф* к 32 минуте', t, t0(8) + 2.8, t1(8) + 0.2, { y: 1560, size: 76 });
  } else if (t < t0(10) - 0.1) {
    // like a real coach
    const cut = t0(9) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.15 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.proud, pose: 'keys', dy: 120 }); desk(ctx, t);
    ctx.restore();
    T.burst(ctx, CX, 640, t, 0.6);
    T.stamp(ctx, t, t0(9) + 0.3, t1(9) + 0.3, 'КАЖДУЮ КАТКУ', CX, 560, { size: 96, color: GREEN, rot: -0.06, bg: 'rgba(6,26,16,0.92)' });
    caption(ctx, 'Бот ведёт его *как настоящий тренер*', t, t0(9), t1(9) + 0.15, { y: H * 0.72, size: 82 });
  } else if (t < t0(12) - 0.1) {
    // CTA: your match, first one free
    hudOn = false; ctx.restore();
    darkBg(ctx, t, '255,201,74');
    const P = panel(ctx, t, t0(10) - 0.1, 'home', 760, 900);
    tap(ctx, t, t0(10) + 1.6, P.x(595), P.y(684));
    tap(ctx, t, t0(10) + 2.1, P.x(595), P.y(684));
    T.stamp(ctx, t, t0(10) + 0.3, t1(10) + 0.1, 'А ТВОЯ КАТКА?', CX, 240, { size: 90, color: GOLD, rot: -0.05, bg: 'rgba(24,18,6,0.92)' });
    if (t > t0(11) - 0.1) {
      T.stamp(ctx, t, t0(11) + 0.1, ST.duration, 'ПЕРВАЯ — БЕСПЛАТНО', CX, 260, { size: 84, color: GREEN, rot: -0.05, bg: 'rgba(6,26,16,0.94)' });
      T.confetti(ctx, t, t0(11) + 0.2, CX, 300, 60);
    }
    T.botTag(ctx, t, t0(10) + 0.5, ST.duration, 1340, 'кинь номер катки');
    caption(ctx, 'Кинь номер *своей катки*', t, t0(10), t1(10) + 0.1, { y: 1600, size: 84 });
    caption(ctx, '*Полный разбор* первой катки бесплатно', t, t0(11), t1(11) + 0.2, { y: 1600, size: 76, hl: GREEN });
  } else {
    const cut = t0(12) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true, dy: 120 }); desk(ctx, t);
    ctx.restore();
    miniNotes(ctx, t, cut + 0.1);
    caption(ctx, 'Гоша идёт в *следующую*', t, t0(12), t0(12) + 1.9, { y: H * 0.72 });
    caption(ctx, 'Подпишись на *день 4*', t, t0(12) + 2.0, ST.duration, { y: H * 0.72, size: 100 });
    T.botTag(ctx, t, t0(12) + 0.6, ST.duration, 1560, 'первая катка бесплатно');
  }
  if (hudOn) T.hud(ctx, t, 0.3, { day: 3, of: 30, label: 'СТРАЖ → ЛЕГЕНДА', pct: 6 + 3 * E.outCubic(pt(t, t0(9), t0(9) + 1)) });
}

const HITS = [];
M.film({
  fonts: [font(100, 900, T.D), font(40, 700, T.UI), font(40, 800, T.UI), font(40, 600, T.UI)],
  samples: 4, hits: HITS,
  async init() {
    ST = await T.loadStory();
    await Promise.all(['coach', 'chat', 'home'].map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = res; im.src = `../common/assets/app_${n}.png`; })));
    const b = (s) => s * 2;
    const P = ST.phrases;
    HITS.push(
      [b(P[0].t0), 'день 3', 'impact'], [b(0.3), 'hud', 'click'],
      [b(P[1].t0 - 0.1), 'cut', 'whoosh'], [b(P[1].t0 + 0.9), 'n1', 'pop', { pitch: 'C6' }], [b(P[1].t0 + 1.05), 'n2', 'pop', { pitch: 'E6' }], [b(P[1].t0 + 1.2), 'n3', 'pop', { pitch: 'G6' }],
      [b(P[2].t0 - 0.05), 'panel', 'whoosh'], [b(P[2].t0 + 0.4), 'bot', 'bell', { pitch: 'B5' }], [b(P[2].t0 + 0.8), 'frame', 'tok', { pitch: 'G5' }],
      [b(P[3].t0 + 0.2), '2', 'thud'], [b(P[3].t0 + 0.8), 'не вышло', 'impact'],
      [b(P[4].t0 + 0.1), 'notif', 'blip', { pitch: 'A6' }], [b(P[4].t0 + 1.1), 'angry', 'boing'],
      [b(P[5].t0 - 0.1), 'fist', 'whoosh'],
      [b(P[6].t0 - 0.1), 'chat', 'whoosh'], [b(P[6].t0 + 0.2), 'q', 'pop', { pitch: 'E6' }], [b(P[6].t0 + 0.3), 'спроси', 'thud'], [b(P[7].t0 + 0.1), 'a', 'pop', { pitch: 'A6' }],
      [b(P[8].t0 - 0.1), 'panel', 'whoosh'], [b(P[8].t0 + 0.6), 'frame', 'tok', { pitch: 'B5' }], [b(P[8].t0 + 0.9), 'задача', 'impact'],
      [b(P[9].t0 - 0.1), 'cut', 'whoosh'], [b(P[9].t0 + 0.3), 'каждую', 'thud'],
      [b(P[10].t0 - 0.1), 'home', 'whoosh'], [b(P[10].t0 + 0.3), 'твоя', 'impact'], [b(P[10].t0 + 1.6), 'tap', 'click'], [b(P[10].t0 + 2.1), 'tap', 'click'],
      [b(P[11].t0 + 0.1), 'free', 'impact'], [b(P[11].t0 + 0.2), 'conf', 'bell', { pitch: 'C7' }],
      [b(P[12].t0 - 0.1), 'cut', 'whoosh'], [b(P[12].t0 + 0.6), 'tag', 'bell', { pitch: 'E6' }],
    );
  },
  draw(ctx, u, t) { draw(ctx, u, t); },
  post(ctx, u, t) { T.vignette(ctx, 0.45); T.grain(ctx, t, 0.03); },
});
