// Движок разбора матча. Точная копия analysis.py для веб-приложения:
// тест tests/test_parity.py прогоняет оба движка на одном матче и сверяет результат.

export const LANE = "Линия", FARM = "Фарм", FIGHTS = "Драки", SURVIVAL = "Выживание", ITEMS = "Предметы", VISION = "Видение";
export const CATEGORIES = [LANE, FARM, FIGHTS, SURVIVAL, ITEMS, VISION];
export const BAD = "bad", WARN = "warn", GOOD = "good";

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
const DAMAGE_TYPE_INSTR = { Physical: "физическим", Magical: "магическим", Pure: "чистым" };

// Python round(): половинки округляются к чётному. Нужен для совпадения с ботом
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

export function position(player) {
  return player.position_est || { 1: 1, 2: 2, 3: 3 }[player.lane_role] || 4;
}

function atMinute(series, minute) {
  if (!series || !series.length) return null;
  return minute < series.length ? series[minute] : series[series.length - 1];
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const intersects = (set, keys) => keys.some((k) => set.has(k));

function damageType(value) {
  if (Array.isArray(value)) value = value.length ? value[0] : null;
  return ["Physical", "Magical", "Pure"].includes(value) ? value : null;
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
  constructor(match, player, od, knowledge) {
    this.match = match;
    this.p = player;
    this.od = od;
    this.k = knowledge;
    this.damageTypeNames = Object.fromEntries(Object.entries(knowledge.damage_types).map(([k, v]) => [k, v.name]));
    this.duration = match.duration;
    this.minutes = Math.floor(this.duration / 60);
    this.pos = position(player);
    this.core = this.pos <= 3;
    this.won = player.isRadiant === match.radiant_win;
    this.allies = match.players.filter((x) => x.isRadiant === player.isRadiant);
    this.enemies = match.players.filter((x) => x.isRadiant !== player.isRadiant);
    this.opponent = this.enemies.find((e) => position(e) === LANE_OPPONENT[this.pos]) || null;
    this.bench = {};
    for (const [k, v] of Object.entries(player.benchmarks || {})) this.bench[k] = pyRound(v.pct * 100);
    this.findings = [];
    this.penalty = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  }

  add(category, severity, text, tip = "", kind = "") {
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
    const scores = this.computeScores();
    const values = Object.values(scores);
    return {
      facts: this.collectFacts(),
      findings: this.findings,
      scores,
      overall: Math.round((sum(values) / values.length) * 10) / 10,
      timeline: this.collectTimeline(),
      killers,
      items: this.coreItems(),
    };
  }

  // ---------- линия ----------

  checkLane() {
    const p = this.p, pos = this.pos;
    const lh10 = atMinute(p.lh_t, 10), dn10 = atMinute(p.dn_t, 10);

    if (this.core && this.minutes >= 10) {
      const target = LH_TARGET_10[pos];
      if (lh10 < target * 0.7) {
        this.add(LANE, BAD, `Ластхиты к 10:00: ${lh10} при норме ${target}+`,
          "Тренируй добивание в демке: 5 минут на линии без скиллов, цель 40+ крипов");
      } else if (lh10 < target) {
        this.add(LANE, WARN, `Ластхиты к 10:00: ${lh10}, чуть ниже нормы ${target}`);
      } else if (lh10 >= target * 1.25) {
        this.add(LANE, GOOD, `Отличное добивание: ${lh10} крипов к 10:00`);
      }
      if (pos === 2 && dn10 < 6) {
        this.add(LANE, WARN, `Денаев на миде к 10:00 всего ${dn10}`,
          "На миде денай важен почти как ластхит: так ты отбираешь у врага опыт и золото");
      }
    }

    if (this.opponent && this.minutes >= 10) {
      const diff = atMinute(p.networth_t, 10) - atMinute(this.opponent.networth_t, 10);
      const opp = this.od.heroName(this.opponent.hero_id);
      if (diff <= -1000) {
        this.add(LANE, BAD, `Проиграл линию: к 10:00 отставал от ${opp} на ${-diff} золота`,
          `Посмотри реплей первых 10 минут и найди, в какие моменты ${opp} тебя наказывал`);
      } else if (diff >= 1000) {
        this.add(LANE, GOOD, `Выиграл линию: к 10:00 впереди ${opp} на ${diff} золота`);
      }
    }

    const early = (p.deaths_log || []).filter((d) => d.time < 600);
    if (early.length >= 2) {
      const times = early.map((d) => mmss(d.time)).join(", ");
      this.add(LANE, BAD, `${early.length} ${plural(early.length, "смерть", "смерти", "смертей")} на линии (${times})`,
        "На линии не заходи за свою крипволну, если не видишь всех врагов. Следи за ранами и не жадничай");
    }
  }

  // ---------- фарм ----------

  checkFarm() {
    const p = this.p;
    if (this.core) {
      for (const [key, name] of [["gold_per_min", "GPM"], ["last_hits_per_min", "Ластхиты в минуту"]]) {
        const pct = this.bench[key];
        if (pct == null) continue;
        if (pct < 25) this.add(FARM, BAD, `${name}: хуже, чем у ${100 - pct}% игроков на этом герое`);
        else if (pct >= 80) this.add(FARM, GOOD, `${name}: лучше, чем у ${pct}% игроков на этом герое`);
      }
      for (const [start, end, lh] of this.idleWindows()) {
        this.add(FARM, WARN, `Простой с ${mmss(start * 60)} по ${mmss(end * 60)}: всего ${lh} крипов за ${end - start} мин`,
          "Если нечего делать, фарми лес или пушь линию. Минута без фарма — минус 300-500 золота");
      }
      if (this.pos === 1 && this.minutes >= 25 && p.last_hits > 0) {
        const share = (p.neutral_kills ?? 0) / p.last_hits;
        if (share < 0.15) {
          this.add(FARM, WARN, `Лесных крипов всего ${pyRound(share * 100)}% от фарма`,
            "Между волнами заходи в лес: линия, лагерь, линия. Так фарм растёт в разы");
        }
      }
    }
    if (this.opponent && this.minutes >= 20) {
      const diff = atMinute(p.networth_t, 20) - atMinute(this.opponent.networth_t, 20);
      const opp = this.od.heroName(this.opponent.hero_id);
      if (this.core && diff <= -3000) this.add(FARM, BAD, `К 20:00 отставал от ${opp} на ${-diff} нетворса`);
      else if (this.core && diff >= 3000) this.add(FARM, GOOD, `К 20:00 обогнал ${opp} на ${diff} нетворса`);
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
      if (kp < 45) {
        this.add(FIGHTS, BAD, `Участие в убийствах ${kp}%: команда воюет без тебя`,
          "Чаще смотри на миникарту и иди на драки с ТП, особенно после 15 минуты");
      } else if (kp >= 70) {
        this.add(FIGHTS, GOOD, `Участие в убийствах ${kp}%`);
      }
    }
    const missed = this.missedFights();
    if (missed.length) {
      const times = missed.slice(0, 3).map(([t, n]) => `${mmss(t)} (-${n})`).join(", ");
      this.add(FIGHTS, missed.length >= 3 ? BAD : WARN,
        `${missed.length} ${plural(missed.length, "драку", "драки", "драк")} пропустил, пока был жив: ${times}`,
        "В скобках сколько союзников погибло. Если не успеваешь, не фарми далеко, держи ТП");
    }
    if (this.core) {
      const pct = this.bench.hero_damage_per_min;
      if (pct != null && pct < 25) {
        this.add(FIGHTS, WARN, `Урон по героям ниже, чем у ${100 - pct}% игроков на этом герое`,
          "Бей тех, до кого достаёшь, а не только цель для убийства. Урон по танку тоже помогает");
      } else if (pct != null && pct >= 80) {
        this.add(FIGHTS, GOOD, `Урон по героям выше, чем у ${pct}% игроков на этом герое`);
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

  checkSurvival() {
    const p = this.p;
    const deaths = p.deaths_log || [];
    const pct = this.bench.deaths_per_min;
    const deathsWord = plural(p.deaths, "смерть", "смерти", "смертей");
    if (pct != null && pct < 25) {
      this.add(SURVIVAL, BAD, `${p.deaths} ${deathsWord}: умираешь чаще, чем ${100 - pct}% игроков на этом герое`);
    } else if (pct != null && pct >= 80 && this.minutes >= 20) {
      this.add(SURVIVAL, GOOD, `Всего ${p.deaths} ${deathsWord} за игру`);
    }

    const fights = (this.match.teamfights || []).map((tf) => [tf.start - TEAMFIGHT_MARGIN, tf.end + TEAMFIGHT_MARGIN]);
    const solo = deaths.filter((d) => d.time >= 600 && !fights.some(([s, e]) => s <= d.time && d.time <= e));
    if (solo.length >= 2) {
      const times = solo.slice(0, 5).map((d) => mmss(d.time)).join(", ");
      this.add(SURVIVAL, BAD, `Пойман в одиночку ${solo.length} ${plural(solo.length, "раз", "раза", "раз")} вне драк: ${times}`,
        "Перед фармом опасной зоны глянь миникарту: кого из врагов не видно. Нет 3+ врагов — отходи ближе к своим");
    }

    const deadShare = (p.life_state_dead || 0) / Math.max(this.duration, 1);
    if (deadShare >= 0.15) {
      this.add(SURVIVAL, BAD, `Провёл мёртвым ${mmss(p.life_state_dead)}, это ${pyRound(deadShare * 100)}% игры`,
        "Каждая минута в таверне — это минута без фарма и опыта");
    }

    const lost = sum(deaths.map((d) => d.gold_lost ?? 0));
    if (lost >= 1000 && lost / Math.max(p.total_gold || 1, 1) >= 0.1) {
      this.add(SURVIVAL, WARN, `Потерял ${lost} золота на смертях`,
        "Перед рискованным моментом трать золото: купи предмет или хотя бы компонент");
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
      if (minute >= 20) {
        this.add(ITEMS, BAD, `Первый крупный предмет (${first.item}) только на ${mmss(first.time)}`,
          "Для кора первый ключевой предмет должен быть к 14-17 минуте. Не трать золото на ситуативщину раньше");
      } else if (minute >= 17) {
        this.add(ITEMS, WARN, `Первый крупный предмет (${first.item}) на ${mmss(first.time)}, можно быстрее`);
      } else if (minute <= 13) {
        this.add(ITEMS, GOOD, `Быстрый ${first.item} на ${mmss(first.time)}`);
      }
    } else if (this.core && this.minutes >= 20) {
      this.add(ITEMS, BAD, "За 20+ минут ни одного крупного предмета");
    }

    if ((this.pos === 1 || this.pos === 2) && this.minutes >= 30) {
      if (!items.some((x) => x.key === "black_king_bar")) {
        this.add(ITEMS, WARN, "Не было BKB за всю игру",
          "Если у врагов много контроля или магии, BKB чаще всего обязателен к 25 минуте");
      }
    }

    const tps = (p.item_uses || {}).tpscroll ?? 0;
    if (this.minutes >= 20 && tps < this.minutes / 10) {
      this.add(ITEMS, WARN, `Всего ${tps} ТП за ${this.minutes} мин`,
        "ТП должен быть в слоте всегда: спасает вышки, союзников и экономит время на ходьбу");
    }

    const boots = (p.purchase_log || []).find((x) => x.key === "boots");
    if (this.core && boots && boots.time > 360) {
      this.add(ITEMS, WARN, `Сапоги только на ${mmss(boots.time)}`,
        "Сапоги нужны к 4-5 минуте: без них проще поймать и сложнее размениваться");
    }

    if (!this.won && (p.gold ?? 0) >= 2500) {
      this.add(ITEMS, WARN, `Закончил проигранную игру с ${p.gold} золота в кармане`,
        "Неиспользованное золото — это предмет, которого не было в последней драке");
    }
  }

  // ---------- видение ----------

  checkVision() {
    const p = this.p;
    const obs = p.obs_placed ?? 0, sen = p.sen_placed ?? 0;
    const dewards = (p.observer_kills ?? 0) + (p.sentry_kills ?? 0);
    if (this.pos >= 4 && this.minutes >= 15) {
      const per10 = (obs / this.minutes) * 10;
      if (per10 < 2.5) {
        this.add(VISION, BAD, `Всего ${obs} обсов за ${this.minutes} мин`,
          "Саппорт должен ставить обс каждый раз, как он есть в лавке. Видение выигрывает драки");
      } else if (per10 >= 4) {
        this.add(VISION, GOOD, `Хорошо варил: ${obs} обсов`);
      }
      const [short, total] = this.dewardedObservers();
      if (total >= 4 && short / total >= 0.4) {
        this.add(VISION, WARN, `${short} из ${total} обсов враги быстро сносили`,
          "Не ставь на самые очевидные точки. Сдвигай вард на пару шагов или на соседнюю высоту");
      }
      if (sen < obs / 2) {
        this.add(VISION, WARN, `Мало сентри: ${sen} при ${obs} обсах, снял ${dewards} вардов`,
          "Сентри у своих вышек и рун ломают вражеское видение и спасают от гангов");
      }
      if (this.pos === 5 && this.minutes >= 25 && (p.camps_stacked ?? 0) < 2) {
        this.add(VISION, WARN, "Почти не стакал лес",
          "На x:53-x:55 оттяни лагерь: керри потом сразу заберёт двойной стак");
      }
    } else if (this.core && dewards >= 3) {
      this.add(VISION, GOOD, `Снял ${dewards} вражеских вардов, хорошо для кора`);
    }

    if (this.pos === 2 && this.minutes >= 20) {
      const runes = p.rune_pickups ?? 0;
      if (runes < this.minutes / 5) {
        this.add(VISION, WARN, `Мало рун для мида: ${runes} за игру`,
          "Руны на миде — это бесплатные ганги и реген. Контролируй их каждые 2 минуты");
      }
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
    for (const [base, upgrades] of Object.entries(ITEM_UPGRADES)) {
      if (intersects(owned, upgrades)) owned.add(base);
    }
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
      if (dmg > 0) {
        sources.push({ key: inflictor, name: this.od.sourceName(inflictor), damage: dmg, type: this.od.sourceType(inflictor) });
      }
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
    const seen = new Set(), missing = [], had = [];
    for (const key of candidates) {
      if (seen.has(key)) continue;
      seen.add(key);
      (owned.has(key) ? had : missing).push(key);
    }
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
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, n] of sorted) {
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
      const killer = {
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
      };
      killers.push(killer);
      this.addKillerFinding(killer);
    }
    return killers.slice(0, 3);
  }

  addKillerFinding(k) {
    const how = k.sources.slice(0, 3).map((s) => `${s.name} ${s.damage}`).join(", ");
    let text = `${k.hero} убил тебя ${k.deaths} ${plural(k.deaths, "раз", "раза", "раз")}`;
    if (k.damage) {
      text += `: ${k.damage} урона`;
      if (k.main_type) text += `, ${k.main_type_share}% ${this.damageTypeNames[k.main_type]}`;
      text += ` (${how})`;
    }
    if (k.disables.length) text += ". Контроль: " + k.disables.map((d) => `${d.name} ×${d.count}`).join(", ");

    const tipParts = k.tips.slice(0, 2);
    if (k.counters.length) tipParts.push("Возьми: " + k.counters.join(", "));
    if (k.deaths >= 3) {
      const had = new Set(k.had_counter_keys);
      if ([...had].some((x) => DETECTION_ITEMS.has(x))) {
        tipParts.push("Детект у тебя был, но не там: ставь сентри и кидай Dust в местах, где умирал");
      }
      const active = k.had_counter_keys.filter((x) => !DETECTION_ITEMS.has(x)).map((x) => this.od.itemName(x));
      if (active.length) {
        const verb = active.length > 1 ? "были" : "был";
        tipParts.push(`${active.slice(0, 2).join(", ")} у тебя ${verb} — используй заранее, а не когда уже в контроле`);
      }
    }
    this.add(SURVIVAL, k.deaths >= 4 ? BAD : WARN, text, tipParts.join(". "), "killer");
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
        if (share >= threshold && !intersects(owned, counters)) {
          const names = counters.slice(0, 3).map((k) => this.od.itemName(k)).join(", ");
          this.add(ITEMS, WARN, `${pyRound(share * 100)}% урона по тебе было ${DAMAGE_TYPE_INSTR[dmgType]}, а защиты от него не было`,
            `Против такого урона на твоей роли работают: ${names}`);
        }
      }
    }

    const enemyTags = {};
    for (const e of this.enemies) {
      for (const tag of this.k.heroes[this.od.heroKey(e.hero_id)] || []) {
        (enemyTags[tag] = enemyTags[tag] || []).push(this.od.heroName(e.hero_id));
      }
    }
    if (enemyTags.invis && this.pos >= 4 && !intersects(owned, ["dust", "ward_sentry", "gem"])) {
      this.add(VISION, BAD, `Против ${enemyTags.invis.join(", ")} не купил ни Dust, ни сентри`,
        "Против невидимых героев саппорт всегда носит Dust и ставит сентри в ключевых местах");
    }
    if (enemyTags.evasion && this.pos === 1 && this.minutes >= 30 && !intersects(owned, ["monkey_king_bar", "bloodthorn"])) {
      this.add(ITEMS, WARN, `Против уклонения ${enemyTags.evasion.join(", ")} не было MKB или Bloodthorn`,
        "Без точности часть твоих атак просто промахивается");
    }
    if ((enemyTags.heal || []).length >= 2 && (this.pos === 3 || this.pos === 4) &&
        !intersects(owned, ["spirit_vessel", "shivas_guard", "skadi"])) {
      this.add(ITEMS, WARN, `У врагов много хила (${enemyTags.heal.join(", ")}), а антихила у тебя не было`,
        "Spirit Vessel на оффлейне или четвёрке режет лечение и добивает тех, кто убегает");
    }
  }

  // ---------- игра в целом ----------

  checkGame() {
    const adv = this.match.radiant_gold_adv || [];
    if (!adv.length || this.won) return;
    const sign = this.p.isRadiant ? 1 : -1;
    let bestMinute = 0, best = adv[0] * sign;
    adv.forEach((a, i) => {
      if (a * sign > best) { best = a * sign; bestMinute = i; }
    });
    if (best >= 8000) {
      this.add(FIGHTS, WARN, `Команда была впереди на ${best} золота на ${bestMinute}-й минуте и слила игру`,
        "Когда впереди, не ломитесь на хайграунд без Рошана и аегиса, а давите картой и забирайте объекты");
    }
  }

  // ---------- оценки и факты ----------

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
    return Object.fromEntries(
      CATEGORIES.map((c) => [c, Math.max(1, Math.min(10, pyRound(base[c] + 1 - this.penalty[c])))]),
    );
  }

  collectFacts() {
    const p = this.p;
    return {
      match_id: this.match.match_id,
      hero: this.od.heroName(p.hero_id),
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
      lane_opponent: this.opponent ? this.od.heroName(this.opponent.hero_id) : null,
      lane_opponent_id: this.opponent ? this.opponent.hero_id : null,
      allies: this.allies.filter((a) => a !== p).map((a) => a.hero_id),
      enemies: this.enemies.map((e) => e.hero_id),
      benchmarks_percentile: this.bench,
    };
  }

  collectTimeline() {
    const sign = this.p.isRadiant ? 1 : -1;
    return {
      player: this.p.networth_t,
      opponent: this.opponent ? this.opponent.networth_t : null,
      opponent_name: this.opponent ? this.od.heroName(this.opponent.hero_id) : null,
      hero: this.od.heroName(this.p.hero_id),
      deaths: (this.p.deaths_log || []).map((d) => d.time),
      last_hits: this.p.lh_t,
      team_gold_adv: (this.match.radiant_gold_adv || []).map((v) => v * sign),
    };
  }
}

export function analyze(match, player, od, knowledge) {
  return new MatchAnalyzer(match, player, od, knowledge).run();
}
