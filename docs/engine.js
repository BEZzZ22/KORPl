// Движок разбора матча. Точная копия analysis.py для веб-приложения:
// тест tests/test_parity.py прогоняет оба движка на одном матче и сверяет результат.
// Тексты общие: docs/texts.json, база механик: docs/knowledge.json.

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
const PHASES = [["lane", "Линия", 0, 10], ["mid", "Мидгейм", 10, 25], ["late", "Лейт", 25, null]];
const SWING_WINDOW = 5;
const SWING_MIN_GOLD = 3000;
const PRO_ITEM_PHASES = ["early_game_items", "mid_game_items", "late_game_items"];

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

export function position(player) {
  return player.position_est || { 1: 1, 2: 2, 3: 3 }[player.lane_role] || 4;
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
      if (key.includes("creep") || key.includes("neutral")) return "крипы";
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
  constructor(match, player, od, knowledge, texts, proItems) {
    this.match = match;
    this.p = player;
    this.od = od;
    this.k = knowledge;
    this.texts = texts;
    this.pro = proItems || {};
    this.hasPro = Object.keys(this.pro).length > 0;
    this.damageTypeNames = Object.fromEntries(Object.entries(knowledge.damage_types).map(([k, v]) => [k, v.name]));
    this.duration = match.duration;
    this.minutes = Math.floor(this.duration / 60);
    this.pos = position(player);
    this.core = this.pos <= 3;
    this.won = player.isRadiant === match.radiant_win;
    this.allies = match.players.filter((x) => x.isRadiant === player.isRadiant);
    this.enemies = match.players.filter((x) => x.isRadiant !== player.isRadiant);
    this.opponent = this.enemies.find((e) => position(e) === LANE_OPPONENT[this.pos]) || null;
    this.oppName = this.opponent ? od.heroName(this.opponent.hero_id) : null;
    this.hero = od.heroName(player.hero_id);
    this.bench = {};
    for (const [k, v] of Object.entries(player.benchmarks || {})) this.bench[k] = pyRound(v.pct * 100);
    const sign = player.isRadiant ? 1 : -1;
    this.teamAdv = (match.radiant_gold_adv || []).map((a) => a * sign);
    this.fightWindows = (match.teamfights || []).map((tf) => [tf.start - TEAMFIGHT_MARGIN, tf.end + TEAMFIGHT_MARGIN]);
    this.findings = [];
    this.penalty = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  }

  // ---------- тексты ----------

  say(key, params = {}, seed = "") {
    const variants = this.texts[key];
    const fullSeed = `${this.match.match_id}:${this.p.player_slot}:${key}:${seed}`;
    return fill(variants[textHash(fullSeed) % variants.length], params);
  }

  add(category, severity, key, tipKey = null, params = {}, kind = "") {
    const text = this.say(key, params);
    const tip = tipKey ? this.say(tipKey, params) : "";
    this.addRaw(category, severity, text, tip, kind);
  }

  addRaw(category, severity, text, tip = "", kind = "") {
    this.findings.push({ category, severity, text, tip, kind });
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
    const scores = this.computeScores();
    const values = Object.values(scores);
    return {
      facts: this.collectFacts(),
      findings: this.findings,
      scores,
      overall: Math.round((sum(values) / values.length) * 10) / 10,
      timeline: this.collectTimeline(),
      killers,
      phases: this.phases(),
      moments: this.moments(),
      pro_build: proBuild,
      verdict: this.verdict(scores),
      items: this.coreItems(),
    };
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
      .filter(([k, c]) => this.isFinalItem(k) && c >= PRO_MIN_COUNT)
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
    if (this.core && this.minutes >= 10) {
      const target = LH_TARGET_10[pos];
      if (lh10 < target * 0.7) this.add(LANE, BAD, "lane_lh_bad", "lane_lh_bad_tip", { lh: lh10, target });
      else if (lh10 < target) this.add(LANE, WARN, "lane_lh_warn", null, { lh: lh10, target });
      else if (lh10 >= target * 1.25) this.add(LANE, GOOD, "lane_lh_good", null, { lh: lh10 });
      if (pos === 2 && dn10 < 6) this.add(LANE, WARN, "lane_denies_warn", "lane_denies_warn_tip", { dn: dn10 });
    }
    if (this.opponent && this.minutes >= 10) {
      const diff = atMinute(p.networth_t, 10) - atMinute(this.opponent.networth_t, 10);
      if (diff <= -1000) this.add(LANE, BAD, "lane_lost", "lane_lost_tip", { opp: this.oppName, gold: num(-diff) });
      else if (diff >= 1000) this.add(LANE, GOOD, "lane_won", null, { opp: this.oppName, gold: num(diff) });
    }
    const early = (p.deaths_log || []).filter((d) => d.time < 600);
    if (early.length >= 2) {
      const n = early.length;
      this.add(LANE, BAD, "lane_deaths", "lane_deaths_tip", {
        n, deaths_word: deathsWord(n), times_word: timesWord(n), times: early.map((d) => mmss(d.time)).join(", "),
      });
    }
  }

  // ---------- фарм ----------

  checkFarm() {
    const p = this.p;
    if (this.core) {
      for (const [key, name] of [["gold_per_min", "GPM"], ["last_hits_per_min", "Ластхиты в минуту"]]) {
        const pct = this.bench[key];
        if (pct == null) continue;
        if (pct < 25) this.add(FARM, BAD, "farm_bench_bad", null, { name, pct: 100 - pct });
        else if (pct >= 80) this.add(FARM, GOOD, "farm_bench_good", null, { name, pct });
      }
      for (const [start, end, lh] of this.idleWindows()) {
        this.add(FARM, WARN, "farm_idle", "farm_idle_tip", { from: mmss(start * 60), to: mmss(end * 60), lh, mins: end - start });
      }
      if (this.pos === 1 && this.minutes >= 25 && p.last_hits > 0) {
        const share = (p.neutral_kills ?? 0) / p.last_hits;
        if (share < 0.15) this.add(FARM, WARN, "farm_jungle", "farm_jungle_tip", { share: pyRound(share * 100) });
      }
      const towers = this.bench.tower_damage;
      if ((this.pos === 1 || this.pos === 3) && this.minutes >= 25 && towers != null && towers < 20) {
        this.add(FARM, WARN, "farm_towers", "farm_towers_tip", { pct: 100 - towers });
      }
    }
    if (this.opponent && this.minutes >= 20 && this.core) {
      const diff = atMinute(p.networth_t, 20) - atMinute(this.opponent.networth_t, 20);
      if (diff <= -3000) this.add(FARM, BAD, "farm_nw_behind", null, { opp: this.oppName, gold: num(-diff) });
      else if (diff >= 3000) this.add(FARM, GOOD, "farm_nw_ahead", null, { opp: this.oppName, gold: num(diff) });
    }
  }

  idleWindows() {
    const lh = this.p.lh_t;
    const deadMinutes = new Set();
    for (const d of this.p.deaths_log || []) {
      const from = Math.floor(d.time / 60), to = Math.floor((d.time + (d.time_dead ?? 30)) / 60);
      for (let m = from; m <= to; m++) deadMinutes.add(m);
    }
    const windows = [];
    let start = null;
    const last = Math.min(lh.length - 1, 40);
    for (let m = 10; m <= last; m++) {
      const idle = m < lh.length && lh[m] - lh[m - 1] <= 1 && !deadMinutes.has(m);
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
    if (teamKills >= 10) {
      const kp = pyRound(((p.kills + p.assists) / teamKills) * 100);
      if (kp < 45) this.add(FIGHTS, BAD, "fights_kp_bad", "fights_kp_bad_tip", { kp });
      else if (kp >= 70) this.add(FIGHTS, GOOD, "fights_kp_good", null, { kp });
    }
    const missed = this.missedFights();
    if (missed.length) {
      const n = missed.length;
      const times = missed.slice(0, 3).map(([t, k]) => `${mmss(t)} (-${k})`).join(", ");
      this.add(FIGHTS, n >= 3 ? BAD : WARN, "fights_missed", "fights_missed_tip",
        { n, fights_word: plural(n, "драку", "драки", "драк"), times });
    }
    if (this.core) {
      const pct = this.bench.hero_damage_per_min;
      if (pct != null && pct < 25) this.add(FIGHTS, WARN, "fights_dmg_bad", "fights_dmg_bad_tip", { pct: 100 - pct });
      else if (pct != null && pct >= 80) this.add(FIGHTS, GOOD, "fights_dmg_good", null, { pct });
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

  checkSurvival() {
    const p = this.p;
    const deaths = p.deaths_log || [];
    const pct = this.bench.deaths_per_min;
    const n = p.deaths;
    if (pct != null && pct < 25) this.add(SURVIVAL, BAD, "surv_deaths_bad", null, { n, deaths_word: deathsWord(n), pct: 100 - pct });
    else if (pct != null && pct >= 80 && this.minutes >= 20) this.add(SURVIVAL, GOOD, "surv_deaths_good", null, { n, deaths_word: deathsWord(n) });

    const solo = deaths.filter((d) => d.time >= 600 && !this.inFight(d.time));
    if (solo.length >= 2) {
      const k = solo.length;
      this.add(SURVIVAL, BAD, "surv_solo", "surv_solo_tip",
        { n: k, times_word: timesWord(k), times: solo.slice(0, 5).map((d) => mmss(d.time)).join(", ") });
    }
    const deadShare = (p.life_state_dead || 0) / Math.max(this.duration, 1);
    if (deadShare >= 0.15) {
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
    if (this.core && items.length) {
      const first = items[0];
      const minute = first.time / 60;
      const params = { item: first.item, time: mmss(first.time) };
      if (minute >= 20) this.add(ITEMS, BAD, "items_first_bad", "items_first_bad_tip", params);
      else if (minute >= 17) this.add(ITEMS, WARN, "items_first_warn", null, params);
      else if (minute <= 13) this.add(ITEMS, GOOD, "items_first_good", null, params);
    } else if (this.core && this.minutes >= 20) {
      this.add(ITEMS, BAD, "items_none");
    }

    const bkbPopular = this.proCount("black_king_bar") >= PRO_MIN_COUNT;
    if ((this.pos === 1 || this.pos === 2) && this.minutes >= 30 && bkbPopular) {
      if (!items.some((x) => x.key === "black_king_bar")) this.add(ITEMS, WARN, "items_no_bkb", "items_no_bkb_tip");
    }

    const tps = (p.item_uses || {}).tpscroll ?? 0;
    if (this.minutes >= 20 && tps < this.minutes / 10) this.add(ITEMS, WARN, "items_tp", "items_tp_tip", { n: tps, mins: this.minutes });

    const boots = (p.purchase_log || []).find((x) => x.key === "boots");
    if (this.core && boots && boots.time > 360) this.add(ITEMS, WARN, "items_boots", "items_boots_tip", { time: mmss(boots.time) });

    if (!this.won && (p.gold ?? 0) >= 2500) this.add(ITEMS, WARN, "items_gold_left", "items_gold_left_tip", { gold: num(p.gold) });
  }

  // ---------- видение ----------

  checkVision() {
    const p = this.p;
    const obs = p.obs_placed ?? 0, sen = p.sen_placed ?? 0;
    const dewards = (p.observer_kills ?? 0) + (p.sentry_kills ?? 0);
    if (this.pos >= 4 && this.minutes >= 15) {
      const per10 = (obs / this.minutes) * 10;
      if (per10 < 2.5) this.add(VISION, BAD, "vision_obs_bad", "vision_obs_bad_tip", { n: obs, mins: this.minutes });
      else if (per10 >= 4) this.add(VISION, GOOD, "vision_obs_good", null, { n: obs });

      const [short, total] = this.dewardedObservers();
      if (total >= 4 && short / total >= 0.4) this.add(VISION, WARN, "vision_dewarded", "vision_dewarded_tip", { short, total });
      if (sen < obs / 2) this.add(VISION, WARN, "vision_sentries", "vision_sentries_tip", { sen, obs, dewards });
      if (this.pos === 5 && this.minutes >= 25 && (p.camps_stacked ?? 0) < 2) this.add(VISION, WARN, "vision_stacks", "vision_stacks_tip");
      const smokes = (p.item_uses || {}).smoke_of_deceit ?? 0;
      if (this.minutes >= 30 && smokes === 0) this.add(VISION, WARN, "vision_smoke", "vision_smoke_tip", { mins: this.minutes });
    } else if (this.core && dewards >= 3) {
      this.add(VISION, GOOD, "vision_dewards_good", null, { n: dewards });
    }
    if (this.pos === 2 && this.minutes >= 20) {
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

  relevantMechanics(mechanics, mainType) {
    return mechanics.filter((m) => {
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
      const mechanics = this.relevantMechanics(this.k.heroes[key] || [], mainType);
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
    this.addRaw(SURVIVAL, n >= 4 ? BAD : WARN, text, tipParts.join(". "), "killer");
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
      for (const tag of this.k.heroes[this.od.heroKey(e.hero_id)] || []) {
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
      const score = nKills - nDeaths * 1.5 + swing;
      const verdict = score >= 2 ? "good" : score <= -2 ? "bad" : "even";
      const killsText = `${nKills} ${plural(nKills, "убийство", "убийства", "убийств")}`;
      const deathsText = nDeaths === 0 ? "без смертей" : `${nDeaths} ${deathsWord(nDeaths)}`;
      result.push({
        key,
        title: `${title} · ${start}–${stop} мин`,
        verdict,
        text: this.say(`phase_${key}_${verdict}`, { lh: lhGain, kills_text: killsText, deaths_text: deathsText, nw_text: nwText }),
        kills: nKills,
        deaths: nDeaths,
        last_hits: lhGain,
        nw_delta: nwDelta,
        team_delta: teamDelta,
      });
    }
    return result;
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
      else key = this.inFight(d.time) ? "moment_death_fight" : "moment_death_solo";
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

  verdict(scores) {
    const values = Object.values(scores);
    const mean = sum(values) / values.length;
    const key = mean >= 8 ? "verdict_top" : mean >= 6.5 ? "verdict_good" : mean >= 5 ? "verdict_mid" : "verdict_bad";
    return this.say(key);
  }

  collectFacts() {
    const p = this.p;
    return {
      match_id: this.match.match_id,
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

export function analyze(match, player, od, knowledge, texts, proItems) {
  return new MatchAnalyzer(match, player, od, knowledge, texts, proItems).run();
}
