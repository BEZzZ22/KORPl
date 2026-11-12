// Глубокий разбор по реплею: факты из d/<матч>.json (считает tools/deep/analyze.mjs в GitHub Actions) → слова для человека.
// Здесь нет ни правил, ни чисел «из головы»: только подстановка посчитанного в шаблоны docs/texts.json (ключи deep_*).
// Работает и в приложении, и в Node (тренер, видеоразбор, тесты).

const ROLES_GEN = { 1: "керри", 2: "мидеров", 3: "офлейнеров", 4: "четвёрок", 5: "пятёрок" };
const ROLES_NOM = { 1: "керри", 2: "мидеры", 3: "офлейнеры", 4: "четвёрки", 5: "пятёрки" };
const ROLE_NAME = { 1: "керри", 2: "мидер", 3: "офлейнер", 4: "четвёрка", 5: "пятёрка" };

const KIND_TITLE = {
  blind_farm: "Фарм вслепую", gank: "Ганг из тумана", smoke: "Ганг под Смоком", saw_coming: "Видел и не ушёл",
  low_hp: "Ходил побитым", dive_enemy_tower: "Под вражеской вышкой", outnumbered: "В меньшинстве", duel: "Один на один",
  fight: "Командная драка", dived: "Достали под своей вышкой", tower: "Вышка", creeps: "Крипы",
};
// смерть, которую человек мог не отдать: выбор был за ним, и это видно в цифрах
const AVOIDABLE = { blind_farm: 1, saw_coming: 1, low_hp: 1, dive_enemy_tower: 1, outnumbered: 1 };
const DOING = { c: "фармил", m: "шёл по карте", s: "стоял на месте", b: "был на базе", t: "телепортировался", f: "дрался в другом месте" };

