// Видеоразбор, шаг 2: выбор ключевых моментов катки. Только правила и арифметика, никаких нейросетей.
// Вход — данные из extract.mjs и слот игрока (0..9), для которого делается ролик.
// Выход — 3–5 моментов по времени: что случилось, почему, чем кончилось. Тексты из них собирает script.mjs.
//
// Координаты внутри модуля — «карта»: x вправо 0..128, y вниз 0..128 (как SVG-карта приложения, dotamap.js).
// База Света слева внизу, Тьмы — справа вверху.

const NEAR = 14;        // «рядом»: ~1800 единиц, дистанция, с которой успевают помочь
const FIGHT_R = 24;     // радиус драки
const OBS_VISION = 12.5; // обзор обса 1600 единиц
const OBS_LIFE = 360;
// логова Рошана и когда он где (как в dotamap.js)
const ROSH_PITS = [[38.5, 44.5], [85.5, 85]];
export const roshanPit = (t) => (Math.floor(Math.max(0, t) / 300) % 2 === 0 ? ROSH_PITS[0] : ROSH_PITS[1]);
const RAX = /rax/, FORT = /fort$/;

export function createView(data) {
  const { start, end, pos } = data;
  const idx = (t) => Math.max(0, Math.min(end - start, Math.round(t) - start));
  const P = (slot, t) => {
    const p = pos[slot][idx(t)];
    return p ? [p[0] / 10 - 64, 192 - p[1] / 10] : null;
  };
  // последнее место, где герой был жив (для мёртвых — где умер)
  const lastP = (slot, t) => {
    for (let k = 0; k < 40; k++) { const p = P(slot, t - k); if (p) return p; }
    return null;
  };
  const alive = (slot, t) => Boolean(pos[slot][idx(t)]);
  const teamOf = (slot) => (slot < 5 ? 0 : 1);
  const mates = (team) => (team === 0 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]);
  const nwAt = (slot, t) => data.nw[slot][Math.max(0, Math.min(data.nw[slot].length - 1, Math.floor((t - start) / data.nw_step)))];
  const teamNw = (team, t) => mates(team).reduce((s, x) => s + nwAt(x, t), 0);
  const lvlAt = (slot, t) => data.lvl[slot][Math.max(0, Math.min(data.lvl[slot].length - 1, Math.floor((t - start) / data.nw_step)))];
  const mapXY = (k) => (k.x === null ? null : [k.x / 10 - 64, 192 - k.y / 10]);
  const wardXY = (w) => [w.x / 10 - 64, 192 - w.y / 10];
  const wardAlive = (w, t) => w.t <= t && t < (w.t1 ?? w.t + (w.kind === "obs" ? OBS_LIFE : 420));
  return { P, lastP, alive, teamOf, mates, nwAt, teamNw, lvlAt, mapXY, wardXY, wardAlive };
}

const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity);
const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
// насколько точка на чужой половине: >0 — у врага, <0 — у себя. Диагональ река, от −1 до 1
const depth = (p, team) => ((p[0] - p[1]) / 128) * (team === 0 ? 1 : -1);

// Драки: убийства подряд (пауза до 18 с) и недалеко друг от друга
export function findFights(data, view) {
  const fights = [];
  let cur = null;
  for (const k of data.kills) {
    const at = view.mapXY(k);
    if (!at) continue;
    if (cur && k.t - cur.t1 <= 18 && dist(at, cur.center) <= 40) {
      cur.kills.push(k); cur.t1 = k.t;
      cur.center = mean(cur.kills.map(view.mapXY));
    } else {
      cur = { t0: k.t, t1: k.t, kills: [k], center: at };
      fights.push(cur);
    }
  }
  for (const f of fights) {
    f.dead = [0, 0];
    for (const k of f.kills) f.dead[view.teamOf(k.v)]++;
    // перевес по золоту Света: до драки и после
    const before = view.teamNw(0, f.t0 - 15) - view.teamNw(1, f.t0 - 15);
    const after = view.teamNw(0, f.t1 + 20) - view.teamNw(1, f.t1 + 20);
    f.swing = after - before;
    f.buildings = data.buildings.filter((b) => b.t >= f.t0 && b.t <= f.t1 + 100);
    f.rosh = data.rosh.find((r) => r.t >= f.t0 && r.t <= f.t1 + 120) || null;
  }
  return fights;
}

