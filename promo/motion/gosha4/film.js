// «Гоша. 30 дней до Легенды», серия 4: перед каткой Гоша открывает «Драфт перед игрой», бот подсказывает
// контрпик и сборку и сравнивает прошлую сборку с про (Magic Wand в 20:05 против 8:36). Вопрос в комменты:
// успеет ли Force Staff к 32-й. Новый голос рассказчика (common/voice). Экраны настоящие.
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
  draft: ['draft', [0, 40, 780, 660]],
  counter: ['draft', [24, 990, 732, 540]],
  build: ['build', [20, 1300, 740, 400]],
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
    set(ctx, t, { clock: true }); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys' }); desk(ctx, t);
    ctx.restore();
    miniNotes(ctx, t, 0.2);
    caption(ctx, '*День 4*', t, t0(0), t1(0) + 0.2, { size: 150, y: H * 0.68 });
  } else if (t < t0(2) - 0.1) {
    // not straight into the queue
    const cut = t0(1) - 0.1;
    cam(ctx, t, cut, 1.3, 540, 1060);
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.sly, pose: 'phone', lookY: 0.4 }); desk(ctx, t);
    ctx.restore();
    T.stamp(ctx, t, t0(1) + 0.4, t1(1) + 0.2, 'НЕ В ПОИСК', CX, 560, { size: 100, color: RED, rot: -0.07, bg: 'rgba(30,8,10,0.92)' });
    caption(ctx, 'Перед каткой — *не сразу в поиск*', t, t0(1), t1(1) + 0.15, { size: 82 });
  } else if (t < t0(5) - 0.1) {
    // draft before the game: enemies, then counterpicks
    hudOn = false; ctx.restore();
    darkBg(ctx, t);
    const toCounter = t > t0(4) - 0.1;
    if (!toCounter) {
      const P = panel(ctx, t, t0(2) - 0.05, 'draft', 760);
      frame(ctx, t, t0(3), t1(3) + 0.2, P.x(66), P.y(452), P.x(456) - P.x(66), P.y(528) - P.y(452), RED);
      tap(ctx, t, t1(3) + 0.05, P.x(390), P.y(630));
      T.stamp(ctx, t, t0(2) + 0.4, t1(3) + 0.2, 'ДРАФТ ПЕРЕД ИГРОЙ', CX, 230, { size: 76, color: GOLD, rot: -0.05, bg: 'rgba(24,18,6,0.92)' });
      caption(ctx, 'Открывает *Драфт перед игрой*', t, t0(2), t1(2) + 0.1, { y: 1560, size: 72 });
      caption(ctx, 'У врагов *Тайни, Клинкз, Энигма*', t, t0(3), t1(3) + 0.15, { y: 1560, size: 72, hl: RED });
    } else {
      const P = panel(ctx, t, t0(4) - 0.1, 'counter', 820);
      frame(ctx, t, t0(4) + 0.5, t1(4) + 0.2, P.x(40), P.y(1110), P.x(740) - P.x(40), P.y(1500) - P.y(1110), GREEN);
      T.stamp(ctx, t, t0(4) + 0.3, t1(4) + 0.2, 'КОНТРПИК', CX, 300, { size: 100, color: GREEN, rot: -0.06, bg: 'rgba(6,26,16,0.92)' });
      caption(ctx, 'Бот подсказывает *контрпик* и сборку', t, t0(4), t1(4) + 0.15, { y: 1560, size: 72, hl: GREEN });
    }
    T.botTag(ctx, t, t0(2) + 0.6, t1(4) + 0.2, 1360, null);
  } else if (t < t0(7) - 0.1) {
    // build vs pros: Magic Wand 20:05 vs 8:36
    hudOn = false; ctx.restore();
    darkBg(ctx, t, '255,201,74');
    const P = panel(ctx, t, t0(5) - 0.1, 'build', 820);
    frame(ctx, t, t0(6), t1(6) + 0.2, P.x(36), P.y(1384), P.x(756) - P.x(36), P.y(1528) - P.y(1384), GOLD);
    T.stamp(ctx, t, t0(5) + 0.3, t1(5) + 0.2, 'СБОРКА VS ПРО', CX, 360, { size: 92, color: GOLD, rot: -0.05, bg: 'rgba(24,18,6,0.92)' });
    if (t > t0(6) - 0.1) {
      T.stamp(ctx, t, t0(6) + 0.3, t1(6) + 0.2, 'ГОША 20:05', CX - 200, 330, { size: 74, color: RED, rot: -0.07, bg: 'rgba(30,8,10,0.92)' });
      T.stamp(ctx, t, t0(6) + 3.0, t1(6) + 0.2, 'ПРО 8:36', CX + 220, 470, { size: 74, color: GREEN, rot: 0.06, bg: 'rgba(6,26,16,0.92)' });
    }
    caption(ctx, 'Сравнил сборку с *про-игроками*', t, t0(5), t1(5) + 0.1, { y: 1520, size: 72 });
    caption(ctx, '*Мэджик Ванд* на 20-й. Про — к 9-й', t, t0(6), t1(6) + 0.2, { y: 1520, size: 70 });
  } else if (t < t0(8) - 0.1) {
    // brother
    const cut = t0(7) - 0.1;
    M.shake(ctx, t * 2, (t0(7) + 1.4) * 2, 10);
    cam(ctx, t, cut, 1.3, 540, 1060);
    set(ctx, t); gosha(ctx, t, { X: t > t0(7) + 1.4 ? T.EXPR.angry : T.EXPR.neutral, pose: 'phone', lookY: -0.6, blush: t > t0(7) + 1.4 ? 1 : 0 }); desk(ctx, t);
    ctx.restore();
    T.notif(ctx, t, t0(7) + 0.05, t1(7) + 0.5, { app: 'TELEGRAM', who: 'Брат', body: 'Гайды читаешь? Поздно. Я уже коврик под твою мышку купил', icon: '#2aa3e0', y: 420 });
    caption(ctx, '*Брат* опять пишет', t, t0(7), t1(7) + 0.15);
  } else if (t < t0(10) - 0.1) {
    // the task + the question
    const cut = t0(8) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.15 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true, dy: 120 }); desk(ctx, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(8,10,18,0.35)'; ctx.fillRect(0, 0, W, H);
    T.burst(ctx, CX, 620, t, 0.5);
    T.stamp(ctx, t, t0(8) + 0.2, ST.duration, 'ЗАДАЧА', CX, 470, { size: 80, color: GOLD, rot: -0.05, bg: 'rgba(24,18,6,0.92)' });
    T.stamp(ctx, t, t0(8) + 0.9, ST.duration, 'FORCE STAFF К 32:00', CX, 640, { size: 78, color: '#fff', rot: 0.03, bg: 'rgba(15,15,24,0.94)' });
    if (t > t0(9) - 0.1) {
      T.stamp(ctx, t, t0(9) + 0.2, ST.duration, 'ДА', CX - 200, 860, { size: 120, color: GREEN, rot: -0.1, bg: 'rgba(6,26,16,0.92)' });
      T.stamp(ctx, t, t0(9) + 0.45, ST.duration, 'НЕТ', CX + 200, 860, { size: 120, color: RED, rot: 0.1, bg: 'rgba(30,8,10,0.92)' });
    }
    caption(ctx, 'Задача прежняя: *Форс Стафф* к 32-й', t, t0(8), t1(8) + 0.1, { y: H * 0.74, size: 76 });
    caption(ctx, 'Успеет? Пиши *да* или *нет*', t, t0(9), t1(9) + 0.2, { y: H * 0.74, size: 90 });
  } else if (t < t0(11) - 0.1) {
    // CTA
    hudOn = false; ctx.restore();
    darkBg(ctx, t, '255,201,74');
    const P = panel(ctx, t, t0(10) - 0.1, 'home', 760, 900);
    tap(ctx, t, t0(10) + 1.2, P.x(595), P.y(684));
    T.stamp(ctx, t, t0(10) + 0.2, t1(10) + 0.2, 'А ТВОЯ КАТКА?', CX, 240, { size: 90, color: GOLD, rot: -0.05, bg: 'rgba(24,18,6,0.92)' });
    T.botTag(ctx, t, t0(10) + 0.4, t1(10) + 0.3, 1340, 'первая катка бесплатно');
    caption(ctx, 'Кинь *свою катку*', t, t0(10), t0(10) + 2.0, { y: 1600, size: 90 });
    caption(ctx, '*Первая* — полный разбор *бесплатно*', t, t0(10) + 2.1, t1(10) + 0.2, { y: 1600, size: 76, hl: GREEN });
    if (t > t0(10) + 2.1) T.confetti(ctx, t, t0(10) + 2.2, CX, 300, 60);
  } else {
    const cut = t0(11) - 0.1;
    cam(ctx, t, cut, 1.0, 540, 1150, { punch: 1.1 });
    set(ctx, t); gosha(ctx, t, { X: T.EXPR.determined, pose: 'keys', typing: true, dy: 120 }); desk(ctx, t);
    ctx.restore();
    miniNotes(ctx, t, cut + 0.1);
    caption(ctx, 'Подпишись на *день 5*', t, t0(11), ST.duration, { y: H * 0.72, size: 100 });
    T.botTag(ctx, t, t0(11) + 0.5, ST.duration, 1560, 'первая катка бесплатно');
  }
  if (hudOn) T.hud(ctx, t, 0.3, { day: 4, of: 30, label: 'СТРАЖ → ЛЕГЕНДА', pct: 9 });
}

