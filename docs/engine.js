// Движок разбора матча — единственный источник логики.
// Его используют веб-приложение (app.js) и бот (через engine_cli.mjs).
// Тексты: docs/texts.json, механики героев: docs/knowledge.json, нормы по рангам: docs/rank_norms.json.

export const LANE = "Линия", FARM = "Фарм", FIGHTS = "Драки", SURVIVAL = "Выживание", ITEMS = "Предметы", VISION = "Видение";
export const CATEGORIES = [LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION];
export const BAD = "bad", WARN = "warn", GOOD = "good";

const DAMAGE_TYPE_ADJ = { Physical: "физическим", Magical: "магическим", Pure: "чистым" };
const LANE_OPPONENT = { 1: 3, 2: 2, 3: 1, 4: 5, 5: 4 };
const LH_TARGET_10 = { 1: 50, 2: 50, 3: 35 };
const CORE_ITEM_MIN_COST = 1800;
const OBSERVER_LIFETIME = 360;
const TEAMFIGHT_MARGIN = 10;
const ITEM_UPGRADES = {
  cyclone: ["wind_waker"],
  force_staff: ["hurricane_pike"],
  ghost: ["ethereal_blade"],
  maelstrom: ["mjollnir", "gleipnir"],
  ward_sentry: ["ward_dispenser"],
  orchid: ["bloodthorn"],
  hood_of_defiance: ["eternal_shroud"],
};
// Мелкие ошибки. Сейв-предметы и сколько секунд после прошлого нажатия они ещё в откате
const SAVE_ITEMS = [["black_king_bar", 100], ["glimmer_cape", 20], ["force_staff", 20], ["hurricane_pike", 20],
  ["ghost", 25], ["cyclone", 25], ["wind_waker", 20], ["lotus_orb", 20], ["satanic", 35], ["manta", 35]];
// Руны силы (без баунти, воды и мудрости): ДД, хаст, иллюзии, инвиз, реген, арканка, щит
const POWER_RUNES = new Set(["0", "1", "2", "3", "4", "6", "9"]);
// Крипов в минуту с 10 по 20 минуту, ниже которых керри своего ранга фармит медленно
const FARM_PACE = { herald: 3.5, guardian: 4.2, crusader: 5, archon: 5.8, legend: 6.5, ancient: 7.2, divine: 8, immortal: 8.5 };
const FARM_PACE_ROLE = { 1: 1, 2: 0.9, 3: 0.65 };
const WARD_GAP = 480;
const BUYBACK_WASTE_WINDOW = 45;
// Хан держит ориентир 200+ крипов к 20:00 для кора, но по реальным матчам это уже уровень сильных:
// флаг ставим на нижней четверти (≈25-й перцентиль), а 200+ называем как цель
const LH20_FLOOR = { 1: 120, 2: 90, 3: 80 };
const LH20_GOAL = 200;
const TURBO_MODE = 23;
const LEAD_DEATH_GOLD = 8000;
const LEAD_DEATH_MIN_TIME = 600;
const ROSHAN_RESPAWN_MIN = 480;
const ROSHAN_FOLLOW_WINDOW = 180;
const ROSHAN_FIGHT_MIN_TIME = 1200;
const LEVEL_XP = [0, 240, 640, 1160, 1760, 2440, 3200, 4000, 4900, 5900, 7000, 8200, 9500, 10900, 12400, 14000, 15700, 17500, 19400, 21400, 23600, 25600, 27600, 29600, 31600];
const NETWORTH_GAP_20 = 5000; const SUPPORT_LEVEL_GAP = 3; const KILLS_NO_FARM = 8;
const DRAFT_MIN_GAMES = 40; const DRAFT_BAD_WR = 0.42; const DRAFT_GOOD_WR = 0.56;
const LANE_XP_GAP = 1500;
const BKB_SOLO_WINDOW = 240;
// Дорогие предметы с активкой: купил и ни разу не нажал — деньги в пустоту
const ACTIVE_ITEMS = ["black_king_bar", "blink", "force_staff", "hurricane_pike", "cyclone", "ghost", "glimmer_cape",
  "lotus_orb", "shivas_guard", "sheepstick", "orchid", "bloodthorn", "abyssal_blade", "silver_edge", "manta", "refresher",
  "mekansm", "guardian_greaves", "solar_crest", "spirit_vessel", "heavens_halberd", "meteor_hammer", "rod_of_atos",
  "nullifier", "diffusal_blade", "disperser", "mjollnir", "pipe", "crimson_guard", "blade_mail", "sphere", "satanic",
  "wind_waker", "overwhelming_blink", "swift_blink", "arcane_blink"];
const MAX_COUNTER_ITEMS = 3;
// Контроль, который можно распознать по описанию умения; БКБ и диспел зависят от полей bkbpierce и dispellable
const CONTROL_KINDS = [
  ["stun", /stun/, "стан", true],
  ["hex", /\bhex|transforms? .{0,30}into/, "хекс", true],
  ["hard", /sleep|fear|taunt|banish|petrif|cyclone|forced to|mute/, "жёсткий контроль", true],
  ["silence", /silence/, "сайленс", false],
  ["root", /\broot|ensnare|entangle|immobiliz/, "рут", false],
  ["disarm", /disarm/, "дизарм", false],
  ["slow", /slow/, "замедление", false],
];
const ITEM_CONTROL = {
  sheepstick: ["hex", true], abyssal_blade: ["stun", true], orchid: ["silence", false], bloodthorn: ["silence", false],
  rod_of_atos: ["root", false], gleipnir: ["root", false], heavens_halberd: ["disarm", false],
};
const BUILD_MIN_SCORE = 2;
const BUILD_MAX_ITEMS = 4;

const DETECTION_ITEMS = new Set(["dust", "ward_sentry", "gem"]);
const PRO_MIN_COUNT = 3;
const PRO_BUILD_SIZE = 6;
const PRO_BUILD_MIN_COST = 1200;
const UPGRADED_BOOTS = new Set(["tranquil_boots", "arcane_boots", "phase_boots", "power_treads", "boots_of_bearing", "guardian_greaves", "travel_boots"]);
const PHASES = [["lane", "Линия", 0, 10], ["mid", "Мидгейм", 10, 25], ["late", "Лейт", 25, null]];
const SWING_WINDOW = 5;
const SWING_MIN_GOLD = 3000;
const PRO_ITEM_PHASES = ["early_game_items", "mid_game_items", "late_game_items"];
const COMPARE_METRICS = [
  ["gold_per_min", "GPM", 1, "Фарм"],
  ["xp_per_min", "XPM", 1, "Фарм"],
  ["last_hits_per_min", "Ластхиты за 10 мин", 10, "Фарм"],
  ["hero_damage_per_min", "Урон по героям в минуту", 1, "Драки"],
  ["kills_per_min", "Убийства за 10 мин", 10, "Драки"],
  ["assists_per_min", "Ассисты за 10 мин", 10, "Драки"],
  ["deaths_per_min", "Смерти за 10 мин", 10, "Выживание"],
  ["tower_damage", "Урон по вышкам", 1, "Фарм"],
];
const SUPPORT_SKIP_METRICS = new Set(["gold_per_min", "last_hits_per_min", "tower_damage"]);
const MAP_CENTER_SUM = 256;
const RIVER_MARGIN = 12;
const EARLY_DEATH_TIME = 180;
const LANING_END = 600; // до 10-й минуты смерть на линии: размены, а не «ходил один по карте»
const RUNE_FIGHT_END = 90; // смерть в первые полторы минуты — драка за руну, а не линия
const LATE_GAME_TIME = 35 * 60;

// Ранги: [именительный, родительный, родительный мн.]
const RANKS = {
  herald: ["Рекрут", "Рекрута", "Рекрутов"],
  guardian: ["Страж", "Стража", "Стражей"],
  crusader: ["Рыцарь", "Рыцаря", "Рыцарей"],
  archon: ["Герой", "Героя", "Героев"],
  legend: ["Легенда", "Легенды", "Легенд"],
  ancient: ["Властелин", "Властелина", "Властелинов"],
  divine: ["Божество", "Божества", "Божеств"],
  immortal: ["Титан", "Титана", "Титанов"],
};
const RANK_ORDER = Object.keys(RANKS);
const ROLE_GEN_PLURAL = { 1: "керри", 2: "мидеров", 3: "офлейнеров", 4: "саппортов-четвёрок", 5: "хард-саппортов" };
const ROLE_NAME = { 1: "керри (поз. 1)", 2: "мидер (поз. 2)", 3: "офлейнер (поз. 3)", 4: "саппорт-четвёрка (поз. 4)", 5: "хард-саппорт (поз. 5)" };
const NORM_PCTS = [10, 25, 50, 75, 90];
const GRADE_WORD = {
  terrible: "провал", bad: "плохо", below: "ниже среднего", avg: "средне", good: "хорошо", great: "отлично",
};
// Ключевые показатели для оценки относительно ранга и роли
const RANK_METRICS = {
  lh10: { what: "Добито крипов к 10:00", cat: "Линия", roles: [1, 2, 3], fmt: (v) => String(Math.round(v)) },
  gpm: { what: "GPM (золото в минуту)", cat: "Фарм", roles: [1, 2, 3], fmt: (v) => String(Math.round(v)) },
  xpm: { what: "XPM (опыт в минуту)", cat: "Фарм", roles: [1, 2, 3, 4, 5], fmt: (v) => String(Math.round(v)) },
  kp: { what: "KP (участие в киллах)", cat: "Драки", roles: [1, 2, 3, 4, 5], fmt: (v) => `${Math.round(v * 100)}%` },
  dmg_min: { what: "Дамаг по героям в минуту", cat: "Драки", roles: [1, 2, 3], fmt: (v) => num(v) },
  deaths10: { what: "Смерти за 10 минут", cat: "Выживание", roles: [1, 2, 3, 4, 5], lower: true, fmt: (v) => tenths(v) },
  dead_share: { what: "Время мёртвым", cat: "Выживание", roles: [1, 2, 3, 4, 5], lower: true, fmt: (v) => `${Math.round(v * 100)}% игры` },
  first_item: { what: "Тайминг первого кор-айтема", cat: "Предметы", roles: [1, 2, 3], lower: true, fmt: (v) => mmss(v) },
  obs10: { what: "Обсы за 10 минут", cat: "Видение", roles: [4, 5], fmt: (v) => tenths(v) },
};
// Сколько примерно золота стоит отставание по показателю — для сортировки проблем в сводке
const FIRST_ITEM_KEYS = new Set(["blink", "black_king_bar", "battle_fury", "bfury", "desolator", "maelstrom", "radiance", "manta",
  "echo_sabre", "aghanims_shard", "ultimate_scepter", "orchid", "kaya", "sange", "yasha", "armlet", "witch_blade",
  "diffusal_blade", "dragon_lance", "mask_of_madness", "hand_of_midas", "vanguard", "blade_mail", "force_staff",
  "glimmer_cape", "cyclone", "aether_lens", "spirit_vessel", "pipe", "crimson_guard", "invis_sword", "phylactery",
  "harpoon", "sange_and_yasha", "kaya_and_sange", "yasha_and_kaya", "mjollnir", "skadi", "basher", "heavens_halberd",
  "solar_crest", "pavise", "holy_locket", "rod_of_atos", "ghost", "lotus_orb", "meteor_hammer", "travel_boots"]);

// Механика засчитывается, только если враг ею реально пользовался в этом матче
const INVIS_ABILITIES = new Set(["clinkz_wind_walk", "bounty_hunter_wind_walk", "weaver_shukuchi", "nyx_assassin_vendetta",
  "mirana_invis", "sand_king_sand_storm", "invoker_ghost_walk", "treant_natures_guise", "riki_tricks_of_the_trade"]);
const INVIS_ITEMS = new Set(["invis_sword", "silver_edge", "shadow_amulet"]);
const ALWAYS_INVIS = new Set(["npc_dota_hero_riki"]);
const BLINK_ITEMS = new Set(["blink", "overwhelming_blink", "swift_blink", "arcane_blink", "force_staff", "hurricane_pike"]);
const INNATE_INITIATORS = new Set(["faceless_void", "magnataur", "batrider", "sand_king", "puck", "slardar", "primal_beast",
  "tiny", "queenofpain", "storm_spirit", "void_spirit", "ember_spirit", "mars", "dark_seer", "spirit_breaker", "earth_spirit"]
  .map((h) => `npc_dota_hero_${h}`));

// Процентиль значения среди игроков ранга по квантилям [p10, p25, p50, p75, p90]
export function percentileIn(v, q) {
  if (v <= q[0]) return q[0] > 0 ? Math.max(0, (10 * v) / q[0]) : 10;
  if (v >= q[4]) return Math.min(100, 90 + (10 * (v - q[4])) / Math.max(q[4] - q[2], 1e-9));
  for (let i = 0; i < 4; i++) {
    if (v <= q[i + 1]) {
      const span = q[i + 1] - q[i];
      return NORM_PCTS[i] + (span > 0 ? ((NORM_PCTS[i + 1] - NORM_PCTS[i]) * (v - q[i])) / span : (NORM_PCTS[i + 1] - NORM_PCTS[i]) / 2);
    }
  }
  return 50;
}

function gradeOf(pct) {
  if (pct < 10) return "terrible";
  if (pct < 25) return "bad";
  if (pct < 45) return "below";
  if (pct < 65) return "avg";
  if (pct < 85) return "good";
  return "great";
}

// ---------- общие утилиты (как в analysis.py) ----------

// Python round(): половинки округляются к чётному
export function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function plural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
  return many;
}

export function mmss(seconds) {
  const sign = seconds < 0 ? "-" : "";
  const s = Math.trunc(Math.abs(seconds));
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function num(n) {
  n = Math.trunc(n);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "-" : "") + digits;
}

export function signed(n) {
  n = Math.trunc(n);
  return n > 0 ? `+${num(n)}` : num(n);
}

function textHash(s) {
  let h = 0;
  for (const ch of s) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return h;
}

function fill(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}

export function tenths(x) {
  let n = pyRound(x * 10);
  const sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  return `${sign}${Math.floor(n / 10)},${n % 10}`;
}

// npc_dota_goodguys_tower2_mid → «T2 на миде», ..._melee_rax_bot → «барак на боте»
const LANE_RU = { top: "на топе", mid: "на миде", bot: "на боте" };
function buildingName(key) {
  const t = /tower(\d)(?:_(top|mid|bot))?/.exec(key);
  if (t) return `T${t[1]}${t[2] ? ` ${LANE_RU[t[2]]}` : ""}`;
  const r = /(melee|range)_rax_(top|mid|bot)/.exec(key);
  if (r) return `барак ${LANE_RU[r[2]]}`;
  return key.includes("fort") ? "трон" : "здание";
}

function enemyHalf(x, y, radiant) {
  const s = x + y;
  return radiant ? s > MAP_CENTER_SUM + RIVER_MARGIN : s < MAP_CENTER_SUM - RIVER_MARGIN;
}

export function position(player) {
  return player.position_est || { 1: 1, 2: 2, 3: 3 }[player.lane_role] || 4;
}

// Доля фарма игрока: чем больше, тем вероятнее он кор. Ранний фарм весит больше —
// поздний у саппорта тоже растёт, а на 10-й минуте роли видны чётче.
function farmScore(p) {
  const lh10 = atMinute(p.lh_t, 10) ?? 0;
  const nw10 = atMinute(p.networth_t, 10) ?? 0;
  return lh10 * 3 + nw10 / 40 + (p.last_hits || 0) + (p.net_worth || 0) / 150;
}

function wardsPlaced(p) {
  return (p.obs_placed ?? 0) + (p.sen_placed ?? 0);
}

// Роли внутри одной команды по фарму, линии и вардам.
// Позиции OpenDota (position_est) в пабах часто ошибаются: кор с 13к нетворса попадает в саппорты.
export function assignRoles(team) {
  const ranked = [...team].sort((a, b) => farmScore(b) - farmScore(a));
  let cores = ranked.slice(0, 3);
  let supports = ranked.slice(3);
  // Кор, который поставил кучу вардов, а саппорт без вардов — меняем местами
  const wardy = cores.filter((p) => wardsPlaced(p) >= 8).sort((a, b) => farmScore(a) - farmScore(b))[0];
  const greedy = supports.filter((p) => wardsPlaced(p) <= 2).sort((a, b) => farmScore(b) - farmScore(a))[0];
  if (wardy && greedy && wardsPlaced(wardy) > wardsPlaced(greedy) + 5) {
    cores = cores.map((p) => (p === wardy ? greedy : p));
    supports = supports.map((p) => (p === greedy ? wardy : p));
  }

  const roles = new Map();
  const laneRole = (p) => p.lane_role || 0;
  const byFarm = (a, b) => farmScore(b) - farmScore(a);
  const pool = [...cores].sort(byFarm);
  const take = (p, pos) => { if (p) { roles.set(p, pos); pool.splice(pool.indexOf(p), 1); } };
  // Мидер — кор, стоявший на центральной линии
  take(pool.find((p) => laneRole(p) === 2) || pool.find((p) => p.lane === 2), 2);
  // Керри — кор на лёгкой линии, иначе самый богатый из оставшихся
  take(pool.find((p) => laneRole(p) === 1) || pool[0], 1);
  // Остальные коры — оффлейн; если мидера не нашли, богатейший из них считается мидером
  const hasMid = [...roles.values()].includes(2);
  pool.forEach((p, i) => roles.set(p, !hasMid && i === 0 ? 2 : 3));
  // Саппорты: пятёрка стоит с керри на лёгкой линии, четвёрка — на сложной или роумит
  const sups = [...supports].sort((a, b) => wardsPlaced(b) - wardsPlaced(a));
  const five = sups.find((p) => laneRole(p) === 1 && !p.is_roaming) || sups[0];
  if (five) roles.set(five, 5);
  for (const p of sups) if (!roles.has(p)) roles.set(p, 4);

  // Уверенность: насколько третий кор отрывается по фарму от лучшего саппорта
  const s3 = farmScore(ranked[2] || ranked[0]), s4 = farmScore(ranked[3] || ranked[0]);
  const confidence = s3 > 0 ? Math.max(0, Math.min(1, (s3 - s4) / s3 * 2.5)) : 0;
  return { roles, confidence };
}

function atMinute(series, minute) {
  if (!series || !series.length) return null;
  return minute < series.length ? series[minute] : series[series.length - 1];
}

