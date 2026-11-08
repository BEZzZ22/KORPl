// Карта Доты: подложка, кемпы и живой повтор матча со всеми десятью героями.
// Координаты: клетки OpenDota 64..192 -> SVG 0..128, север сверху. Мир Доты: клетка = 128 + world / 128.

const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

export const mapX = (x) => Math.max(2, Math.min(126, x - 64));
export const mapY = (y) => Math.max(2, Math.min(126, 192 - y));
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const mm = (t) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;

// ---------- геометрия карты ----------

// Здания: башни, бараки, троны. Ключи как в objectives OpenDota (npc_dota_goodguys_tower1_top)
const BUILDINGS = {
  goodguys: {
    tower1_top: [14.5, 49.5], tower2_top: [14.9, 70.8], tower3_top: [12.5, 90.6],
    tower1_mid: [51.9, 75], tower2_mid: [36.6, 85.8], tower3_mid: [27.8, 96.4],
    tower1_bot: [102.5, 111.5], tower2_bot: [61.2, 112.9], tower3_bot: [33.1, 111.8],
    melee_rax_top: [10.4, 94], range_rax_top: [14.8, 94],
    melee_rax_mid: [24.3, 95.8], range_rax_mid: [27.4, 99.6],
    melee_rax_bot: [30.6, 109.7], range_rax_bot: [30.6, 114],
    tower4: [[19.4, 102], [21.9, 104.6]], fort: [16.6, 107.6],
  },
  badguys: {
    tower1_top: [24.1, 18.3], tower2_top: [63, 17], tower3_top: [91.8, 18.9],
    tower1_mid: [68.1, 58.9], tower2_mid: [83.5, 47.5], tower3_mid: [97.4, 34.6],
    tower1_bot: [113, 77.4], tower2_bot: [114, 61], tower3_bot: [113.5, 40.3],
    melee_rax_top: [95.4, 16.6], range_rax_top: [95.4, 21],
    melee_rax_mid: [100.6, 32.4], range_rax_mid: [97.6, 28.6],
    melee_rax_bot: [117.6, 37.6], range_rax_bot: [113.2, 37.6],
    tower4: [[103.3, 24.6], [106.4, 27.4]], fort: [110.4, 21.2],
  },
};

// Кемпы нейтралов [x, y, тир] в координатах SVG: сняты с про-реплеев (tools/mapdata.mjs),
// точка — где стоит герой, когда добивает крипов кемпа
const CAMPS = [
  [32.8, 1.2, "medium"], [78.8, 3.8, "medium"], [42.0, 5.2, "medium"], [66.0, 5.5, "large"],
  [31.2, 26.0, "small"], [56.2, 27.2, "large"], [25.5, 31.5, "large"], [43.8, 32.0, "medium"],
  [74.0, 36.0, "medium"], [73.0, 41.2, "large"], [32.2, 57.8, "medium"], [126.8, 58.0, "small"],
  [26.5, 63.5, "ancient"], [96.2, 64.2, "ancient"], [91.0, 72.5, "medium"], [2.2, 75.0, "small"],
  [51.8, 93.0, "large"], [101.5, 94.2, "large"], [77.5, 96.8, "medium"], [50.2, 100.2, "medium"],
  [65.8, 102.8, "large"], [96.2, 104.5, "small"], [58.5, 125.0, "large"], [49.2, 126.2, "medium"],
  [96.8, 126.2, "medium"], [85.8, 127.0, "medium"],
];
const CAMP_NAME = { small: "малый кемп", medium: "средний кемп", large: "большой кемп", ancient: "кемп древних" };

// Значок кемпа: ромбик, чем больше кемп — тем больше рисок внутри
export function campIcon(tier) {
  const n = { small: 1, medium: 2, large: 3, ancient: 3 }[tier] || 1;
  return el("g", { class: `lm-camp ${tier}` },
    el("rect", { x: -1.4, y: -1.4, width: 2.8, height: 2.8, rx: 0.4, transform: "rotate(45)" }),
    ...Array.from({ length: n }, (_, i) => { const x = ((i - (n - 1) / 2) * 0.75).toFixed(2); return el("line", { x1: x, y1: -0.6, x2: x, y2: 0.6 }); }));
}

// Подложка — настоящая тактическая карта Доты (патч 7.40, из открытого OpenDota web), притемнена под значки.
// Картинка ~50 КБ: грузится один раз и дальше лежит в офлайн-кэше
export function terrainUrl() {
  return "img/map.webp?v=1";
}

// Карта-основа для статичных слоёв (тепловая карта, пути перед смертями)
export function minimap(points, { label, cls = "" } = {}) {
  return el("svg", { class: `minimap ${cls}`, viewBox: "0 0 128 128", role: "img", "aria-label": label },
    el("image", { href: terrainUrl(), x: 0, y: 0, width: 128, height: 128, preserveAspectRatio: "none" }),
    ...points);
}

// ---------- данные повтора из матча OpenDota и файла реплея ----------

const OBS_LIFE = 360, SEN_LIFE = 420;
const OBS_VISION = 1600 / 128; // обзор обса 1600 единиц, клетка — 128
// логова Рошана в координатах SVG: верхнее у лавы и нижнее у полумесяца
const ROSH_PITS = [[38.5, 44.5], [85.5, 85]];
// Рошан живёт днём в верхнем логове, ночью в нижнем; день и ночь по 5 минут, игра начинается днём
export const roshanPit = (t) => (Math.floor(Math.max(0, t) / 300) % 2 === 0 ? ROSH_PITS[0] : ROSH_PITS[1]);
const ROSH_RESPAWN = [480, 660];
// торменторы на круглых площадках в углах карты, появляются в 20:00, после убийства — через 10 минут
const TORMENTORS = [[8, 3.8], [119.7, 123.6]];
const TORMENTOR_AT = 1200, TORMENTOR_RESPAWN = 600;
// линии от барака Света к бараку Тьмы, точки в координатах SVG
const LANES = {
  top: [[12.6, 94], [12.5, 90.6], [14.9, 70.8], [14.5, 49.5], [13.5, 22], [16, 16.5], [24.1, 18.3], [63, 17], [91.8, 18.9], [95.5, 19.2]],
  mid: [[25.8, 98.2], [27.8, 96.4], [36.6, 85.8], [51.9, 75], [68.1, 58.9], [83.5, 47.5], [97.4, 34.6], [99.2, 31.5]],
  bot: [[32.8, 112.4], [33.1, 111.8], [61.2, 112.9], [102.5, 111.5], [111, 111], [113, 102], [113, 77.4], [114, 61], [113.5, 40.3], [113.4, 38.2]],
};
export const CREEP_SPEED = 325 / 128; // клеток в секунду
// длина пути и точка на нём: s — сколько клеток от барака Света
function laneGeo(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = acc[acc.length - 1];
  const at = (d) => {
    const v = Math.max(0, Math.min(len, d));
    let i = 1;
    while (i < acc.length - 1 && acc[i] < v) i++;
    const k = (v - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
  };
  // ближайшая точка пути: [s, расстояние]
  const project = (x, y) => {
    let best = [0, Infinity];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(ax + dx * k - x, ay + dy * k - y);
      if (d < best[1]) best = [acc[i - 1] + Math.sqrt(l2) * k, d];
    }
    return best;
  };
  return { len, at, project };
}
// руны по номерам OpenDota (runes_log.key)
export const RUNES = {
  0: "двойного урона", 1: "ускорения", 2: "иллюзий", 3: "невидимости", 4: "восстановления",
  5: "богатства", 6: "волшебства", 7: "воды", 8: "мудрости", 9: "щита",
};

