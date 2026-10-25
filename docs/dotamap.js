// Карта Доты: рисованная подложка (лес, река, линии, базы) и живой повтор матча со всеми десятью героями.
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
const mm = (t) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;

// ---------- геометрия карты ----------

// Линии и река в координатах SVG (по башням: у Света низ-лево, у Тьмы верх-право)
const LANES = [
  [[17, 104], [14, 92], [14, 50], [13.5, 24], [17, 16.5], [26, 16], [64, 16.5], [92, 18], [100, 24]],
  [[24, 104], [36.6, 85.8], [51.9, 75], [68.1, 58.9], [83.5, 47.5], [97.4, 34.6], [104, 24]],
  [[28, 111], [62, 112.5], [102, 112], [110.5, 110.5], [113.5, 103], [113.5, 61], [113.5, 40], [111, 26]],
];
const RIVER = [[2, 31], [13, 35], [26, 41], [38, 48], [50, 56], [64, 64], [78, 72], [90, 80], [102, 87], [115, 93], [126, 97]];

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

// Детерминированный шум: лес выглядит одинаково при каждом открытии
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const lineDist = (x, y, pts) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1], pts[i])); return d; };

// Сглаженный путь через точки (Catmull-Rom -> кубические Безье)
function smooth(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const inBase = (x, y) => (x < 36 && y > 92 && x + (128 - y) < 52) || (x > 92 && y < 36 && (128 - x) + y < 52);
// Поляны лагерей и проходы: без них лес сплошной и не похож на карту
const CLEARINGS = [[30, 60, 5], [42, 70, 4.5], [26, 78, 4], [52, 92, 5], [76, 98, 4.5], [88, 104, 4], [44, 100, 4], [64, 82, 4],
  [98, 68, 5], [86, 58, 4.5], [102, 50, 4], [76, 36, 5], [52, 30, 4.5], [40, 24, 4], [84, 28, 4], [64, 46, 4],
  [34, 46, 4], [94, 82, 4], [57, 64, 3.5], [71, 64, 3.5]];

// Где ходят герои: клетки 128x128 (бит на клетку), снято по позициям всех десяти в настоящем реплее.
// Лес на подложке ставится только там, где никто не проходил, поэтому тропы совпадают с игрой
const WALK = "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";
let walkBits = null;
function walkable(x, y) {
  if (!walkBits) walkBits = Uint8Array.from(atob(WALK), (ch) => ch.charCodeAt(0));
  const i = Math.floor(x), j = Math.floor(y);
  if (i < 0 || j < 0 || i > 127 || j > 127) return false;
  const n = j * 128 + i;
  return (walkBits[n >> 3] >> (n & 7)) & 1;
}

let terrainCache = null;
// Подложка одной картинкой: браузер растеризует её один раз, а не сотни кружков на каждом кадре
export function terrainUrl() {
  if (terrainCache) return terrainCache;
  const r = rng(22);
  const rad = [], dire = [], tops = [];
  for (let gy = 2; gy < 127; gy += 1.7) {
    for (let gx = 2; gx < 127; gx += 1.7) {
      const x = gx + (r() - 0.5) * 1.4, y = gy + (r() - 0.5) * 1.4;
      if (inBase(x, y)) continue;
      if (LANES.some((l) => lineDist(x, y, l) < 4)) continue;
      if (lineDist(x, y, RIVER) < 4.4) continue;
      if (walkable(x, y)) continue;
      if (r() < 0.05) continue;
      const rr = 0.9 + r() * 0.6;
      const c = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(2)}"/>`;
      (x - y > 0 ? dire : rad).push(c);
      // кроны: светлые точки поверх массива леса
      if (r() < 0.55) tops.push(`<circle cx="${(x - 0.3).toFixed(1)}" cy="${(y - 0.3).toFixed(1)}" r="${(rr * 0.42).toFixed(2)}" fill="${x - y > 0 ? "#7a4a30" : "#3d7350"}" opacity="${(0.25 + r() * 0.35).toFixed(2)}"/>`);
    }
  }
  const forest = (list, fill) => `<g filter="url(#goo)" fill="${fill}">${list.join("")}</g>`;
  const lane = (pts) => `<path d="${smooth(pts)}" stroke="#3a3328" stroke-width="4.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`
    + `<path d="${smooth(pts)}" stroke="#5b513f" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
  const river = smooth(RIVER);
  const svgText = `<svg xmlns="${NS}" viewBox="0 0 128 128" width="1024" height="1024">
<defs>
<linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1c2b22"/><stop offset=".5" stop-color="#22221f"/><stop offset="1" stop-color="#2e1d1b"/></linearGradient>
<radialGradient id="v" cx=".5" cy=".5" r=".72"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
<filter id="b" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.4"/></filter>
<filter id="goo" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation=".7" result="bl"/><feColorMatrix in="bl" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -7" result="m"/><feOffset in="m" dx=".45" dy=".7" result="o"/><feFlood flood-color="#000" flood-opacity=".55"/><feComposite in2="o" operator="in" result="sh"/><feMerge><feMergeNode in="sh"/><feMergeNode in="m"/></feMerge></filter>
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .06 0"/></filter>
</defs>
<rect width="128" height="128" fill="url(#g)"/>
<rect width="128" height="128" filter="url(#n)"/>
${LANES.map(lane).join("")}
<path d="${river}" stroke="#0b3442" stroke-width="9.5" fill="none" stroke-linecap="round" filter="url(#b)" opacity=".9"/>
<path d="${river}" stroke="#17566a" stroke-width="5.6" fill="none" stroke-linecap="round"/>
<path d="${river}" stroke="#3c9db2" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".5"/>
${forest(rad, "#13301f")}
${forest(dire, "#2e1913")}
${tops.join("")}
<path d="M3 125 L3 96 Q12 94 22 98 L34 110 Q36 118 32 125 Z" fill="#1d3a2a" stroke="#4fae74" stroke-width=".45" opacity=".95"/>
<path d="M125 3 L125 32 Q116 34 106 30 L94 18 Q92 10 96 3 Z" fill="#3a1c1c" stroke="#d0604f" stroke-width=".45" opacity=".95"/>
<circle cx="9" cy="119" r="4.6" fill="#4fae74" opacity=".25"/><circle cx="119" cy="9" r="4.6" fill="#d0604f" opacity=".25"/>
<rect width="128" height="128" fill="url(#v)"/>
</svg>`;
  terrainCache = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  return terrainCache;
}

// Карта-основа для статичных слоёв (тепловая карта, пути перед смертями)
export function minimap(points, { label, cls = "" } = {}) {
  return el("svg", { class: `minimap ${cls}`, viewBox: "0 0 128 128", role: "img", "aria-label": label },
    el("image", { href: terrainUrl(), x: 0, y: 0, width: 128, height: 128, preserveAspectRatio: "none" }),
    ...points);
}

// ---------- данные повтора из матча OpenDota и файла реплея ----------

const OBS_LIFE = 360, SEN_LIFE = 420;

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
  const kills4 = {};
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
      kills4[side] = true;
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

// iconUrl(hero_id) -> маленькая иконка героя; onSelect(i) — тап по герою
export function liveMap(model, { iconUrl, haptic = () => {} }) {
  const myRadiant = model.meIdx >= 0 ? model.players[model.meIdx].radiant : true;
  const t0 = model.hasPos ? model.start : 0;
  const T = model.duration;
  let t = model.hasPos ? Math.min(T, 0) : T;
  let playing = false, speed = SPEEDS[1], raf = 0, last = 0, selected = model.meIdx;

  const defs = el("defs", {},
    el("clipPath", { id: "lm-clip", clipPathUnits: "objectBoundingBox" }, el("circle", { cx: 0.5, cy: 0.5, r: 0.5 })),
    el("filter", { id: "lm-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, el("feGaussianBlur", { stdDeviation: 1.1 })));

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

  // варды
  const wLayer = el("g", { class: "lm-wards" });
  const wNodes = model.wards.map((w) => {
    const ally = w.radiant === myRadiant;
    const node = el("g", { class: `lm-w ${w.kind} ${ally ? "ally" : "foe"}${model.players[w.owner].me ? " mine" : ""}`, transform: `translate(${mapX(w.x).toFixed(1)} ${mapY(w.y).toFixed(1)})`, display: "none" },
      el("title", {}, `${w.kind === "obs" ? "Обс" : "Сентри"} ${model.players[w.owner].name}, ${mm(w.t)}`),
      w.kind === "obs" ? [el("circle", { r: 4.2, class: "lm-vis" }), el("circle", { r: 1.25, class: "lm-dot" })] : el("rect", { x: -1, y: -1, width: 2, height: 2, rx: 0.3, class: "lm-dot" }));
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

  // след выбранного героя за последние 20 секунд
  const trail = el("polyline", { class: "lm-trail", points: "" });

  // герои
  const hLayer = el("g", { class: "lm-heroes" });
  const hNodes = model.players.map((p, i) => {
    const node = el("g", { class: `lm-h ${p.radiant === myRadiant ? "ally" : "foe"}${p.me ? " mine" : ""}`, display: "none", "data-i": i },
      el("circle", { r: 4.1, class: "ring" }),
      // буквы видны, пока иконка не загрузилась или если CDN Steam недоступен
      el("text", { class: "ini", y: 1.3, "text-anchor": "middle" }, p.name.slice(0, 2)),
      el("image", { href: iconUrl(p.hero_id), x: -3.3, y: -3.3, width: 6.6, height: 6.6, "clip-path": "url(#lm-clip)", preserveAspectRatio: "xMidYMid slice" }),
      el("title", {}, p.name));
    node.addEventListener("click", (e) => { e.stopPropagation(); selected = selected === i ? -1 : i; haptic("light"); draw(true); });
    hLayer.append(node);
    return node;
  });

  const map = el("svg", { class: "minimap live", viewBox: "0 0 128 128", role: "img", "aria-label": "Повтор матча на карте" },
    defs, el("image", { href: terrainUrl(), x: 0, y: 0, width: 128, height: 128, preserveAspectRatio: "none" }),
    bLayer, wLayer, dLayer, trail, hLayer);

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

  const range = document.createElement("input");
  Object.assign(range, { type: "range", min: String(t0), max: String(T), step: "1", value: String(t) });
  range.className = "lm-range";
  range.setAttribute("aria-label", "Время матча");
  range.addEventListener("input", () => { pause(); t = Number(range.value); draw(); });

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "lm-play";
  const icon = (d) => { const s = el("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, el("path", { d })); playBtn.replaceChildren(s); };
  const setIcon = () => { icon(playing ? "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" : "M8 5.5v13l10.5-6.5z"); playBtn.setAttribute("aria-label", playing ? "Пауза" : "Смотреть"); };
  playBtn.addEventListener("click", () => { haptic("light"); playing ? pause() : play(); });
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
  const layers = [["heroes", "Герои", model.hasPos], ["wards", "Варды", model.wards.length > 0], ["deaths", "Смерти", model.kills.some((k) => k.pos)], ["buildings", "Здания", true]];
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
  let lastFeedKey = "";

  function draw(force = false) {
    model.wards.forEach((w, i) => show(state.w, i, wNodes[i], t >= w.t && t < w.end));
    model.kills.forEach((k, i) => show(state.d, i, dNodes[i], t >= k.t && t < k.t + 40));
    model.buildings.forEach((b, i) => {
      const dead = b.died != null && t >= b.died;
      if (state.b[i] !== dead || force) { state.b[i] = dead; bNodes[i].classList.toggle("dead", dead); }
    });
    if (model.hasPos) {
      model.players.forEach((p, i) => {
        const at = model.posAt(i, t);
        const node = hNodes[i];
        show(state.h, i, node, Boolean(at));
        if (at) node.setAttribute("transform", `translate(${mapX(at[0]).toFixed(2)} ${mapY(at[1]).toFixed(2)})`);
        node.classList.toggle("sel", i === selected);
      });
      // выбранный герой рисуется поверх остальных
      if (selected >= 0 && hNodes[selected].nextSibling) hLayer.append(hNodes[selected]);
      if (selected >= 0) {
        const pts = [];
        for (let s = Math.max(t0, t - 20); s <= t; s += 1) { const q = model.posAt(selected, s); if (q) pts.push(`${mapX(q[0]).toFixed(1)},${mapY(q[1]).toFixed(1)}`); }
        trail.setAttribute("points", pts.join(" "));
      } else trail.setAttribute("points", "");
    }
    // счёт и перевес
    let ours = 0, theirs = 0;
    for (const k of model.kills) { if (k.t > t) break; if (model.players[k.killer].radiant === myRadiant) ours++; else theirs++; }
    const m = Math.max(0, Math.min(adv.length - 1, Math.floor(t / 60)));
    const g = adv.length ? adv[m] + ((adv[Math.min(adv.length - 1, m + 1)] - adv[m]) * Math.max(0, (t / 60) - m)) : 0;
    clock.textContent = mm(Math.max(t, t0));
    score.replaceChildren(
      Object.assign(document.createElement("span"), { className: "ours", textContent: String(ours) }),
      Object.assign(document.createElement("i"), { textContent: ":" }),
      Object.assign(document.createElement("span"), { className: "theirs", textContent: String(theirs) }),
      Object.assign(document.createElement("small"), { className: g >= 0 ? "ours" : "theirs", textContent: Math.abs(g) < 500 ? "золото ровно" : `${g > 0 ? "+" : "−"}${(Math.abs(g) / 1000).toFixed(1)}к ${g > 0 ? "у вас" : "у врагов"}` }));
    range.value = String(Math.round(t));
    const x = tx(t);
    head.setAttribute("x1", x.toFixed(1));
    head.setAttribute("x2", x.toFixed(1));
    range.style.setProperty("--p", `${((t - t0) / Math.max(1, T - t0)) * 100}%`);
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
      info.textContent = `${p.name}${p.me ? " (ты)" : ""} · ${k} убийств, ${d} смертей к ${mm(Math.max(t, 0))}`;
      info.classList.toggle("foe", p.radiant !== myRadiant);
    } else info.textContent = model.hasPos ? "Тапни по герою — покажу его путь." : "";
  }

  function feedRow(e) {
    const row = document.createElement("div");
    row.className = "lm-ev";
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
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt * speed;
    if (t >= T) { t = T; pause(); draw(); return; }
    draw();
    raf = requestAnimationFrame(frame);
  }
  function play() {
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
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { if (!es[0].isIntersecting && playing) pause(); }) : null;
  map.addEventListener("click", () => { if (selected >= 0) { selected = -1; draw(true); } });

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
  const scrub = document.createElement("div");
  scrub.className = "lm-scrub";
  scrub.append(track, range);
  controls.append(playBtn, scrub, speedBtn);
  const frameBox = document.createElement("div");
  frameBox.className = "lm-frame";
  frameBox.append(map, top);
  root.append(frameBox, controls, feed, chips, info);
  if (io) io.observe(root);
  root.seek = (s) => { pause(); t = Math.max(t0, Math.min(T, s)); draw(); };
  return root;
}
