// Ход игры глазами тренера: где был перевес и на чём он ушёл (или пришёл), каждая драка с тем, что было следом,
// и личные ошибки игрока ровно в эти моменты. Каждая строка — событие, причина и последствие, а не итоговая цифра.
// Только по разобранному матчу OpenDota (teamfights, objectives, *_log, gold_t). Без разбора — null.

const FIGHT_AFTER = 150;      // сек после драки: что сломали следом, это её цена
const LEAD_HOLD = 4000;       // перевес, который уже надо превращать в постройки
const LEAD_MIN_WINDOW = 6;    // минут такого перевеса без единой постройки — уже ошибка
const LATE = 1800;            // с 30-й минуты смерть без выкупа стоит бараков
const ROSH_NEAR = 90;         // драка за 90 с до и после Рошана — драка за Рошана
const TURN_WINDOW = 3;        // минут: окно, в котором ищем переломы
const TURN_MIN_GOLD = 3000;
const SOLO_GAP = 15;          // сек: рядом не умер никто из своих — поймали одного
const MAP_CENTER_SUM = 256;
const CORE_POS = new Set([1, 2, 3]);
// Сейв-предметы и сколько секунд после нажатия они ещё в откате
const SAVE_ITEMS = [["black_king_bar", 100], ["glimmer_cape", 20], ["force_staff", 20], ["hurricane_pike", 20],
  ["ghost", 25], ["cyclone", 25], ["wind_waker", 20], ["lotus_orb", 20], ["satanic", 35], ["manta", 35]];
const SAVE_NAMES = { black_king_bar: "BKB", glimmer_cape: "Glimmer Cape", force_staff: "Force Staff", hurricane_pike: "Hurricane Pike",
  ghost: "Ghost Scepter", cyclone: "Eul", wind_waker: "Wind Waker", lotus_orb: "Lotus Orb", satanic: "Satanic", manta: "Manta" };
const LANE_RU = { top: "верх", mid: "мид", bot: "низ" };
const LANE_GEN = { top: "верха", mid: "мида", bot: "низа" };

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const clock = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const k1 = (n) => {
  const a = Math.abs(Math.round(n));
  return a >= 1000 ? `${(a / 1000).toFixed(1).replace(".0", "").replace(".", ",")}к` : String(a);
};
const signedK = (n) => `${n >= 0 ? "+" : "−"}${k1(n)}`;
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const nonEmpty = (o) => Boolean(o) && Object.keys(o).length > 0;
const isRad = (p) => (typeof p.isRadiant === "boolean" ? p.isRadiant : Number(p.player_slot) < 128);

function mapZone(x, y, radiant) {
  if (x < 88 && y < 88) return radiant ? "у своей базы" : "у базы врага";
  if (x > 168 && y > 168) return radiant ? "у базы врага" : "у своей базы";
  if (Math.abs(x - y) <= 9 && x > 88 && x < 168) return "на миде";
  if (x < 92 || y > 164) return "на верхней линии";
  if (y < 92 || x > 164) return "на нижней линии";
  const s = x + y;
  if (Math.abs(s - MAP_CENTER_SUM) <= 8) return "на реке";
  return (radiant ? s < MAP_CENTER_SUM : s > MAP_CENTER_SUM) ? "в своём лесу" : "в лесу врага";
}
function firstCell(pos) {
  for (const [x, ys] of Object.entries(pos || {})) for (const y of Object.keys(ys || {})) return [Number(x), Number(y)];
  return null;
}

function building(o, ownSide) {
  const key = o.key;
  const t = /tower(\d)(?:_(top|mid|bot))?/.exec(key);
  const r = /(melee|range)_rax_(top|mid|bot)/.exec(key);
  let name, weight, lane = null;
  if (t) { name = t[2] ? `T${t[1]} ${LANE_RU[t[2]]}` : `T${t[1]}`; weight = [0, 1, 1.5, 2.5, 3][Number(t[1])] || 1; lane = t[2] || null; }
  else if (r) { name = `бараки ${LANE_GEN[r[2]]}`; weight = 1.5; lane = r[2]; }
  else if (key.includes("fort")) { name = "трон"; weight = 10; }
  else { name = "здание"; weight = 0.5; }
  return { time: o.time, ours: key.includes(ownSide), name, weight, rax: Boolean(r), high: Boolean(r) || /tower[34]|fort/.test(key), lane };
}
// «T2 мид, бараки мида, T3 низ»: бараки одной линии — одним словом, повторы — «×2»
function names(list) {
  const counts = new Map();
  for (const b of list) counts.set(b.name, (counts.get(b.name) || 0) + (b.rax ? 0.5 : 1));
  return [...counts].map(([n, c]) => (c > 1 && !n.startsWith("бараки") ? `${n} ×${Math.round(c)}` : n)).join(", ");
}