// Все события и сущности для повтора. heroKey(hero_id) -> "tusk", heroName(hero_id) -> "Tusk"
export function replayModel(match, replay, me, { heroKey, heroName }) {
  const players = match.players.map((p) => ({
    slot: p.player_slot, radiant: p.player_slot < 128, hero_id: p.hero_id, key: heroKey(p.hero_id), name: heroName(p.hero_id), me: p === me,
  }));
  const byKey = new Map(players.map((p) => [`npc_dota_hero_${p.key}`, p]));
  const duration = match.duration;
  // позиции: массив точек раз в step секунд от start
  const pos = replay && replay.pos && replay.step > 0 ? players.map((p) => replay.pos[String(p.slot)] || null) : null;
  const posAt = (i, t) => {
    if (!pos || !pos[i]) return null;
    const f = (t - replay.start) / replay.step;
    const a = Math.floor(f), b = a + 1;
    const pa = pos[i][a], pb = pos[i][b];
    if (!pa) return null;
    if (!pb) return pa;
    // скачок больше 12 клеток за шаг — телепорт или возрождение: не тянем героя через полкарты
    if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 12) return f - a < 0.5 ? pa : pb;
    const k = f - a;
    return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k];
  };
  // последняя известная точка до момента t (для смертей: в момент смерти позиции уже нет)
  const lastPos = (i, t) => {
    if (!pos || !pos[i]) return null;
    for (let j = Math.floor((t - replay.start) / replay.step); j >= 0 && j > (t - replay.start) / replay.step - 6; j--) if (pos[i][j]) return pos[i][j];
    return null;
  };

  const kills = [];
  match.players.forEach((p, ki) => {
    for (const k of p.kills_log || []) {
      const victim = byKey.get(k.key);
      if (!victim) continue;
      const vi = players.indexOf(victim);
      kills.push({ t: k.time, killer: ki, victim: vi, pos: lastPos(vi, k.time), from: posAt(ki, k.time) || lastPos(ki, k.time) });
    }
  });
  // без реплея место смерти берём из больших драк: OpenDota хранит его по игроку
  if (!pos) {
    for (const tf of match.teamfights || []) {
      (tf.players || []).forEach((tp, vi) => {
        const spots = [];
        for (const [x, ys] of Object.entries(tp.deaths_pos || {})) for (const [y, n] of Object.entries(ys)) for (let j = 0; j < n; j++) spots.push([parseFloat(x), parseFloat(y)]);
        const inFight = kills.filter((k) => k.victim === vi && !k.pos && k.t >= tf.start - 5 && k.t <= tf.end + 5);
        inFight.forEach((k, j) => { if (spots[j]) k.pos = spots[j]; });
      });
    }
  }
  kills.sort((a, b) => a.t - b.t);

  // кто сломал вард: attackername в obs_left_log. Свой же герой там — вард просто истёк
  const heroIdx = (name) => { const v = byKey.get(name); return v ? players.indexOf(v) : -1; };
  const wards = [];
  match.players.forEach((p, i) => {
    const leftOf = (log) => new Map((log || []).filter((w) => "ehandle" in w).map((w) => [w.ehandle, w]));
    const left = leftOf(p.obs_left_log), senLeft = leftOf(p.sen_left_log);
    const add = (kind, w, l, life) => {
      if (typeof w.x !== "number") return;
      const end = l ? l.time : w.time + life;
      const bi = l && l.attackername ? heroIdx(l.attackername) : -1;
      const breaker = bi >= 0 && players[bi].radiant !== players[i].radiant ? bi : null;
      wards.push({ kind, owner: i, radiant: players[i].radiant, x: w.x, y: w.y, t: w.time, end, breaker,
        dewarded: breaker != null || (kind === "obs" && end < w.time + life - 10) });
    };
    for (const w of p.obs_log || []) add("obs", w, left.get(w.ehandle), OBS_LIFE);
    for (const w of p.sen_log || []) add("sen", w, senLeft.get(w.ehandle), SEN_LIFE);
  });

  // руны: время и кто взял; место — где стоял герой (только с реплеем)
  const runes = [];
  match.players.forEach((p, i) => {
    for (const r of p.runes_log || []) {
      const kind = Number(r.key);
      if (!RUNES[kind]) continue;
      runes.push({ t: r.time, kind, who: i, pos: posAt(i, r.time) || lastPos(i, r.time) });
    }
  });
  runes.sort((a, b) => a.t - b.t);

  // выкупы
  const buybacks = [];
  match.players.forEach((p, i) => { for (const b of p.buyback_log || []) buybacks.push({ t: b.time, who: i }); });
  buybacks.sort((a, b) => a.t - b.t);

  // большие драки: центр — средняя точка смертей, радиус — до самой дальней
  const fights = [];
  for (const tf of match.teamfights || []) {
    const spots = kills.filter((k) => k.pos && k.t >= tf.start - 5 && k.t <= tf.end + 5).map((k) => [mapX(k.pos[0]), mapY(k.pos[1])]);
    if (spots.length < 2) continue;
    const cx = spots.reduce((n, q) => n + q[0], 0) / spots.length, cy = spots.reduce((n, q) => n + q[1], 0) / spots.length;
    const r = Math.max(7, Math.min(20, Math.max(...spots.map((q) => Math.hypot(q[0] - cx, q[1] - cy))) + 5));
    fights.push({ t: tf.start, end: tf.end, x: cx, y: cy, r, deaths: spots.length });
  }

  const buildings = [];
  const t4seen = { goodguys: 0, badguys: 0 };
  for (const [side, list] of Object.entries(BUILDINGS)) {
    for (const [name, xy] of Object.entries(list)) {
      const spots = name === "tower4" ? xy : [xy];
      spots.forEach((s, n) => buildings.push({ id: `${side}_${name}${name === "tower4" ? n : ""}`, key: `npc_dota_${side}_${name}`, side, kind: name.startsWith("tower") ? "tower" : name === "fort" ? "fort" : "rax", x: s[0], y: s[1], died: null }));
    }
  }
  const objectives = [];
  const slotIdx = (slot) => players.findIndex((p) => p.slot === slot);
  for (const o of match.objectives || []) {
    if (o.type === "building_kill" && typeof o.key === "string") {
      const side = o.key.includes("goodguys") ? "goodguys" : o.key.includes("badguys") ? "badguys" : null;
      if (!side) continue;
      let b;
      if (/_tower4$/.test(o.key)) { b = buildings.find((x) => x.id === `${side}_tower4${t4seen[side]}`); t4seen[side]++; } else b = buildings.find((x) => x.key === o.key);
      const by = typeof o.unit === "string" ? heroIdx(o.unit) : -1;
      if (b && b.died == null) { b.died = o.time; objectives.push({ t: o.time, kind: "building", b, by: by >= 0 ? by : null }); }
    } else if (o.type === "CHAT_MESSAGE_ROSHAN_KILL") {
      const radiant = o.team === 2;
      objectives.push({ t: o.time, kind: "roshan", radiant, pos: roshanPit(o.time) });
    } else if (o.type === "CHAT_MESSAGE_AEGIS") {
      const i = slotIdx(o.player_slot);
      const r = objectives.filter((x) => x.kind === "roshan" && o.time - x.t <= 30).pop();
      if (r && i >= 0) r.aegis = i;
    } else if (o.type === "CHAT_MESSAGE_FIRSTBLOOD") {
      const i = slotIdx(o.player_slot);
      if (i >= 0) objectives.push({ t: o.time, kind: "firstblood", by: i });
    }
  }
  // трон без записи падает в конце матча у проигравших
  const loser = match.radiant_win ? "badguys" : "goodguys";
  const fort = buildings.find((b) => b.id === `${loser}_fort`);
  if (fort && fort.died == null) { fort.died = duration; objectives.push({ t: duration, kind: "building", b: fort }); }
  objectives.sort((a, b) => a.t - b.t);

  // линии и где на них встречаются пачки крипов.
  // С реплеем фронт — там, где добивали крипов линии за последние 45 с; без него — посередине
  // между крайними целыми башнями сторон (пока стоят T1 — середина линии, сносят — фронт уходит к базе)
  // добивания из файла реплея: [время, герой, "c" крип | "r" Рошан | "m" торментор], место — позиция героя
  const lasthits = (replay && Array.isArray(replay.lasthits) ? replay.lasthits : []).map(([lt, hero, kind]) => {
    const v = byKey.get(`npc_dota_hero_${hero}`);
    const i = v ? players.indexOf(v) : -1;
    const q = i >= 0 ? posAt(i, lt) || lastPos(i, lt) : null;
    return { t: lt, i, kind, q };
  }).filter((x) => x.i >= 0);
  const creepPts = lasthits.filter((x) => x.kind === "c" && x.q).map((x) => [x.t, mapX(x.q[0]), mapY(x.q[1])]);
  const lanes = Object.entries(LANES).map(([name, pts]) => {
    const g = laneGeo(pts);
    const towers = buildings.filter((b) => b.kind === "tower" && b.key.endsWith(`_${name}`)).map((b) => ({ b, s: g.project(b.x, b.y)[0] }));
    const hits = creepPts.map(([ct, x, y]) => { const [d, off] = g.project(x, y); return off < 7 ? [ct, d] : null; }).filter(Boolean);
    const front = (now) => {
      const near = hits.filter(([ct]) => ct <= now && ct > now - 45).map(([, d]) => d).sort((a, b) => a - b);
      if (near.length >= 3) return near[Math.floor(near.length / 2)];
      const up = (side) => towers.filter((x) => x.b.side === side && (x.b.died == null || x.b.died > now)).map((x) => x.s);
      const r = up("goodguys"), d = up("badguys");
      const a = r.length ? Math.max(...r) : g.len * 0.06, b = d.length ? Math.min(...d) : g.len * 0.94;
      return (a + b) / 2;
    };
    return { name, len: g.len, at: g.at, front };
  });

  // Рошан: жив или мёртв и когда может вернуться
  const roshKills = objectives.filter((o) => o.kind === "roshan").map((o) => o.t);
  const roshanAt = (now) => {
    const last = roshKills.filter((k) => k <= now).pop();
    const since = last == null ? null : now - last;
    const state = since == null || since >= ROSH_RESPAWN[1] ? "alive" : since >= ROSH_RESPAWN[0] ? "maybe" : "dead";
    return { pit: roshanPit(now), state, back: state === "dead" ? ROSH_RESPAWN[0] - since : state === "maybe" ? ROSH_RESPAWN[1] - since : 0 };
  };
  // торменторы: убийства известны только из файла реплея; какой из двух — ближайший к добившему герою
  const tormentorKills = lasthits.filter((x) => x.kind === "m").map(({ t: bt, i, q }) => ({
    t: bt, who: i,
    which: q ? (Math.hypot(mapX(q[0]) - TORMENTORS[0][0], mapY(q[1]) - TORMENTORS[0][1]) < Math.hypot(mapX(q[0]) - TORMENTORS[1][0], mapY(q[1]) - TORMENTORS[1][1]) ? 0 : 1) : null,
  }));
  const tormentorAt = (now, which) => {
    if (now < TORMENTOR_AT) return { state: "none", back: TORMENTOR_AT - now };
    const last = tormentorKills.filter((k) => k.which === which && k.t <= now).pop();
    if (last && now - last.t < TORMENTOR_RESPAWN) return { state: "dead", back: TORMENTOR_RESPAWN - (now - last.t) };
    return { state: "alive", back: 0 };
  };

  const meIdx = players.findIndex((p) => p.me);
  return { players, kills, wards, runes, buybacks, fights, buildings, objectives, duration, posAt, hasPos: Boolean(pos), meIdx,
    lanes, roshanAt, tormentorAt, tormentorKills, hasCreeps: creepPts.length > 0,
    goldAdv: match.radiant_gold_adv || [], radiantWin: match.radiant_win, start: pos ? Math.max(replay.start, -60) : 0 };
}

