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
};
const MAX_COUNTER_ITEMS = 3;
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
  lh10: { what: "Ласт хиты к 10:00", cat: "Линия", roles: [1, 2, 3], fmt: (v) => String(Math.round(v)) },
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
    if (a.dname) abilityInfo[key] = { dname: a.dname, dmg_type: damageType(a.dmg_type) };
  }
  const od = {
    items,
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
      return key;
    },
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
  constructor(match, player, od, knowledge, texts, proItems, heroBench, norms) {
    this.match = match;
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
      params.lasthits = plural(params.lh, "ластхит", "ластхита", "ластхитов");
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
    const proBuild = this.proBuild();
    this.checkProBuild(proBuild);
    this.checkRoshan();
    this.checkDeathZones();
    this.checkWardZones();
    this.checkLateGame();
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
      pro_build: proBuild,
      compare,
      verdict: this.verdict(scores, overall),
      items: this.coreItems(),
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
    const early = (p.deaths_log || []).filter((d) => d.time < 600).length;
    const earlyPct = [70, 50, 25, 10][Math.min(early, 3)];
    let lanePct = null;
    if (this.opponent && this.minutes >= 10) {
      const diff = atMinute(p.networth_t, 10) - atMinute(this.opponent.networth_t, 10);
      lanePct = Math.max(0, Math.min(100, 50 + diff / 40));
    }
    const solo = (p.deaths_log || []).filter((d) => d.time >= 600 && this.isSoloDeath(d.time)).length;
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
    return "Цель на следующую катку: исправить главную ошибку выше";
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
          this.issue("lane_farm", Math.max(0, r.median - lh10) * 45, "Мало ласт хитов на лайне",
            `${lh10} ласт хит${plural(lh10, "", "а", "ов")} к 10:00 — хуже, чем у ${100 - r.pct}% ${ROLE_GEN_PLURAL[pos]} на ранге ${RANKS[this.bracket][0]} (обычно ${Math.round(r.median)})`,
            "Перед каткой 5 минут ластхитить в демке. На лайне бей крипа только на ласт хит, не пушь волну просто так");
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
          `К 10:00 ${this.oppName} обогнал тебя по нетворсу (стоимость шмота и золота) на ${num(-diff)}`,
          `Пересмотри первые 10 минут реплея: где ты проигрывал трейды (размены ударами) с ${this.oppName} и почему терял ХП`);
      }
      else if (diff >= 1000) this.add(LANE, GOOD, "lane_won", null, { opp: this.oppName, gold: num(diff) });
    }
    const firstDeath = (p.deaths_log || [])[0];
    if (firstDeath && firstDeath.time < EARLY_DEATH_TIME) {
      this.add(LANE, WARN, "surv_early_death", "surv_early_death_tip", { time: mmss(firstDeath.time) });
    }
    const early = (p.deaths_log || []).filter((d) => d.time < 600);
    if (early.length >= 2) {
      const n = early.length;
      this.add(LANE, BAD, "lane_deaths", "lane_deaths_tip", {
        n, deaths_word: deathsWord(n), times_word: timesWord(n), times: early.map((d) => mmss(d.time)).join(", "),
      });
      const killers = [...new Set(early.map((d) => this.od.heroNameByKey(d.key)))].join(", ");
      this.issue("lane_deaths", n * 450, "Фидил на лайне",
        `${n} ${deathsWord(n)} до 10-й минуты (${early.map((d) => mmss(d.time)).join(", ")}), убивали: ${killers}` +
          (early[0].time < 90 ? ". Первая — ещё в файте за руну на старте" : ""),
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
          `${idle.map(([s, e]) => `${mmss(s * 60)}–${mmss(e * 60)}`).join(", ")}: ни ласт хитов, ни золота, ни файтов`,
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
      if (!tookPart && !wasDead && allyDeaths >= 2) result.push([tf.start, allyDeaths]);
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

    const solo = deaths.filter((d) => d.time >= 600 && this.isSoloDeath(d.time));
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
          "Каждая смерть после 20-й минуты — минута без игры. Выходи из файта, когда ХП меньше трети и нет сейва (BKB, форс, байбек)");
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
    if (this.pos === 2 && this.minutes >= 20 && !this.dominant) {
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
      const [missing, had] = this.pickCounters(mechanics, mainType, owned);
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
      this.issue(`killer_${k.key}`, n * 380, `${k.hero} тебя фармил`,
        `${n} ${deathsWord(n)} от ${k.hero}${how ? `, в основном ${how}` : ""}`,
        action || `Держись дальше от ${k.hero} и не выходи к нему один`,
        k.counters.length
          ? `Цель на следующую катку: ${k.counters[0]} к 20-й минуте, если снова против ${k.hero}`
          : `Цель на следующую катку: не больше одной смерти от ${k.hero}`);
    }
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
    const lh = p.lh_t;
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
        const wardsText = wards ? `${wards} ${plural(wards, "обс", "обса", "обсов")}` : "ни одного обса";
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
      else key = this.isSoloDeath(d.time) ? "moment_death_solo" : "moment_death_fight";
      add(d.time, BAD, this.say(key, { killer }, String(d.time)));
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

export function analyze(match, player, od, knowledge, texts, proItems, heroBench, norms) {
  return new MatchAnalyzer(match, player, od, knowledge, texts, proItems, heroBench, norms).run();
}