export function gameStory(match, player, od) {
  const fightsRaw = (match && match.teamfights) || [];
  const goldAdv = (match && match.radiant_gold_adv) || [];
  if (!match || !player || !Array.isArray(match.players) || (!fightsRaw.length && goldAdv.length < 5)) return null;
  const heroName = (p) => (od && od.heroName ? od.heroName(p.hero_id) : `герой ${p.hero_id}`);
  const keyName = (k) => (od && od.heroNameByKey ? od.heroNameByKey(k) : String(k || "").replace("npc_dota_hero_", ""));
  const radiant = isRad(player);
  const players = match.players;
  const idx = players.indexOf(player);
  const allies = players.filter((p) => isRad(p) === radiant), enemies = players.filter((p) => isRad(p) !== radiant);
  const allyIdx = players.map((p, i) => (isRad(p) === radiant ? i : -1)).filter((i) => i >= 0);
  const enemyIdx = players.map((p, i) => (isRad(p) !== radiant ? i : -1)).filter((i) => i >= 0);
  const duration = Number(match.duration) || 0;
  const won = Boolean(match.radiant_win) === radiant;
  const adv = goldAdv.map((a) => (radiant ? a : -a));
  const advAt = (m) => (adv.length ? adv[Math.max(0, Math.min(adv.length - 1, m))] : 0);
  const ownSide = radiant ? "goodguys" : "badguys";
  const myTeam = radiant ? 2 : 3;
  const pos = player.position_est || { 1: 1, 2: 2, 3: 3 }[player.lane_role] || 4;
  const core = CORE_POS.has(pos);
  const objs = match.objectives || [];
  const buildings = objs.filter((o) => o.type === "building_kill" && typeof o.key === "string").map((o) => building(o, ownSide));
  const roshes = objs.filter((o) => o.type === "CHAT_MESSAGE_ROSHAN_KILL").map((o) => ({ time: o.time, mine: o.team === myTeam }));
  const slotSide = (slot) => { const p = players.find((x) => x.player_slot === slot); return p ? isRad(p) === radiant : null; };
  const aegisEv = objs.filter((o) => /AEGIS/.test(o.type)).map((o) => ({ time: o.time, type: o.type, mine: slotSide(o.player_slot), who: players.find((x) => x.player_slot === o.player_slot) }));
  const myDeaths = (player.deaths_log || []).slice().sort((a, b) => a.time - b.time);
  const allyDeaths = allies.flatMap((p) => (p.deaths_log || []).map((d) => ({ time: d.time, p })));
  const purchases = player.purchase_log || [];
  const owned = (key, t) => purchases.some((x) => x.key === key && x.time < t);

  // ---------- драки ----------
  const fights = [];
  let prevUses = {};
  // Постройку записываем на последнюю драку перед ней: иначе две соседние драки делят одни и те же бараки
  const claim = new Map();
  for (const b of buildings) {
    const tf = fightsRaw.filter((x) => x.start < b.time && b.time <= x.end + FIGHT_AFTER).sort((x, y) => y.start - x.start)[0];
    if (tf) claim.set(b, tf);
  }
  fightsRaw.forEach((tf, i) => {
    const tp = tf.players || [];
    const ours = sum(allyIdx.map((j) => (tp[j] && tp[j].deaths) || 0));
    const theirs = sum(enemyIdx.map((j) => (tp[j] && tp[j].deaths) || 0));
    if (ours + theirs === 0) return;
    const me = tp[idx] || {};
    const present = (me.damage || 0) > 0 || (me.healing || 0) > 0 || (me.deaths || 0) > 0 || nonEmpty(me.ability_uses) || nonEmpty(me.item_uses);
    const deadAtStart = myDeaths.some((d) => d.time < tf.start && d.time + (d.time_dead != null ? d.time_dead : 40) > tf.start);
    const teamDmg = sum(allyIdx.map((j) => (tp[j] && tp[j].damage) || 0));
    const myDeath = myDeaths.find((d) => d.time >= tf.start - 3 && d.time <= tf.end + 3) || null;
    const inFight = allyDeaths.filter((d) => d.time >= tf.start - 3 && d.time <= tf.end + 3).sort((a, b) => a.time - b.time);
    const firstDead = inFight.length ? inFight[0].p : null;
    const cell = firstCell(me.deaths_pos) || allyIdx.map((j) => tp[j] && firstCell(tp[j].deaths_pos)).find(Boolean)
      || enemyIdx.map((j) => tp[j] && firstCell(tp[j].deaths_pos)).find(Boolean);
    const after = buildings.filter((b) => claim.get(b) === tf);
    const rosh = roshes.find((r) => r.time >= tf.start - ROSH_NEAR && r.time <= tf.end + 30) || null;
    const stolen = aegisEv.find((a) => a.type === "CHAT_MESSAGE_AEGIS_STOLEN" && a.time >= tf.start - ROSH_NEAR && a.time <= tf.end + 30) || null;
    const m0 = Math.floor(tf.start / 60), m1 = Math.min(Math.ceil((tf.end + FIGHT_AFTER) / 60), adv.length - 1);
    // Сейв, который был, не в откате и не нажат, а ты умер
    const unused = [];
    if (myDeath && me.item_uses) {
      for (const [key, cd] of SAVE_ITEMS) {
        if (owned(key, tf.start) && !me.item_uses[key] && !(prevUses[key] != null && tf.start - prevUses[key] < cd)) unused.push(key);
      }
    }
    for (const key of Object.keys(me.item_uses || {})) prevUses[key] = tf.end;
    fights.push({
      n: fights.length + 1, start: tf.start, end: tf.end, clock: clock(tf.start), ours, theirs,
      result: theirs > ours ? "won" : ours > theirs ? "lost" : "even",
      present, dead_at_start: deadAtStart, damage: me.damage || 0, share: teamDmg > 0 ? (me.damage || 0) / teamDmg : 0,
      died: Boolean(myDeath), killer: myDeath ? keyName(myDeath.key) : null, first: Boolean(myDeath) && firstDead === player,
      first_name: firstDead ? heroName(firstDead) : null, unused, gold: me.gold_delta || 0,
      bb_ours: sum(allyIdx.map((j) => (tp[j] && tp[j].buybacks) || 0)), bb_theirs: sum(enemyIdx.map((j) => (tp[j] && tp[j].buybacks) || 0)),
      where: cell ? mapZone(cell[0], cell[1], radiant) : null,
      lost: after.filter((b) => b.ours), took: after.filter((b) => !b.ours),
      rosh, stolen, swing: adv.length ? advAt(m1) - advAt(m0) : 0,
    });
  });
  for (const f of fights) f.text = fightText(f, heroName);

  // ---------- перевес по минутам ----------
  const arc = arcOf(adv);

  // ---------- переломы: окна в 3 минуты с самым большим сдвигом золота ----------
  const turns = [];
  if (adv.length > TURN_WINDOW + 1) {
    const cand = [];
    for (let m = 0; m + TURN_WINDOW < adv.length; m++) cand.push({ m, delta: adv[m + TURN_WINDOW] - adv[m] });
    cand.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    for (const c of cand) {
      if (Math.abs(c.delta) < TURN_MIN_GOLD || turns.length >= 4) break;
      if (turns.some((t) => Math.abs(t.m - c.m) < TURN_WINDOW)) continue;
      const t0 = c.m * 60, t1 = (c.m + TURN_WINDOW) * 60;
      const fs = fights.filter((f) => f.start >= t0 - 30 && f.start <= t1);
      const bs = buildings.filter((b) => b.time >= t0 && b.time <= t1 + 30);
      const parts = [];
      for (const f of fs) parts.push(`драка в ${f.clock} ${f.theirs}:${f.ours}${f.died ? " (ты умер)" : !f.present && !f.dead_at_start ? " (без тебя)" : ""}`);
      const r = roshes.find((x) => x.time >= t0 - 30 && x.time <= t1);
      if (r) parts.push(r.mine ? "Рошан ваш" : "Рошан у врагов");
      const st = aegisEv.find((a) => a.type === "CHAT_MESSAGE_AEGIS_STOLEN" && a.time >= t0 - 30 && a.time <= t1);
      if (st && st.who) parts.push(`Аегис украл ${heroName(st.who)}`);
      const lost = bs.filter((b) => b.ours), took = bs.filter((b) => !b.ours);
      if (lost.length) parts.push(`вы потеряли: ${names(lost)}`);
      if (took.length) parts.push(`вы сломали: ${names(took)}`);
      turns.push({
        m: c.m, time: t0, clock: `${c.m}:00–${c.m + TURN_WINDOW}:00`, delta: c.delta, good: c.delta > 0,
        text: `${c.m}–${c.m + TURN_WINDOW} мин, ${signedK(c.delta)} золота команде${parts.length ? `: ${parts.join("; ")}` : ""}.`,
      });
    }
    turns.sort((a, b) => a.m - b.m);
  }

  // ---------- причины на уровне команды ----------
  const causes = [];
  const add = (list, x) => list.push(x);

  // 1. Перевес, который не стал постройками
  if (adv.length > LEAD_MIN_WINDOW) {
    let best = null, from = null;
    const took = buildings.filter((b) => !b.ours);
    for (let m = 0; m <= adv.length; m++) {
      const ok = m < adv.length && adv[m] >= LEAD_HOLD && !took.some((b) => Math.floor(b.time / 60) === m);
      if (ok) { if (from === null) from = m; continue; }
      if (from !== null && m - from >= LEAD_MIN_WINDOW && (!best || m - from > best.to - best.from)) best = { from, to: m };
      from = null;
    }
    if (best) {
      const span = adv.slice(best.from, best.to);
      const lostIn = buildings.filter((b) => b.ours && b.time >= best.from * 60 && b.time < best.to * 60);
      const farmer = topFarmer(enemies, best.from, best.to, heroName);
      const mins = best.to - best.from;
      add(causes, {
        key: "lead_no_buildings", time: best.from * 60, clock: `${best.from}:00–${best.to}:00`, weight: 6 + mins * 0.4 + (won ? -3 : 0),
        title: "Перевес не превратили в вышки",
        fact: `С ${best.from}-й по ${best.to}-ю минуту вы вели на ${k1(Math.min(...span))}–${k1(Math.max(...span))} золота, но за ${mins} ${plural(mins, "минуту", "минуты", "минут")} не сломали ни одной постройки`
          + (lostIn.length ? `, а враги за это время сломали ваши ${names(lostIn)}` : "")
          + (farmer ? `. ${farmer.name} в это время фармил по ${farmer.gpm} золота в минуту` : "") + ".",
        why: "Золото без карты сгорает: пока вы ходите по лесу, их керри догоняет по предметам, а через 10 минут уже он диктует драки.",
        fix: "Перевес от 4–5 тысяч — собирайтесь впятером на ближайшую вышку врага сразу после выигранной драки или пика вражеского героя. Лес и стаки потом.",
      });
    }
  }

  // 2. Выиграли драку и ничего не взяли
  const wasted = fights.filter((f) => f.start >= 900 && f.theirs - f.ours >= 2 && !f.took.length && !(f.rosh && f.rosh.mine));
  if (wasted.length) {
    add(causes, {
      key: "won_no_push", time: wasted[0].start, clock: wasted.map((f) => f.clock).join(", "), weight: 3 + wasted.length * 1.5,
      title: wasted.length > 1 ? "Выигранные драки без продолжения" : "Выигранная драка без продолжения",
      fact: `${wasted.map((f) => `${f.clock} (${f.theirs}:${f.ours})`).join(", ")}: враги лежали, но за следующие 2,5 минуты вы не сломали ни одной постройки и не взяли Рошана.`,
      why: "После выигранной драки у вас 40–90 секунд, пока враги мертвы. Это и есть время ломать вышки и бараки, иначе убийства просто уходят в нетворс, который потом можно проиграть одной дракой.",
      fix: "Убили двоих и больше — сразу на ближайшую вышку или на Рошана. Если враги мертвы дольше минуты, идите на бараки.",
    });
  }

  // 3. Рошан, который стоил игры
  for (const r of roshes.filter((x) => x.mine)) {
    const st = aegisEv.find((a) => a.type === "CHAT_MESSAGE_AEGIS_STOLEN" && a.mine === false && Math.abs(a.time - r.time) <= 30);
    const f = fights.find((x) => x.rosh === r || (x.start <= r.time + 60 && x.end >= r.time - 60));
    if (!st && !(f && f.result === "lost")) continue;
    const lost = buildings.filter((b) => b.ours && b.time > r.time && b.time <= r.time + 180);
    add(causes, {
      key: "rosh_disaster", time: r.time, clock: clock(r.time), weight: 7 + sum(lost.map((b) => b.weight)) * 0.5,
      title: st ? "Рошан, с которого украли Аегис" : "Проигранная драка за Рошана",
      fact: `${clock(r.time)}: вы убили Рошана`
        + (st && st.who ? `, но Аегис забрал ${heroName(st.who)}` : "")
        + (f ? `, драка ${f.theirs}:${f.ours}${f.where ? ` ${f.where}` : ""}` : "")
        + (f && !f.bb_ours && f.ours >= 2 ? ", никто не выкупился" : "")
        + (lost.length ? `. За 3 минуты после этого вы потеряли ${names(lost)}` : "") + ".",
      why: "Рошан в яме — это драка в узком месте, где каждый ульт бьёт по всем сразу. Если враг не показан на карте, он стоит рядом и ждёт, когда у вас уйдут хп и кнопки на Рошана.",
      fix: "Бейте Рошана, только когда враги показаны на другом конце карты или после выигранной драки. Обсы и сентри вокруг ямы, Аегис поднимает ваш главный кор, он стоит у Рошана сам.",
    });
  }

  // 3б. Отдали Рошана — и с ним базу
  for (const r of roshes.filter((x) => !x.mine && x.time >= 1200)) {
    const lost = buildings.filter((b) => b.ours && b.time > r.time && b.time <= r.time + 240);
    if (!lost.some((b) => b.high) && lost.length < 3) continue;
    const f = fights.find((x) => x.rosh === r) || null;
    add(causes, {
      key: "enemy_rosh_push", time: r.time, clock: clock(r.time), weight: 5 + sum(lost.map((b) => b.weight)) * 0.6,
      title: "Отдали Рошана, а с ним базу",
      fact: `${clock(r.time)}: Рошана забрали враги${f ? ` после драки ${f.theirs}:${f.ours}` : ", драки за него не было"}, и за 4 минуты с Аегисом сломали ваши ${names(lost)}.`,
      why: "Аегис — это пять минут, когда их кор может зайти под ваши вышки и не бояться смерти. Если на это время не встретить их всем составом в выгодном месте, они ломают всё, до чего дотянутся.",
      fix: f ? "Если Рошан уже не ваш, не отдавайте драку следом: отходите под свои вышки T3, держите выкуп и защищайте впятером, пока Аегис не кончится." : "Следите за таймером Рошана и держите вард у ямы. Когда враги пропали с карты на 30+ секунд в его окно, идите к яме всей командой, а не фармите поодиночке.",
    });
  }

  // 4. Проиграли драку — и сразу отдали базу
  const costly = fights.filter((f) => f.result === "lost" && f.lost.some((b) => b.high) && !(f.rosh && f.rosh.mine))
    .sort((a, b) => sum(b.lost.map((x) => x.weight)) - sum(a.lost.map((x) => x.weight)));
  for (const f of costly.slice(0, 2)) {
    add(causes, {
      key: "fight_to_base", time: f.start, clock: f.clock, weight: 4 + sum(f.lost.map((b) => b.weight)) * 0.6,
      title: "Драка, после которой сломали базу",
      fact: `${f.clock}: драка ${f.theirs}:${f.ours}${f.where ? ` ${f.where}` : ""}`
        + (f.ours >= 2 && !f.bb_ours ? ", без единого выкупа" : "")
        + `, следом враги сломали ${names(f.lost)}.`,
      why: f.start >= LATE ? "В поздней игре одна проигранная драка без выкупа — это сразу бараки: возрождение дольше минуты, защищать некому." : "Без защитников вышки падают за секунды, а каждая сломанная постройка — золото всей вражеской команде и карта, на которой вы уже не можете фармить.",
      fix: "Не принимайте драку, когда главные коры без выкупа или без кнопок. Видите, что драка проиграна, — отступайте, кто ещё жив, и выкупайтесь на защиту.",
    });
  }

  // 5. Вражеский керри фармил без давления
  const ef = topFarmer(enemies, 15, Math.min(35, Math.floor(duration / 60)), heroName);
  const af = topFarmer(allies, 15, Math.min(35, Math.floor(duration / 60)), heroName);
  if (ef && af && duration >= 1800 && ef.gold > af.gold * 1.15 && ef.deaths <= 2) {
    add(causes, {
      key: "enemy_free_farm", time: 900, clock: `15:00–${Math.min(35, Math.floor(duration / 60))}:00`, weight: 4 + (ef.gold / af.gold - 1) * 6,
      title: `${ef.name} фармил без давления`,
      fact: `С 15-й по ${Math.min(35, Math.floor(duration / 60))}-ю минуту ${ef.name} набрал ${k1(ef.gold)} золота (${ef.gpm} в минуту) и умер ${ef.deaths} ${plural(ef.deaths, "раз", "раза", "раз")}. Лучший фармер у вас — ${af.name}, ${k1(af.gold)}.`,
      why: "Керри, которого не трогают в середине игры, к 35–40 минуте сильнее любого вашего героя. Дальше вы проигрываете драки, даже если до этого вели.",
      fix: "Найдите, где он фармит (обычно лес возле его безопасной линии), поставьте туда обс и идите туда смоком вдвоём-втроём. Даже одна смерть или сломанная вышка на его линии отнимает у него минуты фарма.",
    });
  }

  // 6. Поздние драки без выкупа у команды
  const noBb = fights.filter((f) => f.start >= LATE && f.result === "lost" && f.ours >= 2 && !f.bb_ours && f.lost.length);
  if (noBb.length && !causes.some((c) => c.key === "fight_to_base" && noBb.some((f) => f.clock === c.clock))) {
    add(causes, {
      key: "no_buyback", time: noBb[0].start, clock: noBb.map((f) => f.clock).join(", "), weight: 3 + noBb.length,
      title: "Без выкупа в поздних драках",
      fact: `${noBb.map((f) => `${f.clock} (${f.theirs}:${f.ours})`).join(", ")}: проиграли драку, никто не выкупился, и враги сломали ${names(noBb.flatMap((f) => f.lost))}.`,
      why: "После 30-й минуты возрождение дольше минуты. Без выкупа одна драка решает игру.",
      fix: "После 30-й минуты корам держать золото на выкуп. Нет выкупа — не идти первым и не драться под чужими вышками.",
    });
  }
  causes.sort((a, b) => b.weight - a.weight);

  // ---------- личные ошибки ----------
  const mistakes = [];
  const later = fights.filter((f) => f.start >= 600);
  // 1. Драки без тебя, пока ты был жив
  const runs = [];
  let run = [];
  for (const f of later) {
    if (!f.present && !f.dead_at_start) run.push(f);
    else { if (run.length) runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const missed = later.filter((f) => !f.present && !f.dead_at_start);
  if (missed.length >= 2) {
    const longest = runs.sort((a, b) => b.length - a.length)[0];
    const t0 = longest[0].start, t1 = longest[longest.length - 1].end;
    const lh = player.lh_t || [];
    const lhGain = lh.length ? (lh[Math.min(lh.length - 1, Math.ceil(t1 / 60))] || 0) - (lh[Math.min(lh.length - 1, Math.floor(t0 / 60))] || 0) : null;
    const lostDuring = missed.flatMap((f) => f.lost);
    add(mistakes, {
      key: "missed_fights", time: missed[0].start, clock: missed.map((f) => f.clock).join(", "), weight: 3 + missed.length * 1.6 + sum(lostDuring.map((b) => b.weight)) * 0.4,
      title: `${missed.length} ${plural(missed.length, "драка", "драки", "драк")} без тебя`,
      fact: `${missed.map((f) => `${f.clock} (${f.theirs}:${f.ours})`).join(", ")}: команда дралась, ты был жив и не нанёс ни единицы урона.`
        + (longest.length >= 2 && lhGain != null ? ` С ${clock(t0)} по ${clock(t1)} ты в это время добил ${lhGain} ${plural(lhGain, "крипа", "крипов", "крипов")}.` : "")
        + (lostDuring.length ? ` После этих драк вы потеряли ${names(lostDuring)}.` : ""),
      why: core ? "Фарм нужен, чтобы выигрывать драки, а не вместо них. Пока ты в лесу, команда дерётся вчетвером, и каждая такая драка — минус вышка или минус чей-то выкуп." : "Саппорт, которого нет в драке, — это минус контроль и минус сейв. Вчетвером против пяти драки не выигрываются.",
      fix: "Держи ТП и смотри на миникарту каждые 5–10 секунд. Видишь, что свои собираются или враги пошли толпой, — бросай стак и иди. Пачку в лесу добьёшь потом.",
    });
  }
  // 2. Свитки ТП: покупки в логе есть не всегда, считаем нажатия
  const tps = ((player.item_uses || {}).tpscroll || 0) + ((player.item_uses || {}).travel_boots || 0) + ((player.item_uses || {}).travel_boots_2 || 0);
  if (player.item_uses && duration >= 1500 && tps < duration / 600) {
    add(mistakes, {
      key: "few_tp", time: 600, clock: "вся игра", weight: 2 + (duration / 600 - tps) * 0.8 + (missed.length >= 2 ? 2 : 0),
      title: "Почти не телепортировался",
      fact: `За ${Math.round(duration / 60)} минут ты нажал ТП ${tps} ${plural(tps, "раз", "раза", "раз")}.${missed.length >= 2 ? " Отсюда и драки без тебя: пешком не успеваешь." : ""}`,
      why: "Без ТП ты не успеваешь ни на защиту вышки, ни в драку, ни сбежать. Хороший кор телепортируется раз в 3–5 минут.",
      fix: "ТП всегда в слоте и не в откате перед дракой. Видишь, что свои стягиваются или ломают вышку, — ТП туда, а не пешком через лес.",
    });
  }
  // 3. Смерти: от кого чаще всего, кого ловили одного, после каких отдали постройки
  const heroDeaths = myDeaths.filter((d) => String(d.key || "").startsWith("npc_dota_hero_"));
  const byKiller = new Map();
  for (const d of heroDeaths) byKiller.set(d.key, (byKiller.get(d.key) || 0) + 1);
  const [topKey, topN] = [...byKiller].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  if (topN >= 2 && topN >= heroDeaths.length * 0.3) {
    const times = heroDeaths.filter((d) => d.key === topKey).map((d) => clock(d.time));
    add(mistakes, {
      key: "same_killer", time: heroDeaths.find((d) => d.key === topKey).time, clock: times.join(", "), weight: 2 + topN,
      title: `${topN} ${plural(topN, "смерть", "смерти", "смертей")} от ${keyName(topKey)}`,
      fact: `${keyName(topKey)} убил тебя ${topN} ${plural(topN, "раз", "раза", "раз")} из ${myDeaths.length}: ${times.join(", ")}.`,
      why: "Одна и та же смерть дважды — это не случайность, а то, что ты не учёл его кнопки и не поменял ни позицию, ни сборку.",
      fix: `Против ${keyName(topKey)} держи дистанцию его главного умения, не стой с союзниками в одной куче и посмотри вкладку «Смерти»: там предметы, которые закрывают именно его урон.`,
    });
  }
  const fightAt = (t) => fights.find((f) => t >= f.start - 3 && t <= f.end + 3);
  const solo = myDeaths.filter((d) => d.time >= 600 && !fightAt(d.time) && !allyDeaths.some((a) => a.p !== player && Math.abs(a.time - d.time) <= SOLO_GAP));
  if (solo.length >= 2) {
    const leadTxt = solo.map((d) => { const g = advAt(Math.floor(d.time / 60)); return `${clock(d.time)}${Math.abs(g) >= 2000 ? ` (${g > 0 ? "вели" : "отставали"} на ${k1(g)})` : ""}`; });
    const lostAfter = buildings.filter((b) => b.ours && solo.some((d) => b.time > d.time && b.time <= d.time + 120));
    add(mistakes, {
      key: "solo_deaths", time: solo[0].time, clock: solo.map((d) => clock(d.time)).join(", "), weight: 2 + solo.length * 1.2 + sum(lostAfter.map((b) => b.weight)) * 0.4,
      title: `Поймали одного ${solo.length} ${plural(solo.length, "раз", "раза", "раз")}`,
      fact: `Смерти без драки и без своих рядом: ${leadTxt.join(", ")}.${lostAfter.length ? ` Следом враги сломали ${names(lostAfter)}.` : ""}`,
      why: "Смерть в одиночку отдаёт врагам золото и время: они идут на вышку вчетвером против четверых, а ты 40–80 секунд смотришь в серый экран.",
      fix: "Фарми там, где есть твой вард или своя вышка рядом. Пропали с карты двое-трое врагов — уходи с линии ближе к своим, это и есть их ганг.",
    });
  }
  // 4. Не нажал сейв и умер
  const unusedFights = fights.filter((f) => f.unused.length);
  if (unusedFights.length) {
    const itemsTxt = [...new Set(unusedFights.flatMap((f) => f.unused))].map((k) => SAVE_NAMES[k] || k).join(", ");
    add(mistakes, {
      key: "unused_save", time: unusedFights[0].start, clock: unusedFights.map((f) => f.clock).join(", "), weight: 3 + unusedFights.length * 1.5,
      title: `Умер с ненажатым ${itemsTxt}`,
      fact: `${unusedFights.map((f) => `${f.clock}: ${f.unused.map((k) => SAVE_NAMES[k] || k).join(", ")} не в откате, не нажат, ты умер`).join("; ")}.`,
      why: "Сейв, который не нажат, — это просто статы за большие деньги. В драке он и есть причина, по которой ты живёшь.",
      fix: "Сейв жми до того, как полезут станы, а не после: BKB — на входе в драку, Glimmer и Force — на первый контроль по тебе. Вынеси их на удобные клавиши.",
    });
  }
  // 5. Кор, который умирал, почти не ударив
  const blanks = core ? fights.filter((f) => f.died && f.result !== "won" && f.start >= 900 && f.damage < 1500 && f.share < 0.2) : [];
  if (blanks.length) {
    add(mistakes, {
      key: "died_no_damage", time: blanks[0].start, clock: blanks.map((f) => f.clock).join(", "), weight: 3 + blanks.length * 1.5,
      title: "Умирал раньше, чем начинал бить",
      fact: `${blanks.map((f) => `${f.clock}: урон ${f.damage}${f.first ? ", умер первым" : ""}${f.killer ? `, убил ${f.killer}` : ""}`).join("; ")}.`,
      why: "Кор, который умер в первые секунды, — это драка вчетвером. Обычно причина одна: зашёл первым или стоял там, где его видно, пока у врагов есть все кнопки.",
      fix: "Заходи вторым: пусть враги потратят контроль на инициатора. Стой на краю драки и бей ближайшую цель, а не прыгай на дальнюю.",
    });
  }
  // 6. Первым умирал в проигранных драках
  const firsts = fights.filter((f) => f.first && f.result === "lost" && !blanks.includes(f));
  if (firsts.length >= 2) {
    add(mistakes, {
      key: "died_first", time: firsts[0].start, clock: firsts.map((f) => f.clock).join(", "), weight: 2 + firsts.length,
      title: "Первым умирал в проигранных драках",
      fact: `${firsts.map((f) => `${f.clock} (${f.theirs}:${f.ours})`).join(", ")}: ты умер раньше всех своих.`,
      why: "Кто умирает первым, тот решает драку: дальше команда дерётся без тебя.",
      fix: "Перед дракой проверь, где вражеские станы и у кого они уже потрачены. Не стой впереди саппортов без BKB.",
    });
  }
  // 7. Поздняя смерть без выкупа, после которой сломали базу
  const lateNoBb = fights.filter((f) => f.died && f.start >= LATE && f.result !== "won" && f.lost.some((b) => b.high))
    .filter((f) => !(player.buyback_log || []).some((b) => b.time >= f.start && b.time <= f.end + FIGHT_AFTER));
  if (lateNoBb.length && core) {
    add(mistakes, {
      key: "no_buyback_me", time: lateNoBb[0].start, clock: lateNoBb.map((f) => f.clock).join(", "), weight: 4 + lateNoBb.length * 2,
      title: "Без выкупа, пока ломали базу",
      fact: `${lateNoBb.map((f) => `${f.clock}: ты умер, не выкупился, враги сломали ${names(f.lost)}`).join("; ")}.`,
      why: "На позднем этапе выкуп кора — это бараки или трон. Без него ты 70–100 секунд смотришь, как ломают базу.",
      fix: "С 30-й минуты держи в запасе золото на выкуп (примерно нетворс / 13 + 200). Не хватает — не покупай следующий предмет, пока не будет.",
    });
  }
  mistakes.sort((a, b) => b.weight - a.weight);

  // ---------- итог в трёх фразах ----------
  const verdict = verdictOf(won, arc, causes, mistakes);
  return { won, arc, turns, fights, causes: causes.slice(0, 5), mistakes: mistakes.slice(0, 6), verdict };
}

function arcOf(adv) {
  if (!adv.length) return null;
  let peak = 0, peakM = 0, low = 0, lowM = 0;
  adv.forEach((g, m) => { if (g > peak) { peak = g; peakM = m; } if (g < low) { low = g; lowM = m; } });
  // самый большой откат от пика и самый большой камбэк от дна
  let runMax = adv[0], runMaxM = 0, drop = { size: 0 }, runMin = adv[0], runMinM = 0, rise = { size: 0 };
  adv.forEach((g, m) => {
    if (g > runMax) { runMax = g; runMaxM = m; }
    if (runMax - g > drop.size) drop = { size: runMax - g, from: runMaxM, to: m, start: runMax, end: g };
    if (g < runMin) { runMin = g; runMinM = m; }
    if (g - runMin > rise.size) rise = { size: g - runMin, from: runMinM, to: m, start: runMin, end: g };
  });
  return { peak, peak_min: peakM, low, low_min: lowM, final: adv[adv.length - 1], drop: drop.size ? drop : null, rise: rise.size ? rise : null };
}

function topFarmer(team, fromM, toM, heroName) {
  if (!(toM > fromM)) return null;
  let best = null;
  for (const p of team) {
    const g = p.gold_t || [];
    if (g.length <= fromM) continue;
    const gold = (g[Math.min(toM, g.length - 1)] || 0) - (g[fromM] || 0);
    if (!best || gold > best.gold) best = { p, gold };
  }
  if (!best) return null;
  const mins = toM - fromM;
  const deaths = (best.p.deaths_log || []).filter((d) => d.time >= fromM * 60 && d.time < toM * 60).length;
  return { p: best.p, gold: best.gold, gpm: Math.round(best.gold / mins), deaths, name: heroName(best.p) };
}

function fightText(f, heroName) {
  const score = `${f.theirs}:${f.ours}`;
  const res = f.result === "won" ? "выиграли" : f.result === "lost" ? "проиграли" : "размен";
  let me;
  if (f.dead_at_start && !f.present) me = "ты был мёртв";
  else if (!f.present) me = "тебя не было, урона 0";
  else if (f.died) me = `ты умер${f.first ? " первым" : ""}${f.killer ? ` (убил ${f.killer})` : ""}, урон ${f.damage}${f.share ? ` (${Math.round(f.share * 100)}% команды)` : ""}`;
  else me = `ты дрался, урон ${f.damage}${f.share ? ` (${Math.round(f.share * 100)}% команды)` : ""}`;
  const extra = [];
  if (f.rosh) extra.push(f.rosh.mine ? "у Рошана, Рошан ваш" : "у Рошана, Рошан у врагов");
  if (f.stolen && f.stolen.who) extra.push(`Аегис украл ${heroName(f.stolen.who)}`);
  if (f.unused.length) extra.push(`не нажат ${f.unused.map((k) => SAVE_NAMES[k] || k).join(", ")}`);
  if (f.ours >= 2 && f.result === "lost") extra.push(f.bb_ours ? `выкупов: ${f.bb_ours}` : "без выкупов");
  if (f.lost.length) extra.push(`следом потеряли ${names(f.lost)}`);
  if (f.took.length) extra.push(`следом сломали ${names(f.took)}`);
  if (!f.lost.length && !f.took.length && f.result === "won" && f.theirs - f.ours >= 2 && f.start >= 900) extra.push("продолжения не было");
  return `${res} ${score}${f.where ? ` ${f.where}` : ""}; ${me}${extra.length ? `; ${extra.join("; ")}` : ""}.`;
}

function verdictOf(won, arc, causes, mistakes) {
  const out = [];
  if (arc) {
    if (!won && arc.peak >= 4000) out.push(`Вы вели до ${k1(arc.peak)} на ${arc.peak_min}-й минуте и проиграли.`);
    else if (won && arc.low <= -4000) out.push(`Вы отставали на ${k1(arc.low)} на ${arc.low_min}-й минуте и вытащили.`);
    else if (!won) out.push(arc.low <= -4000 ? `Вы отставали с ранней игры, до ${k1(arc.low)} на ${arc.low_min}-й минуте.` : "Игра шла ровно и решилась в концовке.");
    else out.push(arc.peak >= 4000 ? `Вы вели с ${arc.peak_min <= 15 ? "ранней игры" : "середины игры"}, до ${k1(arc.peak)}.` : "Игра шла ровно, и вы забрали её в концовке.");
  }
  const low = (t) => (/^[А-ЯЁ][а-яё]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  if (arc && !won && arc.drop && arc.drop.size >= 5000 && arc.drop.from >= 10) out.push(`Перевес ушёл с ${arc.drop.from}-й по ${arc.drop.to}-ю минуту: ${signedK(-arc.drop.size)}.`);
  const c = causes.slice(0, 2).map((x) => low(x.title));
  if (c.length) out.push(`${won ? "Что могло стоить игры" : "Главное"}: ${c.join("; ")}.`);
  if (mistakes.length) out.push(`Твоё: ${mistakes.slice(0, 2).map((x) => low(x.title)).join("; ")}.`);
  return out.join(" ");
}
