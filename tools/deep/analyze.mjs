// Глубокий разбор, шаг 2: сырые данные реплея (tools/deep/extract) → факты по каждому игроку.
// Запуск: node tools/deep/analyze.mjs raw.json [norms.json] > d/<match_id>.json
// Здесь только счёт по правилам, без нейросетей. Всё, что уходит человеку, — числа из реплея:
// кто кого видел (туман войны из данных игры), расстояния, секунды, готовность кнопок.
// Тексты собирает tools/deep/render.mjs из docs/texts.json (ключи deep_*).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UNIT = 1.28; // координаты в сотых долях клетки, клетка — 128 игровых единиц
const NEAR = 1500; // «рядом» в драке
const SIGHT = 1600; // обзор варда
const HERO_PREFIX = "npc_dota_hero_";

// Кнопки, которыми можно было спастись. Пассивные (Аеон, Линка) сюда не идут: их нельзя «не нажать».
const SAVE_ITEMS = ["item_black_king_bar", "item_force_staff", "item_hurricane_pike", "item_glimmer_cape", "item_ghost",
  "item_cyclone", "item_wind_waker", "item_manta", "item_satanic", "item_lotus_orb", "item_ethereal_blade",
  "item_invis_sword", "item_silver_edge"];
const ALLY_SAVES = ["item_glimmer_cape", "item_force_staff", "item_hurricane_pike", "item_lotus_orb", "item_cyclone",
  "item_wind_waker", "item_ghost", "item_pavise", "item_solar_crest", "item_holy_locket", "item_mekansm", "item_guardian_greaves"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function analyze(raw, norms = null) {
  const g = new Game(raw);
  const fights = g.findFights();
  const wards = g.wardReport();
  const players = raw.players.map((p) => g.playerReport(p.slot, fights, wards));
  const out = {
    v: 1, match_id: raw.match_id || null, game_mode: raw.game_mode, start: raw.t0, end: raw.end,
    winner: raw.winner === 2 ? 0 : raw.winner === 3 ? 1 : null,
    players,
    fights: fights.map((f) => ({ t: f.t, t1: f.t1, x: f.x, y: f.y, zone: f.zone, deaths: f.deaths.map((d) => [d.t, d.slot]), dead: f.dead, won: f.won })),
    wards,
  };
  if (norms) applyNorms(out, norms);
  for (const p of out.players) p.findings = findings(p, out);
  return out;
}

class Game {
  constructor(raw) {
    this.raw = raw;
    this.t0 = raw.t0;
    this.end = raw.end;
    this.n = raw.tracks[0].x.length;
    this.players = raw.players;
    this.tracks = raw.tracks;
    this.slotByHero = new Map(raw.players.map((p) => [p.hero, p.slot]));
    this.team = raw.players.map((p) => p.team);
    this.towers = raw.buildings.filter((b) => /tower/.test(b.n));
    this.obs = raw.wards.filter((w) => w.k === "obs");
    this.indexLog();
    this.indexInventory();
    this.findFountains();
    this.roles = this.detectRoles();
    this.activity = raw.players.map((p) => this.classifyTime(p.slot));
  }

  // --- доступ к секундам ---
  i(t) { return clamp(Math.round(t) - this.t0, 0, this.n - 1); }
  pos(slot, t) { const k = this.i(t), tr = this.tracks[slot]; return [tr.x[k], tr.y[k]]; }
  alive(slot, t) { return this.tracks[slot].alive[this.i(t)] === 1; }
  seen(slot, t) { return this.tracks[slot].vis[this.i(t)] === 1; } // видит ли героя вражеская команда
  hpPct(slot, t) { const k = this.i(t), tr = this.tracks[slot]; return tr.mhp[k] ? tr.hp[k] / tr.mhp[k] : 0; }
  dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]) * UNIT; }
  between(slotA, slotB, t) { return this.dist(this.pos(slotA, t), this.pos(slotB, t)); }
  allies(slot) { return this.players.filter((p) => p.team === this.team[slot] && p.slot !== slot).map((p) => p.slot); }
  enemies(slot) { return this.players.filter((p) => p.team !== this.team[slot]).map((p) => p.slot); }
  teamSlots(team) { return this.players.filter((p) => p.team === team).map((p) => p.slot); }
  heroSlot(name) { const s = this.slotByHero.get(name); return s === undefined ? -1 : s; }

  indexLog() {
    const L = this.raw.log;
    this.heroDmg = []; // урон герой → герой
    this.dmgIn = this.players.map(() => []); // весь урон по герою
    this.deaths = [];
    this.casts = this.players.map(() => []);
    this.hits = this.players.map(() => []);
    this.mods = this.players.map(() => []);
    this.kills = []; // добивания крипов и построек героями
    this.wardKills = [];
    this.buybacks = [];
    for (const e of L) {
      if (e.k === "dmg") {
        const v = this.heroSlot(e.v);
        if (v < 0 || (e.f || "").includes("i")) continue;
        const s = this.heroSlot(e.s);
        const rec = { t: e.t, s, v, n: e.n, by: e.s, hp: e.hp || 0, i: e.i || "" };
        this.dmgIn[v].push(rec);
        if (s >= 0 && this.team[s] !== this.team[v]) this.heroDmg.push(rec);
      } else if (e.k === "death") {
        const f = e.f || "";
        const v = this.heroSlot(e.v);
        if (v >= 0 && f.includes("h") && !f.includes("i")) {
          if (!f.includes("a")) this.deaths.push({ t: e.t, slot: v, by: e.s, killer: this.heroSlot(e.s) });
        } else if (/^npc_dota_(observer|sentry)_wards/.test(e.v)) {
          this.wardKills.push({ t: e.t, s: this.heroSlot(e.s), obs: /observer/.test(e.v) });
        } else {
          const s = this.heroSlot(e.s);
          if (s >= 0) this.kills.push({ t: e.t, s, v: e.v });
        }
      } else if (e.k === "abil" || e.k === "item") {
        const s = this.heroSlot(e.a);
        if (s >= 0) this.casts[s].push({ t: e.t, n: e.i, item: e.k === "item", v: e.v });
      } else if (e.k === "hit") {
        const s = this.heroSlot(e.s);
        if (s >= 0) this.hits[s].push({ t: e.t, v: e.v });
      } else if (e.k === "mod" || e.k === "modoff") {
        const v = this.heroSlot(e.v);
        if (v >= 0) this.mods[v].push({ t: e.t, n: e.i, d: e.d || 0, f: e.f || "", off: e.k === "modoff", a: this.heroSlot(e.a) });
      } else if (e.k === "buyback" && typeof e.slot === "number") this.buybacks.push({ t: e.t, slot: e.slot });
    }
    // смерть без записи в журнале (редко) не придумываем: берём только журнал, но убираем дубль одной смерти
    this.deaths.sort((a, b) => a.t - b.t);
    this.deaths = this.deaths.filter((d, k, all) => !all.slice(0, k).some((p) => p.slot === d.slot && d.t - p.t < 3));
  }

  indexInventory() {
    // по каждой ячейке — список смен состояния; готовность на момент t ищем перебором назад
    this.inv = this.players.map(() => new Map());
    this.everCooldown = this.players.map(() => new Set());
    for (const e of this.raw.inv) {
      const cells = this.inv[e.slot];
      const key = `${e.k}${e.i}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(e);
      if (e.s === 0) this.everCooldown[e.slot].add(e.n);
    }
  }

  // состояние предмета или способности name у игрока на момент t: 1 готов, 0 на перезарядке, null нет
  state(slot, name, t) {
    let best = null;
    for (const list of this.inv[slot].values()) {
      let cur = null;
      for (const e of list) { if (e.t > t) break; cur = e; }
      if (cur && cur.n === name && cur.s !== -1) best = Math.max(best === null ? 0 : best, cur.s);
    }
    return best;
  }
  ult(slot, t) {
    const list = this.inv[slot].get("a5");
    if (!list) return null;
    let cur = null;
    for (const e of list) { if (e.t > t) break; cur = e; }
    if (!cur || cur.s === -1 || !this.everCooldown[slot].has(cur.n)) return null; // пассивный ульт нельзя «не нажать»
    return { name: cur.n, ready: cur.s === 1 };
  }
  used(slot, name, a, b) { return this.casts[slot].some((c) => c.n === name && c.t >= a - 0.2 && c.t <= b + 0.2); }

  findFountains() {
    this.fountain = {};
    for (const team of [2, 3]) {
      const pts = this.teamSlots(team).map((s) => [this.tracks[s].x[0], this.tracks[s].y[0]]).filter((p) => p[0] > 0);
      const guess = team === 2 ? [7200, 7400] : [18400, 18200];
      const ok = pts.filter((p) => this.dist(p, guess) < 2500);
      this.fountain[team] = ok.length ? [mean(ok.map((p) => p[0])), mean(ok.map((p) => p[1]))] : guess;
    }
  }

  // --- где это на карте ---
  zone(p, team) {
    const x = p[0] / 100, y = p[1] / 100;
    const mine = team === 2 ? x + y < 256 : x + y > 256;
    if (x < 96 && y < 96) return { z: "base", side: team === 2 ? "own" : "enemy" };
    if (x > 160 && y > 160) return { z: "base", side: team === 3 ? "own" : "enemy" };
    let z;
    if (Math.abs(x + y - 256) < 11 && Math.abs(x - y) > 12) z = "river";
    else if (Math.abs(x - y) < 11) z = "mid";
    else if (x < 88 || y > 168) z = "top";
    else if (x > 168 || y < 88) z = "bot";
    else z = "jungle";
    return { z, side: z === "river" ? "river" : mine ? "own" : "enemy" };
  }
  towerNear(p, team, t, own) {
    let best = null;
    for (const b of this.towers) {
      if ((b.team === team) !== own) continue;
      if (b.t1 > 0 && b.t1 <= t) continue;
      const d = this.dist(p, [b.x, b.y]);
      if (!best || d < best.d) best = { d, n: b.n };
    }
    return best;
  }

  // --- роли: линия по первым минутам, кор или саппорт по добитым ---
  detectRoles() {
    const roles = new Array(this.players.length).fill(0);
    const a = this.i(60), b = this.i(Math.min(420, this.end - 60));
    const at = this.i(Math.min(480, this.end - 30));
    for (const team of [2, 3]) {
      const slots = this.teamSlots(team);
      const lane = {};
      for (const s of slots) {
        const tr = this.tracks[s];
        const c = { top: 0, mid: 0, bot: 0, jungle: 0 };
        for (let k = a; k <= b; k += 5) {
          if (!tr.alive[k]) continue;
          const z = this.zone([tr.x[k], tr.y[k]], team).z;
          if (z in c) c[z] += 1;
        }
        lane[s] = Object.entries(c).sort((p, q) => q[1] - p[1])[0][0];
      }
      const safe = team === 2 ? "bot" : "top", off = team === 2 ? "top" : "bot";
      const farm = (s) => this.tracks[s].lh[at] * 40 + this.tracks[s].nw[at];
      const left = new Set(slots);
      const take = (pos, pool) => {
        const c = pool.filter((s) => left.has(s)).sort((p, q) => farm(q) - farm(p))[0];
        if (c !== undefined) { roles[c] = pos; left.delete(c); }
      };
      take(2, slots.filter((s) => lane[s] === "mid"));
      take(1, slots.filter((s) => lane[s] === safe));
      take(3, slots.filter((s) => lane[s] === off));
      // кому линия не досталась по месту — по фарму
      for (const pos of [1, 2, 3]) if (!roles.some((r, s) => r === pos && this.team[s] === team)) take(pos, [...left]);
      const rest = [...left].sort((p, q) => farm(q) - farm(p));
      rest.forEach((s, k) => { roles[s] = k === 0 && rest.length > 1 ? 4 : 5; });
      if (rest.length === 2) {
        // четвёрка стоит с оффлейнером, пятёрка — с керри
        const [p, q] = rest;
        if (lane[p] === safe && lane[q] !== safe) { roles[p] = 5; roles[q] = 4; }
      }
      this.lane = { ...(this.lane || {}), ...lane };
    }
    return roles;
  }

  // --- чем занята каждая секунда ---
  // d мёртв, b база, f драка с героями, c фарм (крипы, лес, постройки), t телепорт, m идёт, s стоит без дела
  classifyTime(slot) {
    const n = this.n, tr = this.tracks[slot];
    const act = new Array(n).fill("");
    const mark = (list, code, pad) => {
      for (const e of list) {
        const a = clamp(Math.floor(e.t) - pad - this.t0, 0, n - 1), b = clamp(Math.ceil(e.t) + pad - this.t0, 0, n - 1);
        for (let k = a; k <= b; k++) if (!act[k] || code === "f") act[k] = code;
      }
    };
    mark(this.hits[slot].filter((h) => !/ward|courier/.test(h.v)), "c", 3);
    mark(this.kills.filter((k) => k.s === slot), "c", 3);
    mark(this.heroDmg.filter((d) => d.s === slot || d.v === slot), "f", 3);
    const tp = this.mods[slot].filter((m) => m.n === "modifier_teleporting" && !m.off);
    for (const m of tp) {
      const a = clamp(Math.floor(m.t) - this.t0, 0, n - 1), b = clamp(Math.ceil(m.t + (m.d || 3)) - this.t0, 0, n - 1);
      for (let k = a; k <= b; k++) if (!act[k]) act[k] = "t";
    }
    const base = this.fountain[this.team[slot]];
    for (let k = 0; k < n; k++) {
      if (!tr.alive[k]) { act[k] = "d"; continue; }
      if (act[k] === "f") continue;
      if (this.dist([tr.x[k], tr.y[k]], base) < 1700) { act[k] = "b"; continue; }
      if (act[k]) continue;
      const j = Math.max(0, k - 2);
      act[k] = this.dist([tr.x[k], tr.y[k]], [tr.x[j], tr.y[j]]) > 150 ? "m" : "s";
    }
    return act;
  }

  // --- драки ---
  findFights() {
    const ev = this.heroDmg;
    const clusters = [];
    let cur = null;
    for (const e of ev) {
      if (cur && e.t - cur.t1 <= 5) { cur.t1 = e.t; cur.ev.push(e); } else { cur = { t: e.t, t1: e.t, ev: [e] }; clusters.push(cur); }
    }
    const fights = [];
    for (const c of clusters) {
      // одна длинная цепочка урона может быть двумя стычками в разных концах карты: режем по месту
      for (const part of this.splitByPlace(c)) {
        const f = this.describeFight(part);
        if (f) fights.push(f);
      }
    }
    return fights;
  }
  splitByPlace(c) {
    const groups = [];
    for (const e of c.ev) {
      const p = this.pos(e.v, e.t);
      let g = groups.find((q) => this.dist(q.c, p) < 2600 && e.t - q.t1 <= 5);
      if (!g) { g = { t: e.t, t1: e.t, ev: [], c: p, pts: [] }; groups.push(g); }
      g.ev.push(e); g.t1 = e.t; g.pts.push(p);
      g.c = [mean(g.pts.map((q) => q[0])), mean(g.pts.map((q) => q[1]))];
    }
    return groups;
  }
  describeFight(c) {
    let deaths = this.deaths.filter((d) => d.t >= c.t - 0.5 && d.t <= c.t1 + 4 && this.dist(this.pos(d.slot, d.t - 1), c.c) < 3000);
    // долгая перестрелка на линии перед убийством — не драка: берём последние 20 с до первой смерти
    let ev = c.ev;
    if (deaths.length && deaths[0].t - c.t > 20) ev = ev.filter((e) => e.t >= deaths[0].t - 20);
    if (!ev.length) return null;
    const t = ev[0].t, t1 = ev[ev.length - 1].t;
    deaths = deaths.filter((d) => d.t >= t - 0.5);
    const involved = new Set();
    for (const e of ev) { involved.add(e.s); involved.add(e.v); }
    const sides = { 2: 0, 3: 0 };
    for (const s of involved) sides[this.team[s]] += 1;
    const pool = mean([...involved].map((s) => this.tracks[s].mhp[this.i(t)] || 0));
    const heavy = sum(ev.map((e) => e.n)) >= pool * 1.2;
    const big = involved.size >= 5 && sides[2] >= 2 && sides[3] >= 2 && t1 - t >= 3 && (deaths.length >= 1 || heavy);
    if (!big && deaths.length < 3) return null;
    const dead = { 2: deaths.filter((d) => this.team[d.slot] === 2).length, 3: deaths.filter((d) => this.team[d.slot] === 3).length };
    const z = this.zone(c.c, 2);
    return {
      t: round(t, 1), t1: round(t1, 1), x: Math.round(c.c[0]), y: Math.round(c.c[1]), zone: z.z, c: c.c, ev,
      involved, sides, deaths, dead: [dead[2], dead[3]], won: dead[2] < dead[3] ? 0 : dead[3] < dead[2] ? 1 : null,
    };
  }

  // --- смерти ---
  deathReport(d, fights) {
    const v = d.slot, T = d.t, team = this.team[v];
    const enemyTeam = 5 - team;
    const inc = this.dmgIn[v].filter((e) => e.t <= T + 0.1 && e.t >= T - 30);
    // начало замеса: цепочка вражеского урона без пауз длиннее 5 с
    let Ts = T;
    for (let k = inc.length - 1; k >= 0; k--) {
      const e = inc[k];
      if (e.s < 0 && !/tower|fort/.test(e.by)) continue;
      if (Ts - e.t > 5) break;
      Ts = e.t;
    }
    const win = inc.filter((e) => e.t >= Ts - 0.01);
    const byHero = new Map();
    let towerDmg = 0, creepDmg = 0;
    for (const e of win) {
      if (e.s >= 0 && this.team[e.s] !== team) byHero.set(e.s, (byHero.get(e.s) || 0) + e.n);
      else if (/tower|fort/.test(e.by)) towerDmg += e.n;
      else if (e.s < 0) creepDmg += e.n;
    }
    for (const m of this.mods[v]) if (!m.off && m.f && m.t >= Ts - 1 && m.t <= T && m.a >= 0 && this.team[m.a] !== team && !byHero.has(m.a)) byHero.set(m.a, 0);
    const killers = [...byHero.entries()].sort((a, b) => b[1] - a[1]).map(([slot, dmg]) => ({ slot, dmg }));
    const tsI = Math.floor(Ts);
    const at = this.pos(v, tsI - 1);
    const where = this.zone(at, team);

    // что знала команда про каждого убийцу до первого удара
    for (const k of killers) {
      const vis = this.tracks[k.slot].vis;
      let fog = 0;
      while (fog < 180 && !vis[this.i(tsI - 1 - fog)]) fog++;
      k.fog = fog; // секунд подряд не было видно перед ударом
      if (fog === 0) {
        let seenFor = 0;
        while (seenFor < 30 && vis[this.i(tsI - 1 - seenFor)]) seenFor++;
        k.seen = seenFor; // секунд подряд был на виду
        k.seenDist = Math.round(this.between(k.slot, v, tsI - seenFor));
      } else if (fog < 180 && this.alive(k.slot, tsI - 1 - fog)) {
        const lastT = tsI - 1 - fog;
        const lp = this.pos(k.slot, lastT);
        k.last = { t: lastT, zone: this.zone(lp, team), dist: Math.round(this.dist(lp, at)) };
      }
      k.smoke = this.mods[k.slot].some((m) => m.n === "modifier_smoke_of_deceit" && !m.off && m.t >= Ts - 45 && m.t <= Ts);
      k.dmg = Math.round(k.dmg);
      k.nw = this.tracks[k.slot].nw[this.i(tsI)];
      k.lvl = this.tracks[k.slot].lvl[this.i(tsI)];
    }
    // сколько врагов вообще не было на карте за 3 с до замеса
    const missing = this.enemies(v).filter((s) => {
      if (!this.alive(s, tsI - 3)) return false;
      for (let q = 0; q < 8; q++) if (this.tracks[s].vis[this.i(tsI - 3 - q)]) return false;
      return true;
    });
    const alliesAt = this.allies(v).filter((s) => this.alive(s, tsI - 1));
    const allyDist = alliesAt.map((s) => this.between(s, v, tsI - 1)).sort((a, b) => a - b);
    const enemiesNearEnd = this.enemies(v).filter((s) => this.alive(s, T - 1) && this.between(s, v, T - 1) < NEAR).length;
    const alliesNearEnd = this.allies(v).filter((s) => this.alive(s, T - 1) && this.between(s, v, T - 1) < NEAR).length;

    // на виду у врага перед смертью и чем светили
    let exposed = 0;
    for (let q = 1; q <= 30; q++) if (this.tracks[v].vis[this.i(tsI - q)]) exposed++;
    const wardNear = this.obs.find((w) => w.team === enemyTeam && w.t <= Ts - 2 && w.t1 >= Ts && this.dist([w.x, w.y], at) < SIGHT);
    const heroNear = this.enemies(v).some((s) => this.alive(s, tsI - 4) && this.between(s, v, tsI - 4) < 1800);

    // здоровье: с чем вошёл и сколько до этого ходил побитым
    const hp0 = this.hpPct(v, tsI - 1);
    let lowFor = 0;
    while (lowFor < 120 && this.alive(v, tsI - 1 - lowFor) && this.hpPct(v, tsI - 1 - lowFor) < 0.4 && this.activity[v][this.i(tsI - 1 - lowFor)] !== "b") lowFor++;

    // кнопки: что было готово и не нажато, сколько секунд был в контроле
    let stun = 0;
    for (const m of this.mods[v]) if (!m.off && m.f.includes("s") && m.t >= Ts - 0.5 && m.t <= T) stun += Math.min(m.d, T - m.t);
    const free = Math.max(0, T - Ts - stun);
    const unused = free >= 2
      ? SAVE_ITEMS.filter((n) => this.state(v, n, Ts) === 1 && !this.used(v, n, Ts, T)).map((n) => n.slice(5))
      : [];
    const allySaves = [];
    for (const s of alliesAt) {
      if (this.between(s, v, tsI) > 1100) continue;
      for (const n of ALLY_SAVES) if (this.state(s, n, Ts) === 1 && !this.used(s, n, Ts, T) && T - Ts >= 1.5) allySaves.push({ slot: s, item: n.slice(5) });
    }
    const ult = this.ult(v, Ts);
    const ultUnused = Boolean(ult && ult.ready && free >= 1.5 && !this.used(v, ult.name, Ts - 1, T));
    const casts = this.casts[v].filter((c) => c.t >= Ts - 1 && c.t <= T).length;

    const ownTower = this.towerNear(at, team, T, true);
    const enemyTower = this.towerNear(this.pos(v, T - 1), team, T, false);
    const fight = fights.find((f) => T >= f.t - 1 && T <= f.t1 + 4 && f.sides[2] >= 3 && f.sides[3] >= 3 && f.deaths.some((q) => q.slot === v && Math.abs(q.t - T) < 0.5));
    const tpReady = this.state(v, "item_tpscroll", Ts) === 1;
    const prevDeath = this.deaths.filter((q) => q.slot === v && q.t < T).pop();
    const bb = this.buybacks.find((b) => b.slot === v && b.t < T && T - b.t < 60 && (!prevDeath || b.t > prevDeath.t));

    const r = {
      t: round(T, 1), t0: round(Ts, 1), dur: round(T - Ts, 1), x: at[0], y: at[1], zone: where.z, side: where.side,
      hp0: round(hp0, 2), low_for: lowFor,
      killers, missing: missing.length, tower_dmg: Math.round(towerDmg), creep_dmg: Math.round(creepDmg),
      allies_near: allyDist.filter((x) => x < NEAR).length, ally_dist: allyDist.length ? Math.round(allyDist[0]) : null,
      allies_alive: alliesAt.length, enemies_end: enemiesNearEnd, allies_end: alliesNearEnd,
      exposed, ward_watch: Boolean(wardNear && !heroNear),
      stun: round(stun, 1), free: round(free, 1), unused, ally_saves: allySaves, ult_unused: ultUnused ? ult.name : null, casts,
      own_tower: ownTower ? Math.round(ownTower.d) : null, enemy_tower: enemyTower ? Math.round(enemyTower.d) : null,
      in_fight: Boolean(fight), tp_ready: tpReady, after_buyback: Boolean(bb),
      nw: this.tracks[v].nw[this.i(tsI)], lvl: this.tracks[v].lvl[this.i(tsI)],
    };
    r.kind = this.deathKind(r);
    return r;
  }

  // главная причина смерти: одна, по убыванию «сам виноват и это видно в цифрах»
  deathKind(r) {
    const k = r.killers;
    if (!k.length) return r.tower_dmg > 0 ? "tower" : "creeps";
    const fogAll = k.every((q) => q.fog >= 3);
    const outnumber = k.length - (1 + r.allies_near);
    if (r.enemy_tower !== null && r.enemy_tower < 900 && r.tower_dmg > 0 && !r.in_fight) return "dive_enemy_tower";
    if (r.low_for >= 10 && r.hp0 < 0.4) return "low_hp";
    if (r.in_fight && r.allies_near >= 2) return "fight";
    if (fogAll && k.some((q) => q.smoke)) return "smoke";
    if (fogAll && r.side !== "own" && r.missing >= 3 && (r.ally_dist === null || r.ally_dist > 2000)) return "blind_farm";
    if (fogAll) return "gank";
    if (k.some((q) => q.seen >= 4 && q.seenDist > 1000)) return "saw_coming";
    if (outnumber >= 2) return "outnumbered";
    if (r.own_tower !== null && r.own_tower < 800) return "dived";
    return "duel";
  }

  // --- участие в драках ---
  fightReport(slot, f) {
    const team = this.team[slot];
    const t = Math.floor(f.t);
    const aliveAtStart = this.alive(slot, t - 1);
    const dStart = this.dist(this.pos(slot, t - 1), f.c);
    const myDeaths = f.deaths.filter((d) => d.slot === slot);
    const involved = f.involved.has(slot);
    let arrived = null;
    for (let q = t - 1; q <= Math.ceil(f.t1); q++) {
      if (this.alive(slot, q) && this.dist(this.pos(slot, q), f.c) < 1800) { arrived = q; break; }
    }
    const present = involved || arrived !== null;
    const won = f.won === null ? null : (f.won === 0) === (team === 2);
    const r = { t: f.t, t1: f.t1, zone: f.zone, present, won, dead: team === 2 ? f.dead : [f.dead[1], f.dead[0]] };
    if (!aliveAtStart && !present) { r.state = "dead"; return r; }
    if (!present) {
      const a = this.activity[slot][this.i(t)];
      r.state = "absent";
      r.dist = Math.round(dStart);
      r.doing = a;
      r.tp_ready = this.state(slot, "item_tpscroll", f.t) === 1;
      r.allies_in = this.allies(slot).filter((s) => f.involved.has(s)).length;
      return r;
    }
    r.state = "in";
    r.late = arrived !== null && arrived >= t + 6 && dStart > 2500 ? arrived - t : 0;
    if (r.late) r.late_dead = f.deaths.filter((d) => this.team[d.slot] === team && d.t < arrived).length;
    // кто из команды стоял ближе всех к врагам за секунду до начала
    const foes = this.enemies(slot).filter((s) => f.involved.has(s) && this.alive(s, t - 1));
    const mates = [slot, ...this.allies(slot)].filter((s) => this.alive(s, t - 1) && this.dist(this.pos(s, t - 1), f.c) < 2200);
    if (foes.length && mates.length > 1 && mates.includes(slot)) {
      const fc = [mean(foes.map((s) => this.pos(s, t - 1)[0])), mean(foes.map((s) => this.pos(s, t - 1)[1]))];
      const order = mates.map((s) => ({ s, d: this.dist(this.pos(s, t - 1), fc) })).sort((a, b) => a.d - b.d);
      r.front_rank = order.findIndex((o) => o.s === slot) + 1;
      r.front_of = order.length;
      r.front_dist = Math.round(order.find((o) => o.s === slot).d);
      const next = order.find((o) => o.s !== slot);
      r.next_dist = Math.round(next.d);
      r.next_slot = next.s;
    }
    const first = f.ev.find((e) => this.team[e.v] === team);
    r.first_target = Boolean(first && first.v === slot);
    const mine = f.ev.filter((e) => e.s === slot);
    const teamDmg = sum(f.ev.filter((e) => this.team[e.s] === team).map((e) => e.n));
    r.dmg = Math.round(sum(mine.map((e) => e.n)));
    r.dmg_share = teamDmg ? round(r.dmg / teamDmg, 2) : 0;
    r.taken = Math.round(sum(f.ev.filter((e) => e.v === slot).map((e) => e.n)));
    const endMine = myDeaths.length ? myDeaths[0].t : f.t1;
    r.casts = this.casts[slot].filter((c) => c.t >= f.t - 2 && c.t <= endMine + 0.5).length;
    if (myDeaths.length) {
      r.died_at = round(myDeaths[0].t - f.t, 1);
      r.death_order = f.deaths.filter((d) => this.team[d.slot] === team && d.t < myDeaths[0].t).length + 1;
    }
    const ult = this.ult(slot, f.t);
    const lived = endMine - f.t;
    if (ult && ult.ready && lived >= 4 && !this.used(slot, ult.name, f.t - 2, endMine + 0.5)) r.ult_unused = ult.name;
    const bkb = this.state(slot, "item_black_king_bar", f.t) === 1 && !this.used(slot, "item_black_king_bar", f.t - 1, endMine + 0.5);
    if (bkb && myDeaths.length) r.bkb_unused = true;
    r.hp0 = round(this.hpPct(slot, t - 1), 2);
    return r;
  }

  // --- время ---
  timeReport(slot) {
    const act = this.activity[slot];
    const from = this.i(0);
    const phases = [[0, 600], [600, 1500], [1500, Infinity]];
    const count = (a, b) => {
      const c = { d: 0, b: 0, f: 0, c: 0, t: 0, m: 0, s: 0, n: 0 };
      for (let k = Math.max(from, this.i(a)); k < this.n && k + this.t0 < b; k++) { c[act[k]] += 1; c.n += 1; }
      return c;
    };
    const total = count(0, Infinity);
    const share = (c) => (c.n ? { dead: round(c.d / c.n, 3), base: round(c.b / c.n, 3), fight: round(c.f / c.n, 3), farm: round(c.c / c.n, 3),
      move: round((c.m + c.t) / c.n, 3), idle: round(c.s / c.n, 3) } : null);
    // долгие простои: стоял на месте живой, не на базе, никого не бил
    const idles = [];
    let run = 0;
    for (let k = from; k <= this.n; k++) {
      if (k < this.n && act[k] === "s") { run++; continue; }
      if (run >= 12) {
        const t = k - run + this.t0;
        const p = this.pos(slot, t);
        idles.push({ t, dur: run, zone: this.zone(p, this.team[slot]).z });
      }
      run = 0;
    }
    // пешком с базы с готовым телепортом: вышел с фонтана и шёл дольше 35 с, не дравшись и не фармя
    const walks = [];
    for (let k = from + 1; k < this.n; k++) {
      if (act[k - 1] !== "b" || act[k] === "b" || act[k] === "d") continue;
      let q = k;
      while (q < this.n && (act[q] === "m" || act[q] === "s")) q++;
      const dur = q - k, t = k + this.t0;
      if (dur >= 35 && t > 300 && this.state(slot, "item_tpscroll", t) === 1 && !this.casts[slot].some((c) => c.n === "item_tpscroll" && c.t >= t - 5 && c.t <= t + dur)) {
        walks.push({ t, dur, dist: Math.round(this.dist(this.pos(slot, t), this.pos(slot, t + dur))) });
      }
      k = q;
    }
    // на виду у врага: доля живого времени вне базы
    let out = 0, vis = 0;
    for (let k = from; k < this.n; k++) {
      if (act[k] === "d" || act[k] === "b") continue;
      out++;
      if (this.tracks[slot].vis[k]) vis++;
    }
    // вдали от своих: ближайший союзник дальше 2500
    let alone = 0, aloneEnemy = 0;
    for (let k = from; k < this.n; k += 2) {
      if (act[k] === "d" || act[k] === "b") continue;
      const t = k + this.t0;
      const near = this.allies(slot).some((s) => this.tracks[s].alive[k] && this.between(s, slot, t) < 2500);
      if (!near) { alone += 2; if (this.zone(this.pos(slot, t), this.team[slot]).side === "enemy") aloneEnemy += 2; }
    }
    return {
      total: share(total), phases: phases.map(([a, b]) => share(count(a, b))),
      idle_sec: total.s, idles: idles.sort((a, b) => b.dur - a.dur).slice(0, 5), walks: walks.slice(0, 5),
      seen_share: out ? round(vis / out, 3) : 0, alone_share: out ? round(alone / out, 3) : 0,
      alone_enemy_sec: aloneEnemy,
    };
  }

  // --- варды ---
  wardReport() {
    const res = [];
    for (const w of this.raw.wards) {
      if (w.k !== "obs" || w.team < 2) continue;
      const foes = this.teamSlots(5 - w.team), mates = this.teamSlots(w.team);
      const wp = [w.x, w.y];
      const ownTowers = this.towers.filter((b) => b.team === w.team);
      const seenSec = new Map();
      let sightings = 0, lastSeen = -100, groupMax = 0;
      for (let t = Math.ceil(w.t) + 1; t < Math.floor(w.t1); t++) {
        let now = 0;
        for (const s of foes) {
          if (!this.alive(s, t) || !this.seen(s, t)) continue;
          const p = this.pos(s, t);
          if (this.dist(p, wp) > SIGHT - 100) continue;
          // врага и так видел кто-то из своих или вышка — это не заслуга варда
          if (mates.some((m) => this.alive(m, t) && this.dist(this.pos(m, t), p) < 1500)) continue;
          if (ownTowers.some((b) => (b.t1 === 0 || b.t1 > t) && this.dist([b.x, b.y], p) < 1700)) continue;
          if (this.creepNear(w.team, p, t, 900)) continue;
          seenSec.set(s, (seenSec.get(s) || 0) + 1);
          now++;
        }
        if (now) { if (t - lastSeen > 10) sightings++; lastSeen = t; groupMax = Math.max(groupMax, now); }
      }
      const life = w.t1 - w.t;
      res.push({
        t: Math.round(w.t), life: Math.round(life), slot: w.slot, team: w.team === 2 ? 0 : 1, x: w.x, y: w.y,
        zone: this.zone(wp, w.team), killed: life < 355 && w.t1 < this.end - 5,
        sec: sum([...seenSec.values()]), heroes: seenSec.size, sightings, group: groupMax,
      });
    }
    return res;
  }
  creepNear(team, p, t, r) {
    const frames = this.raw.creeps;
    if (!frames.length) return false;
    const step = frames.length > 1 ? frames[1].t - frames[0].t : 5;
    const f = frames[clamp(Math.round((t - frames[0].t) / step), 0, frames.length - 1)];
    const xs = team === 2 ? f.l : f.d;
    for (let k = 0; k < xs.length; k += 2) if (this.dist([xs[k], xs[k + 1]], p) < r) return true;
    return false;
  }

  // --- линия: первые 10 минут против того, кто стоял напротив ---
  laneReport(slot) {
    const at = (t) => this.i(Math.min(t, this.end - 5));
    const tr = this.tracks[slot];
    const lane = this.lane[slot];
    const role = this.roles[slot];
    const end = Math.min(600, this.end - 5);
    const foe = this.enemies(slot).filter((s) => this.lane[s] === lane && lane !== "jungle")
      .sort((a, b) => this.tracks[b].lh[at(end)] - this.tracks[a].lh[at(end)])[0];
    const dealt = sum(this.heroDmg.filter((e) => e.s === slot && e.t < end).map((e) => e.n));
    const taken = sum(this.heroDmg.filter((e) => e.v === slot && e.t < end).map((e) => e.n));
    const act = this.activity[slot];
    let trips = 0, lowSec = 0;
    for (let k = this.i(30); k < at(end); k++) {
      if (act[k] === "b" && act[k - 1] !== "b" && act[k - 1] !== "d") trips++;
      if (tr.alive[k] && act[k] !== "b" && tr.mhp[k] && tr.hp[k] / tr.mhp[k] < 0.35) lowSec++;
    }
    const r = {
      lane, role, lh5: tr.lh[at(300)], lh10: tr.lh[at(end)], dn10: tr.dn[at(end)], nw10: tr.nw[at(end)], lvl10: tr.lvl[at(end)],
      deaths: this.deaths.filter((d) => d.slot === slot && d.t < end).length,
      dealt: Math.round(dealt), taken: Math.round(taken), base_trips: trips, low_hp_sec: lowSec,
    };
    if (foe !== undefined) {
      const ft = this.tracks[foe];
      r.foe = { slot: foe, lh5: ft.lh[at(300)], lh10: ft.lh[at(end)], dn10: ft.dn[at(end)], nw10: ft.nw[at(end)], lvl10: ft.lvl[at(end)] };
    }
    return r;
  }

  playerReport(slot, fights, wards) {
    const p = this.players[slot];
    const deaths = this.deaths.filter((d) => d.slot === slot).map((d) => this.deathReport(d, fights));
    const fr = fights.map((f) => this.fightReport(slot, f));
    const myWards = wards.filter((w) => w.slot === slot);
    const teamWards = wards.filter((w) => w.team === (p.team === 2 ? 0 : 1));
    const dewards = this.wardKills.filter((k) => k.s === slot && k.obs).length;
    const last = this.n - 1;
    return {
      slot, team: p.team === 2 ? 0 : 1, hero_id: p.hero_id, hero: p.hero.slice(HERO_PREFIX.length), ranged: p.ranged, role: this.roles[slot],
      nw: this.tracks[slot].nw[last], lvl: this.tracks[slot].lvl[last],
      deaths, fights: fr, time: this.timeReport(slot), lane: this.laneReport(slot),
      vision: {
        placed: myWards.length, dewards,
        empty: myWards.filter((w) => w.sightings === 0 && w.life >= 120).length,
        killed_fast: myWards.filter((w) => w.killed && w.life < 90).length,
        sightings: sum(myWards.map((w) => w.sightings)),
        team_placed: teamWards.length, team_sightings: sum(teamWards.map((w) => w.sightings)),
      },
    };
  }
}

// --- сравнение с высоким рангом ---
// norms: { roles: { "1": { метрика: [p25, p50, p75] } }, matches }
export function metrics(p) {
  const fightsIn = p.fights.filter((f) => f.state === "in");
  const fightsAll = p.fights.filter((f) => f.state !== "dead");
  const d = p.deaths;
  const share = (kinds) => (d.length ? d.filter((x) => kinds.includes(x.kind)).length / d.length : 0);
  return {
    seen_share: p.time.seen_share,
    alone_share: p.time.alone_share,
    idle: p.time.total ? p.time.total.idle : 0,
    farm: p.time.total ? p.time.total.farm : 0,
    fight: p.time.total ? p.time.total.fight : 0,
    dead: p.time.total ? p.time.total.dead : 0,
    move: p.time.total ? p.time.total.move : 0,
    fight_presence: fightsAll.length ? fightsIn.length / fightsAll.length : 1,
    front_dist: fightsIn.length ? mean(fightsIn.filter((f) => f.front_dist).map((f) => f.front_dist)) : 0,
    blind_deaths: share(["gank", "blind_farm", "smoke"]),
    ward_sightings: p.vision.placed ? p.vision.sightings / p.vision.placed : 0,
  };
}

function applyNorms(out, norms) {
  out.norms = { matches: norms.matches || 0 };
  for (const p of out.players) {
    const ref = norms.roles && norms.roles[p.role];
    if (!ref) continue;
    const m = metrics(p);
    p.vs = {};
    for (const [k, v] of Object.entries(m)) if (ref[k]) p.vs[k] = { v: round(v, 3), p25: ref[k][0], p50: ref[k][1], p75: ref[k][2] };
  }
}

// --- выводы: что именно сказать человеку, по убыванию важности ---
// Каждый вывод: { id, sev 1..3, t (секунда или null), ...числа }. Текст — в render.mjs.
function findings(p, out) {
  const res = [];
  const add = (id, sev, t, data = {}) => res.push({ id, sev, t: t === null ? null : Math.round(t), ...data });
  const hero = (slot) => out.players[slot].hero_id;

  for (const d of p.deaths) {
    const top = d.killers[0];
    const base = { n: d.killers.length, hp: Math.round(d.hp0 * 100), zone: d.zone, side: d.side };
    if (d.kind === "blind_farm") add("death_blind_farm", 3, d.t, { ...base, missing: d.missing, ally: d.ally_dist, heroes: d.killers.map((k) => hero(k.slot)) });
    else if (d.kind === "gank" || d.kind === "smoke") {
      const fog = Math.min(...d.killers.map((k) => k.fog));
      const last = d.killers.find((k) => k.last);
      add(d.kind === "smoke" ? "death_smoke" : "death_gank", d.side === "own" && d.kind === "gank" ? 1 : 2, d.t, { ...base, fog, missing: d.missing,
        heroes: d.killers.map((k) => hero(k.slot)), ward: d.ward_watch, exposed: d.exposed,
        last: last ? { hero: hero(last.slot), ago: Math.round(d.t0 - last.last.t), zone: last.last.zone.z, side: last.last.zone.side } : null });
    } else if (d.kind === "saw_coming") {
      const k = d.killers.filter((q) => q.seen >= 4).sort((a, b) => b.seen - a.seen)[0];
      add("death_saw_coming", 3, d.t, { ...base, hero: hero(k.slot), sec: k.seen, dist: k.seenDist });
    } else if (d.kind === "low_hp") add("death_low_hp", 3, d.t, { ...base, sec: d.low_for });
    else if (d.kind === "dive_enemy_tower") add("death_tower_dive", 2, d.t, { ...base, tower: d.tower_dmg });
    else if (d.kind === "outnumbered") add("death_outnumbered", 2, d.t, { ...base, allies: d.allies_near, ally: d.ally_dist });
    else if (d.kind === "duel" && top) add("death_duel", 1, d.t, { ...base, hero: hero(top.slot), nw: top.nw - d.nw, lvl: top.lvl - d.lvl });
    if (d.unused.length && d.kind !== "low_hp") add("death_unused_item", 3, d.t, { items: d.unused.slice(0, 2), free: d.free });
    if (d.ult_unused && d.free >= 3) add("death_unused_ult", 1, d.t, { ability: d.ult_unused, free: d.free });
    if (d.after_buyback) add("death_after_buyback", 3, d.t, {});
    if (d.ward_watch && d.exposed >= 10 && !["gank", "smoke"].includes(d.kind)) add("death_ward_watch", 2, d.t, { exposed: d.exposed });
  }

  for (const f of p.fights) {
    if (f.state === "absent" && f.won === false && f.allies_in >= 3 && f.t > 600) {
      add("fight_absent", f.tp_ready ? 3 : 2, f.t, { dist: f.dist, doing: f.doing, tp: f.tp_ready, allies: f.allies_in, zone: f.zone });
    }
    if (f.state !== "in") continue;
    const squishy = p.role === 5 || p.role === 4 || (p.role <= 2 && p.ranged);
    if (squishy && f.front_rank === 1 && f.front_of >= 3 && f.next_dist - f.front_dist > 250 && (f.died_at !== undefined || f.first_target)) {
      add("fight_too_close", f.died_at !== undefined && f.death_order === 1 ? 3 : 2, f.t, { dist: f.front_dist, next: f.next_dist, next_hero: hero(f.next_slot), died: f.died_at ?? null });
    }
    if (p.role === 3 && f.front_rank && f.front_rank >= 3 && f.front_of >= 4 && f.won === false) {
      add("fight_too_far", 2, f.t, { rank: f.front_rank, of: f.front_of, dist: f.front_dist });
    }
    if (f.died_at !== undefined && f.died_at < 4 && f.casts === 0 && f.death_order === 1) add("fight_died_first", 3, f.t, { sec: f.died_at });
    if (f.late && f.won === false && f.late_dead >= 1) add("fight_late", 2, f.t, { sec: f.late, dead: f.late_dead });
    if (f.ult_unused && f.won === false && f.died_at !== undefined) add("fight_unused_ult", 2, f.t, { ability: f.ult_unused });
    if (f.bkb_unused) add("fight_unused_bkb", 3, f.t, {});
  }

  const tm = p.time;
  for (const w of tm.walks) add("time_walk", 1, w.t, { sec: w.dur });
  if (tm.idle_sec >= 90) add("time_idle", tm.idle_sec >= 180 ? 2 : 1, tm.idles[0] ? tm.idles[0].t : null, { sec: tm.idle_sec, longest: tm.idles[0] ? tm.idles[0].dur : 0 });
  if (p.vs) {
    const v = p.vs;
    const worse = (k, higherIsBad = true) => v[k] && (higherIsBad ? v[k].v > v[k].p75 : v[k].v < v[k].p25);
    if (worse("seen_share")) add("vs_seen", 2, null, { v: Math.round(v.seen_share.v * 100), ref: Math.round(v.seen_share.p50 * 100) });
    if (worse("idle")) add("vs_idle", 1, null, { v: Math.round(v.idle.v * 100), ref: Math.round(v.idle.p50 * 100) });
    if (worse("dead")) add("vs_dead", 2, null, { v: Math.round(v.dead.v * 100), ref: Math.round(v.dead.p50 * 100) });
    if (p.role <= 3 && worse("farm", false)) add("vs_farm", 2, null, { v: Math.round(v.farm.v * 100), ref: Math.round(v.farm.p50 * 100) });
    if (worse("fight_presence", false)) add("vs_presence", 2, null, { v: Math.round(v.fight_presence.v * 100), ref: Math.round(v.fight_presence.p50 * 100) });
    if (p.role >= 4 && p.vision.placed >= 3 && worse("ward_sightings", false)) add("vs_wards", 2, null, { v: round(v.ward_sightings.v, 1), ref: round(v.ward_sightings.p50, 1) });
  }
  if (p.role >= 4 && p.vision.placed >= 3 && p.vision.empty >= Math.ceil(p.vision.placed / 2)) add("ward_empty", 2, null, { empty: p.vision.empty, placed: p.vision.placed });
  if (p.vision.killed_fast >= 2) add("ward_killed_fast", 1, null, { n: p.vision.killed_fast });

  const L = p.lane;
  if (L.foe && p.role <= 3) {
    const diff = L.lh10 - L.foe.lh10;
    if (diff <= -15) add("lane_lost_cs", 2, 600, { lh: L.lh10, foe: L.foe.lh10, hero: hero(L.foe.slot) });
    if (L.low_hp_sec >= 60) add("lane_low_hp", 1, null, { sec: L.low_hp_sec });
  }
  return res.sort((a, b) => b.sev - a.sev || (a.t ?? 1e9) - (b.t ?? 1e9));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
  let norms = null;
  try { if (process.argv[3]) norms = JSON.parse(readFileSync(process.argv[3], "utf8")); } catch { norms = null; } // норм ещё нет — разбор без сравнения
  process.stdout.write(JSON.stringify(analyze(raw, norms)));
}