// ---------- живой повтор ----------

const SPEEDS = [15, 30, 60];
const BUILDING_NAME = { tower: "башня", rax: "барак", fort: "трон" };
const LANE_NAME = { top: "верх", mid: "мид", bot: "низ" };
function buildingLabel(b) {
  const lane = /_(top|mid|bot)/.exec(b.key);
  const tier = /tower(\d)/.exec(b.key);
  const who = b.side === "goodguys" ? "Света" : "Тьмы";
  if (b.kind === "fort") return `Трон ${who}`;
  if (b.kind === "rax") return `Барак ${who}${lane ? `, ${LANE_NAME[lane[1]]}` : ""}`;
  return `T${tier ? tier[1] : ""} ${who}${lane ? `, ${LANE_NAME[lane[1]]}` : ""}`;
}

// ---------- значки событий ----------
// Значок — тёмная плашка с ободком цвета команды и светлым рисунком, коробка -5..5.
// Ободок: зелёный — свои, красный — враги, золотой — ты. Рисунок говорит, что случилось
const S = (d, extra = "") => el("path", { d, class: `gl-s${extra}` });
const F = (d, extra = "") => el("path", { d, class: `gl-f${extra}` });
const GLYPH = {
  eye: () => [S("M-3.9 0Q0 -3.8 3.9 0Q0 3.8 -3.9 0Z"), el("circle", { r: 1.35, class: "gl-f" })],
  eyeOff: () => [S("M-3.9 0Q0 -3.8 3.9 0Q0 3.8 -3.9 0Z", " gl-dim"), el("circle", { r: 1.35, class: "gl-f gl-dim" }), S("M-3.3 3.3L3.3 -3.3", " gl-cut")],
  skull: () => [F("M0 -3.9C-2.7 -3.9 -3.7 -2 -3.7 -.3C-3.7 1.1 -3 1.8 -2.1 2.1V3.6H2.1V2.1C3 1.8 3.7 1.1 3.7 -.3C3.7 -2 2.7 -3.9 0 -3.9Z"),
    el("circle", { cx: -1.35, cy: -.3, r: .95, class: "gl-hole" }), el("circle", { cx: 1.35, cy: -.3, r: .95, class: "gl-hole" }), F("M0 .9L-.55 1.9H.55Z", " gl-hole")],
  aegis: () => [S("M0 -4L3.4 -2.7L3 1.1Q2.3 3.2 0 4.2Q-2.3 3.2 -3 1.1L-3.4 -2.7Z"), S("M0 -2.1V2.3M-1.6 -.5H1.6")],
  swords: () => [S("M-3.4 -3.4L2.2 2.2M3.4 -3.4L-2.2 2.2M.9 3.5L3.5 .9M-3.5 .9L-.9 3.5")],
  // снесённое здание: ромб, как на карте, с трещиной
  tower: () => [F("M0 -3.5L3.5 0L0 3.5L-3.5 0Z"), S("M-.9 -2.5L.5 -.7L-.6 .5L.9 2.5", " gl-crack")],
  drop: () => [F("M0 -3.6C1.9 -1 2.7 .3 2.7 1.3A2.7 2.7 0 0 1 -2.7 1.3C-2.7 .3 -1.9 -1 0 -3.6Z")],
  // Рошан: рогатая голова
  roshan: () => [S("M-3.9 -3.9Q-3.6 -1.2 -1.9 -1.3M3.9 -3.9Q3.6 -1.2 1.9 -1.3"), F("M-2.5 -1.7Q0 -2.7 2.5 -1.7L2.3 1.4Q1.3 3.7 0 3.7Q-1.3 3.7 -2.3 1.4Z"),
    el("circle", { cx: -1.05, cy: -.1, r: .6, class: "gl-hole" }), el("circle", { cx: 1.05, cy: -.1, r: .6, class: "gl-hole" }), S("M-.9 2H.9", " gl-crack")],
  // торментор: висящий куб
  tormentor: () => [S("M0 -3.9L3.4 -1.95V1.95L0 3.9L-3.4 1.95V-1.95Z"), S("M-3.4 -1.95L0 0L3.4 -1.95M0 0V3.9")],
  // пачка крипов
  creeps: () => [el("circle", { cx: -1.6, cy: -1.3, r: 1.15, class: "gl-f" }), el("circle", { cx: 1.6, cy: -1.3, r: 1.15, class: "gl-f" }), el("circle", { cx: 0, cy: 1.5, r: 1.15, class: "gl-f" })],
  buyback: () => [S("M2.9 -.4A3 3 0 1 1 1.6 -2.5"), S("M3.4 -3.6L3 -.3L-.2 -.9")],
};
const RUNE_GLYPH = {
  0: () => [S("M-2.4 .4L0 -1.9L2.4 .4M-2.4 2.7L0 .4L2.4 2.7")], // двойной урон: две стрелки вверх
  1: () => [S("M-2.5 -2.3L-.2 0L-2.5 2.3M.4 -2.3L2.7 0L.4 2.3")], // ускорение: две стрелки вперёд
  2: () => [el("circle", { cx: -.9, r: 1.8, class: "gl-s" }), el("circle", { cx: .9, r: 1.8, class: "gl-s gl-dim" })], // иллюзии
  3: () => [el("circle", { r: 2.3, class: "gl-s gl-dash" })], // невидимость
  4: () => [S("M0 -2.5V2.5M-2.5 0H2.5")], // восстановление
  5: () => [el("circle", { r: 2.3, class: "gl-s" }), S("M0 -1.1V1.1")], // богатство: монета
  6: () => [F("M0 -2.9L.8 -.8L2.9 0L.8 .8L0 2.9L-.8 .8L-2.9 0L-.8 -.8Z")], // волшебство
  7: () => GLYPH.drop(), // вода
  8: () => [S("M-2.7 -1.8L0 -.8L2.7 -1.8V2L0 3L-2.7 2ZM0 -.8V3")], // мудрость: книга
  9: () => [S("M0 -2.8L2.4 -1.9L2.1 .8Q1.6 2.3 0 3Q-1.6 2.3 -2.1 .8L-2.4 -1.9Z")], // щит
};
const HEX = "M0 -5L4.33 -2.5V2.5L0 5L-4.33 2.5V-2.5Z";