const HITS = [];
M.film({
  fonts: [font(100, 900, T.D), font(40, 700, T.UI), font(40, 800, T.UI), font(40, 600, T.UI)],
  samples: 4, hits: HITS,
  async init() {
    ST = await T.loadStory();
    await Promise.all(['draft', 'build', 'home'].map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = res; im.src = `../common/assets/app_${n}.png`; })));
    const b = (s) => s * 2;
    const P = ST.phrases;
    HITS.push(
      [b(P[0].t0), 'день 4', 'impact'], [b(0.2), 'notes', 'pop', { pitch: 'C6' }],
      [b(P[1].t0 - 0.1), 'cut', 'whoosh'], [b(P[1].t0 + 0.4), 'не в поиск', 'impact'],
      [b(P[2].t0 - 0.05), 'panel', 'whoosh'], [b(P[2].t0 + 0.4), 'драфт', 'thud'], [b(P[2].t0 + 0.6), 'bot', 'bell', { pitch: 'B5' }],
      [b(P[3].t0), 'enemies', 'tok', { pitch: 'G5' }], [b(P[3].t1 + 0.05), 'tap', 'click'],
      [b(P[4].t0 - 0.1), 'panel', 'whoosh'], [b(P[4].t0 + 0.3), 'контрпик', 'impact'],
      [b(P[5].t0 - 0.1), 'panel', 'whoosh'], [b(P[5].t0 + 0.3), 'vs', 'thud'],
      [b(P[6].t0 + 0.3), '20', 'thud'], [b(P[6].t0 + 3.0), '8', 'bell', { pitch: 'E6' }],
      [b(P[7].t0 + 0.05), 'notif', 'blip', { pitch: 'A6' }], [b(P[7].t0 + 1.4), 'angry', 'boing'],
      [b(P[8].t0 - 0.1), 'cut', 'whoosh'], [b(P[8].t0 + 0.2), 'задача', 'impact'], [b(P[8].t0 + 0.9), 'force', 'thud'],
      [b(P[9].t0 + 0.2), 'да', 'pop', { pitch: 'C6' }], [b(P[9].t0 + 0.45), 'нет', 'pop', { pitch: 'G5' }],
      [b(P[10].t0 - 0.1), 'home', 'whoosh'], [b(P[10].t0 + 0.2), 'твоя', 'impact'], [b(P[10].t0 + 1.2), 'tap', 'click'], [b(P[10].t0 + 1.8), 'conf', 'bell', { pitch: 'C7' }],
      [b(P[11].t0 - 0.1), 'cut', 'whoosh'], [b(P[11].t0 + 0.5), 'tag', 'bell', { pitch: 'E6' }],
    );
  },
  draw(ctx, u, t) { draw(ctx, u, t); },
  post(ctx, u, t) { T.vignette(ctx, 0.45); T.grain(ctx, t, 0.03); },
});