function plural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
  return many;
}
function hash(s) {
  let h = 0;
  for (const ch of s) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return h;
}
export function clock(t) {
  const s = Math.trunc(Math.abs(t));
  return `${t < 0 ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
// «12 секунд», «1 мин 40 с»: в шаблонах стоит после «за», «через» или числом-длительностью
function dur(sec) {
  const n = Math.round(sec);
  if (n < 60) return `${n} ${plural(n, "секунду", "секунды", "секунд")}`;
  const m = Math.floor(n / 60), s = n % 60;
  return s ? `${m} мин ${s} с` : `${m} мин`;
}
function durShort(sec) {
  return sec < 10 ? `${String(Math.round(sec * 10) / 10).replace(".", ",")} с` : dur(sec);
}
function far(d) {
  const n = Math.round(d / 50) * 50;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function where(zone, side) {
  if (zone === "top") return "на верхней линии";
  if (zone === "bot") return "на нижней линии";
  if (zone === "mid") return "на миде";
  if (zone === "river") return "на реке";
  if (zone === "base") return side === "own" ? "на своей базе" : "на вражеской базе";
  return side === "enemy" ? "в чужом лесу" : "в своём лесу";
}
function list(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

export function deepView(report, slot, lib) {
  const p = report && report.players && report.players[slot];
  if (!p) return null;
  const texts = lib.texts || {};
  const hero = (id) => lib.heroName(id);
  const heroOf = (s) => hero(report.players[s].hero_id);
  const item = (key) => lib.itemName(key);
  const ability = (key) => (lib.abilityName ? lib.abilityName(key) : key);
  const say = (key, params = {}, seed = "") => {
    const variants = texts[`deep_${key}`];
    if (!variants || !variants.length) return "";
    const tpl = variants[hash(`${report.match_id}:${slot}:${key}:${seed}`) % variants.length];
    return tpl.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
  };
  const tip = (key, seed) => say(`${key}_tip`, {}, seed);
  const roleWords = { roles: ROLES_GEN[p.role], roles_nom: ROLES_NOM[p.role] };

  // --- смерти ---
  const deaths = p.deaths.map((d, i) => {
    const names = d.killers.map((k) => heroOf(k.slot));
    const w = where(d.zone, d.side);
    const base = { where: w, heroes: list(names), n: d.killers.length, hp: Math.round(d.hp0 * 100) };
    const lines = [];
    let tipKey = null;
    const top = d.killers[0];
    if (d.kind === "blind_farm") {
      lines.push(say("death_blind_farm", { ...base, missing: d.missing, ally: d.ally_dist === null ? "далеко" : far(d.ally_dist) }, i));
      tipKey = "death_blind_farm";
    } else if (d.kind === "gank" || d.kind === "smoke") {
      // сколько команда не видела главного по урону; показался за секунды до удара — «внезапный заход»
      const fog = top.fog;
      const key = d.kind === "smoke" ? "death_smoke" : fog >= 6 ? "death_gank" : "death_gank_sudden";
      lines.push(say(key, { ...base, hero: heroOf(top.slot), fog: fog >= 180 ? "больше трёх минут" : dur(fog) }, i));
      const last = d.killers.find((k) => k.last && d.t0 - k.last.t >= 8 && d.t0 - k.last.t <= 120);
      if (last) lines.push(say("death_gank_last", { hero: heroOf(last.slot), ago: dur(d.t0 - last.last.t), where: where(last.last.zone.z, last.last.zone.side) }, i));
      if (d.ward_watch && d.exposed >= 8) lines.push(say("death_gank_ward", { exposed: d.exposed }, i));
      tipKey = d.kind === "smoke" ? "death_smoke" : "death_gank";
    } else if (d.kind === "saw_coming") {
      const k = top;
      lines.push(say("death_saw_coming", { hero: heroOf(k.slot), sec: dur(k.seen), dist: far(k.seenDist) }, i));
      tipKey = "death_saw_coming";
    } else if (d.kind === "low_hp") {
      lines.push(say("death_low_hp", { ...base, sec: dur(d.low_for) }, i));
      tipKey = "death_low_hp";
    } else if (d.kind === "dive_enemy_tower") {
      lines.push(say("death_tower_dive", { tower: d.tower_dmg }, i));
      tipKey = "death_tower_dive";
    } else if (d.kind === "outnumbered") {
      lines.push(say("death_outnumbered", { ...base, allies: d.allies_near }, i));
      tipKey = "death_outnumbered";
    } else if (d.kind === "duel" && top) {
      // «один на один» только когда бил один герой; иначе это мелкая стычка
      lines.push(say(d.killers.length === 1 ? "death_duel" : "death_skirmish", { ...base, hero: heroOf(top.slot) }, i));
      const nw = top.nw - d.nw, lvl = top.lvl - d.lvl;
      if (nw >= 1000 && lvl >= 1) lines.push(say("death_duel_gap", { nw: far(nw), lvl }, i));
      if (nw >= 1000 || lvl >= 2) tipKey = "death_duel";
    } else if (d.kind === "dived") {
      lines.push(say("death_dived", { dist: far(d.own_tower) }, i));
    } else if (d.kind === "fight") {
      lines.push(say("death_fight", base, i));
      if (d.fight && d.fight.order >= 1) lines.push(say("death_fight_detail", { order: d.fight.order, sec: durShort(Math.max(0, d.fight.after)), dmg: far(d.fight.dmg) }, i));
    } else lines.push(say("death_creeps", {}, i));

    if (d.unused.length && d.kind !== "low_hp") {
      lines.push(say("death_unused_item", { items: list(d.unused.slice(0, 2).map(item)), free: durShort(d.free) }, i));
      if (!tipKey || d.kind === "fight" || d.kind === "duel") tipKey = "death_unused_item";
    }
    if (d.ult_unused && d.free >= 3) lines.push(say("death_unused_ult", { ability: ability(d.ult_unused), free: durShort(d.free) }, i));
    // выкуп на защите своей базы — вынужденный, за него не ругаем
    const wastedBuyback = d.after_buyback && d.zone !== "base";
    if (wastedBuyback) { lines.push(say("death_after_buyback", {}, i)); tipKey = "death_after_buyback"; }
    if (d.ward_watch && d.exposed >= 10 && d.kind !== "gank" && d.kind !== "smoke") {
      lines.push(say("death_ward_watch", { exposed: d.exposed }, i));
      if (!tipKey) tipKey = "death_ward_watch";
    }
    const avoidable = Boolean(AVOIDABLE[d.kind] || (d.unused.length && d.kind !== "low_hp") || wastedBuyback
      || ((d.kind === "gank" || d.kind === "smoke") && d.side !== "own" && d.missing >= 3 && d.allies_near === 0));
    const facts = [
      ["Здоровье в начале", `${Math.round(d.hp0 * 100)}%`],
      ["Замес длился", durShort(d.dur)],
      d.stun >= 0.5 && ["В контроле", durShort(d.stun)],
      ["Союзников рядом", String(d.allies_near)],
      ["Врагов не было на карте", `${d.missing} из 5`],
      ["На виду до этого", `${d.exposed} из 30 с`],
    ].filter(Boolean);
    return {
      t: d.t, clock: clock(d.t), kind: d.kind, title: d.kind === "duel" && d.killers.length > 1 ? "Стычка" : KIND_TITLE[d.kind] || "Смерть", lines: lines.filter(Boolean),
      tip: tipKey ? tip(tipKey, i) : "", avoidable, killers: d.killers.map((k) => report.players[k.slot].hero_id), facts,
      x: d.x, y: d.y,
    };
  });

  // --- драки ---
  const fights = p.fights.map((f, i) => {
    const result = f.won === null ? "even" : f.won ? "won" : "lost";
    const notes = [];
    let tipKey = null, heavy = false; // heavy: есть замечание весомее, чем «ульт остался ненажатым»
    const w = where(f.zone, "own");
    if (f.state === "absent") {
      if (f.won === false && f.allies_in >= 3 && f.t > 600) {
        let s = say("fight_absent", { where: w, dist: far(f.dist), doing: DOING[f.doing] || "был далеко" }, i);
        s += `. ${say(f.tp_ready ? "fight_absent_tp" : "fight_absent_notp", {}, i)}`;
        notes.push(s);
        tipKey = "fight_absent";
        heavy = true;
      }
    } else if (f.state === "in") {
      const squishy = p.role >= 4 || (p.role <= 2 && p.ranged);
      if (squishy && f.front_rank === 1 && f.front_of >= 3 && f.front_dist < 1300 && f.next_dist - f.front_dist > 250 && (f.died_at !== undefined || f.first_target)) {
        let s = say("fight_too_close", { dist: far(f.front_dist), next: far(f.next_dist), next_hero: heroOf(f.next_slot) }, i);
        if (f.died_at !== undefined) s += `. ${say("fight_too_close_died", { died: durShort(f.died_at) }, i)}`;
        notes.push(s);
        tipKey = "fight_too_close";
      }
      if (p.role === 3 && f.front_rank >= 3 && f.front_of >= 4 && f.won === false && f.front_dist >= 900 && f.front_dist <= 1800) {
        notes.push(say("fight_too_far", { rank: f.front_rank, of: f.front_of, dist: far(f.front_dist) }, i));
        tipKey = tipKey || "fight_too_far";
      }
      if (f.died_at !== undefined && f.died_at < 4 && f.casts === 0 && f.death_order === 1) {
        notes.push(say("fight_died_first", { sec: durShort(f.died_at) }, i));
        tipKey = tipKey || "fight_died_first";
      }
      if (f.late && f.won === false && f.late_dead >= 1) {
        notes.push(say("fight_late", { sec: dur(f.late), dead: f.late_dead }, i));
        tipKey = tipKey || "fight_late";
      }
      if (f.bkb_unused) { notes.push(say("fight_unused_bkb", {}, i)); tipKey = tipKey || "fight_unused_bkb"; }
      heavy = notes.length > 0;
      if (f.ult_unused && f.won === false && f.died_at !== undefined) {
        notes.push(say("fight_unused_ult", { ability: ability(f.ult_unused) }, i));
        tipKey = tipKey || "fight_unused_ult";
      }
    }
    return {
      t: f.t, clock: clock(f.t), result, state: f.state, score: `${f.dead[1]}:${f.dead[0]}`, total: f.dead[0] + f.dead[1], where: w,
      dmg: f.dmg || 0, dmg_share: f.dmg_share || 0, died: f.died_at !== undefined, heavy,
      notes: notes.filter(Boolean), tip: tipKey ? tip(tipKey, i) : "",
    };
  });

  // --- время ---
  const tm = p.time;
  const vs = p.vs || {};
  const pct = (v) => Math.round(v * 100);
  const bar = (key, label, v, norm, lowerIsBetter) => {
    const ref = vs[norm];
    const r = { key, label, pct: pct(v), ref: ref ? pct(ref.p50) : null, bad: false };
    if (ref) r.bad = lowerIsBetter ? ref.v > ref.p75 : ref.v < ref.p25;
    return r;
  };
  const total = tm.total || { farm: 0, fight: 0, move: 0, idle: 0, dead: 0, base: 0 };
  const time = {
    bars: [
      bar("farm", "Фарм", total.farm, "farm", false), bar("fight", "Драки", total.fight, "fight", false),
      bar("move", "В пути", total.move, "move", true), bar("idle", "Простой", total.idle, "idle", true),
      bar("dead", "Мёртв", total.dead, "dead", true), bar("base", "База", total.base, null, true),
    ],
    seen: { pct: pct(tm.seen_share), ref: vs.seen_share ? pct(vs.seen_share.p50) : null, bad: Boolean(vs.seen_share && vs.seen_share.v > vs.seen_share.p75) },
    alone: { pct: pct(tm.alone_share), ref: vs.alone_share ? pct(vs.alone_share.p50) : null },
    notes: [],
  };
  if (tm.idle_sec >= 150 && total.idle >= 0.04 && tm.idles[0]) {
    const longest = tm.idles[0];
    time.notes.push({ t: longest.t, sev: 1, text: say("time_idle", { sec: dur(tm.idle_sec), longest: dur(longest.dur) }), tip: tip("time_idle") });
  }
  tm.walks.forEach((wk, i) => time.notes.push({ t: wk.t, text: say("time_walk", { sec: dur(wk.dur) }, i), tip: i === 0 ? tip("time_walk") : "" }));
  const cmp = (id, key, extra = {}) => ({ t: null, text: say(id, { v: pct(vs[key].v), ref: pct(vs[key].p50), ...roleWords, ...extra }), tip: tip(id) });
  if (time.seen.bad) time.notes.push(cmp("vs_seen", "seen_share"));
  if (vs.idle && vs.idle.v > vs.idle.p75 && tm.idle_sec >= 60) time.notes.push(cmp("vs_idle", "idle"));
  if (vs.dead && vs.dead.v > vs.dead.p75) time.notes.push(cmp("vs_dead", "dead"));
  if (p.role <= 3 && vs.farm && vs.farm.v < vs.farm.p25) time.notes.push(cmp("vs_farm", "farm"));
  if (vs.fight_presence && vs.fight_presence.v < vs.fight_presence.p25) time.notes.push(cmp("vs_presence", "fight_presence"));

  // --- варды ---
  const vz = p.vision;
  const myWards = report.wards.filter((w) => w.slot === slot).map((w) => ({
    t: w.t, clock: clock(w.t), x: w.x, y: w.y, where: where(w.zone.z, w.zone.side), life: w.life, killed: w.killed,
    sightings: w.sightings, heroes: w.heroes, group: w.group,
  }));
  const vision = { placed: vz.placed, dewards: vz.dewards, sightings: vz.sightings, empty: vz.empty, wards: myWards, notes: [] };
  if (p.role >= 4 && vz.placed >= 3 && vz.empty >= Math.ceil(vz.placed / 2)) vision.notes.push({ text: say("ward_empty", { empty: vz.empty, placed: vz.placed }), tip: tip("vs_wards") });
  if (vz.killed_fast >= 2) vision.notes.push({ text: say("ward_killed_fast", { n: vz.killed_fast }), tip: tip("ward_killed_fast") });
  if (p.role >= 4 && vz.placed >= 3 && vs.ward_sightings && vs.ward_sightings.v < vs.ward_sightings.p25) {
    const one = (v) => String(Math.round(v * 10) / 10).replace(".", ",");
    vision.notes.push({ text: say("vs_wards", { v: one(vs.ward_sightings.v), ref: one(vs.ward_sightings.p50) }), tip: tip("vs_wards") });
  }

  // --- линия ---
  const L = p.lane;
  const lane = { lh10: L.lh10, dn10: L.dn10, deaths: L.deaths, dealt: L.dealt, taken: L.taken, foe: L.foe ? { hero_id: report.players[L.foe.slot].hero_id, lh10: L.foe.lh10, nw10: L.foe.nw10, lvl10: L.foe.lvl10 } : null, nw10: L.nw10, lvl10: L.lvl10, notes: [] };
  if (L.foe && p.role <= 3 && L.lh10 - L.foe.lh10 <= -15) lane.notes.push({ text: say("lane_lost_cs", { lh: L.lh10, foe: L.foe.lh10, hero: heroOf(L.foe.slot) }), tip: "" });
  if (L.low_hp_sec >= 60) lane.notes.push({ text: say("lane_low_hp", { sec: dur(L.low_hp_sec) }), tip: tip("death_low_hp", "lane") });

  // --- главное: до шести выводов, самые тяжёлые сверху, не больше двух одного вида ---
  const top = [];
  const seen = {};
  const push = (sev, t, text, tipText, kind) => {
    if (!text) return;
    seen[kind] = (seen[kind] || 0) + 1;
    if (seen[kind] > 2) return;
    top.push({ sev, t, clock: t === null || t === undefined ? "" : clock(t), text, tip: tipText, kind });
  };
  const SEV = { blind_farm: 3, saw_coming: 3, low_hp: 3, dive_enemy_tower: 2, outnumbered: 2, smoke: 2, gank: 2, duel: 1 };
  deaths.forEach((d) => {
    if (!d.avoidable && d.kind !== "gank" && d.kind !== "smoke") return;
    const sev = d.kind === "gank" && !d.avoidable ? 1 : Math.max(SEV[d.kind] || 1, d.avoidable && d.kind === "fight" ? 3 : 0);
    const text = d.kind === "fight" || d.kind === "duel" ? d.lines.slice(1).join(". ") || d.lines[0] : d.lines.join(". ");
    push(sev, d.t, text, d.tip, `death_${d.kind}`);
  });
  fights.forEach((f) => {
    if (!f.notes.length) return;
    // керри до 15-й минуты часто прав, что фармит, а не бежит на драку: это замечание, но не главное
    const early = f.state === "absent" && p.role === 1 && f.t < 900;
    push(!f.heavy ? 1 : early ? 2 : f.died || f.state === "absent" ? 3 : 2, f.t, f.notes.join(". "), f.tip, f.heavy ? `fight_${f.state}` : "fight_ult");
  });
  time.notes.forEach((n) => push(n.sev || 2, n.t, n.text, n.tip, "time"));
  vision.notes.forEach((n) => push(2, null, n.text, n.tip, "vision"));
  lane.notes.forEach((n) => push(1, null, n.text, n.tip, "lane"));
  top.sort((a, b) => b.sev - a.sev || (a.t === null ? 1e9 : a.t) - (b.t === null ? 1e9 : b.t));

  const avoid = deaths.filter((d) => d.avoidable).length;
  const head = deaths.length && avoid ? say("head_deaths", { avoid, total: deaths.length }) : top.length ? "" : say("head_clean");
  return {
    slot, hero_id: p.hero_id, role: p.role, role_name: ROLE_NAME[p.role], head, avoidable: avoid,
    norms: report.norms ? report.norms.matches : 0,
    top: top.slice(0, 6), deaths, fights, time, vision, lane,
  };
}

// Короткая выжимка для тренера и видеоразбора: строки «время — что случилось»
export function deepBrief(view, limit = 8) {
  if (!view) return [];
  return view.top.slice(0, limit).map((x) => `${x.clock ? `${x.clock} ` : ""}${x.text}`);
}
