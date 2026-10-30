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

// Все события и сущности для повтора. heroKey(hero_id) -> "tusk", heroName(hero_id) -> "Tusk"
export function replayModel(match, replay, me, { heroKey, heroName }) {
  const players = match.players.map((p) => ({
    slot: p.player_slot, radiant: p.player_slot < 128, hero_id: p.hero_id, key: heroKey(p.hero_id), name: heroName(p.hero_id), me: p === me,
  }));
  const byKey = new Map(players.map((p) => [`npc_dota_hero_${p.key}`, p]));
  const duration = match.duration;
  // позиции: массив точек раз в step секунд от start
  const pos = replay && replay.pos ? players.map((p) => replay.pos[String(p.slot)] || null) : null;
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
      kills.push({ t: k.time, killer: ki, victim: vi, pos: lastPos(vi, k.time) });
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

  const wards = [];
  match.players.forEach((p, i) => {
    const left = new Map((p.obs_left_log || []).filter((w) => "ehandle" in w).map((w) => [w.ehandle, w.time]));
    const senLeft = new Map((p.sen_left_log || []).filter((w) => "ehandle" in w).map((w) => [w.ehandle, w.time]));
    for (const w of p.obs_log || []) {
      if (typeof w.x !== "number") continue;
      const end = left.has(w.ehandle) ? left.get(w.ehandle) : w.time + OBS_LIFE;
      wards.push({ kind: "obs", owner: i, radiant: players[i].radiant, x: w.x, y: w.y, t: w.time, end, dewarded: end < w.time + OBS_LIFE - 10 });
    }
    for (const w of p.sen_log || []) {
      if (typeof w.x !== "number") continue;
      const end = senLeft.has(w.ehandle) ? senLeft.get(w.ehandle) : w.time + SEN_LIFE;
      wards.push({ kind: "sen", owner: i, radiant: players[i].radiant, x: w.x, y: w.y, t: w.time, end });
    }
  });

  const buildings = [];
  const t4seen = { goodguys: 0, badguys: 0 };
  for (const [side, list] of Object.entries(BUILDINGS)) {
    for (const [name, xy] of Object.entries(list)) {
      const spots = name === "tower4" ? xy : [xy];
      spots.forEach((s, n) => buildings.push({ id: `${side}_${name}${name === "tower4" ? n : ""}`, key: `npc_dota_${side}_${name}`, side, kind: name.startsWith("tower") ? "tower" : name === "fort" ? "fort" : "rax", x: s[0], y: s[1], died: null }));
    }
  }
  const objectives = [];
  for (const o of match.objectives || []) {
    if (o.type === "building_kill" && typeof o.key === "string") {
      const side = o.key.includes("goodguys") ? "goodguys" : o.key.includes("badguys") ? "badguys" : null;
      if (!side) continue;
      let b;
      if (/_tower4$/.test(o.key)) { b = buildings.find((x) => x.id === `${side}_tower4${t4seen[side]}`); t4seen[side]++; } else b = buildings.find((x) => x.key === o.key);
      if (b && b.died == null) { b.died = o.time; objectives.push({ t: o.time, kind: "building", b }); }
    } else if (o.type === "CHAT_MESSAGE_ROSHAN_KILL") {
      objectives.push({ t: o.time, kind: "roshan", radiant: o.team === 2 });
    }
  }
  // трон без записи падает в конце матча у проигравших
  const loser = match.radiant_win ? "badguys" : "goodguys";
  const fort = buildings.find((b) => b.id === `${loser}_fort`);
  if (fort && fort.died == null) { fort.died = duration; objectives.push({ t: duration, kind: "building", b: fort }); }
  objectives.sort((a, b) => a.t - b.t);

  const meIdx = players.findIndex((p) => p.me);
  return { players, kills, wards, buildings, objectives, duration, posAt, hasPos: Boolean(pos), meIdx,
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

// Подпись к значкам карты: что чем обозначено
function legend() {
  const row = document.createElement("div");
  row.className = "lm-legend";
  const item = (svgKids, text) => {
    const span = document.createElement("span");
    span.append(el("svg", { viewBox: "-5 -5 10 10", "aria-hidden": "true" }, svgKids), text);
    return span;
  };
  row.append(...[
    item(el("circle", { r: 3.6, class: "lg-me" }), "ты"),
    item(el("circle", { r: 3.6, class: "lg-ally" }), "свои"),
    item(el("circle", { r: 3.6, class: "lg-foe" }), "враги"),
    item(el("path", { d: "M-4 3 L0 -1 L4 1", class: "lg-path" }), "путь за минуту"),
    item([el("circle", { r: 4, class: "lg-vis" }), el("circle", { r: 1.6, class: "lg-obs" })], "обс и обзор"),
    item(el("rect", { x: -1.8, y: -1.8, width: 3.6, height: 3.6, class: "lg-sen" }), "сентри"),
    item(el("path", { d: "M-2.5 -2.5 L2.5 2.5 M-2.5 2.5 L2.5 -2.5", class: "lg-death" }), "смерть"),
    item(el("rect", { x: -2.2, y: -2.2, width: 4.4, height: 4.4, transform: "rotate(45)", class: "lg-tower" }), "башня"),
    CAMPS.length > 0 && item(campIcon("large"), "кемп"),
  ].filter(Boolean));
  const camp = row.querySelector(".lm-camp");
  if (camp) camp.setAttribute("transform", "scale(2.2)");
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

  // варды
  const wLayer = el("g", { class: "lm-wards" });
  const wNodes = model.wards.map((w) => {
    const ally = w.radiant === myRadiant;
    const node = el("g", { class: `lm-w ${w.kind} ${ally ? "ally" : "foe"}${model.players[w.owner].me ? " mine" : ""}`, transform: `translate(${mapX(w.x).toFixed(1)} ${mapY(w.y).toFixed(1)})`, display: "none" },
      el("title", {}, `${w.kind === "obs" ? "Обс" : "Сентри"} ${model.players[w.owner].name}, ${mm(w.t)}`),
      w.kind === "obs" ? [el("circle", { r: OBS_VISION, class: "lm-vis" }), el("circle", { r: 1.25, class: "lm-dot" })] : el("rect", { x: -1, y: -1, width: 2, height: 2, rx: 0.3, class: "lm-dot" }));
    wLayer.append(node);
    return node;
  });

  // смерти: крестик в цвет погибшего, видно 40 секунд игрового времени
  const dLayer = el("g", { class: "lm-deaths" });
  const dNodes = model.kills.map((k) => {
    if (!k.pos) return null;
    const v = model.players[k.victim];
    const node = el("g", { class: `lm-d ${v.radiant === myRadiant ? "ally" : "foe"}${v.me ? " mine" : ""}`, transform: `translate(${mapX(k.pos[0]).toFixed(1)} ${mapY(k.pos[1]).toFixed(1)})`, display: "none" },
      el("title", {}, `${model.players[k.killer].name} убил ${v.name}, ${mm(k.t)}`),
      el("circle", { r: 2.6, class: "halo" }),
      el("path", { d: "M-1.5 -1.5 L1.5 1.5 M-1.5 1.5 L1.5 -1.5" }));
    dLayer.append(node);
    return node;
  });

  // путь выбранного героя за последнюю минуту: чем свежее, тем ярче, стрелка в конце — куда идёт
  const TRAIL = 60, TRAIL_PARTS = 6;
  const trail = el("g", { class: "lm-trail" });
  const trailParts = Array.from({ length: TRAIL_PARTS }, (_, n) => el("path", { d: "", opacity: (0.18 + (0.82 * (n + 1)) / TRAIL_PARTS).toFixed(2) }));
  const trailDots = el("g", { class: "lm-trail-dots" });
  trail.append(...trailParts, trailDots);

  // герои
  const hLayer = el("g", { class: "lm-heroes" });
  const hNodes = model.players.map((p, i) => {
    const node = el("g", { class: `lm-h ${p.radiant === myRadiant ? "ally" : "foe"}${p.me ? " mine" : ""}`, display: "none", "data-i": i },
      el("circle", { r: 3.4, class: "ring" }),
      // буквы видны, пока иконка не загрузилась или если CDN Steam недоступен
      el("text", { class: "ini", y: 1.1, "text-anchor": "middle" }, p.name.slice(0, 2)),
      el("image", { href: iconUrl(p.hero_id), x: -2.7, y: -2.7, width: 5.4, height: 5.4, "clip-path": "url(#lm-clip)", preserveAspectRatio: "xMidYMid slice" }),
      el("title", {}, p.name));
    node.addEventListener("click", (e) => { e.stopPropagation(); selected = selected === i ? -1 : i; haptic("light"); draw(true); });
    hLayer.append(node);
    return node;
  });

  const map = el("svg", { class: "minimap live", viewBox: "0 0 128 128", role: "img", "aria-label": "Повтор матча на карте" },
    defs, el("image", { href: terrainUrl(), x: 0, y: 0, width: 128, height: 128, preserveAspectRatio: "none" }),
    cLayer, bLayer, wLayer, dLayer, trail, hLayer);

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
  const layers = [["heroes", "Герои", model.hasPos], ["camps", "Кемпы", CAMPS.length > 0], ["wards", "Варды", model.wards.length > 0], ["deaths", "Смерти", model.kills.some((k) => k.pos)], ["buildings", "Здания", true]];
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
  const state = { w: [], d: [], b: [], h: [] };
  const show = (arr, i, node, on) => { if (node && arr[i] !== on) { arr[i] = on; node.setAttribute("display", on ? "inline" : "none"); } };
  let lastFeedKey = "", lastScore = "";

  function draw(force = false) {
    model.wards.forEach((w, i) => show(state.w, i, wNodes[i], t >= w.t && t < w.end));
    model.kills.forEach((k, i) => show(state.d, i, dNodes[i], t >= k.t && t < k.t + 40));
    model.buildings.forEach((b, i) => {
      const dead = b.died != null && t >= b.died;
      if (state.b[i] !== dead || force) { state.b[i] = dead; bNodes[i].classList.toggle("dead", dead); }
    });
    if (model.hasPos) {
      // слежение: карта приближается вдвое и держит выбранного героя в центре
      const focus = follow && selected >= 0 ? model.posAt(selected, t) : null;
      const k = focus ? 0.62 : 1;
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
    // лента: последние 3 события до текущей секунды
    const evs = [];
    for (const k of model.kills) { if (k.t > t) break; evs.push({ t: k.t, kill: k }); }
    for (const o of model.objectives) { if (o.t > t) break; evs.push({ t: o.t, obj: o }); }
    evs.sort((a, b) => a.t - b.t);
    const recent = evs.filter((e) => t - e.t < 90).slice(-3);
    const key = recent.map((e) => `${e.t}${e.kill ? e.kill.victim : e.obj.kind}`).join("|");
    if (key !== lastFeedKey) {
      lastFeedKey = key;
      feed.replaceChildren(...(recent.length ? recent.reverse().map((e) => feedRow(e))
        : [Object.assign(document.createElement("p"), { className: "lm-empty", textContent: t <= 0 ? "Жми плей: матч пойдёт с первой секунды, убийства и снесённые здания появятся здесь." : "Последние полторы минуты тихо." })]));
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

  function feedRow(e) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "lm-ev";
    // тап по событию — перемотка за 10 секунд до него: видно, как к этому пришли
    row.addEventListener("click", () => { haptic("light"); seek(e.t - 10); });
    const time = Object.assign(document.createElement("time"), { textContent: mm(e.t) });
    if (e.kill) {
      const killer = model.players[e.kill.killer], victim = model.players[e.kill.victim];
      const ours = killer.radiant === myRadiant;
      row.classList.add(ours ? "ours" : "theirs");
      row.append(time,
        Object.assign(document.createElement("span"), { textContent: killer.name }),
        Object.assign(document.createElement("i"), { textContent: "убил" }),
        Object.assign(document.createElement("span"), { textContent: victim.name + (victim.me ? " (ты)" : "") }));
    } else if (e.obj.kind === "building") {
      const ours = (e.obj.b.side === "goodguys") !== myRadiant;
      row.classList.add(ours ? "ours" : "theirs");
      row.append(time, Object.assign(document.createElement("span"), { textContent: `${buildingLabel(e.obj.b)} — снесли` }));
    } else {
      row.classList.add(e.obj.radiant === myRadiant ? "ours" : "theirs");
      row.append(time, Object.assign(document.createElement("span"), { textContent: `Рошан у ${e.obj.radiant === myRadiant ? "вас" : "врагов"}` }));
    }
    return row;
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
  frameBox.append(map, top);
  root.append(frameBox, controls, steps, info, feed, legend(), chips);
  if (io) io.observe(root);
  root.seek = seek;
  return root;
}
