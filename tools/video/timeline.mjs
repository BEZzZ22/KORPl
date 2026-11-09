// Видеоразбор, шаг 4: раскадровка. Сценарий + длительности озвучки → film.json, по которому страница film/ рисует кадры.
// Всё время в секундах ролика; у момента ещё «игровое» время (секунды матча) и таблица warp: как игровое время
// течёт по экрану — быстро на подходе, медленно вокруг убийств, стоп-кадр на совете.
import { createView, roshanPit } from "./moments.mjs";

export const FPS = 30, W = 1080, H = 1920;
const CHAR_RATE = 15.5;          // знаков в секунду у диктора: оценка, если озвучки нет
const TRAIL = 8;                 // сколько секунд игры хвост героя до начала окна
const round = (x, k = 1000) => Math.round(x * k) / k;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// предметы, нажатие которых подписываем в драке
const CALLOUT = { black_king_bar: "БКБ", refresher: "Рефрешер", satanic: "Сатаник", manta: "Манта", glimmer_cape: "Глиммер", invis_sword: "Инвиз",
  silver_edge: "Сильвер", abyssal_blade: "Абиссал", sheepstick: "Хекс", cyclone: "Еул", wind_waker: "Винд вейкер", force_staff: "Форс",
  hurricane_pike: "Пика", ghost: "Гост", lotus_orb: "Лотус", shivas_guard: "Шива", bloodthorn: "Блудторн", orchid: "Орчид", nullifier: "Нуллифаер",
  blade_mail: "Блейдмейл", ethereal_blade: "Эзериал", blink: "Блинк", overwhelming_blink: "Блинк", swift_blink: "Блинк", arcane_blink: "Блинк",
  sphere: "Линка", guardian_greaves: "Гривы", mekansm: "Мека", pipe: "Пайп", crimson_guard: "Кримсон", heavens_halberd: "Алебарда", rod_of_atos: "Атос", gungir: "Глейпнир" };
export const estimate = (say) => Math.max(0.9, say.length / CHAR_RATE);

// скорость игры по экрану: 1 вдали от ключевых секунд, проседает до slow рядом с ними
function buildWarp(g0, g1, keys, playDur, hold, lead) {
  const N = 240, weight = [];
  for (let i = 0; i < N; i++) {
    const g = g0 + ((i + 0.5) / N) * (g1 - g0);
    let dip = 0;
    for (const k of keys) dip = Math.max(dip, Math.exp(-(((g - k + 0.6) / 2.6) ** 2)));
    weight.push(1 + dip * 3.2); // у ключа игра идёт в 4.2 раза медленнее, чем на подходе
  }
  const total = weight.reduce((a, b) => a + b, 0);
  const pts = [[0, g0], [round(lead), g0]];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += weight[i];
    if ((i + 1) % 6 === 0 || i === N - 1) pts.push([round(lead + (acc / total) * playDur), round(g0 + ((i + 1) / N) * (g1 - g0))]);
  }
  pts.push([round(lead + playDur + hold), g1]);
  return pts;
}
export function warpAt(warp, s) {
  if (s <= warp[0][0]) return warp[0][1];
  for (let i = 1; i < warp.length; i++) {
    if (s <= warp[i][0]) {
      const [s0, a] = warp[i - 1], [s1, b] = warp[i];
      return s1 === s0 ? b : a + ((s - s0) / (s1 - s0)) * (b - a);
    }
  }
  return warp[warp.length - 1][1];
}
// обратно: в какую секунду сегмента на экране наступает игровая секунда g
export function warpInv(warp, g) {
  for (let i = 1; i < warp.length; i++) {
    const [s0, a] = warp[i - 1], [s1, b] = warp[i];
    if (b > a && g <= b) return s0 + ((Math.max(a, g) - a) / (b - a)) * (s1 - s0);
  }
  return warp[warp.length - 1][0];
}