// [3, 4, 5, 8] -> "2:00–5:00, 7:00–8:00": минута m — это отрезок с (m-1):00 до m:00
function minuteRanges(mins) {
  const out = [];
  let start = mins[0], prev = mins[0];
  for (const m of [...mins.slice(1), null]) {
    if (m === prev + 1) { prev = m; continue; }
    out.push(`${start - 1}:00–${prev}:00`);
    start = prev = m;
  }
  return out.join(", ");
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const intersects = (set, keys) => keys.some((k) => set.has(k));
const deathsWord = (n) => plural(n, "смерть", "смерти", "смертей");
const timesWord = (n) => plural(n, "раз", "раза", "раз");

function damageType(value) {
  if (Array.isArray(value)) value = value.length ? value[0] : null;
  return ["Physical", "Magical", "Pure"].includes(value) ? value : null;
}

// itemPopularity (id предмета -> сколько раз) -> {ключ предмета: сумма по фазам}
export function proItemCounts(popularity, itemIds) {
  const counts = {};
  for (const phase of PRO_ITEM_PHASES) {
    for (const [id, n] of Object.entries((popularity && popularity[phase]) || {})) {
      const key = itemIds[String(id)];
      if (key) counts[key] = (counts[key] || 0) + n;
    }
  }
  return counts;
}

// Справочники OpenDota в том же виде, что и класс OpenDota в боте
export function createDictionary({ heroes, items, abilities }) {
  const heroNames = {}, heroesByKey = {}, heroKeys = {}, heroImages = {}, abilityInfo = {};
  for (const h of Object.values(heroes)) {
    heroNames[h.id] = h.localized_name;
    heroesByKey[h.name] = h.localized_name;
    heroKeys[h.id] = h.name;
    heroImages[h.id] = h.img;
  }
  for (const [key, a] of Object.entries(abilities)) {
    if (a.dname) {
      const one = (v) => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));
      abilityInfo[key] = { dname: a.dname, dmg_type: damageType(a.dmg_type), desc: one(a.desc).toLowerCase(), bkb: one(a.bkbpierce), disp: one(a.dispellable) };
    }
  }
  const od = {
    items,
    heroList: () => Object.values(heroes).map((h) => ({ id: h.id, name: h.localized_name, img: h.img }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    heroName: (id) => heroNames[id] ?? `герой #${id}`,
    heroKey: (id) => heroKeys[id] ?? "",
    heroImage: (id) => heroImages[id],
    heroNameByKey(key) {
      if (key in heroesByKey) return heroesByKey[key];
      if (key.includes("tower")) return "башня";
      if (key.includes("creep") || key.includes("neutral") || key.includes("siege")) return "крипы";
      return key.replace("npc_dota_", "");
    },
    itemName: (key) => (items[key] && items[key].dname) || key,
    itemCost: (key) => (items[key] && items[key].cost) || 0,
    itemImage: (key) => items[key] && items[key].img,
    sourceName(key) {
      if (key === "null" || key === "") return "Автоатаки";
      if (key in abilityInfo) return abilityInfo[key].dname;
      if (key in items) return od.itemName(key);
      // Неизвестный скилл: «drow_ranger_multishot» -> «Drow Ranger Multishot»
      return key.includes("_") ? key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : key;
    },
    abilityInfo: (key) => abilityInfo[key] || null,
    sourceType(key) {
      if (key === "null" || key === "") return "Physical";
      return abilityInfo[key] ? abilityInfo[key].dmg_type : null;
    },
  };
  return od;
}

export function isParsed(match) {
  return Boolean(match && match.players && match.players.length && match.players[0].lh_t != null);
}

class MatchAnalyzer {
  constructor(match, player, od, knowledge, texts, proItems, heroBench, norms, matchups, replay = null) {
    this.match = match;
    this.matchups = Array.isArray(matchups) ? matchups : [];
    this.norms = norms || {};
    this.issues = [];
    this.heroBench = heroBench || {};
    this.flagged = new Set();
    this.p = player;
    this.od = od;
    this.k = knowledge;
    this.texts = texts;
    this.pro = proItems || {};
    this.hasPro = Object.keys(this.pro).length > 0;
    this.damageTypeNames = Object.fromEntries(Object.entries(knowledge.damage_types).map(([k, v]) => [k, v.name]));
    this.duration = match.duration;
    this.minutes = Math.floor(this.duration / 60);
    const radiant = match.players.filter((x) => x.isRadiant);
    const dire = match.players.filter((x) => !x.isRadiant);
    const rr = assignRoles(radiant), dr = assignRoles(dire);
    this.roleOf = new Map([...rr.roles, ...dr.roles]);
    this.roleConfidence = player.isRadiant ? rr.confidence : dr.confidence;
    this.pos = this.roleOf.get(player) || position(player);
    this.core = this.pos <= 3;
    this.won = player.isRadiant === match.radiant_win;
    this.allies = match.players.filter((x) => x.isRadiant === player.isRadiant);
    this.enemies = match.players.filter((x) => x.isRadiant !== player.isRadiant);
    this.opponent = this.laneOpponent();
    this.oppName = this.opponent ? od.heroName(this.opponent.hero_id) : null;
    this.hero = od.heroName(player.hero_id);
    this.bench = {};
    for (const [k, v] of Object.entries(player.benchmarks || {})) this.bench[k] = pyRound(v.pct * 100);
    const sign = player.isRadiant ? 1 : -1;
    this.teamAdv = (match.radiant_gold_adv || []).map((a) => a * sign);
    this.fightWindows = (match.teamfights || []).map((tf) => [tf.start - TEAMFIGHT_MARGIN, tf.end + TEAMFIGHT_MARGIN]);
    this.findings = [];
    this.penalty = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    // Игрок разнёс игру: мелкие придирки ему не показываем
    this.dominant = this.won && (player.kills + player.assists) / Math.max(1, player.deaths) >= 5;
    // Роль 3 или 4 при низкой уверенности спорная: ролевые проверки для неё не запускаем
    this.roleSure = this.roleConfidence >= 0.3 || ![3, 4].includes(this.pos);
    this.bracket = this.detectBracket();
    this.metrics = this.collectMetrics();
    this.rank = this.rankMetrics();
    // позиции из реплея, если его разобрали: правда о том, кто был рядом в каждой смерти
    this.replay = replayInsights(match, player, replay);
  }

  // ---------- ранг и нормы ----------

  // Ранг игрока; если скрыт — средний по открытым рангам в матче
  detectBracket() {
    const toBracket = (tier) => RANK_ORDER[Math.min(8, Math.max(1, Math.floor(tier / 10))) - 1];
    if (this.p.rank_tier) return toBracket(this.p.rank_tier);
    const tiers = this.match.players.map((x) => x.rank_tier).filter(Boolean);
    if (tiers.length) return toBracket(sum(tiers) / tiers.length);
    return null;
  }

  collectMetrics() {
    const p = this.p;
    const minutes = this.duration / 60;
    const teamKills = sum(this.match.players.filter((x) => x.isRadiant === p.isRadiant).map((x) => x.kills));
    const first = (p.purchase_log || []).find((x) => FIRST_ITEM_KEYS.has(x.key));
    return {
      lh10: this.minutes >= 10 ? atMinute(p.lh_t, 10) : null,
      gpm: p.gold_per_min,
      xpm: p.xp_per_min,
      kp: teamKills ? (p.kills + p.assists) / teamKills : null,
      dmg_min: p.hero_damage / minutes,
      deaths10: (p.deaths / minutes) * 10,
      dead_share: (p.life_state_dead || 0) / this.duration,
      first_item: first ? first.time : null,
      obs10: ((p.obs_placed || 0) / minutes) * 10,
    };
  }

  normFor(metric, bracket = this.bracket) {
    const row = this.norms[bracket] && this.norms[bracket][`pos${this.pos}`];
    return row && row[metric] && row[metric].n >= 8 ? row[metric].q : null;
  }

  // Процентиль каждого показателя среди игроков того же ранга и роли (больше — лучше)
  rankMetrics() {
    const out = {};
    if (!this.bracket) return out;
    // При спорной роли не сравниваем с нормами, которые сильно зависят от роли
    const roleBound = new Set(["lh10", "first_item", "obs10", "gpm"]);
    for (const [key, m] of Object.entries(RANK_METRICS)) {
      const v = this.metrics[key];
      const q = this.normFor(key);
      if (v == null || !q || !m.roles.includes(this.pos)) continue;
      if (!this.roleSure && roleBound.has(key)) continue;
      const raw = percentileIn(v, q);
      const pct = Math.max(1, Math.min(99, Math.round(m.lower ? 100 - raw : raw)));
      out[key] = { value: v, pct, grade: gradeOf(pct), median: q[2], strong: m.lower ? q[1] : q[3] };
    }
    return out;
  }

  rankParams(key) {
    const r = this.rank[key], m = RANK_METRICS[key];
    const nextBracket = RANK_ORDER[RANK_ORDER.indexOf(this.bracket) + 1];
    const nextQ = nextBracket ? this.normFor(key, nextBracket) : null;
    return {
      what: m.what,
      value: m.fmt(r.value),
      grade: GRADE_WORD[r.grade],
      pct: r.pct,
      worse_pct: 100 - r.pct,
      median: m.fmt(r.median),
      strong: m.fmt(r.strong),
      rank: RANKS[this.bracket][0],
      rank_gen: RANKS[this.bracket][1],
      rank_plural: RANKS[this.bracket][2],
      role_gen: ROLE_GEN_PLURAL[this.pos],
      next_rank: nextBracket ? RANKS[nextBracket][2] : "",
      next_median: nextQ ? m.fmt(nextQ[2]) : "",
    };
  }

  // Находка по показателю относительно ранга. true — если норма есть и проверка сделана
  rankCheck(key, { tipKey = null, roastKey = null } = {}) {
    const r = this.rank[key];
    if (!r) return false;
    const m = RANK_METRICS[key];
    const params = this.rankParams(key);
    this.flagged.add(key);
    if (r.grade === "terrible" || r.grade === "bad") {
      const text = this.say(`rank_low_${r.grade}`, params, key);
      const tip = tipKey ? this.say(tipKey, params) : "";
      const roast = roastKey && roastKey in this.texts ? this.say(roastKey, params) : "";
      this.addRaw(m.cat, r.grade === "terrible" ? BAD : WARN, text, tip, "rank", roast);
    } else if (r.grade === "great") {
      this.addRaw(m.cat, GOOD, this.say("rank_high", params, key), "", "rank");
    }
    return true;
  }

  issue(group, impact, title, fact, action, goal = null) {
    this.issues.push({ group, impact: Math.round(impact), title, fact, action, ...(goal ? { goal } : {}) });
  }

  // Оппонент по линии: враг на той же физической линии с похожей ролью (кор против кора).
  // Если на линии никого подходящего — зеркальная позиция.
  laneOpponent() {
    const isCore = (pos) => pos <= 3;
    const sameLane = this.enemies.filter((e) => e.lane && e.lane === this.p.lane);
    const fit = sameLane.filter((e) => isCore(this.roleOf.get(e)) === this.core)
      .sort((a, b) => farmScore(b) - farmScore(a));
    if (fit.length) return fit[0];
    return this.enemies.find((e) => this.roleOf.get(e) === LANE_OPPONENT[this.pos]) || null;
  }

  // ---------- тексты ----------

  say(key, params = {}, seed = "") {
    const variants = this.texts[key];
    const fullSeed = `${this.match.match_id}:${this.p.player_slot}:${key}:${seed}`;
    // Слова при числах склоняются сами: «2 крипа», «5 минут»
    params = { ...params };
    if ("lh" in params) {
      params.creeps = plural(params.lh, "крип", "крипа", "крипов");
      params.lasthits = params.creeps;
    }
    if ("mins" in params) params.mins_word = plural(params.mins, "минуту", "минуты", "минут");
    return fill(variants[textHash(fullSeed) % variants.length], params);
  }

  add(category, severity, key, tipKey = null, params = {}, kind = "") {
    const text = this.say(key, params);
    const tip = tipKey ? this.say(tipKey, params) : "";
    const roastKey = `${key}_roast`;
    const roast = severity !== GOOD && roastKey in this.texts ? this.say(roastKey, params) : "";
    this.addRaw(category, severity, text, tip, kind, roast);
  }

  addRaw(category, severity, text, tip = "", kind = "", roast = "") {
    this.findings.push({ category, severity, text, tip, kind, roast });
    this.penalty[category] += { [BAD]: 1.0, [WARN]: 0.5, [GOOD]: -0.5 }[severity];
  }

  run() {
    this.checkLane();
    this.checkFarm();
    this.checkFights();
    this.checkSurvival();
    this.checkItems();
    this.checkVision();
    this.checkGame();
    const killers = this.checkKillers();
    this.checkItemization();
    this.checkDispel();
    const proBuild = this.proBuild();
    this.checkProBuild(proBuild);
    this.checkRoshan();
    this.checkDeathZones();
    this.checkWardZones();
    this.checkLateGame();
    this.checkMicro();
    const compare = this.compare();
    this.checkCompareGap(compare);
    this.cleanup();
    const rankScores = this.rankScores(proBuild);
    const scores = rankScores ? rankScores.scores : this.computeScores();
    const values = Object.values(scores);
    const overall = rankScores ? rankScores.overall : Math.round((sum(values) / values.length) * 10) / 10;
    return {
      facts: this.collectFacts(),
      findings: this.findings,
      scores,
      overall,
      summary: this.summary(),
      timeline: this.collectTimeline(),
      killers,
      phases: this.phases(),
      moments: this.moments(),
      episodes: this.episodes(),
      map: this.mapData(),
      replay: this.replay,
      progress: this.progressMetrics(),
      next_rank: this.nextRank(),
      lane: this.laneDuel(),
      pro_build: proBuild,
      compare,
      verdict: this.verdict(scores, overall),
      items: this.coreItems(),
      draft: this.draftReview(),
      build_plan: this.buildPlan(),
    };
  }

  // Убирает противоречия и лишние подколы
  cleanup() {
    // Похвала за выживание рядом с серьёзной ошибкой по смертям звучит как издёвка
    const survivalBad = this.findings.some((f) => f.category === SURVIVAL && f.severity === BAD);
    if (survivalBad) {
      this.findings = this.findings.filter((f) => !(f.category === SURVIVAL && f.severity === GOOD));
    }
    // Подколы: максимум 3, сначала к самым тяжёлым ошибкам; в выигранной игре — только к серьёзным
    const order = { [BAD]: 0, [WARN]: 1, [GOOD]: 2 };
    const withRoast = this.findings.filter((f) => f.roast)
      .sort((a, b) => order[a.severity] - order[b.severity]);
    withRoast.forEach((f, i) => {
      if (i >= 3 || (this.won && f.severity !== BAD)) f.roast = "";
    });
  }

  // ---------- оценки относительно ранга ----------

  rankScores(proBuild) {
    if (Object.keys(this.rank).length < 3) return null;
    const pct = (k) => (this.rank[k] ? this.rank[k].pct : null);
    const p = this.p;
    const early = (p.deaths_log || []).filter((d) => d.time < LANING_END).length;
    const earlyPct = [70, 50, 25, 10][Math.min(early, 3)];
    let lanePct = null;
    if (this.opponent && this.minutes >= 10) {
      const diff = atMinute(p.networth_t, 10) - atMinute(this.opponent.networth_t, 10);
      lanePct = Math.max(0, Math.min(100, 50 + diff / 40));
    }
    const solo = (p.deaths_log || []).filter((d) => d.time >= LANING_END && this.isSoloDeath(d.time)).length;
    const have = proBuild.slice(0, 5).filter((b) => b.owned).length;
    const cats = {
      [LANE]: [pct("lh10"), earlyPct, lanePct],
      [FARM]: [pct("gpm"), pct("xpm")],
      [FIGHTS]: [pct("kp"), pct("dmg_min")],
      [SURVIVAL]: [pct("deaths10"), pct("dead_share"), solo ? Math.max(0, 60 - solo * 15) : null],
      [ITEMS]: [pct("first_item"), proBuild.length >= 3 ? 30 + have * 14 : null],
      [VISION]: this.core ? [] : [pct("obs10")],
    };
    const weights = this.core
      ? { [LANE]: 1, [FARM]: 1.4, [FIGHTS]: 1.1, [SURVIVAL]: 1.2, [ITEMS]: 0.7, [VISION]: 0 }
      : { [LANE]: 0.8, [FARM]: 0.4, [FIGHTS]: 1.3, [SURVIVAL]: 1.2, [ITEMS]: 0.5, [VISION]: 1.3 };
    // Ошибки-события (не процентили) немного сдвигают раздел
    const eventShift = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const f of this.findings) {
      if (f.kind) continue;
      eventShift[f.category] += { [BAD]: -0.6, [WARN]: -0.3, [GOOD]: 0.3 }[f.severity];
    }
    const scores = {};
    let wSum = 0, total = 0;
    for (const c of CATEGORIES) {
      const xs = cats[c].filter((x) => x != null);
      if (!xs.length) {
        scores[c] = Math.max(1, Math.min(10, Math.round(6 + eventShift[c])));
        continue;
      }
      const raw = 1 + (9 * sum(xs)) / xs.length / 100 + eventShift[c];
      scores[c] = Math.max(1, Math.min(10, Math.round(raw)));
      wSum += weights[c];
      total += weights[c] * Math.max(1, Math.min(10, raw));
    }
    return { scores, overall: wSum ? Math.round((total / wSum) * 10) / 10 : 5 };
  }

  // ---------- сводка: что было не так и что делать ----------

  summary() {
    const sorted = [...this.issues].sort((a, b) => b.impact - a.impact);
    const deathFamily = (g) => ["lane_deaths", "solo_deaths", "dead_time"].includes(g) || g.startsWith("killer_");
    const problems = [];
    let deathCount = 0;
    for (const i of sorted) {
      if (i.impact <= 0 || problems.some((x) => x.group === i.group)) continue;
      if (deathFamily(i.group)) {
        if (deathCount >= 2) continue;
        deathCount++;
      }
      problems.push(i);
      if (problems.length === 3) break;
    }
    // Серьёзного нет — подсказываем, что подтянуть, по главным мелким замечаниям
    if (!problems.length) {
      for (const f of this.findings.filter((x) => x.severity === WARN && x.tip && x.kind !== "killer").slice(0, 2)) {
        problems.push({ group: `minor_${problems.length}`, impact: 1, title: `Подтянуть: ${f.category.toLowerCase()}`, fact: f.text, action: f.tip, minor: true });
      }
    }
    // Сильные стороны: по одной из каждой группы, чтобы не хвалить дважды за одно и то же
    const family = { deaths10: "surv", dead_share: "surv", gpm: "farm", xpm: "farm", lh10: "farm" };
    const usedFamilies = new Set();
    const strengths = Object.entries(this.rank)
      .filter(([, r]) => r.pct >= 75)
      .sort((a, b) => b[1].pct - a[1].pct)
      .filter(([key]) => {
        const fam = family[key] || key;
        if (usedFamilies.has(fam)) return false;
        usedFamilies.add(fam);
        return true;
      })
      .slice(0, 2)
      .map(([key, r]) => ({
        title: `${RANK_METRICS[key].what}: ${RANK_METRICS[key].fmt(r.value)}`,
        fact: `лучше, чем у ${r.pct}% ${ROLE_GEN_PLURAL[this.pos]} на ранге ${RANKS[this.bracket][0]}`,
      }));
    if (strengths.length < 2) {
      for (const f of this.findings.filter((x) => x.severity === GOOD && x.kind !== "rank")) {
        if (strengths.length >= 2) break;
        strengths.push({ title: f.text, fact: "" });
      }
    }
    return {
      rank: this.bracket ? RANKS[this.bracket][0] : null,
      role: ROLE_NAME[this.pos],
      role_sure: this.roleSure,
      problems,
      strengths,
      goal: problems.length && !problems[0].minor ? this.goalFor(problems[0]) : "Цель на следующую катку: повторить такой же матч — и ранг пойдёт вверх",
      goal_check: problems.length && !problems[0].minor ? this.goalCheckFor(problems[0]) : null,
    };
  }

  goalFor(issue) {
    if (issue.goal) return issue.goal;
    const r = this.rank;
    const g = issue.group;
    const nextOr = (key, fmt) => {
      const next = RANK_ORDER[RANK_ORDER.indexOf(this.bracket) + 1];
      const q = (next && this.normFor(key, next)) || this.normFor(key);
      return q ? fmt(q[2]) : null;
    };
    if (g === "lane_farm") return `Цель на следующую катку: ${nextOr("lh10", (v) => Math.round(v)) ?? 45}+ крипов к 10:00`;
    if (g === "lane_deaths") return "Цель на следующую катку: не больше одной смерти до 10:00";
    if (g === "solo_deaths") return "Цель на следующую катку: ни одной смерти вне файтов";
    if (g === "dead_time") return `Цель на следующую катку: не больше ${r.dead_share ? Math.round(r.dead_share.median * 100) : 12}% катки мёртвым`;
    if (g === "gpm") return `Цель на следующую катку: ${nextOr("gpm", (v) => Math.round(v)) ?? 450}+ золота в минуту`;
    if (g === "obs") return `Цель на следующую катку: ${Math.ceil(((r.obs10 ? r.obs10.median : 3) * this.minutes) / 10) + 2}+ обсов`;
    if (g === "missed_fights" || g === "kp") return "Цель на следующую катку: KP 60%+ — быть в 6 из 10 киллов команды";
    if (g === "first_item") return `Цель на следующую катку: первый крупный предмет к ${nextOr("first_item", mmss) ?? "15:00"}`;
    if (g === "idle") return "Цель на следующую катку: ни одной минуты АФК — фарм или файт";
    if (g === "lane_lost") return "Цель на следующую катку: выйти с линии хотя бы в ноль по золоту";
    if (g.startsWith("killer_")) return `Цель на следующую катку: заранее купить защиту против самого опасного врага`;
    if (g === "lane_gaps") return "Цель на следующую катку: на лайне ни одной минуты без добитого крипа";
    if (g === "mid_runes") return "Цель на следующую катку: забрать минимум 2 руны силы до 12:00";
    if (g === "buyback_wasted") return "Цель на следующую катку: выкуп только когда файт ещё можно выиграть";
    return "Цель на следующую катку: исправить главную ошибку выше";
  }

  // Та же цель в проверяемом виде: какой показатель следующей катки и с каким порогом сравнить.
  // null — цель словами, автоматически её не проверить
  goalCheckFor(issue) {
    const g = issue.group, r = this.rank;
    const nextQ = (key) => {
      const next = RANK_ORDER[RANK_ORDER.indexOf(this.bracket) + 1];
      return (next && this.normFor(key, next)) || this.normFor(key);
    };
    const num = (m, op, target) => ({ group: g, metric: m, op, target });
    if (g === "lane_farm") return num("lh10", ">=", Math.round((nextQ("lh10") || [0, 0, 45])[2]));
    if (g === "lane_deaths") return num("lane_deaths", "<=", 1);
    if (g === "solo_deaths") return num("solo_deaths", "<=", 0);
    if (g === "dead_time") return num("dead_share", "<=", r.dead_share ? Math.round(r.dead_share.median * 100) / 100 : 0.12);
    if (g === "gpm") return num("gpm", ">=", Math.round((nextQ("gpm") || [0, 0, 450])[2]));
    if (g === "obs") return num("obs10", ">=", Math.round((r.obs10 ? r.obs10.median : 3) * 10) / 10);
    if (g === "missed_fights" || g === "kp") return num("kp", ">=", 0.6);
    if (g === "first_item") return num("first_item", "<=", Math.round((nextQ("first_item") || [0, 0, 900])[2]));
    if (g === "idle") return num("idle_minutes", "<=", 0);
    if (g === "lane_lost") return num("lane_nw10", ">=", 0);
    if (g === "lane_gaps") return num("lane_gaps", "<=", 0);
    if (g === "mid_runes") return num("runes12", ">=", 2);
    if (g === "buyback_wasted") return num("wasted_buybacks", "<=", 0);
    if (g === "lh20") return num("lh20", ">=", LH20_FLOOR[this.pos] || 80);
    if (g === "farm_pace") return num("farm_pace", ">=", Math.round(FARM_PACE[this.bracket || "archon"] * (FARM_PACE_ROLE[this.pos] || 1) * 10) / 10);
    if (g === "ward_gap") return num("ward_gap", "<=", 300);
    if (g === "first_death") return num("first_deaths", "<=", 0);
    if (g === "silent_deaths") return num("silent_deaths", "<=", 0);
    if (g === "lead_deaths") return num("lead_deaths", "<=", 0);
    if (g.startsWith("unused_")) return num(`unused:${g.slice(7)}`, "<=", 0);
    if (g.startsWith("killer_")) return num(`killer:${g.slice(7)}`, "<=", 1);
    return null;
  }

  // Измеримые показатели катки: по ним проверяются цели, считаются ачивки и прогресс к рангу
  progressMetrics() {
    const p = this.p, deaths = p.deaths_log || [];
    const killers = {};
    for (const d of deaths) if (d.key.startsWith("npc_dota_hero_")) killers[d.key] = (killers[d.key] || 0) + 1;
    const nw10 = this.opponent && this.minutes >= 10 ? atMinute(p.networth_t, 10) - atMinute(this.opponent.networth_t, 10) : null;
    const runes = Array.isArray(p.runes_log) ? p.runes_log.filter((x) => x.time <= 735 && POWER_RUNES.has(String(x.key))).length : null;
    return {
      pos: this.pos,
      won: this.won,
      minutes: this.minutes,
      deaths: p.deaths,
      kda: (p.kills + p.assists) / Math.max(1, p.deaths),
      lane_deaths: deaths.filter((d) => d.time < LANING_END).length,
      solo_deaths: deaths.filter((d) => d.time >= LANING_END && this.isSoloDeath(d.time)).length,
      dead_share: (p.life_state_dead || 0) / Math.max(this.duration, 1),
      gpm: p.gold_per_min,
      xpm: p.xp_per_min,
      kp: this.metrics.kp,
      lh10: this.metrics.lh10,
      lh20: this.minutes >= 20 ? atMinute(p.lh_t, 20) : null,
      obs10: this.metrics.obs10,
      first_item: this.metrics.first_item,
      dmg_min: this.metrics.dmg_min,
      deaths10: this.metrics.deaths10,
      idle_minutes: sum(this.idleWindows().map(([s, e]) => e - s)),
      lane_nw10: nw10,
      lane_gaps: this.laneGapCount ?? null,
      enemy_keys: this.enemies.map((e) => this.od.heroKey(e.hero_id)),
      runes12: this.pos === 2 ? runes : null,
      wasted_buybacks: this.wastedBuybacks ?? 0,
      farm_pace: this.farmPace ?? null,
      ward_gap: this.wardGap ?? null,
      first_deaths: this.firstDeaths ?? 0,
      silent_deaths: this.silentDeaths ?? 0,
      lead_deaths: this.leadDeaths ?? 0,
      unused: [...(this.unusedKeys || [])],
      bought: [...new Set((p.purchase_log || []).map((x) => x.key))],
      killers,
    };
  }

  // Разрыв с медианой следующего ранга по ключевым показателям роли
  nextRank() {
    const next = RANK_ORDER[RANK_ORDER.indexOf(this.bracket) + 1];
    if (!this.bracket || !next) return null;
    const out = [];
    for (const [key, m] of Object.entries(RANK_METRICS)) {
      if (!m.roles.includes(this.pos)) continue;
      const q = this.normFor(key, next);
      if (!q) continue;
      out.push({ key, what: m.what, need: q[2], lower: Boolean(m.lower) });
    }
    return out.length ? { rank: RANKS[next][0], rank_gen: RANKS[next][1], pos: this.pos, metrics: out } : null;
  }

  // ---------- про-сборки ----------

  proCount(key) {
    return this.pro[key] || 0;
  }

  isFinalItem(key) {
    const item = this.od.items[key] || {};
    return Boolean(item.components && item.components.length) || key === "blink" || key === "aghanims_shard";
  }

  proFilter(keys) {
    if (!this.hasPro) return null;
    return keys.filter((k) => this.proCount(k) >= PRO_MIN_COUNT).sort((a, b) => this.proCount(b) - this.proCount(a));
  }

  proBuild() {
    const finals = Object.entries(this.pro)
      .filter(([k, c]) => this.isFinalItem(k) && c >= PRO_MIN_COUNT &&
        (this.od.itemCost(k) >= PRO_BUILD_MIN_COST || UPGRADED_BOOTS.has(k)))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (!finals.length) return [];
    const top = finals[0][1];
    const purchases = {};
    for (const x of this.p.purchase_log || []) if (!(x.key in purchases)) purchases[x.key] = x.time;
    const owned = this.ownedItems();
    return finals.slice(0, PRO_BUILD_SIZE).map(([k, c]) => ({
      key: k,
      item: this.od.itemName(k),
      share: pyRound((c / top) * 100),
      owned: owned.has(k),
      time: k in purchases ? purchases[k] : null,
    }));
  }

  checkProBuild(build) {
    if (this.minutes < 25 || build.length < 3) return;
    const have = build.slice(0, 5).filter((b) => b.owned).length;
    const missing = build.slice(0, 3).filter((b) => !b.owned).map((b) => b.item);
    if (have <= 1 && missing.length) {
      this.add(ITEMS, WARN, "items_pro_missing", "items_pro_missing_tip", { hero: this.hero, items: missing.slice(0, 2).join(", ") });
    } else if (have >= 3) {
      this.add(ITEMS, GOOD, "items_pro_match", null, { hero: this.hero, n: have });
    }
  }

  // ---------- линия ----------

  checkLane() {
    const p = this.p, pos = this.pos;
    const lh10 = atMinute(p.lh_t, 10), dn10 = atMinute(p.dn_t, 10);
    if (this.core && this.minutes >= 10 && this.roleSure) {
      if (this.rankCheck("lh10", { tipKey: "lane_lh_bad_tip", roastKey: "lane_lh_bad_roast" })) {
        const r = this.rank.lh10;
        if (r.pct < 25) {
          this.issue("lane_farm", Math.max(0, r.median - lh10) * 45, "Мало добитых крипов на лайне",
            `${lh10} ${plural(lh10, "крип", "крипа", "крипов")} к 10:00 — хуже, чем у ${100 - r.pct}% ${ROLE_GEN_PLURAL[pos]} на ранге ${RANKS[this.bracket][0]} (обычно ${Math.round(r.median)})`,
            "Перед каткой 5 минут добивай крипов в демке. На лайне бей крипа только на добивание, не пушь волну просто так");
        }
      } else {
        const target = LH_TARGET_10[pos];
        if (lh10 < target * 0.7) this.add(LANE, BAD, "lane_lh_bad", "lane_lh_bad_tip", { lh: lh10, target });
        else if (lh10 < target) this.add(LANE, WARN, "lane_lh_warn", null, { lh: lh10, target });
        else if (lh10 >= target * 1.25) this.add(LANE, GOOD, "lane_lh_good", null, { lh: lh10 });
      }
      if (pos === 2 && dn10 < 6) this.add(LANE, WARN, "lane_denies_warn", "lane_denies_warn_tip", { dn: dn10 });
    }
    if (this.opponent && this.minutes >= 10) {
      const diff = atMinute(p.networth_t, 10) - atMinute(this.opponent.networth_t, 10);
      if (diff <= -1000) {
        this.add(LANE, BAD, "lane_lost", "lane_lost_tip", { opp: this.oppName, gold: num(-diff) });
        this.issue("lane_lost", -diff * 0.8, `Слил лайн против ${this.oppName}`,
          `К 10:00 ты отстал от ${this.oppName} по нетворсу (стоимость шмота и золота) на ${num(-diff)}`,
          `Пересмотри первые 10 минут реплея: где ты проигрывал трейды (размены ударами) с ${this.oppName} и почему терял ХП`);
      }
      else if (diff >= 1000) this.add(LANE, GOOD, "lane_won", null, { opp: this.oppName, gold: num(diff) });
    }
    const firstDeath = (p.deaths_log || [])[0];
    if (firstDeath && firstDeath.time < EARLY_DEATH_TIME) {
      this.add(LANE, WARN, "surv_early_death", "surv_early_death_tip", { time: mmss(firstDeath.time) });
    }
    const early = (p.deaths_log || []).filter((d) => d.time < LANING_END);
    if (early.length >= 2) {
      const n = early.length;
      this.add(LANE, BAD, "lane_deaths", "lane_deaths_tip", {
        n, deaths_word: deathsWord(n), times_word: timesWord(n), times: early.map((d) => mmss(d.time)).join(", "),
      });
      const killers = [...new Set(early.map((d) => this.od.heroNameByKey(d.key)))].join(", ");
      this.issue("lane_deaths", n * 450, "Фидил на лайне",
        `${n} ${deathsWord(n)} до 10-й минуты (${early.map((d) => mmss(d.time)).join(", ")}), убивали: ${killers}` +
          (early[0].time < RUNE_FIGHT_END ? ". Первая — ещё в файте за руну на старте" : ""),
        "Пока не видишь всех врагов на миникарте, стой за своей крип-волной. Не лезь в трейд первым без преимущества по ХП и мане — так ты фидишь");
    }
  }

  // ---------- фарм ----------

  checkFarm() {
    const p = this.p;
    if (this.core) {
      const rankGpm = this.rankCheck("gpm", { tipKey: "compare_gap_tip_gold_per_min" });
      if (rankGpm && this.rank.gpm.pct < 25) {
        const r = this.rank.gpm;
        this.flagged.add("gold_per_min");
        this.flagged.add("last_hits_per_min");
        this.issue("gpm", (r.median - r.value) * (this.duration / 60), "Низкий GPM — мало фарма",
          `${Math.round(r.value)} золота в минуту — хуже, чем у ${100 - r.pct}% ${ROLE_GEN_PLURAL[this.pos]} на ранге ${RANKS[this.bracket][0]} (обычно ${Math.round(r.median)})`,
          "Всегда думай, какую волну или кемп (лесной лагерь) фармишь следующим. Нет файта — фарми, не стой АФК");
      }
      for (const [key, name] of rankGpm ? [] : [["gold_per_min", "GPM"], ["last_hits_per_min", "Ластхиты в минуту"]]) {
        const pct = this.bench[key];
        if (pct == null) continue;
        if (pct < 25) {
          this.flagged.add(key);
          this.add(FARM, BAD, "farm_bench_bad", null, { name, pct: 100 - pct });
        }
        else if (pct >= 80) this.add(FARM, GOOD, "farm_bench_good", null, { name, pct });
      }
      const idle = this.idleWindows();
      for (const [start, end, lh] of idle) {
        this.add(FARM, WARN, "farm_idle", "farm_idle_tip", { from: mmss(start * 60), to: mmss(end * 60), lh, mins: end - start });
      }
      if (idle.length) {
        const mins = sum(idle.map(([s, e]) => e - s));
        this.issue("idle", mins * (p.gold_per_min || 300) * 0.8, "АФК: ни фарма, ни файтов",
          `${idle.map(([s, e]) => `${mmss(s * 60)}–${mmss(e * 60)}`).join(", ")}: ни крипов, ни золота, ни файтов`,
          "Нет файта — фарми по кругу: волна, кемп, волна. Заранее решай, куда идёшь после текущей волны");
      }
      if (this.pos === 1 && this.minutes >= 25 && p.last_hits > 0) {
        const share = (p.neutral_kills ?? 0) / p.last_hits;
        if (share < 0.15) this.add(FARM, WARN, "farm_jungle", "farm_jungle_tip", { share: pyRound(share * 100) });
      }
      const towers = this.bench.tower_damage;
      if ((this.pos === 1 || this.pos === 3) && this.minutes >= 25 && towers != null && towers < 20) {
        this.flagged.add("tower_damage");
        this.add(FARM, WARN, "farm_towers", "farm_towers_tip", { pct: 100 - towers });
      }
      const xp = this.bench.xp_per_min;
      if (this.rankCheck("xpm", { tipKey: "farm_xp_bad_tip" })) {
        this.flagged.add("xp_per_min");
      } else if (xp != null && xp < 25) {
        this.flagged.add("xp_per_min");
        this.add(FARM, WARN, "farm_xp_bad", "farm_xp_bad_tip", { pct: 100 - xp });
      }
    }
    if (this.opponent && this.minutes >= 20 && this.core) {
      const diff = atMinute(p.networth_t, 20) - atMinute(this.opponent.networth_t, 20);
      if (diff <= -3000) this.add(FARM, BAD, "farm_nw_behind", null, { opp: this.oppName, gold: num(-diff) });
      else if (diff >= 3000) this.add(FARM, GOOD, "farm_nw_ahead", null, { opp: this.oppName, gold: num(diff) });
    }
  }

  // Минуты, когда игрок участвовал в драке (урон, хил, смерть или скиллы)
  fightMinutes() {
    const idx = this.match.players.indexOf(this.p);
    const busy = new Set();
    for (const tf of this.match.teamfights || []) {
      const me = (tf.players || [])[idx];
      if (!me) continue;
      if (me.damage > 0 || me.healing > 0 || me.deaths > 0 || Object.keys(me.ability_uses || {}).length > 0) {
        for (let m = Math.floor(tf.start / 60); m <= Math.floor(tf.end / 60) + 1; m++) busy.add(m);
      }
    }
    for (const k of this.p.kills_log || []) busy.add(Math.floor(k.time / 60));
    return busy;
  }

  // Простой: почти нет крипов, мало золота, игрок жив и не дерётся. Драки и ганги простоем не считаются
  idleWindows() {
    const lh = this.p.lh_t;
    if (!lh || !lh.length) return [];
    const gold = this.p.gold_t || [];
    const avgGold = gold.length > 1 ? gold[gold.length - 1] / (gold.length - 1) : 0;
    const busy = this.fightMinutes();
    const deadMinutes = new Set();
    for (const d of this.p.deaths_log || []) {
      const from = Math.floor(d.time / 60), to = Math.floor((d.time + (d.time_dead ?? 30)) / 60);
      for (let m = from; m <= to; m++) deadMinutes.add(m);
    }
    const lowGold = (m) => gold.length <= m || gold[m] - gold[m - 1] < avgGold * 0.4;
    for (const m of busy) deadMinutes.add(m);
    const windows = [];
    let start = null;
    const last = Math.min(lh.length - 1, 40);
    for (let m = 10; m <= last; m++) {
      const idle = m < lh.length && lh[m] - lh[m - 1] <= 1 && lowGold(m) && !deadMinutes.has(m);
      if (idle && start === null) start = m - 1;
      if ((!idle || m === last) && start !== null) {
        const end = !idle ? m - 1 : m;
        if (end - start >= 3) windows.push([start, end, lh[end] - lh[start]]);
        start = null;
      }
    }
    return windows.slice(0, 2);
  }

  // ---------- драки ----------

  checkFights() {
    const p = this.p;
    const teamKills = sum(this.allies.map((a) => a.kills));
    if (teamKills >= 10 && !this.rankCheck("kp", { tipKey: "fights_kp_bad_tip", roastKey: "fights_kp_bad_roast" })) {
      const kp = pyRound(((p.kills + p.assists) / teamKills) * 100);
      if (kp < 45) this.add(FIGHTS, BAD, "fights_kp_bad", "fights_kp_bad_tip", { kp });
      else if (kp >= 70) this.add(FIGHTS, GOOD, "fights_kp_good", null, { kp });
    }
    const missed = this.missedFights();
    if (missed.length) {
      const n = missed.length;
      const times = missed.slice(0, 3).map(([t, k]) => `${mmss(t)} (-${k})`).join(", ");
      this.add(FIGHTS, n >= 3 ? BAD : WARN, "fights_missed", "fights_missed_tip",
        { n, fights_word: plural(n, "файт", "файта", "файтов"), times });
      const lostAllies = sum(missed.map(([, k]) => k));
      this.issue("missed_fights", lostAllies * 300, "Файты без тебя",
        `${n} ${plural(n, "файт прошёл", "файта прошло", "файтов прошло")} без тебя, пока ты был жив (${times}; в скобках — сколько тиммейтов умерло)`,
        "Каждые пару секунд глянь на миникарту. Тиммейты собираются на файт — иди к ним или прыгай по ТП (свиток телепорта)");
    }
    if (this.rank.kp && this.rank.kp.pct < 25 && !missed.length) {
      const r = this.rank.kp;
      this.issue("kp", (r.median - r.value) * teamKills * 250, "Низкий KP — мало в файтах",
        `Ты участвовал в ${Math.round(r.value * 100)}% киллов команды — у ${ROLE_GEN_PLURAL[this.pos]} на ранге ${RANKS[this.bracket][0]} обычно ${Math.round(r.median * 100)}%`,
        "После 15-й минуты фарми рядом с командой и приходи на каждый файт, а не добивай кемп до конца");
    }
    if (this.core) {
      const pct = this.bench.hero_damage_per_min;
      if (this.rankCheck("dmg_min", { tipKey: "fights_dmg_bad_tip" })) {
        this.flagged.add("hero_damage_per_min");
      } else if (pct != null && pct < 25) {
        this.flagged.add("hero_damage_per_min");
        this.add(FIGHTS, WARN, "fights_dmg_bad", "fights_dmg_bad_tip", { pct: 100 - pct });
      } else if (pct != null && pct >= 80) this.add(FIGHTS, GOOD, "fights_dmg_good", null, { pct });
    } else {
      const assists = this.bench.assists_per_min;
      if (assists != null && assists < 25) {
        this.flagged.add("assists_per_min");
        this.add(FIGHTS, WARN, "fights_assists_bad", "fights_assists_bad_tip", { pct: 100 - assists });
      }
    }
  }

  missedFights() {
    const idx = this.match.players.indexOf(this.p);
    const allyIdx = this.allies.map((a) => this.match.players.indexOf(a));
    const dead = (this.p.deaths_log || []).map((d) => [d.time, d.time + (d.time_dead ?? 0)]);
    const result = [];
    for (const tf of this.match.teamfights || []) {
      const players = tf.players || [];
      if (players.length <= idx) continue;
      const me = players[idx];
      const tookPart = me.damage > 0 || me.healing > 0 || me.deaths > 0 || Object.keys(me.ability_uses || {}).length > 0;
      const wasDead = dead.some(([s, e]) => s <= tf.start && tf.start <= e);
      const allyDeaths = sum(allyIdx.filter((i) => i < players.length).map((i) => players[i].deaths));
      if (!tookPart && !wasDead && allyDeaths >= 2) result.push([tf.start, allyDeaths, tf]);
    }
    return result;
  }

  // ---------- выживание ----------

  inFight(t) {
    return this.fightWindows.some(([s, e]) => s <= t && t <= e);
  }

  // Смерть «в одиночку»: не в крупной драке и рядом по времени (±20 с) никто из своих не умер и не убил,
  // а сам игрок никого не забрал. Стычки 2 на 2 OpenDota дракой не считает — их отсекаем так
  isSoloDeath(t) {
    if (this.inFight(t)) return false;
    const near = (x) => Math.abs(x - t) <= 20;
    if ((this.p.kills_log || []).some((k) => near(k.time) && k.key.startsWith("npc_dota_hero_"))) return false;
    for (const a of this.allies) {
      if (a !== this.p && (a.deaths_log || []).some((d) => near(d.time))) return false;
      if ((a.kills_log || []).some((k) => near(k.time) && k.key.startsWith("npc_dota_hero_"))) return false;
    }
    return true;
  }

  checkSurvival() {
    const p = this.p;
    const deaths = p.deaths_log || [];
    const pct = this.bench.deaths_per_min;
    const n = p.deaths;
    if (this.rankCheck("deaths10", { roastKey: "surv_deaths_bad_roast", tipKey: "surv_dead_time_tip" })) {
      this.flagged.add("deaths_per_min");
    } else if (pct != null && pct < 25) {
      this.flagged.add("deaths_per_min");
      this.add(SURVIVAL, BAD, "surv_deaths_bad", null, { n, deaths_word: deathsWord(n), pct: 100 - pct });
    } else if (pct != null && pct >= 80 && this.minutes >= 20) {
      this.add(SURVIVAL, GOOD, n === 0 ? "surv_no_deaths" : "surv_deaths_good", null, { n, deaths_word: deathsWord(n) });
    }

    const solo = deaths.filter((d) => d.time >= LANING_END && this.isSoloDeath(d.time));
    if (solo.length >= 2) {
      const k = solo.length;
      this.add(SURVIVAL, BAD, "surv_solo", "surv_solo_tip",
        { n: k, times_word: timesWord(k), times: solo.slice(0, 5).map((d) => mmss(d.time)).join(", ") });
      const killers = [...new Set(solo.map((d) => this.od.heroNameByKey(d.key)))].slice(0, 3).join(", ");
      this.issue("solo_deaths", k * 550, "Тебя ганкали одного",
        `${k} ${deathsWord(k)} вне файтов: ${solo.slice(0, 5).map((d) => mmss(d.time)).join(", ")}. Ганкали: ${killers}`,
        "Прежде чем идти фармить дальний лайн или вражеский лес, посчитай врагов на миникарте. Трёх нет — значит, идут на тебя: фарми ближе к своим");
    }
    const deadShare = (p.life_state_dead || 0) / Math.max(this.duration, 1);
    if (this.rankCheck("dead_share", { tipKey: "surv_dead_time_tip", roastKey: "surv_dead_time_roast" })) {
      const r = this.rank.dead_share;
      if (r.pct < 25) {
        this.issue("dead_time", (r.value - r.median) * this.duration * ((p.gold_per_min || 300) / 60), "Слишком долго лежал мёртвым",
          `Ты пролежал мёртвым ${mmss(p.life_state_dead)} (${Math.round(r.value * 100)}% катки), у ${ROLE_GEN_PLURAL[this.pos]} на ранге ${RANKS[this.bracket][0]} обычно ${Math.round(r.median * 100)}%`,
          "Каждая смерть после 20-й минуты — минута без игры. Выходи из файта, когда ХП меньше трети и нет сейва (BKB, форс, выкуп)");
      }
    } else if (deadShare >= 0.15) {
      this.add(SURVIVAL, BAD, "surv_dead_time", "surv_dead_time_tip", { time: mmss(p.life_state_dead), pct: pyRound(deadShare * 100) });
    }
    const lost = sum(deaths.map((d) => d.gold_lost ?? 0));
    if (lost >= 1000 && lost / Math.max(p.total_gold || 1, 1) >= 0.1) {
      this.add(SURVIVAL, WARN, "surv_gold_lost", "surv_gold_lost_tip", { gold: num(lost) });
    }
  }

  // ---------- предметы ----------

  coreItems() {
    return (this.p.purchase_log || [])
      .filter((x) => this.od.itemCost(x.key) >= CORE_ITEM_MIN_COST && !x.key.startsWith("recipe_"))
      .map((x) => ({ key: x.key, item: this.od.itemName(x.key), time: x.time }));
  }

  checkItems() {
    const p = this.p, items = this.coreItems();
    if (this.core && this.roleSure && this.rankCheck("first_item", { tipKey: "items_first_bad_tip", roastKey: "items_first_bad_roast" })) {
      const r = this.rank.first_item;
      if (r.pct < 25) {
        const first = (p.purchase_log || []).find((x) => FIRST_ITEM_KEYS.has(x.key));
        this.issue("first_item", ((r.value - r.median) / 60) * (p.gold_per_min || 300) * 0.6, "Медленный тайминг кор-айтема",
          `${this.od.itemName(first.key)} только на ${mmss(r.value)} — у ${ROLE_GEN_PLURAL[this.pos]} на ранге ${RANKS[this.bracket][0]} первый кор-айтем обычно к ${mmss(r.median)}`,
          "Сначала собирай главный кор-айтем героя, ситуативку — потом. Не трать голду на лишние расходники и не умирай с полным карманом");
      }
    } else if (this.core && items.length) {
      const first = items[0];
      const minute = first.time / 60;
      const params = { item: first.item, time: mmss(first.time) };
      if (minute >= 20) this.add(ITEMS, BAD, "items_first_bad", "items_first_bad_tip", params);
      else if (minute >= 17) this.add(ITEMS, WARN, "items_first_warn", null, params);
      else if (minute <= 13) this.add(ITEMS, GOOD, "items_first_good", null, params);
    } else if (this.core && this.minutes >= 20) {
      this.add(ITEMS, BAD, "items_none");
    }

    // BKB — только если его реально часто собирают на этом герое и игрок много умирал
    const topPro = Math.max(0, ...Object.entries(this.pro).filter(([k]) => this.isFinalItem(k)).map(([, c]) => c));
    const bkbPopular = topPro > 0 && this.proCount("black_king_bar") >= topPro * 0.3;
    if ((this.pos === 1 || this.pos === 2) && this.minutes >= 30 && bkbPopular && (!this.won || p.deaths >= 6) && p.deaths >= 4) {
      if (!items.some((x) => x.key === "black_king_bar")) this.add(ITEMS, WARN, "items_no_bkb", "items_no_bkb_tip");
    }

    if (!this.dominant) {
      const tps = (p.item_uses || {}).tpscroll ?? 0;
      if (this.minutes >= 20 && tps < this.minutes / 10) this.add(ITEMS, WARN, "items_tp", "items_tp_tip", { n: tps, mins: this.minutes });
      const boots = (p.purchase_log || []).find((x) => x.key === "boots");
      if (this.core && boots && boots.time > 360) this.add(ITEMS, WARN, "items_boots", "items_boots_tip", { time: mmss(boots.time) });
    }

    if (!this.won && (p.gold ?? 0) >= 2500) this.add(ITEMS, WARN, "items_gold_left", "items_gold_left_tip", { gold: num(p.gold) });
  }

  // ---------- видение ----------

  checkVision() {
    const p = this.p;
    const obs = p.obs_placed ?? 0, sen = p.sen_placed ?? 0;
    const dewards = (p.observer_kills ?? 0) + (p.sentry_kills ?? 0);
    if (this.pos >= 4 && this.minutes >= 15 && this.roleSure) {
      const per10 = (obs / this.minutes) * 10;
      if (this.rankCheck("obs10", { tipKey: "vision_obs_bad_tip", roastKey: "vision_obs_bad_roast" })) {
        const r = this.rank.obs10;
        if (r.pct < 25) {
          this.issue("obs", ((r.median - r.value) / 10) * this.minutes * 300, "Мало вардов — нет вижна",
            `${obs} ${plural(obs, "обс", "обса", "обсов")} за ${this.minutes} ${plural(this.minutes, "минуту", "минуты", "минут")} — меньше, чем у ${100 - r.pct}% ${ROLE_GEN_PLURAL[this.pos]} на ранге ${RANKS[this.bracket][0]}`,
            "Обс (обсервер-вард) появился в лавке — сразу купи и поставь. Ставь туда, где через минуту будет файт или фарм команды");
        }
      } else if (per10 < 2.5) this.add(VISION, BAD, "vision_obs_bad", "vision_obs_bad_tip", { n: obs, mins: this.minutes });
      else if (per10 >= 4) this.add(VISION, GOOD, "vision_obs_good", null, { n: obs });

      const [short, total] = this.dewardedObservers();
      if (total >= 4 && short / total >= 0.4) this.add(VISION, WARN, "vision_dewarded", "vision_dewarded_tip", { short, total });
      if (sen < obs / 2) this.add(VISION, WARN, "vision_sentries", "vision_sentries_tip", { sen, obs, dewards });
      if (!this.dominant) {
        if (this.pos === 5 && this.minutes >= 25 && (p.camps_stacked ?? 0) < 2) this.add(VISION, WARN, "vision_stacks", "vision_stacks_tip");
        const smokes = (p.item_uses || {}).smoke_of_deceit ?? 0;
        if (this.minutes >= 30 && smokes === 0) this.add(VISION, WARN, "vision_smoke", "vision_smoke_tip", { mins: this.minutes });
      }
    } else if (this.core && dewards >= 3) {
      this.add(VISION, GOOD, "vision_dewards_good", null, { n: dewards });
    }
    if (this.pos === 2 && this.minutes >= 20 && !this.dominant && !this.missedEarlyPowerRunes()) {
      const runes = p.rune_pickups ?? 0;
      if (runes < this.minutes / 5) this.add(VISION, WARN, "vision_runes", "vision_runes_tip", { n: runes });
    }
  }

  dewardedObservers() {
    const placed = new Map();
    for (const w of this.p.obs_log || []) if ("ehandle" in w) placed.set(w.ehandle, w.time);
    const ownHero = this.od.heroKey(this.p.hero_id);
    let short = 0;
    for (const w of this.p.obs_left_log || []) {
      const start = placed.get(w.ehandle);
      if (start === undefined) continue;
      const killedByEnemy = w.attackername && w.attackername !== ownHero;
      if (killedByEnemy && w.time - start < (OBSERVER_LIFETIME * 2) / 3) short += 1;
    }
    return [short, placed.size];
  }

  // ---------- кто убивал и чем ----------

  ownedItems() {
    const owned = new Set((this.p.purchase_log || []).map((x) => x.key));
    for (const [base, upgrades] of Object.entries(ITEM_UPGRADES)) if (intersects(owned, upgrades)) owned.add(base);
    return owned;
  }

  role() {
    return this.core ? "core" : "support";
  }

  damageFrom(enemy) {
    const myKey = this.od.heroKey(this.p.hero_id);
    const sources = [];
    for (const [inflictor, targets] of Object.entries(enemy.damage_targets || {})) {
      const dmg = (targets || {})[myKey] ?? 0;
      if (dmg > 0) sources.push({ key: inflictor, name: this.od.sourceName(inflictor), damage: dmg, type: this.od.sourceType(inflictor) });
    }
    sources.sort((a, b) => b.damage - a.damage);
    return [sum(sources.map((s) => s.damage)), sources];
  }

  disablesFrom(enemy) {
    const myKey = this.od.heroKey(this.p.hero_id);
    const result = [];
    for (const [ability, targets] of Object.entries(enemy.ability_targets || {})) {
      const count = (targets || {})[myKey] ?? 0;
      if (count > 0) result.push({ name: this.od.sourceName(ability), count });
    }
    return result.sort((a, b) => b.count - a.count);
  }

  pickCounters(mechanics, mainType, owned) {
    let candidates = [];
    for (const m of mechanics) candidates = candidates.concat(this.k.mechanics[m][this.role()]);
    if (mainType in this.k.damage_types) candidates = candidates.concat(this.k.damage_types[mainType][this.role()]);
    const unique = [];
    for (const key of candidates) if (!unique.includes(key)) unique.push(key);
    const had = unique.filter((k) => owned.has(k));
    let missing = unique.filter((k) => !owned.has(k));
    const popular = this.proFilter(missing);
    if (popular !== null) missing = popular;
    return [missing.slice(0, MAX_COUNTER_ITEMS), had];
  }

  mechanicConfirmed(m, enemy, key) {
    const used = enemy.ability_uses || {};
    const bought = new Set((enemy.purchase_log || []).map((x) => x.key));
    if (m === "invis") {
      return ALWAYS_INVIS.has(key) || Object.keys(used).some((a) => INVIS_ABILITIES.has(a)) || [...bought].some((x) => INVIS_ITEMS.has(x));
    }
    if (m === "blink_init") return INNATE_INITIATORS.has(key) || [...bought].some((x) => BLINK_ITEMS.has(x));
    return true;
  }

  relevantMechanics(mechanics, mainType, enemy = null, key = "") {
    return mechanics.filter((m) => {
      if (enemy && !this.mechanicConfirmed(m, enemy, key)) return false;
      if (m === "burst_physical" && mainType !== "Physical") return false;
      if (m === "burst_magic" && !(mainType === "Magical" || mainType === "Pure")) return false;
      return this.k.mechanics[m].roles.includes(this.role());
    });
  }

  checkKillers() {
    const counts = new Map();
    for (const d of this.p.deaths_log || []) counts.set(d.key, (counts.get(d.key) || 0) + 1);
    const owned = this.ownedItems();
    const enemiesByKey = new Map(this.enemies.map((e) => [this.od.heroKey(e.hero_id), e]));
    const killers = [];
    for (const [key, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      const enemy = enemiesByKey.get(key);
      if (!enemy || n < 2) continue;
      const [total, sources] = this.damageFrom(enemy);
      const byType = new Map();
      for (const s of sources) if (s.type) byType.set(s.type, (byType.get(s.type) || 0) + s.damage);
      let mainType = null;
      for (const [t, v] of byType) if (mainType === null || v > byType.get(mainType)) mainType = t;
      const share = mainType && total ? pyRound((byType.get(mainType) / total) * 100) : 0;
      const mechanics = this.relevantMechanics(this.k.heroes[key] || [], mainType, enemy, key);
      const threat = this.threatProfile([enemy]);
      const ranked = this.rankCounters(threat).slice(0, 5);
      let missing = ranked.filter((r) => !owned.has(r.key)).map((r) => r.key).slice(0, MAX_COUNTER_ITEMS);
      let had = ranked.filter((r) => owned.has(r.key)).map((r) => r.key);
      if (!ranked.length) [missing, had] = this.pickCounters(mechanics, mainType, owned);
      const whyByKey = Object.fromEntries(ranked.map((r) => [r.key, r.why]));
      const name = this.od.heroName(enemy.hero_id);
      killers.push({
        hero: name,
        hero_id: enemy.hero_id,
        key,
        deaths: n,
        damage: total,
        main_type: mainType,
        main_type_share: share,
        damage_by_type: Object.fromEntries(byType),
        sources: sources.slice(0, 4),
        disables: this.disablesFrom(enemy).slice(0, 3),
        control: threat.controls.slice(0, 4).map((c) => ({ name: c.name, count: c.count, label: c.label, bkb_blocks: c.bkbBlocks, dispellable: c.dispellable })),
        counter_why: whyByKey,
        mechanics: mechanics.map((m) => this.k.mechanics[m].name),
        tips: mechanics.map((m) => this.k.mechanics[m].tip.replaceAll("{hero}", name)),
        counters: missing.map((k) => this.od.itemName(k)),
        counter_keys: missing,
        had_counters: had.map((k) => this.od.itemName(k)),
        had_counter_keys: had,
      });
    }
    for (const killer of killers.slice(0, 3)) this.addKillerFinding(killer);
    return killers.slice(0, 3);
  }

  addKillerFinding(k) {
    const n = k.deaths;
    let text = this.say("killer_head", { hero: k.hero, n, times_word: timesWord(n) }, k.key);
    if (k.damage) {
      const how = k.sources.slice(0, 3).map((s) => `${s.name} ${num(s.damage)}`).join(", ");
      text += `: ${num(k.damage)} урона`;
      if (k.main_type) text += `, ${k.main_type_share}% ${this.damageTypeNames[k.main_type]}`;
      text += ` (${how})`;
    }
    if (k.disables.length) text += ". Контроль: " + k.disables.map((d) => `${d.name} ×${d.count}`).join(", ");

    const tipParts = k.tips.slice(0, 2);
    if (k.counters.length) tipParts.push(this.say("killer_buy", { items: k.counters.join(", ") }, k.key));
    else if (this.hasPro && !k.had_counters.length) tipParts.push(this.say("killer_no_items", {}, k.key));
    if (n >= 3) {
      const had = new Set(k.had_counter_keys);
      if ([...had].some((x) => DETECTION_ITEMS.has(x))) tipParts.push(this.say("killer_had_detect", {}, k.key));
      const active = k.had_counter_keys.filter((x) => !DETECTION_ITEMS.has(x)).map((x) => this.od.itemName(x));
      if (active.length) {
        tipParts.push(this.say("killer_had_active", { items: active.slice(0, 2).join(", "), verb: active.length > 1 ? "были" : "был" }, k.key));
      }
    }
    let roast = "";
    if (n >= 3) {
      const params = { hero: k.hero, n, times_word: timesWord(n), deaths_word: deathsWord(n) };
      if (k.mechanics.includes("невидимость") && !k.had_counter_keys.some((x) => DETECTION_ITEMS.has(x))) {
        roast = this.say("killer_roast_detect", params, k.key);
      } else if (k.counters.length) {
        roast = this.say("killer_roast_item", { ...params, item: k.counters[0] }, k.key);
      } else {
        roast = this.say("killer_roast_generic", params, k.key);
      }
    }
    this.addRaw(SURVIVAL, n >= 4 ? BAD : WARN, text, tipParts.join(". "), "killer", roast);
    if (n >= 3) {
      const how = k.sources.slice(0, 2).map((s) => s.name).join(" и ");
      const action = [k.tips[0], k.counters.length ? `Купи ${k.counters.slice(0, 2).join(" или ")}` : ""]
        .filter(Boolean).join(". ");
      this.issue(`killer_${k.key}`, n * 380, `Частые смерти от ${k.hero}`,
        `${n} ${deathsWord(n)} от ${k.hero}${how ? `, в основном ${how}` : ""}`,
        action || `Держись дальше от ${k.hero} и не выходи один против этого героя`,
        k.counters.length
          ? `Цель на следующую катку: не больше одной смерти от ${k.hero}, если снова против него (помогут ${k.counters[0]})`
          : `Цель на следующую катку: не больше одной смерти от ${k.hero}`);
    }
  }

  // ---------- что реально происходило с тобой: урон и контроль по всем врагам ----------

  classifyControl(ability) {
    if (ability in ITEM_CONTROL) {
      const [kind, hard] = ITEM_CONTROL[ability];
      const label = CONTROL_KINDS.find((k) => k[0] === kind)[2];
      return { kind, label, hard, bkbBlocks: true, dispellable: kind !== "stun" && kind !== "hex" };
    }
    const info = this.od.abilityInfo ? this.od.abilityInfo(ability) : null;
    if (!info || !info.desc) return null;
    const found = CONTROL_KINDS.find((k) => k[1].test(info.desc));
    if (!found) return null;
    return { kind: found[0], label: found[2], hard: found[3], bkbBlocks: info.bkb !== "Yes", dispellable: info.disp === "Yes" };
  }

  controlFrom(enemy) {
    const myKey = this.od.heroKey(this.p.hero_id);
    const result = [];
    for (const [ability, targets] of Object.entries(enemy.ability_targets || {})) {
      const count = (targets || {})[myKey] ?? 0;
      if (count < 1) continue;
      const c = this.classifyControl(ability);
      if (c) result.push({ ability, name: this.od.sourceName(ability), count, ...c });
    }
    return result.sort((a, b) => b.count - a.count);
  }

  threatProfile(enemies) {
    const byType = {};
    let total = 0, auto = 0, magicBlock = 0;
    const controls = [];
    for (const e of enemies) {
      const [t, sources] = this.damageFrom(e);
      total += t;
      for (const src of sources) {
        if (src.type) byType[src.type] = (byType[src.type] || 0) + src.damage;
        if (src.key === "null" || src.key === "") auto += src.damage;
        const ai = this.od.abilityInfo ? this.od.abilityInfo(src.key) : null;
        if (src.type === "Magical" && ai && ai.bkb !== "Yes") magicBlock += src.damage;
      }
      controls.push(...this.controlFrom(e));
    }
    const share = (t) => (total ? (byType[t] || 0) / total : 0);
    const sumBy = (f) => sum(controls.filter(f).map((c) => c.count));
    return {
      total, byType, controls,
      magic: share("Magical"), magicBlock: total ? magicBlock / total : 0, phys: share("Physical"), pure: share("Pure"), auto: total ? auto / total : 0,
      hard: sumBy((c) => c.hard),
      hardBlock: sumBy((c) => c.hard && c.bkbBlocks),
      soft: sumBy((c) => !c.hard && c.kind !== "slow"),
      softDispel: sumBy((c) => !c.hard && c.kind !== "slow" && c.dispellable),
      silence: sumBy((c) => c.kind === "silence"),
      anyDispel: sumBy((c) => c.dispellable),
    };
  }

  // Предметы под обстановку: у каждого свой счёт по тому, от чего тебя реально били
  rankCounters(t, minutes = this.minutes) {
    const core = this.core;
    const pct = (x) => Math.round(x * 100);
    const rows = [
      ["black_king_bar", core ? 1 : 0.5, t.hardBlock * 0.9 + t.silence * 0.4 * (t.hardBlock ? 0 : 1) + t.magicBlock * 6,
        () => {
          const n = t.hardBlock + (t.hardBlock ? 0 : t.silence);
          const parts = [];
          if (n) parts.push(`БКБ заблокировал бы ${n} ${plural(n, "контроль", "контроля", "контролей")} на тебе`);
          if (t.magicBlock >= 0.25) parts.push(`${pct(t.magicBlock)}% урона по тебе идёт магией, которую он режет`);
          return parts.join(", плюс ") || "защита от магии и контроля";
        }],
      ["manta", core ? 1 : 0, t.softDispel * 0.9,
        () => `${t.softDispel} ${plural(t.softDispel, "сайленс/рут/дизарм", "сайленса/рута/дизарма", "сайленсов/рутов/дизармов")} на тебе, Manta снимает их диспелом`],
      ["cyclone", 1, t.anyDispel * 0.7 + t.hard * 0.15,
        () => `дешёвый диспел: снимает ${t.anyDispel} ${plural(t.anyDispel, "контроль", "контроля", "контролей")} на тебе и спасает от добивания`],
      ["lotus_orb", 1, t.anyDispel * 0.6 + t.hard * 0.3,
        () => `диспел плюс отражение: ${t.anyDispel + t.hard} ${plural(t.anyDispel + t.hard, "контроль", "контроля", "контролей")} на тебе`],
      ["sphere", core ? 1 : 0, t.hardBlock * 0.7,
        () => `${t.hardBlock} ${plural(t.hardBlock, "жёсткий контроль", "жёстких контроля", "жёстких контролей")} по одной цели, Linken's блокирует первый из них`],
      ["aeon_disk", core ? 1 : 0, t.magic >= 0.4 && t.total > 8000 ? t.magic * 6 : 0,
        () => `${pct(t.magic)}% урона магией и много урона разом: Aeon Disk спасает от добивания`],
      ["glimmer_cape", core ? 0 : 1, t.magic * 6,
        () => `${pct(t.magic)}% урона по тебе магией, Glimmer режет магию и прячет от таргета`],
      ["pipe", core ? 0 : 1, t.magic * 5.5,
        () => `${pct(t.magic)}% урона магией: Pipe срезает его всей команде`],
      ["hood_of_defiance", core ? 1 : 0.6, t.magic * 4.5,
        () => `${pct(t.magic)}% урона магией, а это самый дешёвый способ его срезать`],
      ["ghost", 1, t.phys * 3.5 + t.auto * 1.5,
        () => `${pct(t.phys)}% урона физического: Ghost Scepter даёт к нему неуязвимость на несколько секунд`],
      ["heavens_halberd", core ? 1 : 0.3, t.auto * 6,
        () => `${pct(t.auto)}% урона пришло автоатаками: Halberd отключает атаку и даёт уклонение`],
      ["assault", core ? (minutes >= 28 ? 1 : 0) : 0, t.auto * 5 + t.phys * 1.5,
        () => `${pct(t.auto)}% урона автоатаками: Assault Cuirass даёт броню, а она в лейте решает`],
      ["shivas_guard", 1, t.phys * 3 + t.magic * 1.2,
        () => `броня и замедление против физики (${pct(t.phys)}% урона по тебе), плюс режет лечение врагов`],
      ["solar_crest", core ? 0 : 1, t.auto * 4,
        () => `${pct(t.auto)}% урона автоатаками: Solar Crest снимает броню врагу и прибавляет её союзнику`],
      ["butterfly", core ? (minutes >= 30 ? 1 : 0) : 0, t.auto * 3.5,
        () => `${pct(t.auto)}% урона автоатаками, а уклонение режет часть из них`],
    ];
    const popular = new Set(this.proFilter(rows.map((r) => r[0])) || []);
    const items = this.od.items || {};
    return rows
      .filter(([key, w]) => w > 0 && (!Object.keys(items).length || key in items))
      .map(([key, w, base, why]) => ({ key, score: base * w + (popular.has(key) ? 0.6 : 0), why: why(), popular: popular.has(key) }))
      .filter((r) => r.score >= BUILD_MIN_SCORE)
      .sort((a, b) => b.score - a.score);
  }

  buildPlan() {
    if (this.minutes < 15) return null;
    const t = this.threatProfile(this.enemies);
    if (t.total < 3000) return null;
    const owned = this.ownedItems();
    const bought = new Map((this.p.purchase_log || []).map((x) => [x.key, x.time]));
    const ranked = this.rankCounters(t);
    const items = ranked.slice(0, BUILD_MAX_ITEMS + 2).map((r) => ({
      key: r.key, item: this.od.itemName(r.key), why: r.why, popular: r.popular,
      owned: owned.has(r.key), time: bought.has(r.key) ? bought.get(r.key) : null,
    }));
    const missing = items.filter((i) => !i.owned).slice(0, BUILD_MAX_ITEMS);
    const have = items.filter((i) => i.owned);
    const facts = [];
    const pct = (x) => Math.round(x * 100);
    if (t.total) {
      const main = Object.entries(t.byType).sort((a, b) => b[1] - a[1])[0];
      if (main) facts.push(`Основной урон по тебе: ${this.damageTypeNames[main[0]]} (${pct(main[1] / t.total)}%)${t.auto >= 0.4 ? `, автоатаки ${pct(t.auto)}%` : ""}`);
    }
    if (t.hard + t.soft > 0) {
      const top = t.controls.slice(0, 3).map((c) => `${c.name} ×${c.count} (${c.label})`).join(", ");
      facts.push(`Контроль на тебе: ${top}`);
    }
    return { facts, missing, have };
  }

  checkDispel() {
    if (this.minutes < 20 || this.dominant) return;
    const t = this.threatProfile(this.enemies);
    if (t.anyDispel < 6 || t.silence + t.softDispel < 4) return;
    const owned = this.ownedItems();
    const dispels = ["manta", "cyclone", "lotus_orb", "black_king_bar"].filter((k) => owned.has(k));
    if (dispels.length) return;
    const names = ["manta", "cyclone", "lotus_orb"].filter((k) => this.od.itemName(k) && (!Object.keys(this.od.items || {}).length || k in this.od.items))
      .map((k) => this.od.itemName(k)).join(", ");
    this.add(ITEMS, WARN, "build_dispel", "build_dispel_tip", { n: t.anyDispel, times_word: timesWord(t.anyDispel), items: names });
  }

  // ---------- сборка против пика ----------

  checkItemization() {
    if (this.minutes < 20) return;
    const owned = this.ownedItems();
    const role = this.role();

    const received = this.p.damage_inflictor_received || {};
    const total = sum(Object.values(received));
    if (total >= 5000) {
      const byType = {};
      for (const [key, dmg] of Object.entries(received)) {
        const t = this.od.sourceType(key);
        if (t) byType[t] = (byType[t] || 0) + dmg;
      }
      for (const [dmgType, threshold] of [["Magical", 0.5], ["Physical", 0.65]]) {
        const share = (byType[dmgType] || 0) / total;
        const counters = this.k.damage_types[dmgType][role];
        if (share < threshold || intersects(owned, counters)) continue;
        const popular = this.proFilter(counters);
        const options = (popular !== null ? popular : counters).slice(0, 3);
        if (options.length) {
          this.add(ITEMS, WARN, "items_dmg_type", "items_dmg_type_tip", {
            pct: pyRound(share * 100), type: DAMAGE_TYPE_ADJ[dmgType], items: options.map((k) => this.od.itemName(k)).join(", "),
          });
        }
      }
    }

    const enemyTags = {};
    for (const e of this.enemies) {
      const key = this.od.heroKey(e.hero_id);
      for (const tag of this.k.heroes[key] || []) {
        if (!this.mechanicConfirmed(tag, e, key)) continue;
        (enemyTags[tag] = enemyTags[tag] || []).push(this.od.heroName(e.hero_id));
      }
    }
    if (enemyTags.invis && this.pos >= 4 && !intersects(owned, [...DETECTION_ITEMS])) {
      this.add(VISION, BAD, "vision_invis", "vision_invis_tip", { heroes: enemyTags.invis.join(", ") });
    }
    const accuracyPopular = this.proFilter(["monkey_king_bar", "bloodthorn"]);
    if (enemyTags.evasion && this.pos === 1 && this.minutes >= 30 && !intersects(owned, ["monkey_king_bar", "bloodthorn"]) &&
        !(accuracyPopular !== null && accuracyPopular.length === 0)) {
      this.add(ITEMS, WARN, "items_evasion", "items_evasion_tip", { heroes: enemyTags.evasion.join(", ") });
    }
    const antihealPopular = this.proFilter(["spirit_vessel", "shivas_guard", "skadi"]);
    if ((enemyTags.heal || []).length >= 2 && (this.pos === 3 || this.pos === 4) &&
        !intersects(owned, ["spirit_vessel", "shivas_guard", "skadi"]) && !(antihealPopular !== null && antihealPopular.length === 0)) {
      this.add(ITEMS, WARN, "items_heal", "items_heal_tip", { heroes: enemyTags.heal.join(", ") });
    }
  }

  // ---------- игра в целом ----------

  checkGame() {
    const adv = this.teamAdv;
    if (!adv.length || this.won) return;
    let bestMinute = 0, best = adv[0];
    adv.forEach((a, i) => { if (a > best) { best = a; bestMinute = i; } });
    if (best >= 8000) this.add(FIGHTS, WARN, "game_throw", "game_throw_tip", { gold: num(best), minute: bestMinute });
  }

  // ---------- карта, Рошан, концовка ----------

  checkRoshan() {
    const myTeam = this.p.isRadiant ? 2 : 3;
    const kills = (this.match.objectives || []).filter((o) => o.type === "CHAT_MESSAGE_ROSHAN_KILL");
    const ours = kills.filter((o) => o.team === myTeam).length;
    const theirs = kills.length - ours;
    if (theirs >= 2 && ours === 0) {
      this.add(FIGHTS, WARN, "fights_roshan_lost", "fights_roshan_lost_tip", { theirs, times_word: timesWord(theirs) });
    } else if (ours >= 2 && theirs === 0) {
      this.add(FIGHTS, GOOD, "fights_roshan_won", null, { ours, times_word: timesWord(ours) });
    }
  }

  fightDeathPoints() {
    const idx = this.match.players.indexOf(this.p);
    const points = [];
    for (const tf of this.match.teamfights || []) {
      const players = tf.players || [];
      if (players.length <= idx) continue;
      for (const [x, ys] of Object.entries(players[idx].deaths_pos || {})) {
        for (const [y, count] of Object.entries(ys)) {
          for (let i = 0; i < count; i++) points.push([parseFloat(x), parseFloat(y)]);
        }
      }
    }
    return points;
  }

  checkDeathZones() {
    const n = this.fightDeathPoints().filter(([x, y]) => enemyHalf(x, y, this.p.isRadiant)).length;
    if (n >= 3) {
      this.add(SURVIVAL, WARN, "surv_enemy_half", `surv_enemy_half_tip_${this.role()}`,
        { n, times_word: timesWord(n), deaths_word: deathsWord(n) });
    }
  }

  checkWardZones() {
    const wards = this.p.obs_log || [];
    if (this.pos < 4 || this.minutes < 20 || wards.length < 5) return;
    const enemy = wards.filter((w) => enemyHalf(w.x, w.y, this.p.isRadiant)).length;
    const share = enemy / wards.length;
    if (share < 0.2) this.add(VISION, WARN, "vision_own_half", "vision_own_half_tip", { enemy, total: wards.length });
    else if (share >= 0.5) this.add(VISION, GOOD, "vision_deep_good", null, { enemy, total: wards.length });
  }

  checkLateGame() {
    const late = (this.p.deaths_log || []).filter((d) => d.time >= LATE_GAME_TIME);
    if (!this.won && late.length >= 2 && !this.p.buyback_count) {
      const n = late.length;
      this.add(ITEMS, WARN, "items_no_buyback", "items_no_buyback_tip", { n, times_word: timesWord(n), deaths_word: deathsWord(n) });
    }
  }

  // ---------- мелкие ошибки: конкретные моменты со временем ----------

  checkMicro() {
    // Пометки к смертям в хронологии: время смерти -> что пошло не так
    this.deathNotes = new Map();
    this.unusedKeys = new Set();
    this.checkLaneGaps();
    this.checkCoreDenies();
    this.checkMidRunes();
    this.checkFarmPace();
    this.checkLastHits20();
    this.checkWardGaps();
    this.checkNeutral();
    this.checkWand();
    this.checkFightButtons();
    this.checkFirstToDie();
    this.checkBuybacks();
    this.checkDeathsWhileAhead();
    this.checkIdleActives();
    this.checkCoreWards();
    this.checkMidStartWard();
    this.checkRoshanFollowup();
    this.checkTormentor();
    this.checkLaneXp();
    this.checkNetworthGap();
    this.checkKillsNoFarm();
    this.checkSupportLevel();
    this.checkBkbSolo();
  }

  micro(category, severity, key, params = {}, tipKey = `${key}_tip`) {
    this.add(category, severity, key, tipKey, params, "micro");
  }

  // Минуты (по началу), когда игрок был мёртв
  deadMinuteSet() {
    const dead = new Set();
    for (const d of this.p.deaths_log || []) {
      const from = Math.floor(d.time / 60), to = Math.floor((d.time + (d.time_dead ?? 30)) / 60);
      for (let m = from; m <= to; m++) dead.add(m);
    }
    return dead;
  }

  // Минуты лайна без единого ластхита, когда игрок был жив и не дрался
  checkLaneGaps() {
    const lh = this.p.lh_t || [];
    if (!this.core || !this.roleSure || this.dominant || this.minutes < 10 || lh.length < 11) return;
    const dead = this.deadMinuteSet(), busy = this.fightMinutes();
    const empty = [];
    for (let m = 2; m <= 10; m++) {
      if (lh[m] - lh[m - 1] === 0 && !dead.has(m - 1) && !dead.has(m) && !busy.has(m - 1)) empty.push(m);
    }
    this.laneGapCount = empty.length;
    if (empty.length < 2) return;
    const n = empty.length;
    const times = minuteRanges(empty);
    this.micro(LANE, n >= 4 ? BAD : WARN, "micro_lane_gaps", { n, mins: n, times });
    this.issue("lane_gaps", n * 150, "Пустые минуты на лайне",
      `${n} ${plural(n, "минута", "минуты", "минут")} лайна без единого добитого крипа: ${times}. Ты был жив и не дрался — крипы умирали без тебя`,
      this.pos === 3
        ? "Если тебя зонят от волны — не стой в стороне: тяни крипов на себя, добивай или фарми малый кемп рядом с лайном"
        : "Каждые 20–30 секунд будь у волны. Если не пускают — отведи волну к своей вышке (пул саппорта, агро крипов), но не стой без дела");
  }

  checkCoreDenies() {
    if (![1, 3].includes(this.pos) || !this.roleSure || this.dominant || this.minutes < 10) return;
    const dn10 = atMinute(this.p.dn_t, 10);
    if (dn10 == null || dn10 > 2) return;
    const dnText = dn10 === 0 ? "ни одного деная" : `всего ${dn10} ${plural(dn10, "денай", "деная", "денаев")}`;
    this.micro(LANE, WARN, "micro_core_denies", { dn_text: dnText });
  }

  // Мидер без единой руны силы до 12:00 (по логу рун)
  missedEarlyPowerRunes() {
    const log = this.p.runes_log;
    if (this.pos !== 2 || !this.roleSure || this.dominant || !Array.isArray(log) || this.duration < 900) return false;
    return !log.some((r) => r.time <= 735 && POWER_RUNES.has(String(r.key)));
  }

  checkMidRunes() {
    if (!this.missedEarlyPowerRunes()) return;
    this.micro(LANE, WARN, "micro_mid_runes");
    this.issue("mid_runes", 400, "Мид без рун",
      "До 12:00 ты не взял ни одной руны силы — а они появляются на 6:00, 8:00, 10:00 и 12:00",
      "За 15 секунд до чётной минуты сдвигайся к реке и забирай руну. Нет шансов забрать — подсвети её вардом, чтобы знать, с чем придёт оппонент");
  }

  // Темп фарма с 10 по 20 минуту в спокойные минуты (жив и не в драке)
  checkFarmPace() {
    const lh = this.p.lh_t || [];
    if (!this.core || !this.roleSure || this.dominant || this.minutes < 21 || lh.length < 21) return;
    const dead = this.deadMinuteSet(), busy = this.fightMinutes();
    // Простои уже разобраны отдельной проверкой «АФК», второй раз их не считаем
    const idle = this.idleWindows();
    const isIdle = (m) => idle.some(([s, e]) => s <= m - 1 && m - 1 < e);
    let free = 0, gained = 0;
    for (let m = 11; m <= 20; m++) {
      if (dead.has(m - 1) || busy.has(m - 1) || isIdle(m)) continue;
      free++;
      gained += lh[m] - lh[m - 1];
    }
    if (free < 4) return;
    const pace = gained / free;
    this.farmPace = Math.round(pace * 10) / 10;
    const target = Math.round(FARM_PACE[this.bracket || "archon"] * FARM_PACE_ROLE[this.pos] * 10) / 10;
    if (pace >= target) return;
    const rankGen = this.bracket ? ` на ранге ${RANKS[this.bracket][0]}` : "";
    this.micro(FARM, pace < target * 0.7 ? BAD : WARN, "micro_farm_pace",
      { pace: tenths(pace), target: tenths(target), mins: free, role_gen: ROLE_GEN_PLURAL[this.pos], rank: rankGen });
    this.issue("farm_pace", (target - pace) * free * 45, "Медленный фарм в мидгейме",
      `С 10:00 до 20:00 в спокойные минуты (${free} ${plural(free, "минута", "минуты", "минут")}) ты добивал ${tenths(pace)} крипа в минуту — для ${ROLE_GEN_PLURAL[this.pos]}${rankGen} нормальный темп от ${tenths(target)}`,
      "Фарми по кругу: волна на линии → ближайший кемп → следующая волна. Пока идёшь — смотри на миникарту и сразу решай, куда дальше",
      `Цель на следующую катку: с 10 по 20 минуту ${tenths(target)}+ крипов в минуту`);
  }

  // Самая длинная дыра между обсами у саппорта (без учёта времени мёртвым)
  checkWardGaps() {
    if (this.pos < 4 || !this.roleSure || this.duration < 1500) return;
    const times = (this.p.obs_log || []).map((w) => w.time).filter((t) => t >= 0).sort((a, b) => a - b);
    if (times.length < 3) return;
    const a = 300, b = this.duration - 180;
    const points = [a, ...times.filter((t) => t > a && t < b), b];
    let gap = [0, a, a];
    for (let i = 1; i < points.length; i++) {
      if (points[i] - points[i - 1] > gap[0]) gap = [points[i] - points[i - 1], points[i - 1], points[i]];
    }
    const deadInGap = sum((this.p.deaths_log || []).map((d) =>
      Math.max(0, Math.min(d.time + (d.time_dead ?? 30), gap[2]) - Math.max(d.time, gap[1]))));
    const effective = gap[0] - deadInGap;
    this.wardGap = effective;
    if (effective < WARD_GAP) return;
    const mins = Math.round(gap[0] / 60);
    this.micro(VISION, mins >= 12 ? BAD : WARN, "micro_ward_gap", { from: mmss(gap[1]), to: mmss(gap[2]), mins });
    this.issue("ward_gap", (effective / 60) * 80, "Дыра в вардах",
      `С ${mmss(gap[1])} до ${mmss(gap[2])} ты не поставил ни одного обса — ${mins} ${plural(mins, "минуту", "минуты", "минут")} команда играла вслепую`,
      "Обсы в лавке восстанавливаются: заглядывай туда каждые пару минут и держи 1–2 варда при себе. Пропал старый — сразу ставь новый",
      "Цель на следующую катку: ни одного перерыва в обсах дольше 5 минут");
  }

  checkNeutral() {
    if (this.duration < 1500 || this.dominant || !("item_neutral" in this.p) || this.p.item_neutral) return;
    this.micro(ITEMS, WARN, "micro_neutral");
  }

  checkWand() {
    if (this.duration < 1200 || this.dominant || !this.hasPro) return;
    if ((this.p.purchase_log || []).some((x) => x.key === "magic_stick" || x.key === "magic_wand")) return;
    const ranked = Object.entries(this.pro).sort((x, y) => y[1] - x[1]).map(([k]) => k);
    const idx = ranked.indexOf("magic_wand");
    if (idx < 0 || idx >= 15) return;
    this.micro(ITEMS, WARN, "micro_wand", { hero: this.hero });
  }

  // Был ли у игрока предмет к моменту t: куплен заранее и ещё не ушёл в апгрейд
  ownedAt(key, t) {
    const log = this.p.purchase_log || [];
    const buy = log.find((x) => x.key === key && x.time < t - 5);
    if (!buy) return false;
    const upgrades = ITEM_UPGRADES[key] || [];
    return !log.some((x) => upgrades.includes(x.key) && x.time > buy.time && x.time < t);
  }

  fightDeathTime(tf) {
    const d = (this.p.deaths_log || []).find((x) => x.time >= tf.start - 2 && x.time <= tf.end + 2);
    return d ? d.time : tf.start;
  }

  // Смерти в файтах с ненажатым сейвом и смерти без единой прожатой кнопки
  checkFightButtons() {
    const idx = this.match.players.indexOf(this.p);
    const unused = [], silent = [];
    const usedAt = {}, insideUses = {};
    for (const tf of this.match.teamfights || []) {
      const me = (tf.players || [])[idx];
      if (!me) continue;
      const items = me.item_uses;
      if (me.deaths > 0) {
        const t = this.fightDeathTime(tf);
        if (items) {
          const miss = SAVE_ITEMS.find(([key, cd]) => this.ownedAt(key, tf.start) && !items[key] &&
            !(usedAt[key] != null && tf.start - usedAt[key] < cd));
          if (miss) unused.push({ t, key: miss[0] });
        }
        if (!Object.keys(me.ability_uses || {}).length && !Object.keys(items || {}).length && !(me.damage > 0)) silent.push(t);
      }
      for (const [key, n] of Object.entries(items || {})) {
        usedAt[key] = tf.end;
        insideUses[key] = (insideUses[key] || 0) + n;
      }
    }

    const byItem = new Map();
    for (const u of unused) byItem.set(u.key, [...(byItem.get(u.key) || []), u.t]);
    for (const [key, ts] of [...byItem.entries()].slice(0, 2)) {
      const item = this.od.itemName(key);
      const times = ts.slice(0, 3).map(mmss).join(", ");
      const n = ts.length;
      // Нажатия вне больших драк по времени не видны: предмет мог быть в откате после стычки
      const outside = ((this.p.item_uses || {})[key] || 0) > (insideUses[key] || 0);
      const severe = (key === "black_king_bar" || n >= 2) && !(outside && n < 2);
      this.unusedKeys.add(key);
      this.micro(FIGHTS, severe ? BAD : WARN, "micro_unused_item",
        { item, times, n, times_word: timesWord(n) });
      for (const t of ts) this.deathNotes.set(t, `${item} так и не нажат`);
      this.issue(`unused_${key}`, n * 500, `Не нажал ${item} в файтах`,
        `${n === 1 ? "Умер" : `${n} ${timesWord(n)} умер`} в драке с ${item} в слоте и так его и не нажал (${times})`,
        key === "black_king_bar"
          ? "BKB жмётся ДО того, как на тебя прилетит контроль: видишь врага с блинком/станом в тумане — жми, а не жди, пока поймают"
          : `Поставь ${item} на удобную кнопку и нажимай, как только тебя начинают фокусить — не надо ждать последних 100 ХП`,
        `Цель на следующую катку: в каждой драке нажать ${item} раньше, чем умрёшь`);
    }
    this.silentDeaths = silent.length;
    if (silent.length >= 2) {
      const n = silent.length;
      const times = silent.slice(0, 3).map(mmss).join(", ");
      this.micro(FIGHTS, n >= 3 ? BAD : WARN, "micro_silent_death", { n, times, times_word: timesWord(n) });
      for (const t of silent) if (!this.deathNotes.has(t)) this.deathNotes.set(t, "ни одной кнопки не прожато");
      this.issue("silent_deaths", n * 300, "Умирал, не нажав ни одной кнопки",
        `${n} ${timesWord(n)} в драке тебя убили раньше, чем ты прожал хоть один скилл или предмет (${times})`,
        "Тебя ловят первым, ещё до начала файта: держись за крипами и героями с большим запасом ХП, а скиллы прожимай с дистанции, а не после захода врага",
        "Цель на следующую катку: в каждом файте успеть прожать главный скилл");
    }
  }

  // Первым умирает в драках — значит, стоит не там
  checkFirstToDie() {
    const first = [];
    let teamFights = 0;
    for (const tf of this.match.teamfights || []) {
      let best = null;
      for (const a of this.allies) {
        for (const d of a.deaths_log || []) {
          if (d.time >= tf.start - 2 && d.time <= tf.end + 2 && (!best || d.time < best.t)) best = { t: d.time, who: a };
        }
      }
      if (!best) continue;
      teamFights++;
      if (best.who === this.p) first.push(best.t);
    }
    this.firstDeaths = first.length;
    if (first.length < 3 || first.length / teamFights < 0.45) return;
    const n = first.length;
    const times = first.slice(0, 4).map(mmss).join(", ");
    this.micro(SURVIVAL, WARN, "micro_first_death", { n, times_word: timesWord(n), total: teamFights, times }, `micro_first_death_tip_${this.role()}`);
    for (const t of first) if (!this.deathNotes.has(t)) this.deathNotes.set(t, "умер первым в драке");
    this.issue("first_death", n * 250, "Первым умираешь в драках",
      `В ${n} из ${teamFights} ${plural(teamFights, "драки", "драк", "драк")}, где твоя команда теряла героев, первым умирал ты (${times})`,
      this.core
        ? "Заходи в драку вторым: дождись, пока враги потратят контроль на тех, кто впереди, и только потом залетай"
        : "Стой за корами, а не перед ними: саппорт, который умер первым, не успел дать ни стана, ни сейва",
      "Цель на следующую катку: ни разу не умереть первым в драке");
  }

  // Выкуп, после которого умер почти сразу
  checkBuybacks() {
    const deaths = this.p.deaths_log || [];
    const wasted = [];
    for (const b of this.p.buyback_log || []) {
      // Выкуп в последние минуты — защита трона или добивание, это не ошибка
      if (b.time > this.duration - 120) continue;
      const d = deaths.find((x) => x.time > b.time && x.time <= b.time + BUYBACK_WASTE_WINDOW);
      if (d) wasted.push([b.time, d.time]);
    }
    this.wastedBuybacks = wasted.length;
    if (!wasted.length) return;
    const [bt, dt] = wasted[0];
    const cost = Math.round(200 + (atMinute(this.p.networth_t, Math.floor(bt / 60)) || 0) / 13);
    this.micro(SURVIVAL, WARN, "micro_buyback_wasted", { time: mmss(bt), sec: dt - bt, gold: num(cost) });
    for (const [b, d] of wasted) this.deathNotes.set(d, `через ${d - b} с после выкупа`);
    this.issue("buyback_wasted", cost * wasted.length, "Выкуп в пустоту",
      `На ${mmss(bt)} выкупился за ~${num(cost)} золота и умер через ${dt - bt} ${plural(dt - bt, "секунду", "секунды", "секунд")}`,
      "Перед выкупом посмотри на карту: сколько врагов живо и успеешь ли ты вообще что-то сделать. Если файт уже проигран — копи на следующий");
  }

  // ---------- методика Хана: бенчмарки и привычки ----------

  // 200 крипов к 20:00 — нижняя планка кора по Хану; у керри цель 300
  checkLastHits20() {
    const lh = this.p.lh_t || [];
    if (!this.core || !this.roleSure || this.dominant || this.minutes < 21 || lh.length < 21) return;
    if (this.match.game_mode === TURBO_MODE || this.issues.some((i) => i.group === "farm_pace")) return;
    const target = LH20_FLOOR[this.pos], got = lh[20];
    if (got >= target) return;
    const goal = this.pos === 1 ? ` Ориентир сильных керри — ${LH20_GOAL}+.` : "";
    this.micro(FARM, got < target * 0.75 ? BAD : WARN, "micro_lh20", { lh: got, target, goal });
    this.issue("lh20", (target - got) * 40, "Мало крипов к 20-й минуте",
      `К 20:00 у тебя ${got} ${plural(got, "крип", "крипа", "крипов")}, а нижняя планка для ${ROLE_GEN_PLURAL[this.pos]} — ${target}.${goal}`,
      "Нет файта — фарми. Волна, ближайший кемп, снова волна; стакай большой кемп, пока идёшь по кругу",
      `Цель на следующую катку: ${target}+ крипов к 20:00`);
  }

  // Умирал при крупном перевесе по золоту: игра была в кармане
  checkDeathsWhileAhead() {
    if (this.dominant || !this.teamAdv.length) return;
    const lead = (this.p.deaths_log || []).filter((d) => d.time >= LEAD_DEATH_MIN_TIME &&
      atMinute(this.teamAdv, Math.floor(d.time / 60)) >= LEAD_DEATH_GOLD);
    this.leadDeaths = lead.length;
    if (lead.length < 2) return;
    const n = lead.length;
    const times = lead.slice(0, 4).map((d) => mmss(d.time)).join(", ");
    this.micro(SURVIVAL, n >= 3 ? BAD : WARN, "micro_death_lead", { n, times, times_word: timesWord(n), gold: num(LEAD_DEATH_GOLD) });
    for (const d of lead) if (!this.deathNotes.has(d.time)) this.deathNotes.set(d.time, "умер, когда команда вела по золоту");
    this.issue("lead_deaths", n * 600, "Умирал при перевесе",
      `${n} ${deathsWord(n)} в моменты, когда команда вела по золоту на ${num(LEAD_DEATH_GOLD)}+ (${times})`,
      "С перевесом тебя должны ловить, а не ты бегать: стой с командой, бери объекты и не лезь в туман один",
      "Цель на следующую катку: ни одной смерти, когда команда ведёт по золоту на 8 000+");
  }

  // Купил предмет с активкой и ни разу не нажал за всю игру
  checkIdleActives() {
    if (this.dominant || this.duration < 1200) return;
    const log = this.p.purchase_log || [], uses = this.p.item_uses || {};
    if (!("item_uses" in this.p)) return;
    const idle = [];
    for (const key of ACTIVE_ITEMS) {
      if (this.unusedKeys && this.unusedKeys.has(key)) continue;
      const buy = log.find((x) => x.key === key);
      if (!buy || buy.time > this.duration - 420) continue;
      const group = [key, ...(ITEM_UPGRADES[key] || [])];
      if (group.some((k) => (uses[k] || 0) > 0)) continue;
      idle.push({ key, time: buy.time });
    }
    if (!idle.length) return;
    idle.sort((a, b) => this.od.itemCost(b.key) - this.od.itemCost(a.key));
    const top = idle.slice(0, 2);
    const items = top.map((x) => this.od.itemName(x.key)).join(", ");
    const n = top.length;
    this.micro(ITEMS, WARN, "micro_idle_active", { items, n, verb: n > 1 ? "ни разу не нажаты" : "ни разу не нажат" });
    this.issue("idle_active", sum(top.map((x) => this.od.itemCost(x.key))) * 0.4, "Предметы без нажатия",
      `${items} куплен${n > 1 ? "ы" : ""} на ${top.map((x) => mmss(x.time)).join(", ")} и за всю игру не нажат${n > 1 ? "ы" : ""} ни разу`,
      "Купил активку — нажимай: в каждой драке, на каждом ганге. Предмет, который лежит в слоте, не работает");
  }

  // Керри и мидер сами покупают обсы: они дешёвые, а вижн нужен им не меньше саппортов
  checkCoreWards() {
    const p = this.p;
    if (this.pos > 2 || !this.roleSure || this.dominant || this.minutes < 25 || !("obs_placed" in p)) return;
    if ((p.obs_placed || 0) > 0 || (p.sen_placed || 0) > 0) return;
    this.micro(VISION, WARN, "micro_core_wards", { mins: this.minutes, role: this.pos === 1 ? "керри" : "мидер" });
  }

  // Мидер ставит обс на старте или к руне 6-й минуты, а не живёт вслепую
  checkMidStartWard() {
    const log = this.p.obs_log;
    if (this.pos !== 2 || !this.roleSure || this.dominant || this.minutes < 12 || !Array.isArray(log)) return;
    if (log.some((w) => w.time <= 420)) return;
    this.micro(VISION, WARN, "micro_mid_ward");
  }

  // Выиграли драку с перевесом, а Рошана не взяли и вышки не сломали
  checkRoshanFollowup() {
    const objs = this.match.objectives || [];
    const roshans = objs.filter((o) => o.type === "CHAT_MESSAGE_ROSHAN_KILL").sort((a, b) => a.time - b.time);
    const kills = roshans.map((o) => o.time);
    const myTeam = this.p.isRadiant ? 2 : 3;
    // Респаун считаем от любого убийства, а «взяли» — только своей командой
    const ours = roshans.filter((o) => o.team === myTeam).map((o) => o.time);
    const enemyBuilding = this.p.isRadiant ? "badguys" : "goodguys";
    const buildingFalls = objs.filter((o) => o.type === "building_kill" && typeof o.key === "string" && o.key.includes(enemyBuilding)).map((o) => o.time);
    const allyIdx = this.allies.map((a) => this.match.players.indexOf(a));
    const enemyIdx = this.enemies.map((a) => this.match.players.indexOf(a));
    const missed = [];
    for (const tf of this.match.teamfights || []) {
      const ps = tf.players || [];
      if (!ps.length || tf.end < ROSHAN_FIGHT_MIN_TIME || tf.end > this.duration - 240) continue;
      const mine = sum(allyIdx.filter((i) => i < ps.length).map((i) => ps[i].deaths));
      const theirs = sum(enemyIdx.filter((i) => i < ps.length).map((i) => ps[i].deaths));
      if (theirs < 3 || theirs - mine < 2) continue;
      const lastRosh = kills.filter((t) => t <= tf.end).pop();
      if (lastRosh !== undefined && tf.end - lastRosh < ROSHAN_RESPAWN_MIN) continue;
      const until = tf.end + ROSHAN_FOLLOW_WINDOW;
      if (ours.some((t) => t >= tf.start && t <= until)) continue;
      if (buildingFalls.some((t) => t >= tf.end && t <= until)) continue;
      missed.push(tf.start);
    }
    const n = missed.length;
    if (!n || (n < 2 && this.won)) return;
    this.micro(FIGHTS, WARN, "micro_roshan_skipped", { n, times: missed.slice(0, 3).map(mmss).join(", "), times_word: timesWord(n) });
    this.issue("roshan_skipped", n * 500, "Выиграли файт и не взяли Рошана",
      `${n} ${timesWord(n)} команда выиграла драку с перевесом (${missed.slice(0, 3).map(mmss).join(", ")}), но ни Рошана, ни вышки за следующие 3 минуты не взяла`,
      "Выиграли драку — сразу Рошан, а если он ещё на кулдауне — ломайте вышки. Аегис и перевес не ждут, пока враги соберутся");
  }

  // Торментор: враги забирают, а вы ни разу
  checkTormentor() {
    if (this.minutes < 30 || this.dominant) return;
    const myTeam = this.p.isRadiant ? 2 : 3;
    const kills = (this.match.objectives || []).filter((o) => o.type === "CHAT_MESSAGE_MINIBOSS_KILL");
    const ours = kills.filter((o) => o.team === myTeam).length;
    const theirs = kills.length - ours;
    if (theirs >= 2 && ours === 0) this.micro(FIGHTS, WARN, "micro_tormentor", { theirs, times_word: timesWord(theirs) });
  }

  // Опыт против оппонента по линии: перекачать его — главная цель лайна
  checkLaneXp() {
    const mine = this.p.xp_t, theirs = this.opponent && this.opponent.xp_t;
    if (!this.core || !this.roleSure || this.dominant || !this.opponent || this.minutes < 16 || !mine || !theirs) return;
    if (this.issues.some((i) => i.group === "lane_lost")) return;
    const gap = atMinute(theirs, 15) - atMinute(mine, 15);
    if (gap < LANE_XP_GAP) return;
    this.micro(LANE, gap >= LANE_XP_GAP * 1.6 ? BAD : WARN, "micro_lane_xp", { opp: this.oppName, xp: num(gap) });
  }

  // К 20:00 золота у кора на 5000+ меньше, чем у его визави: итог всей лайн-стадии и фарма до 20-й
  checkNetworthGap() {
    const mine = this.p.networth_t, theirs = this.opponent && this.opponent.networth_t;
    if (!this.core || !this.roleSure || this.dominant || !this.opponent || this.minutes < 22 || !mine || !theirs) return;
    if (this.issues.some((i) => ["lh20", "lane_lost", "farm_pace"].includes(i.group))) return;
    const gap = atMinute(theirs, 20) - atMinute(mine, 20);
    if (gap < NETWORTH_GAP_20) return;
    this.micro(FARM, gap >= NETWORTH_GAP_20 * 1.6 ? BAD : WARN, "micro_networth_gap", { opp: this.oppName, gold: num(gap) });
  }

  // Много киллов, а по золоту в своей команде кор не в топ-2: убийства не заменяют фарм
  checkKillsNoFarm() {
    const nw = this.p.networth_t;
    if (this.pos > 2 || !this.roleSure || this.minutes < 25 || !nw || this.p.kills < KILLS_NO_FARM) return;
    const mine = atMinute(nw, 20);
    const rank = this.allies.filter((a) => a !== this.p && atMinute(a.networth_t, 20) > mine).length + 1;
    if (rank < 3) return;
    this.micro(FARM, WARN, "micro_kills_no_farm", { kills: this.p.kills, rank });
  }

  // Саппорт к 20:00 отстаёт от вражеского на 3+ уровня: лайн проигран или опыт отдан
  checkSupportLevel() {
    if (this.core || !this.roleSure || this.minutes < 22) return;
    const opp = this.enemies.find((e) => this.roleOf.get(e) === this.pos);
    if (!opp || !opp.xp_t || !this.p.xp_t) return;
    const level = (xp) => LEVEL_XP.filter((x) => xp >= x).length;
    const mine = level(atMinute(this.p.xp_t, 20)), theirs = level(atMinute(opp.xp_t, 20));
    if (theirs - mine < SUPPORT_LEVEL_GAP) return;
    this.micro(LANE, WARN, "micro_support_level", { opp: this.od.heroName(opp.hero_id), mine, theirs });
  }

  // Купил БКБ и в первые минуты умер один: «реализовывать» пошёл без команды
  checkBkbSolo() {
    if (!this.core || this.dominant) return;
    const buy = (this.p.purchase_log || []).find((x) => x.key === "black_king_bar");
    if (!buy) return;
    const d = (this.p.deaths_log || []).find((x) => x.time > buy.time && x.time <= buy.time + BKB_SOLO_WINDOW && this.isSoloDeath(x.time));
    if (!d) return;
    this.micro(SURVIVAL, WARN, "micro_bkb_solo", { buy: mmss(buy.time), death: mmss(d.time) });
    if (!this.deathNotes.has(d.time)) this.deathNotes.set(d.time, "через пару минут после БКБ, в одиночку");
  }

  // ---------- сравнение с другими игроками на герое ----------

  benchValue(key, percentile) {
    for (const row of this.heroBench[key] || []) if (Math.abs(row.percentile - percentile) < 1e-9) return row.value;
    return null;
  }

  compare() {
    const result = [];
    const playerBench = this.p.benchmarks || {};
    for (const [key, name, scale, category] of COMPARE_METRICS) {
      if (!(key in playerBench) || !(this.heroBench[key] || []).length) continue;
      if (!this.core && SUPPORT_SKIP_METRICS.has(key)) continue;
      const lowerBetter = key === "deaths_per_min";
      const median = this.benchValue(key, 0.5);
      const top = this.benchValue(key, lowerBetter ? 0.1 : 0.99);
      if (median === null || top === null) continue;
      const fmt = scale !== 1 ? tenths : (v) => num(pyRound(v));
      result.push({
        key, name, category,
        you: fmt(playerBench[key].raw * scale),
        median: fmt(median * scale),
        top: fmt(top * scale),
        pct: this.bench[key] ?? 50,
        lower_better: lowerBetter,
      });
    }
    return result;
  }

  checkCompareGap(compare) {
    const candidates = compare.filter((c) => !this.flagged.has(c.key) && c.key !== "deaths_per_min");
    if (!candidates.length) return;
    let worst = candidates[0];
    for (const c of candidates) if (c.pct < worst.pct) worst = c;
    if (worst.pct >= 30) return;
    this.add(worst.category, WARN, "compare_gap", `compare_gap_tip_${worst.key}`,
      { name: worst.name, you: worst.you, median: worst.median, top: worst.top, hero: this.hero });
  }

  // ---------- фазы игры ----------

  phases() {
    const p = this.p;
    const lh = p.lh_t || [];
    if (!lh.length) return [];
    const kills = (p.kills_log || []).filter((k) => k.key.startsWith("npc_dota_hero_")).map((k) => k.time);
    const deaths = (p.deaths_log || []).map((d) => d.time);
    const result = [];
    for (const [key, title, start, end] of PHASES) {
      if (this.minutes <= start + 2) break;
      const stop = Math.min(end !== null ? end : this.minutes, lh.length - 1);
      const t0 = start * 60, t1 = end !== null ? stop * 60 : this.duration + 1;
      const nKills = kills.filter((t) => t0 <= t && t < t1).length;
      const nDeaths = deaths.filter((t) => t0 <= t && t < t1).length;
      const lhGain = lh[stop] - lh[start];
      const teamDelta = this.teamAdv.length ? atMinute(this.teamAdv, stop) - atMinute(this.teamAdv, start) : 0;
      let nwDelta = null, nwText, swing;
      if (this.opponent) {
        const onw = this.opponent.networth_t, pnw = p.networth_t;
        nwDelta = (atMinute(pnw, stop) - atMinute(onw, stop)) - (atMinute(pnw, start) - atMinute(onw, start));
        nwText = `По нетворсу против ${this.oppName}: ${signed(nwDelta)}.`;
        swing = nwDelta / 1000;
      } else {
        nwText = `Команда за этот отрезок: ${signed(teamDelta)} золота.`;
        swing = teamDelta / 2000;
      }
      const killsText = `${nKills} ${plural(nKills, "убийство", "убийства", "убийств")}`;
      const deathsText = nDeaths === 0 ? "без смертей" : `${nDeaths} ${deathsWord(nDeaths)}`;
      let verdict, text;
      if (this.core) {
        const score = nKills - nDeaths * 1.5 + swing;
        verdict = score >= 2 ? "good" : score <= -2 ? "bad" : "even";
        text = this.say(`phase_${key}_${verdict}`, { lh: lhGain, kills_text: killsText, deaths_text: deathsText, nw_text: nwText });
      } else {
        // Саппорта оцениваем по дракам, смертям и вардам, а не по крипам
        const fights = this.fightsInWindow(t0, t1);
        const wards = (p.obs_log || []).filter((w) => t0 <= w.time && w.time < t1).length;
        const score = fights.took * 0.8 + nKills * 0.5 - nDeaths * 1.5 + teamDelta / 3000 - Math.max(0, fights.total - fights.took) * 0.5;
        verdict = score >= 2 ? "good" : score <= -2 ? "bad" : "even";
        const fightsText = fights.total
          ? `в ${fights.took} из ${fights.total} ${plural(fights.total, "файта", "файтов", "файтов")}`
          : "файтов почти не было";
        const wardsText = wards ? `${wards} ${plural(wards, "обс", "обса", "обсов")}` : "ноль обсов";
        text = this.say(`phase_sup_${verdict}`, {
          fights_text: fightsText, deaths_text: deathsText, wards_text: wardsText,
          nw_text: `Команда за этот отрезок: ${signed(teamDelta)} золота.`,
        }, key);
      }
      result.push({
        key,
        title: `${title} · ${start}–${stop} мин`,
        verdict,
        text,
        kills: nKills,
        deaths: nDeaths,
        last_hits: lhGain,
        nw_delta: nwDelta,
        team_delta: teamDelta,
      });
    }
    return result;
  }

  // Сколько драк было в окне и в скольких игрок участвовал
  fightsInWindow(t0, t1) {
    const idx = this.match.players.indexOf(this.p);
    let total = 0, took = 0;
    for (const tf of this.match.teamfights || []) {
      if (tf.start < t0 || tf.start >= t1) continue;
      total++;
      const me = (tf.players || [])[idx];
      if (me && (me.damage > 0 || me.healing > 0 || me.deaths > 0 || Object.keys(me.ability_uses || {}).length > 0)) took++;
    }
    return { total, took };
  }

  // ---------- ключевые моменты ----------

  moments() {
    const p = this.p;
    const out = [];
    const add = (t, severity, text) => out.push({ time: t, clock: mmss(t), severity, text });

    const kills = (p.kills_log || []).filter((k) => k.key.startsWith("npc_dota_hero_"));
    if (kills.length) {
      add(kills[0].time, GOOD, this.say("moment_first_kill", { victim: this.od.heroNameByKey(kills[0].key) }, String(kills[0].time)));
    }
    for (const d of p.deaths_log || []) {
      const killer = this.od.heroNameByKey(d.key);
      let key;
      if (killer === "башня") key = "moment_death_tower";
      else if (!d.key.startsWith("npc_dota_hero_")) key = "moment_death_creeps";
      // До 10:00 вне драки — это линия, а не «поймали одного»
      else if (!this.inFight(d.time) && d.time < LANING_END) key = "moment_death_lane";
      else key = this.isSoloDeath(d.time) ? "moment_death_solo" : "moment_death_fight";
      const traded = (p.kills_log || []).some((k) => k.key.startsWith("npc_dota_hero_") && Math.abs(k.time - d.time) <= 20);
      const note = this.deathNotes && this.deathNotes.get(d.time);
      add(d.time, BAD, this.say(key, { killer }, String(d.time)) + (traded ? " (размен)" : "") + (note ? ` — ${note}` : ""));
    }
    for (const x of p.purchase_log || []) {
      if (this.isFinalItem(x.key) && this.od.itemCost(x.key) >= 2000) {
        add(x.time, "item", this.say("moment_item", { item: this.od.itemName(x.key) }, String(x.time)));
      }
    }
    for (const [t, n] of this.missedFights()) add(t, WARN, this.say("moment_missed_fight", { n }, String(t)));
    for (const b of p.buyback_log || []) add(b.time, "info", this.say("moment_buyback", {}, String(b.time)));

    const adv = this.teamAdv;
    if (adv.length > SWING_WINDOW) {
      let worst = null, best = null;
      for (let i = 0; i < adv.length - SWING_WINDOW; i++) {
        const delta = adv[i + SWING_WINDOW] - adv[i];
        if (worst === null || delta < worst[0]) worst = [delta, i];
        if (best === null || delta > best[0]) best = [delta, i];
      }
      for (const [[delta, i], key, sev] of [[worst, "moment_swing_down", BAD], [best, "moment_swing_up", GOOD]]) {
        if (Math.abs(delta) >= SWING_MIN_GOLD && (delta < 0) === (key === "moment_swing_down")) {
          add(i * 60, sev, this.say(key, { gold: num(Math.abs(delta)), from: `${i}:00`, to: `${i + SWING_WINDOW}:00` }));
        }
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }

  // ---------- эпизоды для тренера ----------

  // Самые дорогие моменты игры (смерти и пропущенные драки) с проверенными фактами вокруг них:
  // где умер, была ли видимость, нажаты ли кнопки, какой был перевес и что команда потеряла следом.
  // Тренер по ним разбирает игру, а не пересказывает итоговые цифры
  episodes(limit = 4) {
    const p = this.p;
    const idx = this.match.players.indexOf(p);
    const objs = this.match.objectives || [];
    const ownSide = p.isRadiant ? "goodguys" : "badguys";
    const enemyTeam = p.isRadiant ? 3 : 2;
    // lane у OpenDota географический: 1 низ, 2 мид, 3 верх (4 и 5 — лес)
    const myLane = { 1: "bot", 2: "mid", 3: "top" }[p.lane];
    // На стадии линий смерть в миду не связана с вышкой на боте: берём только свою линию
    const lost = (t0, t1, laneOnly = false) => {
      const out = [];
      const fallen = objs.filter((o) => o.type === "building_kill" && typeof o.key === "string" && o.key.includes(ownSide) && o.time >= t0 && o.time <= t1
        && (!laneOnly || (myLane && o.key.endsWith(`_${myLane}`))));
      const counts = new Map();
      for (const o of fallen) counts.set(buildingName(o.key), (counts.get(buildingName(o.key)) || 0) + 1);
      if (counts.size) out.push(`за 2 минуты враги сломали: ${[...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ")}`);
      if (objs.some((o) => o.type === "CHAT_MESSAGE_ROSHAN_KILL" && o.team === enemyTeam && o.time >= t0 && o.time <= t1)) out.push("за 2 минуты враги забрали Рошана");
      return out;
    };
    const swing = (t) => {
      if (!this.teamAdv.length) return 0;
      const m = Math.floor(t / 60);
      return atMinute(this.teamAdv, Math.min(m + 2, this.teamAdv.length - 1)) - atMinute(this.teamAdv, m);
    };
    const lead = (t) => {
      if (!this.teamAdv.length) return null;
      const g = atMinute(this.teamAdv, Math.floor(t / 60));
      if (Math.abs(g) < 2000) return "золото примерно поровну";
      return g > 0 ? `команда вела на ${num(g)} золота` : `команда отставала на ${num(-g)} золота`;
    };
    // Обсы своей команды, живые в момент t: поставлен не раньше 6 минут назад и ещё не снят
    const removed = new Map();
    for (const a of this.allies) for (const w of a.obs_left_log || []) if ("ehandle" in w) removed.set(w.ehandle, w.time);
    const wardsAt = (t) => sum(this.allies.map((a) => (a.obs_log || []).filter((w) =>
      w.time <= t && t - w.time < OBSERVER_LIFETIME && !(removed.has(w.ehandle) && removed.get(w.ehandle) <= t)).length));
    const fightAt = (t) => (this.match.teamfights || []).find((tf) => tf.start - 2 <= t && t <= tf.end + 2);
    const allyDeathsNear = (t) => sum(this.allies.filter((a) => a !== p).map((a) =>
      (a.deaths_log || []).filter((d) => d.time > t && d.time <= t + 30).length));

    const out = [];
    for (const d of p.deaths_log || []) {
      const facts = [];
      const killer = this.od.heroNameByKey(d.key);
      const tf = fightAt(d.time);
      const laning = !tf && d.time < LANING_END;
      if (killer === "башня") facts.push("тебя убила вышка");
      else if (!d.key.startsWith("npc_dota_hero_")) facts.push("тебя убили крипы или нейтралы");
      else facts.push(`тебя убил ${killer}`);
      // по реплею видно точно, кто был рядом: это важнее догадок по логу смертей
      const seen = this.replay ? this.replay.deaths.find((x) => x.t === d.time) : null;
      const alone = seen ? seen.allies_near === 0 && !laning && d.time >= RUNE_FIGHT_END : !tf && !laning && this.isSoloDeath(d.time);
      if (seen) {
        facts.push(seen.allies_near
          ? `по реплею: рядом своих ${seen.allies_near}, врагов ${seen.enemies_near}`
          : `по реплею: своих в радиусе 1 500 не было${seen.nearest_ally ? ` (до ближайшего ${num(seen.nearest_ally)})` : ""}, врагов рядом ${seen.enemies_near}`);
        facts.push(seen.enemy_half ? "на вражеской половине карты" : "на своей половине карты");
      }
      if (tf) facts.push("в командной драке");
      else if (d.time < RUNE_FIGHT_END) facts.push("драка за руну на старте, до выхода на линии");
      else if (laning) facts.push(myLane ? `стадия линий, твоя линия: ${{ bot: "низ", mid: "мид", top: "верх" }[myLane]}` : "стадия линий");
      else facts.push(alone ? "один, рядом своих не было" : "в мелкой стычке");
      // На линии важно, кто убил: оппонент по линии (проигран размен) или пришёл ганг (нужна видимость)
      const killerP = laning && myLane && d.time >= RUNE_FIGHT_END ? this.enemies.find((e) => this.od.heroKey(e.hero_id) === d.key) : null;
      if (killerP) facts.push(killerP.lane === p.lane ? "убийца стоял на твоей линии" : "ганг: убийца пришёл не с твоей линии");
      const traded = (p.kills_log || []).filter((k) => k.key.startsWith("npc_dota_hero_") && Math.abs(k.time - d.time) <= 20);
      if (traded.length) facts.push(`размен: ты тоже убил ${[...new Set(traded.map((k) => this.od.heroNameByKey(k.key)))].join(", ")}`);
      if (tf && !seen) {
        const pos = Object.entries((tf.players || [])[idx]?.deaths_pos || {}).flatMap(([x, ys]) => Object.keys(ys).map((y) => [parseFloat(x), parseFloat(y)]));
        if (pos.length) facts.push(enemyHalf(pos[0][0], pos[0][1], p.isRadiant) ? "на вражеской половине карты" : "на своей половине карты");
      }
      const wards = wardsAt(d.time);
      facts.push(wards ? `обсов вашей команды на карте: ${wards}` : "ни одного обса вашей команды на карте");
      const note = this.deathNotes && this.deathNotes.get(d.time);
      if (note) facts.push(note);
      const ld = lead(d.time);
      if (ld) facts.push(ld);
      if (d.time_dead) facts.push(`лежал мёртвым ${d.time_dead} с`);
      // на линиях союзник, умерший через 20 с на другой линии, к этой смерти отношения не имеет
      const after = laning ? 0 : allyDeathsNear(d.time);
      if (after) facts.push(`следом за тобой умерло союзников: ${after}`);
      const cost = lost(d.time, d.time + 120, laning);
      facts.push(...cost);
      const sw = swing(d.time);
      if (sw <= -1500) facts.push(`за 2 минуты команда потеряла ${num(-sw)} золота перевеса`);
      const weight = 400 + (alone ? 300 : 0) - (traded.length ? 250 : 0) + (note ? 400 : 0) + cost.length * 900 + after * 300 + Math.max(0, -sw) / 2 + (d.time_dead || 0) * 5;
      out.push({ time: d.time, clock: mmss(d.time), kind: "death", facts, weight });
    }
    const enemyIdx = this.enemies.map((a) => this.match.players.indexOf(a));
    // драка на чужой линии до 10-й минуты не «пропущена»: игрок стоял на своей
    for (const [, mine, tf] of this.missedFights().filter(([t]) => t >= LANING_END)) {
      const ps = tf.players || [];
      const theirs = sum(enemyIdx.filter((i) => i < ps.length).map((i) => ps[i].deaths));
      const facts = [`драка без тебя: союзников погибло ${mine}, врагов ${theirs}`];
      const lh = p.lh_t || [];
      const m0 = Math.floor(tf.start / 60), m1 = Math.min(Math.ceil(tf.end / 60) + 1, lh.length - 1);
      if (lh.length && m1 > m0) {
        const got = (lh[m1] ?? 0) - (lh[m0] ?? 0);
        facts.push(got > 0 ? `ты в это время добил ${got} ${plural(got, "крип", "крипа", "крипов")}` : "ты в это время не фармил");
      }
      const ld = lead(tf.start);
      if (ld) facts.push(ld);
      const cost = lost(tf.start, tf.end + 120);
      facts.push(...cost);
      const sw = swing(tf.start);
      if (sw <= -1500) facts.push(`за 2 минуты команда потеряла ${num(-sw)} золота перевеса`);
      const weight = 500 + (mine - theirs) * 300 + cost.length * 900 + Math.max(0, -sw) / 2;
      out.push({ time: tf.start, clock: mmss(tf.start), kind: "missed_fight", facts, weight });
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, limit)
      .sort((a, b) => a.time - b.time).map(({ weight, ...e }) => e);
  }

  // ---------- карта и линия ----------

  // Точки для миникарты: где умирал в драках (OpenDota даёт позицию только для смертей в драках)
  // и где стояли обсы команды: свои отдельно, снесённые врагом отдельно. Координаты — клетки карты 64..192
  mapData() {
    const idx = this.match.players.indexOf(this.p);
    const deaths = [];
    for (const tf of this.match.teamfights || []) {
      for (const [x, ys] of Object.entries(((tf.players || [])[idx] || {}).deaths_pos || {})) {
        for (const [y, n] of Object.entries(ys)) {
          for (let i = 0; i < n; i++) deaths.push({ x: parseFloat(x), y: parseFloat(y), t: this.fightDeathTime(tf), enemy_half: enemyHalf(parseFloat(x), parseFloat(y), this.p.isRadiant) });
        }
      }
    }
    const wards = [];
    for (const a of this.allies) {
      const left = new Map((a.obs_left_log || []).filter((w) => "ehandle" in w).map((w) => [w.ehandle, w.time]));
      for (const w of a.obs_log || []) {
        if (typeof w.x !== "number" || typeof w.y !== "number") continue;
        const life = left.has(w.ehandle) ? left.get(w.ehandle) - w.time : null;
        wards.push({ x: w.x, y: w.y, t: w.time, mine: a === this.p, dewarded: life != null && life < OBSERVER_LIFETIME - 10, enemy_half: enemyHalf(w.x, w.y, this.p.isRadiant) });
      }
    }
    return { radiant: this.p.isRadiant, deaths, wards };
  }

  // Дуэль с оппонентом по линии минута в минуту до 10:00: крипы, нетворс и опыт
  laneDuel() {
    const o = this.opponent, p = this.p;
    if (!o || !p.lh_t || !o.lh_t || this.minutes < 6) return null;
    const at = (s, m) => (s && s.length ? atMinute(s, m) : null);
    const rows = [];
    for (let m = 2; m <= Math.min(10, this.minutes); m += 2) {
      rows.push({
        m,
        lh: [at(p.lh_t, m), at(o.lh_t, m)],
        dn: [at(p.dn_t, m), at(o.dn_t, m)],
        nw: [at(p.networth_t || p.gold_t, m), at(o.networth_t || o.gold_t, m)],
        xp: [at(p.xp_t, m), at(o.xp_t, m)],
      });
    }
    return { opponent: this.oppName, opponent_id: o.hero_id, rows };
  }

  // ---------- оценки и итоги ----------

  computeScores() {
    const pct = (key, def = 50) => 2 + ((this.bench[key] ?? def) / 100) * 7;
    const base = {
      [LANE]: this.core ? 2 + (Math.min(this.p.lane_efficiency_pct || 50, 100) / 100) * 7 : 6,
      [FARM]: this.core ? (pct("gold_per_min") + pct("last_hits_per_min")) / 2 : pct("gold_per_min") * 0.5 + 3.5,
      [FIGHTS]: (2 + Math.min(this.p.teamfight_participation || 0.5, 1) * 7 + pct("hero_damage_per_min")) / 2,
      [SURVIVAL]: pct("deaths_per_min"),
      [ITEMS]: 7,
      [VISION]: this.pos >= 4 ? 6 : 7,
    };
    return Object.fromEntries(CATEGORIES.map((c) => [c, Math.max(1, Math.min(10, pyRound(base[c] + 1 - this.penalty[c])))]));
  }

  // ---------- драфт ----------

  // Как твой герой играет против этих пятерых врагов по статистике OpenDota (все игры на герое, не твои)
  draftReview() {
    const byHero = new Map(this.matchups.map((m) => [m.hero_id, m]));
    const rows = [];
    for (const e of this.enemies) {
      const m = byHero.get(e.hero_id);
      if (!m || m.games_played < DRAFT_MIN_GAMES) continue;
      rows.push({ hero_id: e.hero_id, name: this.od.heroName(e.hero_id), games: m.games_played, wr: m.wins / m.games_played });
    }
    if (rows.length < 3) return null;
    rows.sort((a, b) => a.wr - b.wr);
    const hero = this.od.heroName(this.p.hero_id);
    const notes = [];
    for (const r of rows.filter((x) => x.wr <= DRAFT_BAD_WR).slice(0, 2)) {
      notes.push({ severity: WARN, text: this.say("draft_bad", { hero, enemy: r.name, wr: pyRound(r.wr * 100), games: r.games }, r.name) });
    }
    for (const r of rows.filter((x) => x.wr >= DRAFT_GOOD_WR).slice(-2)) {
      notes.push({ severity: GOOD, text: this.say("draft_good", { hero, enemy: r.name, wr: pyRound(r.wr * 100), games: r.games }, r.name) });
    }
    const total = sum(rows.map((r) => r.games));
    const avg = sum(rows.map((r) => r.wr * r.games)) / total;
    if (rows.length >= 4 && avg <= 0.47) notes.push({ severity: WARN, text: this.say("draft_hard", { hero, wr: pyRound(avg * 100) }) });
    if (rows.length >= 4 && avg >= 0.53) notes.push({ severity: GOOD, text: this.say("draft_easy", { hero, wr: pyRound(avg * 100) }) });
    return { hero_id: this.p.hero_id, hero, avg_wr: avg, rows: rows.map((r) => ({ ...r, wr: r.wr })), notes };
  }

  verdict(scores, overall) {
    const values = Object.values(scores);
    const mean = overall ?? sum(values) / values.length;
    const key = mean >= 8 ? "verdict_top" : mean >= 6.5 ? "verdict_good" : mean >= 5 ? "verdict_mid" : "verdict_bad";
    return this.say(key);
  }

  collectFacts() {
    const p = this.p;
    return {
      match_id: this.match.match_id,
      start_time: this.match.start_time ?? null,
      slot: p.player_slot,
      game_mode: this.match.game_mode ?? null,
      hero: this.hero,
      hero_id: p.hero_id,
      position: this.pos,
      won: this.won,
      duration: mmss(this.duration),
      kda: `${p.kills}/${p.deaths}/${p.assists}`,
      gpm: p.gold_per_min,
      xpm: p.xp_per_min,
      last_hits: p.last_hits,
      denies: p.denies,
      net_worth: p.net_worth,
      hero_damage: p.hero_damage,
      tower_damage: p.tower_damage,
      level: p.level,
      lane_opponent: this.oppName,
      lane_opponent_id: this.opponent ? this.opponent.hero_id : null,
      allies: this.allies.filter((a) => a !== p).map((a) => a.hero_id),
      enemies: this.enemies.map((e) => e.hero_id),
      ally_names: this.allies.filter((a) => a !== p).map((a) => this.od.heroName(a.hero_id)),
      enemy_names: this.enemies.map((e) => this.od.heroName(e.hero_id)),
      benchmarks_percentile: this.bench,
    };
  }

  collectTimeline() {
    return {
      player: this.p.networth_t,
      opponent: this.opponent ? this.opponent.networth_t : null,
      opponent_name: this.oppName,
      hero: this.hero,
      deaths: (this.p.deaths_log || []).map((d) => d.time),
      last_hits: this.p.lh_t,
      team_gold_adv: this.teamAdv,
    };
  }
}

// ---------- реплей: позиции героев ----------

const CELL = 128;            // юнитов в клетке карты OpenDota
const NEAR_RADIUS = 1500;    // юнитов: «рядом» — примерно дальность каста и подхода в драке
const PATH_SECONDS = 20;     // путь перед смертью

// Позиции из файла реплея (tools/replay-summary.mjs): кто где стоял, кто был рядом в каждой смерти,
// сколько времени на своей половине, на реке и на чужой. null — файла нет или игрока в нём нет
export function replayInsights(match, player, replay) {
  if (!replay || replay.v !== 1 || !replay.pos) return null;
  const mine = replay.pos[player.player_slot];
  if (!Array.isArray(mine) || !mine.length) return null;
  const { step, start } = replay;
  const index = (t) => Math.round((t - start) / step);
  const at = (track, t, back = 3) => {
    // ближайшая живая точка не позже t (смерть пишется уже мёртвым)
    for (let k = 0; k <= back; k++) {
      const p = track && track[index(t) - k];
      if (p) return p;
    }
    return null;
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * CELL;
  const radiant = player.isRadiant;
  const allies = match.players.filter((x) => x.isRadiant === radiant && x !== player).map((x) => replay.pos[x.player_slot]);
  const enemies = match.players.filter((x) => x.isRadiant !== radiant).map((x) => replay.pos[x.player_slot]);
  const deaths = (player.deaths_log || []).map((d) => {
    const me = at(mine, d.time);
    if (!me) return null;
    const allyPos = allies.map((tr) => at(tr, d.time, 1)).filter(Boolean);
    const enemyPos = enemies.map((tr) => at(tr, d.time, 1)).filter(Boolean);
    const nearest = allyPos.length ? Math.min(...allyPos.map((p) => dist(me, p))) : null;
    const path = [];
    for (let t = d.time - PATH_SECONDS; t <= d.time; t += step) { const p = mine[index(t)]; if (p) path.push(p); }
    return {
      t: d.time, x: me[0], y: me[1], path,
      allies_near: allyPos.filter((p) => dist(me, p) <= NEAR_RADIUS).length,
      enemies_near: enemyPos.filter((p) => dist(me, p) <= NEAR_RADIUS).length,
      nearest_ally: nearest == null ? null : Math.round(nearest / 100) * 100,
      enemy_half: enemyHalf(me[0], me[1], radiant),
    };
  }).filter(Boolean);
  // где проводил время: своя половина, река, чужая — по фазам игры
  const phases = [["lane", 0, 600], ["mid", 600, 1500], ["late", 1500, Infinity]];
  const zones = {};
  for (const [key, t0, t1] of phases) {
    const z = { own: 0, river: 0, enemy: 0 };
    mine.forEach((p, i) => {
      const t = start + i * step;
      if (!p || t < t0 || t >= t1) return;
      const s = p[0] + p[1];
      if (Math.abs(s - MAP_CENTER_SUM) <= RIVER_MARGIN) z.river++;
      else if (enemyHalf(p[0], p[1], radiant)) z.enemy++;
      else z.own++;
    });
    const total = z.own + z.river + z.enemy;
    if (total) zones[key] = { own: z.own / total, river: z.river / total, enemy: z.enemy / total };
  }
  // тепловая карта: точка раз в 10 секунд, пока жив
  const heat = mine.filter((p, i) => p && i % Math.max(1, Math.round(10 / step)) === 0);
  return { deaths, zones, heat, radiant };
}

// ---------- прогресс: цели, ачивки, ранг ----------

// Проверка цели прошлой катки по показателям новой: done, failed или skip (в этой катке не проверить)
export function checkGoal(check, m) {
  if (!check || !m) return null;
  let value;
  if (check.metric.startsWith("unused:")) {
    const key = check.metric.slice(7);
    if (!(m.bought || []).includes(key)) return { status: "skip" };
    value = (m.unused || []).includes(key) ? 1 : 0;
  } else if (check.metric.startsWith("killer:")) {
    const key = check.metric.slice(7);
    if (!(m.enemy_keys || []).includes(key)) return { status: "skip" };
    value = (m.killers || {})[key] || 0;
  } else {
    value = m[check.metric];
  }
  if (value == null || Number.isNaN(value)) return { status: "skip" };
  const ok = check.op === "<=" ? value <= check.target : value >= check.target;
  return { status: ok ? "done" : "failed", value };
}

// Показатель катки для людей: проценты, время, знак
export function formatMetric(metric, v) {
  if (v == null) return "—";
  if (["dead_share", "kp"].includes(metric)) return `${Math.round(v * 100)}%`;
  if (["first_item", "ward_gap"].includes(metric)) return mmss(v);
  if (metric === "lane_nw10") return signed(v);
  if (["obs10", "farm_pace", "deaths10"].includes(metric)) return tenths(v);
  if (metric.startsWith("unused:")) return v ? "не нажат" : "нажат";
  if (metric.startsWith("killer:")) return `${v} ${plural(v, "смерть", "смерти", "смертей")}`;
  return num(Math.round(v));
}

// Показатель из норм рангов (lh10, gpm, kp…) в том же виде, что в разборе
export function formatRankMetric(key, v) {
  const m = RANK_METRICS[key];
  return m && v != null ? m.fmt(v) : "—";
}

// Ачивки за прогресс, а не за победы. streak — подряд по разобранным каткам (неподходящие по роли пропускаются),
// count — сколько всего. history — разобранные катки от старых к новым: [{m: progressMetrics}]
export const ACHIEVEMENTS = [
  { id: "clean_lane", title: "Чистая линия", desc: "3 катки подряд не больше одной смерти до 10:00", kind: "streak", need: 3, test: (m) => m.lane_deaths <= 1 },
  { id: "no_feed", title: "Без фида", desc: "3 катки подряд не больше 4 смертей", kind: "streak", need: 3, test: (m) => m.deaths <= 4 },
  { id: "teamplayer", title: "В каждой драке", desc: "3 катки подряд KP 60% и выше", kind: "streak", need: 3, test: (m) => m.kp != null && m.kp >= 0.6, applies: (m) => m.kp != null },
  { id: "buttons", title: "Всё прожато", desc: "5 каток подряд не умирать с непрожатыми кнопками", kind: "streak", need: 5, test: (m) => !m.silent_deaths && !(m.unused || []).length },
  { id: "farmer", title: "Фермер", desc: "3 катки на коре с 45+ крипами к 10:00", kind: "count", need: 3, test: (m) => m.lh10 >= 45, applies: (m) => m.pos <= 3 && m.lh10 != null },
  { id: "eyes", title: "Глаза команды", desc: "3 катки на саппорте с 4+ обсами за 10 минут", kind: "count", need: 3, test: (m) => m.obs10 >= 4, applies: (m) => m.pos >= 4 },
  { id: "alive", title: "Живучий", desc: "3 катки, где мёртвым был меньше 10% игры", kind: "count", need: 3, test: (m) => m.dead_share < 0.1 },
  { id: "goals5", title: "Слово держит", desc: "5 выполненных задач тренера", kind: "goals", need: 5 },
];

export function achievements(history, goalsDone = 0) {
  return ACHIEVEMENTS.map((a) => {
    let have = 0, best = 0;
    if (a.kind === "goals") have = best = goalsDone;
    else {
      for (const { m } of history || []) {
        if (!m || (a.applies && !a.applies(m))) continue;
        if (a.kind === "count") { if (a.test(m)) have++; best = have; continue; }
        have = a.test(m) ? have + 1 : 0;
        best = Math.max(best, have);
      }
    }
    // серия: прогресс показываем по текущей серии, а открыта ачивка, если лучшая серия добралась до цели
    return { id: a.id, title: a.title, desc: a.desc, need: a.need, have: Math.min(have, a.need), done: best >= a.need };
  });
}

// Тайминги предметов против всех игр на герое. rows — OpenDota scenarios/itemTimings:
// корзины по времени покупки (time — конец корзины в секундах), игры и победы в каждой
export function itemTimings(items, rows, minGames = 15) {
  const byItem = new Map();
  for (const r of rows || []) {
    const g = Number(r.games) || 0;
    if (!g || !r.item) continue;
    if (!byItem.has(r.item)) byItem.set(r.item, []);
    byItem.get(r.item).push({ t: Number(r.time), g, w: Number(r.wins) || 0 });
  }
  const winrate = (xs) => {
    const g = sum(xs.map((x) => x.g));
    return g >= 5 ? Math.round((sum(xs.map((x) => x.w)) / g) * 100) : null;
  };
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    const b = (byItem.get(it.key) || []).sort((x, y) => x.t - y.t);
    const total = sum(b.map((x) => x.g));
    if (total < minGames) continue;
    // Медиана по играм: к этому времени предмет собирает половина игроков на герое
    let acc = 0, usual = b[b.length - 1].t;
    for (const x of b) { acc += x.g; if (acc >= total / 2) { usual = x.t; break; } }
    out.push({
      key: it.key, item: it.item, time: it.time, usual, games: total,
      verdict: it.time > usual + 180 ? "late" : it.time <= usual - 180 ? "early" : "ok",
      wr_by: winrate(b.filter((x) => x.t <= usual)), wr_after: winrate(b.filter((x) => x.t > usual)),
    });
  }
  return out;
}

// Драфт до игры: кого из своих героев взять против этих врагов и что собирать.
// pool — [{hero_id, games, win}] свои герои, matchups — {hero_id: [{hero_id, games_played, wins}]} по каждому из них
export function draftAdvice({ enemies, pool, matchups, knowledge, od, role = "core", minGames = 20 }) {
  const picks = [];
  for (const h of pool || []) {
    const rows = new Map((matchups[h.hero_id] || []).map((m) => [m.hero_id, m]));
    const vs = [];
    for (const e of enemies) {
      const m = rows.get(e);
      if (m && m.games_played >= minGames) vs.push({ hero_id: e, name: od.heroName(e), wr: m.wins / m.games_played, games: m.games_played });
    }
    if (vs.length < Math.min(2, enemies.length)) continue;
    // Своя игра на герое: винрейт со сглаживанием к 50%, чтобы 3 игры из 3 не перевешивали всё
    const own = ((h.win || 0) + 5) / ((h.games || 0) + 10);
    const matchup = sum(vs.map((v) => v.wr)) / vs.length;
    picks.push({ hero_id: h.hero_id, name: od.heroName(h.hero_id), games: h.games, own_wr: own, matchup_wr: matchup,
      score: matchup * 0.7 + own * 0.3, vs: vs.sort((a, b) => b.wr - a.wr) });
  }
  picks.sort((a, b) => b.score - a.score);
  // Предметы против механик врагов: каждая механика даёт свои предметы для роли
  const votes = new Map();
  for (const e of enemies) {
    const key = od.heroKey(e);
    for (const tag of (knowledge.heroes[key] || [])) {
      const mech = knowledge.mechanics[tag];
      if (!mech || !mech.roles.includes(role)) continue;
      for (const item of mech[role] || []) {
        const v = votes.get(item) || { key: item, item: od.itemName(item), n: 0, why: new Set(), from: new Set() };
        v.n += 1;
        v.why.add(mech.name);
        v.from.add(od.heroName(e));
        votes.set(item, v);
      }
    }
  }
  const items = [...votes.values()].sort((a, b) => b.n - a.n).slice(0, 5)
    .map((v) => ({ key: v.key, item: v.item, why: [...v.why].join(", "), from: [...v.from].join(", ") }));
  return { picks: picks.slice(0, 3), items };
}

export function analyze(match, player, od, knowledge, texts, proItems, heroBench, norms, matchups, replay = null) {
  return new MatchAnalyzer(match, player, od, knowledge, texts, proItems, heroBench, norms, matchups, replay).run();
}