// плашка со значком; side — "ally" | "foe" | "mine" | "gold"
function badge(glyph, side, { hex = false, tint = "" } = {}) {
  return el("g", { class: `bd ${side}` },
    hex ? el("path", { d: HEX, class: "bd-plate" }) : el("circle", { r: 4.9, class: "bd-plate" }),
    el("g", { class: `bd-gl${tint ? ` ${tint}` : ""}` }, glyph()));
}
// разлёт осколков: сломанный вард, снесённое здание
function shards(n = 6) {
  return el("g", { class: "fx-shards" }, Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.3;
    return el("path", { d: `M${(Math.cos(a) * 5.6).toFixed(2)} ${(Math.sin(a) * 5.6).toFixed(2)}L${(Math.cos(a) * 8).toFixed(2)} ${(Math.sin(a) * 8).toFixed(2)}` });
  }));
}
// маленький значок для ленты и подписи
function iconSvg(node) {
  return el("svg", { viewBox: "-5.6 -5.6 11.2 11.2", class: "lm-ico", "aria-hidden": "true" }, node);
}

// Подпись к значкам карты: что чем обозначено
function legend() {
  const row = document.createElement("div");
  row.className = "lm-legend";
  const item = (node, text) => {
    const span = document.createElement("span");
    span.append(iconSvg(node), text);
    return span;
  };
  const ring = (cls) => el("circle", { r: 4.2, class: `lg-ring ${cls}` });
  const camp = campIcon("large");
  camp.setAttribute("transform", "scale(2.2)");
  row.append(
    item(ring("lg-me"), "ты"),
    item(ring("lg-ally"), "свои"),
    item(ring("lg-foe"), "враги"),
    item(el("path", { d: "M-4.5 3.5L-1 -1.5L4.5 1", class: "lg-path" }), "след героя"),
    item(badge(GLYPH.eye, "ally", { tint: "t-obs" }), "обс"),
    item(badge(GLYPH.eye, "ally", { tint: "t-sen" }), "сентри"),
    item(badge(GLYPH.eyeOff, "foe"), "сломали вард"),
    item(badge(GLYPH.skull, "ally"), "смерть"),
    item(el("g", {}, el("circle", { r: 4.6, class: "lg-fight" })), "драка"),
    item(badge(RUNE_GLYPH[0], "ally", { hex: true }), "руна"),
    item(badge(GLYPH.roshan, "gold"), "Рошан"),
    item(badge(GLYPH.tormentor, "gold"), "торментор"),
    item(el("g", {}, el("circle", { cx: -2, cy: -1.4, r: 1.5, class: "lg-creep ally" }), el("circle", { cx: 2, cy: -1.4, r: 1.5, class: "lg-creep ally" }), el("circle", { cx: 0, cy: 2, r: 1.5, class: "lg-creep ally" })), "крипы"),
    item(el("rect", { x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: .6, transform: "rotate(45)", class: "lg-tower" }), "башня"),
    CAMPS.length > 0 ? item(camp, "кемп") : "");
  return row;
}