function buildingWord(n) {
  if (FORT.test(n)) return "fort";
  if (RAX.test(n)) return "rax";
  return /tower4/.test(n) ? "t4" : /tower3/.test(n) ? "t3" : /tower2/.test(n) ? "t2" : "t1";
}
const laneOf = (n) => (/_top$/.test(n) ? "top" : /_mid$/.test(n) ? "mid" : /_bot$/.test(n) ? "bot" : null);
const buildingScore = (b) => ({ fort: 6, rax: 2.5, t4: 2, t3: 2, t2: 1.2, t1: 0.8 })[buildingWord(b.n)];
const lostBuildings = (list, team) => list.filter((b) => b.team === team).map((b) => ({ t: b.t, kind: buildingWord(b.n), lane: laneOf(b.n), n: b.n }));

export function findMoments(data, me, { max = 5 } = {}) {
  const view = createView(data);
  const { P, lastP, alive, teamOf, mates, wardXY, wardAlive } = view;
  const T = teamOf(me), E = 1 - T;
  const allies = mates(T).filter((s) => s !== me), enemies = mates(E);
  const fights = findFights(data, view);
  const late = (t) => (t > 1500 ? 1 : t > 900 ? 0.5 : 0);
  const obsNear = (team, at, t, r = OBS_VISION) => data.wards.filter((w) => w.kind === "obs" && teamOf(w.slot) === team && wardAlive(w, t) && dist(wardXY(w), at) <= r);
  const out = [];

  // --- 1. Проигранные драки ---
  for (const f of fights) {
    const total = f.dead[0] + f.dead[1], lost = f.dead[T] - f.dead[E];
    if (total < 3 || lost < 2) continue;
    const first = f.kills[0], firstAt = view.mapXY(first);
    const tPre = first.t - 4;
    const near = (list) => list.filter((s) => alive(s, tPre) && dist(P(s, tPre), firstAt) <= FIGHT_R);
    const ours = near(mates(T)), theirs = near(enemies);
    const myDeaths = f.kills.filter((k) => teamOf(k.v) === T);
    const meDied = myDeaths.find((k) => k.v === me) || null;
    // где я был всю драку: далеко и жив — драка прошла без меня
    let meMin = Infinity;
    for (let t = f.t0 - 4; t <= f.t1; t += 2) meMin = Math.min(meMin, dist(lastP(me, t), f.center));
    const absent = !meDied && meMin > 38;
    const spread = myDeaths.length >= 3 ? myDeaths[myDeaths.length - 1].t - myDeaths[0].t : 0;
    let sub = "generic";
    if (absent) sub = "absent";
    else if (theirs.length - ours.length >= 2) sub = "numbers";
    else if (meDied && first.v === me) sub = "first";
    else if (spread >= 12) sub = "one_by_one";
    const lostB = lostBuildings(f.buildings, T);
    const roshLost = f.rosh && f.rosh.team === E ? f.rosh : null;
    const swing = (T === 0 ? 1 : -1) * f.swing;
    const score = 3 + lost * 1.2 + Math.min(4, Math.max(0, -swing) / 1500) + lostB.reduce((s, b) => s + buildingScore(b), 0)
      + (roshLost ? 2 : 0) + late(f.t0) + (meDied ? 0.8 : 0) + (absent ? 0.5 : 0);
    out.push({ type: "fight_lost", sub, t: first.t, a: f.t0 - 10, b: Math.min(f.t1 + 3, f.t0 + 26), score,
      center: f.center, kills: f.kills, actors: [...new Set([...ours, ...theirs, ...f.kills.map((k) => k.v), ...f.kills.map((k) => k.k).filter((k) => k >= 0)])],
      facts: { dead_us: f.dead[T], dead_them: f.dead[E], ours: ours.length, theirs: theirs.length, absent, me_died: Boolean(meDied), me_first: Boolean(meDied && first.v === me),
        swing: Math.round(swing), buildings: lostB, rosh: Boolean(roshLost), spread, first_victim: first.v } });
  }

  // --- 2. Мои смерти: поймали одного, без вижна, под вардом, под смоком, выкуп впустую ---
  const myDeaths = data.kills.filter((k) => k.v === me);
  for (const k of myDeaths) {
    const at = view.mapXY(k);
    if (!at) continue;
    const attackers = [...new Set(data.dmg.filter((d) => d[2] === me && d[1] >= 0 && teamOf(d[1]) === E && d[0] >= k.t - 12 && d[0] <= k.t).map((d) => d[1]))];
    if (k.k >= 0 && teamOf(k.k) === E && !attackers.includes(k.k)) attackers.push(k.k);
    const tPre = k.t - 3;
    const alliesNear = allies.filter((s) => alive(s, tPre) && dist(P(s, tPre), at) <= NEAR);
    const nearestAlly = Math.min(...allies.map((s) => (alive(s, tPre) ? dist(P(s, tPre), at) : Infinity)));
    const fight = fights.find((f) => f.kills.includes(k));
    const fightTotal = fight ? fight.dead[0] + fight.dead[1] : 1;
    const ownObs = obsNear(T, at, k.t - 5);
    const enemyObs = obsNear(E, at, k.t - 5).sort((a, b) => a.t - b.t)[0] || null;
    const smoke = data.smokes.find((s) => teamOf(s.slot) === E && s.t >= k.t - 50 && s.t <= k.t - 2 && (attackers.includes(s.slot) || attackers.length >= 2)) || null;
    const dp = depth(at, T);
    // когда я снова на карте: сколько лежал
    let back = k.t + 1;
    while (back < data.end && !alive(me, back)) back++;
    const down = back - k.t;
    const bb = data.buybacks.find((b) => b.slot === me && b.t >= k.t && b.t <= back + 1) || null;
    const prevBb = data.buybacks.find((b) => b.slot === me && b.t < k.t && k.t - b.t <= 75) || null;
    const lostB = lostBuildings(data.buildings.filter((b) => b.t > k.t && b.t <= k.t + Math.min(90, down + 20)), T);
    const roshLost = data.rosh.find((r) => r.team === E && r.t > k.t && r.t <= k.t + 100) || null;
    const core = mates(T).map((s) => [s, view.nwAt(s, k.t)]).sort((a, b) => b[1] - a[1]).slice(0, 2).some((x) => x[0] === me);
    const solo = alliesNear.length === 0;

    let sub = null;
    if (prevBb) sub = "buyback_wasted";
    else if (fightTotal >= 4 && alliesNear.length >= 2) sub = null; // обычная смерть в общей драке — её покажет драка
    else if (smoke && attackers.length >= 2 && alliesNear.length <= 1) sub = "smoke";
    else if (solo && attackers.length >= 2 && enemyObs) sub = "under_ward";
    else if (solo && attackers.length >= 2 && !ownObs.length) sub = "no_vision";
    else if (solo && dp > 0.1) sub = "deep";
    else if (solo && attackers.length >= 2) sub = "caught";
    if (!sub) continue;
    const score = 2.5 + (attackers.length >= 3 ? 1 : 0) + (ownObs.length ? 0 : 0.7) + (enemyObs ? 1 : 0) + Math.min(3, down / 30)
      + lostB.reduce((s, b) => s + buildingScore(b), 0) + (roshLost ? 2 : 0) + (core ? 1 : 0) + (smoke ? 0.5 : 0) + late(k.t)
      + (sub === "buyback_wasted" ? 2.5 : 0) + (bb ? 0.8 : 0);
    out.push({ type: "death", sub, t: k.t, a: k.t - 15, b: k.t + 3, score, center: at, kills: fight ? fight.kills.filter((x) => Math.abs(x.t - k.t) <= 15) : [k],
      actors: [me, ...attackers, ...alliesNear],
      facts: { attackers, allies_near: alliesNear.length, nearest_ally: Number.isFinite(nearestAlly) ? Math.round(nearestAlly) : null,
        own_obs: ownObs.length, enemy_obs: enemyObs ? { x: wardXY(enemyObs)[0], y: wardXY(enemyObs)[1], age: k.t - enemyObs.t, slot: enemyObs.slot } : null,
        smoke: smoke ? { t: smoke.t, slot: smoke.slot } : null, depth: Math.round(dp * 100) / 100, down, buyback: Boolean(bb),
        prev_buyback: prevBb ? k.t - prevBb.t : null, buildings: lostB, rosh: Boolean(roshLost), core, killer: k.k } });
  }

  // --- 3. Рошан ушёл врагу без драки ---
  for (const r of data.rosh) {
    if (r.team !== E) continue;
    if (out.some((m) => m.type === "fight_lost" && r.t - m.t >= 0 && r.t - m.t <= 140)) continue; // это следствие драки, она и расскажет
    const pit = roshanPit(r.t);
    const tPre = r.t - 12;
    const aliveAllies = mates(T).filter((s) => alive(s, tPre));
    const nearPit = aliveAllies.filter((s) => dist(P(s, tPre), pit) <= 26);
    const ward = obsNear(T, pit, r.t - 25, 15).length;
    const lostB = lostBuildings(data.buildings.filter((b) => b.t > r.t && b.t <= r.t + 300), T);
    const aegis = data.aegis.find((a) => Math.abs(a.t - r.t) <= 20) || null;
    const score = 4 + lostB.reduce((s, b) => s + buildingScore(b), 0) * 0.8 + (aliveAllies.length >= 4 ? 1 : 0) + (ward ? 0 : 0.7) + late(r.t);
    out.push({ type: "rosh_lost", sub: ward ? "contest" : "no_ward", t: r.t, a: r.t - 16, b: r.t + 3, score, center: pit, kills: [],
      actors: [...enemies.filter((s) => alive(s, tPre) && dist(P(s, tPre), pit) <= 20), ...aliveAllies],
      facts: { alive: aliveAllies.length, near: nearPit.length, ward, buildings: lostB, aegis: aegis ? aegis.slot : null, pit } });
  }

  // --- 4. Выиграли драку и ничего не забрали ---
  for (const f of fights) {
    const won = f.dead[E] - f.dead[T];
    if (f.dead[E] < 3 || won < 2 || f.t0 < 840) continue;
    const after = [f.t1, f.t1 + 100];
    const tookBuilding = data.buildings.some((b) => b.team === E && b.t >= f.t0 && b.t <= after[1]);
    const tookRosh = data.rosh.some((r) => r.team === T && r.t >= f.t0 && r.t <= after[1] + 30);
    const ended = data.end - f.t1 < 110;
    if (tookBuilding || tookRosh || ended) continue;
    const lastRosh = [...data.rosh].reverse().find((r) => r.t < f.t1);
    const roshUp = !lastRosh || f.t1 - lastRosh.t > 660;
    const aliveAfter = mates(T).filter((s) => alive(s, f.t1 + 5)).length;
    if (aliveAfter < 3) continue;
    const score = 3 + won * 0.9 + (roshUp ? 1.2 : 0) + late(f.t0) + (f.dead[E] >= 4 ? 1 : 0);
    out.push({ type: "no_objective", sub: roshUp ? "rosh_up" : "generic", t: f.t1, a: f.t1 - 8, b: f.t1 + 40, score, center: f.center, kills: f.kills,
      actors: mates(T).filter((s) => alive(s, f.t1 + 5)),
      facts: { dead_us: f.dead[T], dead_them: f.dead[E], alive_after: aliveAfter, rosh_up: roshUp, pit: roshanPit(f.t1 + 30) } });
  }

  // --- 5. Лучший момент: выигранная драка, где я убивал ---
  const good = [];
  for (const f of fights) {
    const won = f.dead[E] - f.dead[T];
    const mine = f.kills.filter((k) => k.k === me).length;
    if (won < 1 || mine < 2 || f.kills.some((k) => k.v === me)) continue;
    const gotB = lostBuildings(f.buildings, E);
    good.push({ type: "highlight", sub: mine >= 3 ? "multi" : "double", t: f.t0, a: f.t0 - 8, b: Math.min(f.t1 + 3, f.t0 + 26),
      score: mine * 2 + won + gotB.reduce((s, b) => s + buildingScore(b), 0) + late(f.t0), center: f.center, kills: f.kills,
      actors: [...new Set([me, ...f.kills.map((k) => k.v), ...f.kills.map((k) => k.k).filter((k) => k >= 0)])],
      facts: { my_kills: mine, dead_us: f.dead[T], dead_them: f.dead[E], buildings: gotB, swing: Math.round((T === 0 ? 1 : -1) * f.swing) } });
  }

  // --- выбор: самые тяжёлые ошибки, не подряд и не однообразно, плюс один хороший момент ---
  const apart = (m, list) => list.every((x) => Math.abs(x.t - m.t) > 75 && (m.b < x.a || m.a > x.b));
  const best = good.sort((a, b) => b.score - a.score)[0] || null;
  const picked = [];
  const perType = {};
  const limit = { death: 2, fight_lost: 2, rosh_lost: 1, no_objective: 1 };
  const room = max - (best ? 1 : 0);
  for (const m of out.sort((a, b) => b.score - a.score)) {
    if (picked.length >= room) break;
    if ((perType[m.type] || 0) >= limit[m.type]) continue;
    if (!apart(m, picked)) continue;
    // одна и та же причина смерти дважды — скучно
    if (m.type === "death" && picked.some((x) => x.type === "death" && x.sub === m.sub)) continue;
    picked.push(m);
    perType[m.type] = (perType[m.type] || 0) + 1;
  }
  if (best && apart(best, picked)) picked.push(best);
  picked.sort((a, b) => a.t - b.t);
  for (const m of picked) { m.a = Math.max(data.start, Math.round(m.a)); m.b = Math.min(data.end, Math.round(m.b)); m.score = Math.round(m.score * 10) / 10; }
  return { me, team: T, moments: picked, candidates: out.length + good.length, fights: fights.length };
}
