// Видеоразбор, шаг 1: вывод парсера реплеев OpenDota (odota/parser, JSON на строку) → компактные данные для ролика.
// Запуск: node tools/video/extract.mjs <parsed.jsonl> [match.json] > data.json
// Всё, что нужно ролику, берётся из реплея: позиции героев раз в секунду, смерти, урон герой → герой, скиллы,
// предметы, варды, Рошан, здания, выкупы, смоки, золото. match.json (матч OpenDota) нужен только ради ников,
// номера матча и рангов: без него ролик тоже соберётся.
// Координаты как в obs_log у OpenDota (клетки 64..192), в файле умножены на 10 и округлены.
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HEROES = JSON.parse(readFileSync(new URL("./heroes.json", import.meta.url), "utf8"));
const HERO_PREFIX = "npc_dota_hero_";
const NW_STEP = 5;

export async function extract(lines, match = null) {
  const slotHero = new Map(); // слот 0..9 -> hero_id
  const track = Array.from({ length: 10 }, () => new Map()); // секунда -> [x, y, жив, networth, level]
  const raw = { deaths: [], dmg: new Map(), abil: [], items: [], buys: [], wards: new Map(), wardList: [], rosh: [], aegis: [],
    buildings: [], buybacks: [], smokes: [], tormentors: [], heals: new Map() };
  let tMin = Infinity, tMax = -Infinity, winner = null, matchId = null;

  for await (const line of lines) {
    if (!line || line[0] !== "{") continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const t = e.time;
    switch (e.type) {
      case "interval": {
        if (typeof e.slot !== "number" || e.slot < 0 || e.slot > 9) break;
        if (e.hero_id) slotHero.set(e.slot, e.hero_id);
        if (typeof e.x !== "number") break;
        track[e.slot].set(t, [e.x, e.y, !e.life_state, e.networth || 0, e.level || 0]);
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
        break;
      }
      case "DOTA_COMBATLOG_DEATH": {
        const target = e.targetname || "";
        if (target.startsWith(HERO_PREFIX)) {
          if (e.targetillusion || !e.targethero) break;
          raw.deaths.push({ t, v: target, k: e.sourcename || e.attackername || "", by: e.attackername || "", inf: e.inflictor });
        } else if (target.startsWith("npc_dota_roshan")) raw.rosh.push({ t, k: e.sourcename || e.attackername || "" });
        else if (target.startsWith("npc_dota_miniboss")) raw.tormentors.push({ t, k: e.sourcename || e.attackername || "" });
        break;
      }
      case "DOTA_COMBATLOG_DAMAGE": {
        const a = e.sourcename || e.attackername || "", v = e.targetname || "";
        if (e.targetillusion || !v.startsWith(HERO_PREFIX) || !e.value) break;
        const key = `${t}|${a}|${v}`;
        raw.dmg.set(key, (raw.dmg.get(key) || 0) + e.value);
        break;
      }
      case "DOTA_COMBATLOG_ABILITY":
        if (e.attackerhero && !e.attackerillusion && e.inflictor) raw.abil.push({ t, a: e.attackername, n: e.inflictor, v: e.targetname });
        break;
      case "DOTA_COMBATLOG_ITEM":
        if (e.attackerhero && !e.attackerillusion && e.inflictor) raw.items.push({ t, a: e.attackername, n: e.inflictor });
        break;
      case "DOTA_COMBATLOG_PURCHASE":
        if (e.valuename) raw.buys.push({ t, a: e.targetname, n: e.valuename.replace(/^item_/, "") });
        break;
      case "obs": case "sen": {
        const w = { kind: e.type, t, slot: e.slot, x: e.x, y: e.y, t1: null, by: null };
        raw.wards.set(`${e.type}${e.ehandle}`, w);
        raw.wardList.push(w);
        break;
      }
      case "obs_left": case "sen_left": {
        const w = raw.wards.get(`${e.type.slice(0, 3)}${e.ehandle}`);
        if (w) { w.t1 = t; w.by = e.attackername || null; }
        break;
      }
      case "CHAT_MESSAGE_AEGIS": raw.aegis.push({ t, slot: e.player1 }); break;
      case "DOTA_COMBATLOG_TEAM_BUILDING_KILL": raw.buildings.push({ t, n: (e.targetname || "").replace(/^npc_dota_/, "") }); break;
      case "DOTA_COMBATLOG_BUYBACK": raw.buybacks.push({ t, slot: e.value }); break;
      case "CHAT_MESSAGE_SMOKE_ACTIVATED": raw.smokes.push({ t, slot: e.player1 }); break;
      case "epilogue": {
        try {
          const d = JSON.parse(e.key).gameInfo_.dota_;
          winner = d.gameWinner_ === 2 ? 0 : d.gameWinner_ === 3 ? 1 : null;
          matchId = d.matchId_ || null;
        } catch { /* без эпилога победителя возьмём по трону */ }
        break;
      }
      default:
    }
  }
  if (slotHero.size < 10 || !Number.isFinite(tMin)) throw new Error("в выводе парсера нет позиций десяти героев");

  // имя героя из боевого лога -> слот. У части героев имя в логе не совпадает с ключом (npc_dota_hero_witchdoctor в DOTA_ABILITY_LEVEL),
  // поэтому сверяем без подчёркиваний
  const norm = (s) => String(s || "").replace(HERO_PREFIX, "").replace(/_/g, "");
  const byName = new Map();
  for (const [slot, id] of slotHero) if (HEROES[id]) byName.set(norm(HEROES[id].key), slot);
  const slotOf = (name) => (String(name || "").startsWith(HERO_PREFIX) && byName.has(norm(name)) ? byName.get(norm(name)) : -1);

  const start = Math.max(tMin, -60), end = tMax, n = end - start + 1;
  const pos = [], nw = [], lvl = [];
  for (let s = 0; s < 10; s++) {
    const p = new Array(n), g = [], l = [];
    let last = null;
    for (let i = 0; i < n; i++) {
      const r = track[s].get(start + i);
      if (r) last = r;
      p[i] = r && r[2] ? [Math.round(r[0] * 10), Math.round(r[1] * 10)] : null;
      if (i % NW_STEP === 0) { g.push(last ? last[3] : 0); l.push(last ? last[4] : 0); }
    }
    pos.push(p); nw.push(g); lvl.push(l);
  }
  // место героя в секунду t: если мёртв — последнее место, где был жив (там он и умер)
  const lastAlive = (slot, t) => {
    for (let i = Math.min(n - 1, t - start); i >= 0 && i >= t - start - 30; i--) if (pos[slot][i]) return pos[slot][i];
    return null;
  };

  const kills = [];
  for (const d of raw.deaths) {
    const v = slotOf(d.v);
    if (v < 0) continue;
    // настоящая смерть: через пару секунд герой мёртв (отсекает Аегис и перерождения, там герой сразу жив)
    const i = d.t - start;
    const dead = i + 1 >= n || [1, 2, 3].some((k) => i + k < n && i + k >= 0 && !pos[v][i + k]);
    if (!dead) continue;
    if (kills.some((x) => x.v === v && Math.abs(x.t - d.t) < 3)) continue;
    const at = lastAlive(v, d.t);
    kills.push({ t: d.t, v, k: slotOf(d.k), by: slotOf(d.k) < 0 ? String(d.by).replace(/^npc_dota_/, "") : undefined, x: at ? at[0] : null, y: at ? at[1] : null });
  }
  kills.sort((a, b) => a.t - b.t);
  // с Аегисом герой «умирает» и встаёт на месте: это не смерть, первую такую после подбора убираем
  for (const a of raw.aegis) {
    const i = kills.findIndex((k) => k.v === a.slot && k.t > a.t && k.t - a.t <= 300);
    if (i >= 0) kills.splice(i, 1);
  }

  const dmg = [];
  for (const [key, value] of raw.dmg) {
    const [t, a, v] = key.split("|");
    const sa = slotOf(a), sv = slotOf(v);
    if (sv < 0) continue;
    // урон от башен и крипов тоже важен для смертей: источник -1 (не герой)
    dmg.push([Number(t), sa, sv, value]);
  }
  dmg.sort((a, b) => a[0] - b[0]);

  const named = (list) => list.map((x) => [x.t, slotOf(x.a), x.n.replace(/^item_/, "")]).filter((x) => x[1] >= 0);
  const wards = raw.wardList.filter((w) => w.slot >= 0 && w.slot <= 9).map((w) => {
    const killer = slotOf(w.by);
    const enemy = killer >= 0 && (killer < 5) !== (w.slot < 5);
    return { kind: w.kind, t: w.t, slot: w.slot, x: Math.round(w.x * 10), y: Math.round(w.y * 10), t1: w.t1, by: enemy ? killer : -1 };
  });

  const players = [];
  const mp = (match && Array.isArray(match.players)) ? match.players : [];
  for (let s = 0; s < 10; s++) {
    const id = slotHero.get(s), h = HEROES[id] || { key: "unknown", name: `Hero ${id}`, ru: "Герой" };
    const ps = s < 5 ? s : 128 + s - 5;
    const m = mp.find((p) => p.player_slot === ps) || {};
    const lastT = track[s].get(end) || [];
    players.push({ slot: s, team: s < 5 ? 0 : 1, hero_id: id, key: h.key, hero: h.name, ru: h.ru,
      name: typeof m.personaname === "string" ? m.personaname : null, account_id: m.account_id || null,
      k: m.kills ?? kills.filter((x) => x.k === s).length, d: m.deaths ?? kills.filter((x) => x.v === s).length, a: m.assists ?? null,
      nw: m.net_worth ?? lastT[3] ?? 0, level: m.level ?? lastT[4] ?? 0, rank: m.rank_tier || null,
      items: [0, 1, 2, 3, 4, 5].map((i) => m[`item_${i}`]).filter(Boolean) });
  }
  if (winner === null && match && typeof match.radiant_win === "boolean") winner = match.radiant_win ? 0 : 1;
  if (winner === null) {
    const fort = raw.buildings.find((b) => /fort$/.test(b.n));
    if (fort) winner = fort.n.includes("goodguys") ? 1 : 0;
  }

  return {
    v: 1, match_id: (match && match.match_id) || matchId, start, end, duration: (match && match.duration) || end, winner,
    players, pos, nw_step: NW_STEP, nw, lvl, kills, dmg,
    abil: named(raw.abil), items: named(raw.items), buys: named(raw.buys), wards,
    rosh: raw.rosh.map((r) => ({ t: r.t, slot: slotOf(r.k), team: slotOf(r.k) < 0 ? null : slotOf(r.k) < 5 ? 0 : 1 })),
    aegis: raw.aegis.filter((a) => a.slot >= 0 && a.slot <= 9),
    tormentors: raw.tormentors.map((r) => ({ t: r.t, slot: slotOf(r.k) })),
    buildings: raw.buildings.map((b) => ({ t: b.t, n: b.n, team: b.n.includes("goodguys") ? 0 : 1 })),
    buybacks: raw.buybacks.filter((b) => b.slot >= 0 && b.slot <= 9),
    smokes: raw.smokes.filter((b) => b.slot >= 0 && b.slot <= 9),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, matchFile] = process.argv.slice(2);
  if (!file) { process.stderr.write("нужен файл с выводом парсера\n"); process.exit(2); }
  let match = null;
  if (matchFile) { try { match = JSON.parse(readFileSync(matchFile, "utf8")); } catch { match = null; } }
  try {
    const data = await extract(createInterface({ input: createReadStream(file), crlfDelay: Infinity }), match);
    process.stdout.write(JSON.stringify(data));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}