// iconUrl(hero_id) -> маленькая иконка героя; onSelect(i) — тап по герою
export function liveMap(model, { iconUrl, haptic = () => {} }) {
  const myRadiant = model.meIdx >= 0 ? model.players[model.meIdx].radiant : true;
  const t0 = model.hasPos ? model.start : 0;
  const T = model.duration;
  let t = 0;
  let playing = false, speed = SPEEDS[1], raf = 0, last = 0, selected = model.meIdx;
  let follow = false, cam = null;

  const defs = el("defs", {},
    el("clipPath", { id: "lm-clip", clipPathUnits: "objectBoundingBox" }, el("circle", { cx: 0.5, cy: 0.5, r: 0.5 })));

  // здания
  const bLayer = el("g", { class: "lm-buildings" });
  const bNodes = model.buildings.map((b) => {
    const size = b.kind === "fort" ? 3.4 : b.kind === "rax" ? 1.9 : 2.3;
    const node = el("g", { class: `lm-b ${b.side === "goodguys" ? "rad" : "dire"} ${b.kind}`, transform: `translate(${b.x} ${b.y})` },
      el("title", {}, buildingLabel(b)),
      b.kind === "rax" ? el("rect", { x: -size / 2, y: -size / 2, width: size, height: size, rx: 0.4 })
        : el("rect", { x: -size / 2, y: -size / 2, width: size, height: size, rx: b.kind === "fort" ? 0.9 : 0.5, transform: "rotate(45)" }));
    bLayer.append(node);
    return node;
  });

  // кемпы: где стоят нейтралы
  const cLayer = el("g", { class: "lm-camps" }, CAMPS.map(([x, y, tier]) => {
    const g = campIcon(tier);
    g.setAttribute("transform", `translate(${x} ${y})`);
    g.append(el("title", {}, CAMP_NAME[tier]));
    return g;
  }));

  // ---------- события на карте ----------
  // Узел события: снаружи позиция и масштаб, внутри .pop — он и вспышка проигрываются
  // заново каждый раз, когда событие появляется (CSS-анимация стартует при показе)
  const sideOf = (i) => (model.players[i].me ? "mine" : model.players[i].radiant === myRadiant ? "ally" : "foe");
  const scaled = []; // [узел, x, y, масштаб] — при «Следить» значки ужимаются; x = null — только масштаб
  const placeAt = (node, x, y, s, k = 1) => node.setAttribute("transform", `${x == null ? "" : `translate(${x.toFixed(1)} ${y.toFixed(1)}) `}scale(${(s * k).toFixed(3)})`);
  const place = (node, x, y, s) => { scaled.push([node, x, y, s]); placeAt(node, x, y, s); return node; };
  const evNode = (cls, x, y, s, title, ...kids) => place(el("g", { class: `lm-e ${cls}`, display: "none" }, el("title", {}, title), ...kids), x, y, s);
  const ripple = (cls = "") => el("circle", { r: 4.9, class: `fx-ripple${cls}` });

  // варды: значок глаза, у обса круг обзора разворачивается при установке
  const wLayer = el("g", { class: "lm-wards" });
  const wNodes = model.wards.map((w) => {
    const side = sideOf(w.owner);
    const x = mapX(w.x), y = mapY(w.y);
    const obs = w.kind === "obs";
    const node = el("g", { class: `lm-w ${w.kind} ${side}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, display: "none" },
      el("title", {}, `${obs ? "Обс" : "Сентри"} ${model.players[w.owner].name}, ${mm(w.t)}`),
      obs && el("circle", { r: OBS_VISION, class: "lm-vis" }),
      // сдвиг у внешней группы, масштаб у значка: круг обзора не ужимается
      place(el("g", {}, el("g", { class: "pop" }, badge(GLYPH.eye, side, { tint: obs ? "t-obs" : "t-sen" }))), null, null, obs ? 0.5 : 0.42));
    wLayer.append(node);
    return node;
  });
  // сломанный вард: глаз перечёркнут, осколки разлетаются; ободок — цвет того, кто сломал
  const xLayer = el("g", { class: "lm-wbreaks" });
  const xNodes = model.wards.map((w) => {
    if (w.breaker == null) return null;
    const node = evNode(`brk ${sideOf(w.breaker)}`, mapX(w.x), mapY(w.y), 0.5,
      `${model.players[w.breaker].name} сломал ${w.kind === "obs" ? "обс" : "сентри"} ${model.players[w.owner].name}, ${mm(w.end)}`,
      ripple(), shards(), el("g", { class: "pop" }, badge(GLYPH.eyeOff, sideOf(w.breaker))));
    xLayer.append(node);
    return node;
  });

  // драки: пунктирный круг крутится, пока идёт драка
  const fLayer = el("g", { class: "lm-fights" });
  const fNodes = model.fights.map((f) => {
    const node = el("g", { class: "lm-fight", transform: `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)})`, display: "none" },
      el("title", {}, `Драка ${mm(f.t)}–${mm(f.end)}`),
      el("circle", { r: f.r.toFixed(1), class: "f-zone" }),
      el("g", { class: "f-spin" }, el("circle", { r: f.r.toFixed(1), class: "f-ring" })));
    fLayer.append(node);
    return node;
  });

  // убийства: удар от убийцы к жертве и череп на месте смерти с волной
  const kLayer = el("g", { class: "lm-strikes" });
  const kNodes = model.kills.map((k) => {
    if (!k.pos || !k.from) return null;
    const x1 = mapX(k.from[0]), y1 = mapY(k.from[1]), x2 = mapX(k.pos[0]), y2 = mapY(k.pos[1]);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1.5 || len > 40) return null;
    const node = el("line", { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), class: `lm-strike ${sideOf(k.killer)}`, display: "none" });
    // через CSSOM: атрибут style режет политика безопасности страницы
    node.style.setProperty("--len", len.toFixed(1));
    kLayer.append(node);
    return node;
  });
  const dLayer = el("g", { class: "lm-deaths" });
  const dNodes = model.kills.map((k) => {
    if (!k.pos) return null;
    const v = model.players[k.victim];
    const node = evNode(`death ${sideOf(k.victim)}`, mapX(k.pos[0]), mapY(k.pos[1]), 0.52,
      `${model.players[k.killer].name} убил ${v.name}, ${mm(k.t)}`,
      ripple(), ripple(" late"), el("g", { class: "pop" }, badge(GLYPH.skull, sideOf(k.victim))));
    dLayer.append(node);
    return node;
  });

  // руны: шестигранник с рисунком руны там, где её взяли
  const rLayer = el("g", { class: "lm-runes" });
  const rNodes = model.runes.map((r) => {
    if (!r.pos) return null;
    const node = evNode(`rune k${r.kind} ${sideOf(r.who)}`, mapX(r.pos[0]), mapY(r.pos[1]), r.kind === 5 ? 0.4 : 0.5,
      `${model.players[r.who].name}: руна ${RUNES[r.kind]}, ${mm(r.t)}`,
      el("g", { class: "fx-spark" }, el("path", { d: "M0 -7.2V-5.8M7.2 0H5.8M0 7.2V5.8M-7.2 0H-5.8" })),
      el("g", { class: "pop" }, badge(RUNE_GLYPH[r.kind], sideOf(r.who), { hex: true })));
    rLayer.append(node);
    return node;
  });

  // Рошан: знак Аегиса в логове, ударная волна. Рисуется поверх героев: в логове стоит вся команда
  const oLayer = el("g", { class: "lm-rosh" });
  const roshList = model.objectives.filter((o) => o.kind === "roshan" && o.pos);
  const oNodes = roshList.map((o) => {
    const side = o.aegis != null ? sideOf(o.aegis) : o.radiant === myRadiant ? "ally" : "foe";
    const node = evNode(`roshan ${side}`, o.pos[0], o.pos[1], 0.7,
      `Рошан у ${o.radiant === myRadiant ? "вас" : "врагов"}, ${mm(o.t)}`,
      ripple(), ripple(" late"), el("g", { class: "f-spin" }, el("circle", { r: 6.6, class: "ro-ring" })));
    oLayer.append(node);
    return node;
  });
  // здание падает: вспышка и осколки поверх ромба
  const bfxLayer = el("g", { class: "lm-bfx" });
  const bfxNodes = model.buildings.map((b) => (b.died == null ? null
    : bfxLayer.appendChild(evNode(`bfall ${b.side === "goodguys" ? (myRadiant ? "ally" : "foe") : (myRadiant ? "foe" : "ally")}`, b.x, b.y, 0.5, buildingLabel(b), ripple(), shards(8)))));

  // хвосты: каждый герой тянет за собой след последних секунд — видно, кто куда бежит
  const TAIL = 8;
  const tailLayer = el("g", { class: "lm-tails" });
  const tails = model.players.map((p, i) => {
    const g = el("g", { class: `tail ${sideOf(i)}` }, el("path", { class: "old" }), el("path", { class: "new" }));
    tailLayer.append(g);
    return g;
  });

  // путь выбранного героя за последнюю минуту: чем свежее, тем ярче
  const TRAIL = 60, TRAIL_PARTS = 6;
  const trail = el("g", { class: "lm-trail" });
  const trailParts = Array.from({ length: TRAIL_PARTS }, (_, n) => el("path", { d: "", opacity: (0.18 + (0.82 * (n + 1)) / TRAIL_PARTS).toFixed(2) }));
  const trailDots = el("g", { class: "lm-trail-dots" });
  trail.append(...trailParts, trailDots);

  // герои: портрет из Доты в кольце цвета команды; тебя видно по золотому пульсу, выбранного — по белому.
  // iconUrl может вернуть список адресов: не загрузился первый — берём следующий
  const HERO_R = 4.3;
  function heroImage(id) {
    const urls = [].concat(iconUrl(id));
    const img = el("image", { href: urls[0], x: -HERO_R + 0.45, y: -HERO_R + 0.45, width: (HERO_R - 0.45) * 2, height: (HERO_R - 0.45) * 2, "clip-path": "url(#lm-clip)", preserveAspectRatio: "xMidYMid slice" });
    let n = 0;
    img.addEventListener("error", () => { n++; if (n < urls.length) img.setAttribute("href", urls[n]); else img.remove(); });
    return img;
  }
  const hLayer = el("g", { class: "lm-heroes" });
  const hNodes = model.players.map((p, i) => {
    const node = el("g", { class: `lm-h ${p.radiant === myRadiant ? "ally" : "foe"}${p.me ? " mine" : ""}`, display: "none", "data-i": i },
      el("g", { class: "pop" },
        el("circle", { r: HERO_R, class: "pulse" }),
        el("circle", { r: HERO_R, class: "ring" }),
        // буквы видны, пока портрет не загрузился или если CDN Steam недоступен
        el("text", { class: "ini", y: 1.3, "text-anchor": "middle" }, p.name.slice(0, 2)),
        heroImage(p.hero_id)),
      el("title", {}, p.name));
    node.addEventListener("click", (e) => { e.stopPropagation(); selected = selected === i ? -1 : i; haptic("light"); draw(true); });
    hLayer.append(node);
    return node;
  });

  // пачки крипов: каждые 30 с из бараков, идут по линии со скоростью крипа до фронта и там рубятся
  const WAVE_FIGHT = 22;
  const crLayer = el("g", { class: "lm-creeps" });
  const waves = model.lanes.map((lane) => ({
    lane,
    rad: Array.from({ length: 4 }, () => crLayer.appendChild(waveNode(myRadiant ? "ally" : "foe"))),
    dire: Array.from({ length: 4 }, () => crLayer.appendChild(waveNode(myRadiant ? "foe" : "ally"))),
    clash: crLayer.appendChild(el("g", { class: "lm-clash", display: "none" }, el("g", { class: "cl-spin" }, el("path", { d: "M-1.6 -1.6L1.6 1.6M1.6 -1.6L-1.6 1.6" })), el("circle", { r: 2.4 }))),
  }));
  function waveNode(side) {
    return el("g", { class: `lm-wave ${side}`, display: "none" },
      el("g", { class: "wv" }, el("circle", { cx: -1.2, cy: -0.9, r: 0.85 }), el("circle", { cx: 1.2, cy: -0.9, r: 0.85 }), el("circle", { cx: -1.2, cy: 1.1, r: 0.85 }), el("circle", { cx: 1.2, cy: 1.1, r: 0.85 })));
  }

  // Рошан всегда виден в своём логове: жив, мёртв (сколько до возрождения) или может уже вернуться
  const label = (y) => el("text", { class: "lm-timer", y, "text-anchor": "middle" });
  // логово меняется днём и ночью, поэтому сдвиг ставит drawBosses, а не общий список масштаба
  const roshNode = el("g", { class: "lm-boss rosh alive" }, el("title", {}, "Рошан"), el("circle", { r: 7, class: "boss-glow" }),
    badge(GLYPH.roshan, "gold"), label(9.2));
  const tormNodes = [0, 1].map((n) => place(el("g", { class: "lm-boss torm", display: "none" }, el("title", {}, "Торментор"), el("circle", { r: 7, class: "boss-glow" }),
    badge(GLYPH.tormentor, "gold"), label(9.2)), TORMENTORS[n][0], TORMENTORS[n][1], 0.55));
  const bossLayer = el("g", { class: "lm-bosses" }, roshNode, ...tormNodes);

  const map = el("svg", { class: "minimap live", viewBox: "0 0 128 128", role: "img", "aria-label": "Повтор матча на карте" },
    defs, el("image", { href: terrainUrl(), x: 0, y: 0, width: 128, height: 128, preserveAspectRatio: "none" }),
    cLayer, bLayer, crLayer, bossLayer, fLayer, wLayer, xLayer, rLayer, bfxLayer, kLayer, dLayer, tailLayer, trail, hLayer, oLayer);

  // ---------- шкала: перевес по золоту, убийства, здания ----------
  const W = 300, H = 40, MID = H / 2;
  const tx = (s) => ((s - t0) / Math.max(1, T - t0)) * W;
  const adv = model.goldAdv.map((g) => (myRadiant ? g : -g));
  const peak = Math.max(3000, ...adv.map(Math.abs));
  const ay = (g) => MID - (g / peak) * (MID - 5);
  const advPts = adv.map((g, m) => `${tx(m * 60).toFixed(1)},${ay(g).toFixed(1)}`).join(" ");
  const track = el("svg", { class: "lm-track", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" },
    el("defs", {},
      el("clipPath", { id: "lm-up" }, el("rect", { x: 0, y: 0, width: W, height: MID })),
      el("clipPath", { id: "lm-down" }, el("rect", { x: 0, y: MID, width: W, height: MID }))),
    adv.length > 1 && el("polygon", { class: "adv up", points: `${tx(0)},${MID} ${advPts} ${tx((adv.length - 1) * 60)},${MID}`, "clip-path": "url(#lm-up)" }),
    adv.length > 1 && el("polygon", { class: "adv down", points: `${tx(0)},${MID} ${advPts} ${tx((adv.length - 1) * 60)},${MID}`, "clip-path": "url(#lm-down)" }),
    el("line", { x1: 0, x2: W, y1: MID, y2: MID, class: "axis" }),
    ...model.kills.map((k) => {
      const ours = model.players[k.killer].radiant === myRadiant;
      return el("line", { x1: tx(k.t), x2: tx(k.t), y1: ours ? 1 : H - 7, y2: ours ? 7 : H - 1, class: `tick ${ours ? "ours" : "theirs"}` });
    }),
    ...model.objectives.filter((o) => o.kind === "roshan").map((o) => el("circle", { cx: tx(o.t), cy: MID, r: 2.2, class: `rosh ${o.radiant === myRadiant ? "ours" : "theirs"}` })));
  const head = el("line", { x1: 0, x2: 0, y1: 0, y2: H, class: "head" });
  track.append(head);
  // ручка над шкалой: видно, за что тянуть
  const knob = document.createElement("i");
  knob.className = "lm-knob";

  // Перемотка: палец кладётся в любое место шкалы и ведёт, время идёт за пальцем.
  // Невидимый input range на телефоне ловил только саму ручку, а iOS не прыгал по тапу
  const range = document.createElement("input");
  Object.assign(range, { type: "range", min: String(t0), max: String(T), step: "1", value: String(t) });
  range.className = "lm-range";
  range.setAttribute("aria-label", "Время матча");
  range.addEventListener("input", () => { pause(); t = Number(range.value); draw(); });
  let dragging = false;
  const timeAtX = (clientX) => {
    const r = scrubBox.getBoundingClientRect();
    return t0 + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * (T - t0);
  };
  const scrubBox = document.createElement("div");
  scrubBox.className = "lm-scrub";
  scrubBox.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    dragging = true;
    scrubBox.classList.add("drag");
    try { scrubBox.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    pause();
    haptic("light");
    t = timeAtX(e.clientX);
    draw();
  });
  scrubBox.addEventListener("pointermove", (e) => { if (!dragging) return; t = timeAtX(e.clientX); draw(); });
  const stopDrag = () => { if (!dragging) return; dragging = false; scrubBox.classList.remove("drag"); };
  scrubBox.addEventListener("pointerup", stopDrag);
  scrubBox.addEventListener("pointercancel", stopDrag);
  scrubBox.addEventListener("lostpointercapture", stopDrag);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "lm-play";
  const icon = (d) => { const s = el("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, el("path", { d })); playBtn.replaceChildren(s); };
  const setIcon = () => { icon(playing ? "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" : "M8 5.5v13l10.5-6.5z"); playBtn.setAttribute("aria-label", playing ? "Пауза" : "Смотреть"); };
  playBtn.addEventListener("click", () => { haptic("light"); playing ? pause() : play(); });
  const btn = (cls, text, label, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", () => { haptic("light"); onClick(); });
    return b;
  };
  const back = btn("lm-step", "−15 с", "Назад на 15 секунд", () => seek(t - 15));
  const fwd = btn("lm-step", "+15 с", "Вперёд на 15 секунд", () => seek(t + 15));
  const followBtn = btn("lm-step lm-follow", "Следить", "Приблизить карту и вести выбранного героя", () => { follow = !follow; draw(true); });
  const speedBtn = document.createElement("button");
  speedBtn.type = "button";
  speedBtn.className = "lm-speed";
  const setSpeed = () => { speedBtn.textContent = `×${speed}`; };
  speedBtn.addEventListener("click", () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(); haptic("light"); });

  const clock = document.createElement("b");
  clock.className = "lm-clock";
  const score = document.createElement("div");
  score.className = "lm-score";
  const feed = document.createElement("div");
  feed.className = "lm-feed";
  feed.setAttribute("aria-live", "off");
  const info = document.createElement("div");
  info.className = "lm-info";

  // слои: тап по чипу прячет и показывает
  const layers = [["heroes", "Герои", model.hasPos], ["wards", "Варды", model.wards.length > 0], ["deaths", "Убийства", model.kills.some((k) => k.pos)],
    ["runes", "Руны", model.runes.some((r) => r.pos)], ["creeps", "Крипы", true], ["buildings", "Объекты", true], ["camps", "Кемпы", CAMPS.length > 0]];
  const chips = document.createElement("div");
  chips.className = "lm-layers";
  for (const [k, label, on] of layers) {
    if (!on) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lm-chip on";
    b.textContent = label;
    b.setAttribute("aria-pressed", "true");
    b.addEventListener("click", () => {
      const off = map.classList.toggle(`hide-${k}`);
      b.classList.toggle("on", !off);
      b.setAttribute("aria-pressed", String(!off));
      haptic("light");
    });
    chips.append(b);
  }

  // ---------- кадр ----------
  const state = { w: [], x: [], f: [], k: [], d: [], r: [], o: [], bf: [], b: [], h: [] };
  const show = (arr, i, node, on) => { if (node && arr[i] !== on) { arr[i] = on; node.setAttribute("display", on ? "inline" : "none"); } };
  // значок гаснет к концу своей жизни; life — сколько игровых секунд виден
  const fade = (node, age, life) => { if (!node) return; const o = Math.max(0.25, Math.min(1, 1 - (age - life * 0.6) / (life * 0.4))).toFixed(2); if (node.getAttribute("opacity") !== o) node.setAttribute("opacity", o); };
  const LIFE = { brk: 30, death: 45, strike: 5, rune: 20, rosh: 60, bfall: 8 };
  let lastFeedKey = "", lastScore = "", lastZoom = false;

  function draw(force = false) {
    model.wards.forEach((w, i) => {
      show(state.w, i, wNodes[i], t >= w.t && t < w.end);
      const on = xNodes[i] && t >= w.end && t < w.end + LIFE.brk;
      show(state.x, i, xNodes[i], on);
      if (on) fade(xNodes[i], t - w.end, LIFE.brk);
    });
    model.fights.forEach((f, i) => show(state.f, i, fNodes[i], t >= f.t - 2 && t < f.end + 4));
    model.kills.forEach((k, i) => {
      show(state.k, i, kNodes[i], t >= k.t && t < k.t + LIFE.strike);
      const on = t >= k.t && t < k.t + LIFE.death;
      show(state.d, i, dNodes[i], on);
      if (on) fade(dNodes[i], t - k.t, LIFE.death);
    });
    model.runes.forEach((r, i) => {
      const on = t >= r.t && t < r.t + LIFE.rune;
      show(state.r, i, rNodes[i], on);
      if (on) fade(rNodes[i], t - r.t, LIFE.rune);
    });
    roshList.forEach((o, i) => {
      const on = t >= o.t && t < o.t + LIFE.rosh;
      show(state.o, i, oNodes[i], on);
      if (on) fade(oNodes[i], t - o.t, LIFE.rosh);
    });
    model.buildings.forEach((b, i) => {
      const dead = b.died != null && t >= b.died;
      if (state.b[i] !== dead || force) { state.b[i] = dead; bNodes[i].classList.toggle("dead", dead); }
      show(state.bf, i, bfxNodes[i], dead && t < b.died + LIFE.bfall);
    });
    drawCreeps();
    drawBosses();
    // при «Следить» карта вдвое крупнее: значки ужимаем, чтобы не закрывали героев
    const zoom = Boolean(follow && selected >= 0 && model.hasPos);
    if (zoom !== lastZoom) { lastZoom = zoom; for (const [node, x, y, s] of scaled) placeAt(node, x, y, s, zoom ? 0.6 : 1); }
    if (model.hasPos) {
      // слежение: карта приближается вдвое и держит выбранного героя в центре
      const focus = follow && selected >= 0 ? model.posAt(selected, t) : null;
      const k = focus ? 0.55 : 1;
      if (focus) {
        const cx = Math.max(32, Math.min(96, mapX(focus[0]))), cy = Math.max(32, Math.min(96, mapY(focus[1])));
        cam = playing && cam ? [cam[0] + (cx - cam[0]) * 0.25, cam[1] + (cy - cam[1]) * 0.25] : [cx, cy];
        map.setAttribute("viewBox", `${(cam[0] - 32).toFixed(2)} ${(cam[1] - 32).toFixed(2)} 64 64`);
      } else if (cam) { cam = null; map.setAttribute("viewBox", "0 0 128 128"); }
      map.classList.toggle("zoomed", Boolean(focus));
      model.players.forEach((p, i) => {
        const at = model.posAt(i, t);
        const node = hNodes[i];
        show(state.h, i, node, Boolean(at));
        if (at) node.setAttribute("transform", `translate(${mapX(at[0]).toFixed(2)} ${mapY(at[1]).toFixed(2)})${k !== 1 ? ` scale(${k})` : ""}`);
        node.classList.toggle("sel", i === selected);
      });
      // выбранный герой рисуется поверх остальных
      if (selected >= 0 && hNodes[selected].nextSibling) hLayer.append(hNodes[selected]);
      drawTails();
      drawTrail();
    }
    // счёт и перевес
    let ours = 0, theirs = 0;
    for (const k of model.kills) { if (k.t > t) break; if (model.players[k.killer].radiant === myRadiant) ours++; else theirs++; }
    const m = Math.max(0, Math.min(adv.length - 1, Math.floor(t / 60)));
    const g = adv.length ? adv[m] + ((adv[Math.min(adv.length - 1, m + 1)] - adv[m]) * Math.max(0, (t / 60) - m)) : 0;
    const clockText = mm(Math.max(t, t0));
    if (clock.textContent !== clockText) clock.textContent = clockText;
    const scoreKey = `${ours}:${theirs}:${Math.round(g / 100)}`;
    if (scoreKey !== lastScore) {
      lastScore = scoreKey;
      score.replaceChildren(
      Object.assign(document.createElement("span"), { className: "ours", textContent: String(ours) }),
      Object.assign(document.createElement("i"), { textContent: ":" }),
      Object.assign(document.createElement("span"), { className: "theirs", textContent: String(theirs) }),
      Object.assign(document.createElement("small"), { className: g >= 0 ? "ours" : "theirs", textContent: Math.abs(g) < 500 ? "золото ровно" : `${g > 0 ? "+" : "−"}${(Math.abs(g) / 1000).toFixed(1)}к ${g > 0 ? "у вас" : "у врагов"}` }));
    }
    range.value = String(Math.round(t));
    const x = tx(t);
    head.setAttribute("x1", x.toFixed(1));
    head.setAttribute("x2", x.toFixed(1));
    knob.style.left = `${((t - t0) / Math.max(1, T - t0)) * 100}%`;
    followBtn.disabled = !model.hasPos || selected < 0;
    followBtn.setAttribute("aria-pressed", String(follow && selected >= 0));
    followBtn.classList.toggle("on", follow && selected >= 0);
    // лента: последние 4 события за полторы минуты
    const recent = feedAt(t);
    const key = recent.map((e) => `${e.t}${e.type}${e.i}`).join("|");
    if (key !== lastFeedKey) {
      lastFeedKey = key;
      feed.replaceChildren(...(recent.length ? recent.reverse().map((e) => feedRow(e))
        : [Object.assign(document.createElement("p"), { className: "lm-empty", textContent: t <= 0 ? "Жми плей: матч пойдёт с первой секунды, убийства, сломанные варды, руны и снесённые здания появятся здесь." : "Последние полторы минуты тихо." })]));
    }
    if (selected >= 0) {
      const p = model.players[selected];
      const k = model.kills.filter((x) => x.t <= t && x.killer === selected).length;
      const d = model.kills.filter((x) => x.t <= t && x.victim === selected).length;
      const line = `${p.name}${p.me ? " (ты)" : ""} · ${k} ${plural(k, "убийство", "убийства", "убийств")}, ${d} ${plural(d, "смерть", "смерти", "смертей")} к ${mm(Math.max(t, 0))}`;
      if (info.textContent !== line) info.textContent = line;
    } else info.textContent = model.hasPos ? "Тапни по герою: покажу его путь за минуту, «Следить» приблизит карту к нему." : "";
    info.classList.toggle("foe", selected >= 0 && model.players[selected].radiant !== myRadiant);
  }

  // путь за минуту кусками по 10 секунд: старые бледнее; телепорт и смерть рвут линию.
  // Точки — каждые 10 секунд, по ним видно, где стоял, а где бежал
  function drawTrail() {
    const ds = trailParts.map(() => "");
    const dots = [];
    if (selected >= 0) {
      let prev = null;
      for (let s = Math.ceil(Math.max(t0, t - TRAIL)); s <= t; s += 1) {
        const q = model.posAt(selected, s);
        if (!q) { prev = null; continue; }
        const xy = `${mapX(q[0]).toFixed(1)} ${mapY(q[1]).toFixed(1)}`;
        const x = mapX(q[0]), y = mapY(q[1]);
        if (prev && Math.hypot(x - prev[0], y - prev[1]) < 8) {
          const n = Math.min(TRAIL_PARTS - 1, Math.floor(((s - (t - TRAIL)) / TRAIL) * TRAIL_PARTS));
          ds[n] += `M${prev[0].toFixed(1)} ${prev[1].toFixed(1)}L${xy}`;
        }
        if (s % 10 === 0 && s < t - 1) dots.push([x, y]);
        prev = [x, y];
      }
    }
    trailParts.forEach((node, n) => node.setAttribute("d", ds[n]));
    trailDots.replaceChildren(...dots.map(([x, y]) => el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 0.6 })));
    trail.setAttribute("class", `lm-trail${selected < 0 ? "" : model.players[selected].me ? " mine" : model.players[selected].radiant === myRadiant ? " ally" : " foe"}`);
  }

  // все события ленты по времени: убийства, сломанные варды, руны (кроме богатства), Рошан, здания, выкупы
  const events = [
    ...model.kills.map((k, i) => ({ t: k.t, type: "kill", i, k, first: i === 0 })),
    ...model.wards.map((w, i) => (w.breaker != null ? { t: w.end, type: "brk", i, w } : null)).filter(Boolean),
    ...model.runes.map((r, i) => (r.kind !== 5 ? { t: r.t, type: "rune", i, r } : null)).filter(Boolean),
    ...model.objectives.filter((o) => o.kind === "roshan" || o.kind === "building").map((o, i) => ({ t: o.t, type: o.kind, i, o })),
    ...model.buybacks.map((b, i) => ({ t: b.t, type: "bb", i, b })),
    ...model.tormentorKills.map((x, i) => (x.who != null ? { t: x.t, type: "torm", i, x } : null)).filter(Boolean),
  ].sort((a, b) => a.t - b.t);
  function feedAt(now) {
    const out = [];
    for (const e of events) { if (e.t > now) break; if (now - e.t < 90) out.push(e); }
    return out.slice(-4);
  }

  function feedRow(e) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `lm-ev ${e.type}`;
    // тап по событию — перемотка за 10 секунд до него: видно, как к этому пришли
    row.addEventListener("click", () => { haptic("light"); seek(e.t - 10); });
    const time = Object.assign(document.createElement("time"), { textContent: mm(e.t) });
    const span = (text) => Object.assign(document.createElement("span"), { textContent: text });
    const word = (text) => Object.assign(document.createElement("i"), { textContent: text });
    const nm = (i) => model.players[i].name + (model.players[i].me ? " (ты)" : "");
    const ours = (i) => model.players[i].radiant === myRadiant;
    let ico, good, parts;
    if (e.type === "kill") {
      good = ours(e.k.killer);
      ico = badge(GLYPH.skull, sideOf(e.k.victim));
      parts = [e.first && word("Первая кровь:"), span(nm(e.k.killer)), word("убил"), span(nm(e.k.victim))];
    } else if (e.type === "brk") {
      good = ours(e.w.breaker);
      ico = badge(GLYPH.eyeOff, sideOf(e.w.breaker));
      parts = [span(nm(e.w.breaker)), word(`сломал ${e.w.kind === "obs" ? "обс" : "сентри"}`), span(nm(e.w.owner))];
    } else if (e.type === "rune") {
      good = ours(e.r.who);
      ico = badge(RUNE_GLYPH[e.r.kind], sideOf(e.r.who), { hex: true });
      parts = [span(nm(e.r.who)), word(`взял руну ${RUNES[e.r.kind]}`)];
    } else if (e.type === "roshan") {
      good = e.o.radiant === myRadiant;
      ico = badge(GLYPH.roshan, "gold");
      parts = [span(`Рошан у ${good ? "вас" : "врагов"}`), e.o.aegis != null && word("Аегис у"), e.o.aegis != null && span(nm(e.o.aegis))];
    } else if (e.type === "building") {
      good = (e.o.b.side === "goodguys") !== myRadiant;
      ico = badge(GLYPH.tower, good ? "foe" : "ally");
      parts = [span(buildingLabel(e.o.b)), word(e.o.by != null ? "снёс" : "— снесли"), e.o.by != null && span(nm(e.o.by))];
    } else if (e.type === "torm") {
      good = ours(e.x.who);
      ico = badge(GLYPH.tormentor, sideOf(e.x.who));
      parts = [span(nm(e.x.who)), word("добил торментора")];
    } else {
      good = ours(e.b.who);
      ico = badge(GLYPH.buyback, sideOf(e.b.who));
      parts = [span(nm(e.b.who)), word("выкупился")];
    }
    row.classList.add(good ? "ours" : "theirs");
    row.append(time, iconSvg(ico), ...parts.filter(Boolean));
    return row;
  }

  function drawCreeps() {
    for (const w of waves) {
      const { lane } = w;
      const F = lane.front(t);
      const travel = lane.len / CREEP_SPEED;
      const fight = { rad: false, dire: false };
      for (const side of ["rad", "dire"]) {
        const nodes = w[side];
        let n = 0;
        if (t >= 0) {
          for (let k = Math.floor(t / 30); k >= 0 && k * 30 > t - travel - WAVE_FIGHT; k--) {
            const age = t - k * 30;
            const startS = side === "rad" ? lane.len * 0.03 : lane.len * 0.97;
            const need = Math.abs(F - startS) / CREEP_SPEED; // сколько идти до фронта
            if (age > need + WAVE_FIGHT || n >= nodes.length) continue;
            const atFront = age >= need;
            const d = atFront ? F + (side === "rad" ? -1.3 : 1.3) : startS + (side === "rad" ? 1 : -1) * age * CREEP_SPEED;
            const [x, y] = lane.at(d);
            const node = nodes[n++];
            node.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
            node.classList.toggle("fighting", atFront);
            if (node.getAttribute("display") !== "inline") node.setAttribute("display", "inline");
            if (atFront) fight[side] = true;
          }
        }
        for (; n < nodes.length; n++) if (nodes[n].getAttribute("display") !== "none") nodes[n].setAttribute("display", "none");
      }
      const both = fight.rad && fight.dire;
      if (both) { const [x, y] = lane.at(F); w.clash.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`); }
      const want = both ? "inline" : "none";
      if (w.clash.getAttribute("display") !== want) w.clash.setAttribute("display", want);
    }
  }

  const clockOf = (sec) => mm(Math.ceil(sec));
  function setLabel(node, text) { const tl = node.querySelector(".lm-timer"); if (tl.textContent !== text) tl.textContent = text; }
  function drawBosses() {
    const r = model.roshanAt(t);
    const [px, py] = r.pit;
    const k = lastZoom ? 0.6 : 1;
    placeAt(roshNode, px, py, 0.62, k);
    roshNode.setAttribute("class", `lm-boss rosh ${r.state}`);
    setLabel(roshNode, r.state === "dead" ? clockOf(r.back) : r.state === "maybe" ? `до ${clockOf(r.back)}` : "");
    tormNodes.forEach((node, n) => {
      const st = model.tormentorAt(t, n);
      const on = st.state !== "none";
      if (node.getAttribute("display") !== (on ? "inline" : "none")) node.setAttribute("display", on ? "inline" : "none");
      node.setAttribute("class", `lm-boss torm ${st.state}`);
      setLabel(node, st.state === "dead" ? clockOf(st.back) : "");
    });
  }

  // хвосты всех героев за последние секунды: старая часть бледнее, телепорт рвёт линию
  function drawTails() {
    model.players.forEach((p, i) => {
      let dOld = "", dNew = "", prev = null;
      if (state.h[i]) {
        const marks = [];
        for (let s = Math.ceil(Math.max(t0, t - TAIL)); s < t; s++) marks.push(s);
        marks.push(t);
        for (const s of marks) {
          const q = model.posAt(i, s);
          if (!q) { prev = null; continue; }
          const x = mapX(q[0]), y = mapY(q[1]);
          if (prev && Math.hypot(x - prev[0], y - prev[1]) < 8) {
            const seg = `M${prev[0].toFixed(1)} ${prev[1].toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
            if (s > t - TAIL / 2) dNew += seg; else dOld += seg;
          }
          prev = [x, y];
        }
      }
      const [o, n] = tails[i].childNodes;
      o.setAttribute("d", dOld);
      n.setAttribute("d", dNew);
    });
  }

  function frame(now) {
    // карту убрали со страницы или приложение свернули — не крутим кадры в фоне
    if (!root.isConnected || document.hidden) { pause(); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt * speed;
    if (t >= T) { t = T; pause(); draw(); return; }
    draw();
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (playing) return; // второй цикл кадров — карта шла бы вдвое быстрее
    if (t >= T) t = t0;
    playing = true;
    setIcon();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    setIcon();
  }
  // карта ушла с экрана (другая вкладка, уход со страницы) — не крутим кадры впустую
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { if (!es[es.length - 1].isIntersecting && playing) pause(); }) : null;
  map.addEventListener("click", () => { if (selected >= 0 && !follow) { selected = -1; draw(true); } });
  function seek(s) { pause(); t = Math.max(t0, Math.min(T, s)); draw(); }

  setIcon();
  setSpeed();
  draw(true);

  const root = document.createElement("div");
  root.className = "live-map";
  const top = document.createElement("div");
  top.className = "lm-top";
  top.append(clock, score);
  const controls = document.createElement("div");
  controls.className = "lm-controls";
  scrubBox.append(track, knob, range);
  controls.append(playBtn, scrubBox, speedBtn);
  const steps = document.createElement("div");
  steps.className = "lm-steps";
  steps.append(back, fwd, followBtn);
  const frameBox = document.createElement("div");
  frameBox.className = "lm-frame";
  // часы и счёт над картой, а не поверх: углы карты (торменторы, базы) не закрыты
  frameBox.append(map);
  root.append(top, frameBox, controls, steps, info, feed, legend(), chips);
  if (io) io.observe(root);
  root.seek = seek;
  return root;
}