// durations: [сегмент][фраза] секунд озвучки (null — нет, берём оценку)
export function buildTimeline(data, found, script, durations = null) {
  const view = createView(data);
  const me = found.me, T = found.team;
  const film = { v: 1, W, H, fps: FPS, me, team: T, match_id: data.match_id,
    players: data.players.map((p) => ({ slot: p.slot, team: p.team, key: p.key, ru: p.ru, hero: p.hero })),
    match: { won: data.winner === T, minutes: Math.round(data.duration / 60), k: data.players[me].k, d: data.players[me].d, a: data.players[me].a ?? 0,
      score: [data.kills.filter((k) => k.v >= 5).length, data.kills.filter((k) => k.v < 5).length] },
    // все убийства катки для заставки: [доля времени матча, x, y, команда жертвы, это я]
    all_kills: data.kills.filter((k) => k.x !== null).map((k) => [round(clamp(k.t / data.end, 0, 1)), round(k.x / 10 - 64, 10), round(192 - k.y / 10, 10), k.v < 5 ? 0 : 1, k.v === me ? 1 : 0]),
    segs: [], vo: [] };
  // перевес по золоту глазами игрока, шаг 30 с: [доля времени матча, тысячи золота]
  film.adv = [];
  for (let g = 0; g <= data.end; g += 30) film.adv.push([round(g / data.end), round((view.teamNw(T, g) - view.teamNw(1 - T, g)) / 1000, 10)]);
  film.pins = found.moments.map((m) => [round(clamp(m.t / data.end, 0, 1)), m.type === "highlight" ? 1 : 0]);
  let t = 0;
  const place = (seg, si, lead, gap, tail, minDur) => {
    let s = lead;
    const lines = seg.lines.map((l, li) => {
      const real = durations && durations[si] ? durations[si][li] : null;
      const dur = real || estimate(l.say);
      const line = { text: l.text, t0: round(s), t1: round(s + dur), role: l.role || null };
      if (real) film.vo.push({ seg: si, line: li, t: round(t + s) });
      s += dur + gap;
      return line;
    });
    const dur = Math.max(minDur, s - gap + tail);
    return { lines, dur: Math.ceil(dur * FPS) / FPS };
  };

  script.segments.forEach((seg, si) => {
    if (seg.kind === "intro") {
      const { lines, dur } = place(seg, si, 0.55, 0.22, 0.45, 4.2);
      film.segs.push({ kind: "intro", t0: round(t), t1: round(t + dur), lines, hero: seg.hero, kda: seg.kda, won: seg.won, n: found.moments.length });
      t += dur;
      return;
    }
    if (seg.kind === "outro") {
      const { lines, dur } = place(seg, si, 0.5, 0.3, 1.7, 5);
      film.segs.push({ kind: "outro", t0: round(t), t1: round(t + dur), lines,
        recap: script.segments.filter((x) => x.kind === "moment").map((x) => ({ title: x.title, clock: x.clock, good: x.good })) });
      t += dur;
      return;
    }
    const m = found.moments[seg.index];
    const { lines, dur } = place(seg, si, 1.15, 0.26, 0.7, 7);
    const tip = lines[lines.length - 1];
    // игра идёт от заставки момента до начала совета, на совете — стоп-кадр
    const lead = 0.75, hold = Math.max(1.2, dur - tip.t0 + 0.15), playDur = Math.max(2.5, dur - lead - hold);
    const g0 = m.a, g1 = m.b;
    const keys = m.type === "no_objective" ? [] : (m.kills.length ? m.kills.map((k) => k.t) : [m.t]).filter((k) => k >= g0 && k <= g1);
    const warp = buildWarp(g0, g1, keys, playDur, hold, lead);

    // кого показываем: участники момента, остальные — бледно
    const actors = [...new Set(m.actors)];
    const tr0 = g0 - TRAIL, n = g1 - tr0 + 1;
    const track = [];
    for (let s = 0; s < 10; s++) {
      const row = new Array(n);
      for (let i = 0; i < n; i++) { const p = view.P(s, tr0 + i); row[i] = p ? [round(p[0], 10), round(p[1], 10)] : null; }
      track.push(row);
    }
    // камера: центр — там, где убивают, рамка — вокруг участников рядом в ключевые секунды.
    // Тех, кто далеко (бежит с базы, фармит), в рамку не тянем: иначе действие уезжает на край кадра
    const killPts = m.kills.map(view.mapXY).filter(Boolean);
    const anchor = m.type === "death" || !killPts.length ? m.center
      : [killPts.reduce((a, p) => a + p[0], 0) / killPts.length, killPts.reduce((a, p) => a + p[1], 0) / killPts.length];
    const span = m.type === "no_objective" ? [g0, g0 + 6] : [Math.max(g0, m.t - 6), Math.min(g1, (m.kills.length ? m.kills[m.kills.length - 1].t : m.t) + 1)];
    const reach = m.type === "rosh_lost" ? 60 : 24;
    const pts = [anchor, ...killPts];
    for (const s of actors) for (let g = span[0]; g <= span[1]; g += 1) { const p = view.P(s, g); if (p && Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) <= reach) pts.push(p); }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    // центр рамки тянем к месту убийств, чтобы оно не оказалось у края
    let c = [((Math.min(...xs) + Math.max(...xs)) / 2 + anchor[0]) / 2, ((Math.min(...ys) + Math.max(...ys)) / 2 + anchor[1]) / 2];
    let r = Math.max(...pts.map((p) => Math.max(Math.abs(p[0] - c[0]), Math.abs(p[1] - c[1]) * 0.55))) + 4.5;
    r = clamp(r, 11, m.type === "rosh_lost" ? 44 : 24);
    c = [clamp(c[0], 4, 124), clamp(c[1], 4, 124)];
    let cam = [{ u: 0, c, r: Math.min(60, r * 1.75) }, { u: 0.55, c, r }, { u: 1, c, r: r * 0.94 }];
    if (m.type === "no_objective") cam = [{ u: 0, c, r: Math.min(30, r * 1.3) }, { u: 0.22, c, r }, { u: 1, c: [64, 64], r: 62 }];

    const inWin = (x) => x >= g0 - 1 && x <= g1 + 1;
    const kills = data.kills.filter((k) => inWin(k.t) && k.x !== null).map((k) => {
      const at = view.mapXY(k);
      return { t: k.t, s: round(warpInv(warp, k.t)), v: k.v, k: k.k, x: round(at[0], 10), y: round(at[1], 10) };
    });
    const dmg = data.dmg.filter((d) => d[0] >= g0 && d[0] <= g1 && d[1] >= 0 && d[1] !== d[2] && (d[1] < 5) !== (d[2] < 5));
    const wards = data.wards.filter((w) => w.kind === "obs" && w.t <= g1 && (w.t1 ?? w.t + 360) >= g0)
      .map((w) => { const p = view.wardXY(w); return { team: view.teamOf(w.slot), x: round(p[0], 10), y: round(p[1], 10), t: w.t, t1: w.t1 ?? w.t + 360 }; });
    const buildings = data.buildings.filter((b) => b.t <= g1 + 1).map((b) => ({ n: b.n, t: b.t }));
    // громкие предметы участников: подпись над фишкой в момент нажатия
    const seenCast = new Set();
    const casts = data.items.filter((c) => c[0] >= g0 && c[0] <= g1 && actors.includes(c[1]) && CALLOUT[c[2]])
      .filter((c) => { const k = `${c[1]}:${CALLOUT[c[2]]}`; if (seenCast.has(k)) return false; seenCast.add(k); return true; })
      .map((c) => ({ s: round(warpInv(warp, c[0])), slot: c[1], label: CALLOUT[c[2]] }));
    // урон по игроку: по игровой секунде, для всплывающих цифр
    const hitMap = new Map();
    for (const d of data.dmg) if (d[2] === me && d[1] !== me && d[0] >= g0 && d[0] <= g1) hitMap.set(d[0], (hitMap.get(d[0]) || 0) + d[3]);
    const hits = [...hitMap].filter(([, v]) => v >= 60).map(([g, v]) => [g, Math.round(v)]);
    const f = m.facts, marks = {};
    if (m.type === "death") {
      marks.victim = me; marks.attackers = f.attackers;
      // ближайший живой союзник за 3 с до смерти: линия «до своих далеко»
      const at = m.center; let best = null;
      for (const s of view.mates(T)) { if (s === me) continue; const p = view.P(s, m.t - 3); if (p) { const d = Math.hypot(p[0] - at[0], p[1] - at[1]); if (!best || d < best.d) best = { slot: s, d: Math.round(d * 128 / 100) * 100 }; } }
      if (best && f.allies_near === 0) marks.ally = best;
      if (f.enemy_obs) marks.enemy_obs = [round(f.enemy_obs.x, 10), round(f.enemy_obs.y, 10)];
    }
    if (m.type === "rosh_lost" || (m.type === "no_objective" && f.rosh_up)) marks.pit = f.pit || roshanPit(m.t);
    if (m.type === "fight_lost" || m.type === "highlight" || m.type === "no_objective") marks.score = [f.dead_them, f.dead_us];
    film.segs.push({ kind: "moment", t0: round(t), t1: round(t + dur), index: seg.index, type: seg.type, sub: seg.sub, good: seg.good, title: seg.title, clock: seg.clock,
      lines, chips: seg.chips, g0, g1, key: m.t, warp, cam, actors, track: { t0: tr0, pos: track }, kills, dmg, wards, buildings, marks, casts, hits });
    t += dur;
  });
  film.duration = round(t);
  film.frames = Math.round(t * FPS);
  film.moments = found.moments.length;
  return film;
}
