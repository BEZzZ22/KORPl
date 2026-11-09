// Видеоразбор, шаг 3: сценарий ролика. Из моментов (moments.mjs) собирает текст диктора и подписи по шаблонам texts.json.
// У каждой фразы два вида: text — что на экране (цифрами), say — что читает диктор (числа словами).
// Выбор варианта шаблона зависит только от номера матча: тот же матч даёт тот же текст.
import { readFileSync } from "node:fs";

const TEXTS = JSON.parse(readFileSync(new URL("./texts.json", import.meta.url), "utf8"));

// ---------- числа словами ----------
const ONES = ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать",
  "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
export const plural = (n, one, few, many) => {
  const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
function below1000(n, fem) {
  const out = [];
  if (n >= 100) { out.push(HUNDREDS[Math.floor(n / 100)]); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; }
  if (n > 0) out.push(fem && n === 1 ? "одна" : fem && n === 2 ? "две" : ONES[n]);
  return out.join(" ");
}
export function cardinal(n, fem = false) {
  n = Math.round(Math.abs(n));
  if (n === 0) return ONES[0];
  const th = Math.floor(n / 1000), rest = n % 1000, out = [];
  if (th) out.push(`${below1000(th, true)} ${plural(th, "тысяча", "тысячи", "тысяч")}`);
  if (rest) out.push(below1000(rest, fem));
  return out.join(" ");
}
const ORD_ONES = ["", "первой", "второй", "третьей", "четвёртой", "пятой", "шестой", "седьмой", "восьмой", "девятой", "десятой", "одиннадцатой",
  "двенадцатой", "тринадцатой", "четырнадцатой", "пятнадцатой", "шестнадцатой", "семнадцатой", "восемнадцатой", "девятнадцатой"];
const ORD_TENS = ["", "", "двадцатой", "тридцатой", "сороковой", "пятидесятой", "шестидесятой", "семидесятой", "восьмидесятой", "девяностой"];
// «на двадцать третьей (минуте)»: порядковое, женский род, предложный падеж
export function ordinalFem(n) {
  if (n >= 100) { const r = n % 100; return r ? `сто ${ordinalFem(r)}` : "сотой"; }
  if (n < 20) return ORD_ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return o ? `${TENS[t]} ${ORD_ONES[o]}` : ORD_TENS[t];
}
const TOGETHER = ["", "в одиночку", "вдвоём", "втроём", "вчетвером", "впятером"];
const AGAINST = ["", "одного", "двоих", "троих", "четверых", "пятерых"];
const GROUP = ["никого", "один", "двое", "трое", "четверо", "пятеро"];

const both = (text, say = text) => ({ text: String(text), say: String(say) });
const mmss = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
function seconds(n) {
  const w = plural(n, "секунду", "секунды", "секунд");
  return both(`${n} ${w}`, `${cardinal(n, true)} ${w}`);
}
function duration(sec) {
  if (sec < 90) return seconds(Math.max(1, Math.round(sec / 5) * 5 || sec));
  const m = Math.round(sec / 60), w = plural(m, "минуту", "минуты", "минут");
  return both(`${m} ${w}`, `${cardinal(m, true)} ${w}`);
}
function listRu(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}
const LANE = { top: "верх", mid: "мид", bot: "низ" };
// «две башни и сторону бараков» (винительный падеж); short — для плашки на экране
export function buildingsPhrase(list, { rosh = false } = {}) {
  const fort = list.some((b) => b.kind === "fort");
  const raxLanes = new Set(list.filter((b) => b.kind === "rax").map((b) => b.lane)).size;
  const towers = list.filter((b) => /^t\d/.test(b.kind) && b.lane).length + new Set(list.filter((b) => b.kind === "t4").map((b) => b.t)).size;
  const parts = [], say = [], short = [];
  if (fort) { parts.push("трон"); say.push("трон"); short.push("Трон"); }
  if (!fort && towers) {
    const w = plural(towers, "башню", "башни", "башен");
    parts.push(towers === 1 ? "башню" : `${towers} ${w}`);
    say.push(towers === 1 ? "башню" : `${cardinal(towers, true)} ${w}`);
    short.push(towers === 1 ? "Башня" : `${towers} ${w}`);
  }
  if (!fort && raxLanes) {
    const p = raxLanes === 1 ? "сторону бараков" : raxLanes === 2 ? "две стороны бараков" : "все бараки";
    parts.push(p); say.push(p);
    short.push(raxLanes === 3 ? "Все бараки" : `Бараки: ${raxLanes} ${plural(raxLanes, "сторона", "стороны", "сторон")}`);
  }
  if (rosh) { parts.push("Рошана"); say.push("Рошана"); short.push("Рошан"); }
  return { ...both(listRu(parts), listRu(say)), short, empty: !parts.length };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// cons: false — без фразы «чем кончилось» (она остаётся плашкой на экране): так ролик короче
export function buildScript(data, found, { cons = true } = {}) {
  const me = found.me, T = found.team, P = data.players;
  const seed = String(data.match_id || `${data.end}:${data.kills.length}`);
  const pick = (key, salt = "") => {
    const v = TEXTS[key];
    if (!v) throw new Error(`нет шаблона ${key}`);
    return Array.isArray(v) ? v[hash(`${seed}:${key}:${salt}`) % v.length] : v;
  };
  // подстановка {имя}: в text идёт экранный вид, в say — речевой. Первая буква фразы — заглавная
  const fill = (key, vars = {}, salt = "") => {
    const tpl = pick(key, salt);
    const render = (field) => {
      const s = tpl.replace(/\{(\w+)\}/g, (_, name) => {
        if (!(name in vars)) throw new Error(`в шаблоне ${key} нет значения ${name}`);
        const v = vars[name];
        return typeof v === "object" ? v[field] : String(v);
      });
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    return { text: render("text"), say: render("say") };
  };
  const heroes = (slots) => listRu(slots.map((s) => P[s].ru));
  const minute = (t) => { const m = Math.floor(Math.max(0, t) / 60) + 1; return both(`на ${m}-й минуте`, `на ${ordinalFem(m)} минуте`); };
  const score = (a, b) => both(`${a}:${b}`, `${cardinal(a)} — ${cardinal(b)}`);
  const deaths = (n) => (n === 0 ? both("ни одной смерти") : both(`${n} ${plural(n, "смерть", "смерти", "смертей")}`, `${cardinal(n, true)} ${plural(n, "смерть", "смерти", "смертей")}`));
  const gold = (n) => { const g = Math.round(Math.abs(n) / 100) * 100; return both(thousands(g), cardinal(g)); };
  const isCore = (t) => {
    const mates = P.filter((p) => p.team === T).map((p) => [p.slot, data.nw[p.slot][Math.max(0, Math.min(data.nw[p.slot].length - 1, Math.floor((t - data.start) / data.nw_step)))]]);
    return mates.sort((a, b) => b[1] - a[1]).slice(0, 2).some((x) => x[0] === me);
  };

  const segments = [];
  const my = P[me], won = data.winner === T;
  const n = found.moments.length;
  const nMoments = both(`${n} ${plural(n, "момент", "момента", "моментов")}`, `${cardinal(n)} ${plural(n, "момент", "момента", "моментов")}`);
  const kda = both(`${my.k}/${my.d}/${my.a ?? 0}`, `${cardinal(my.k)}, ${cardinal(my.d)}, ${cardinal(my.a ?? 0)}`);
  segments.push({ kind: "intro", lines: [fill("intro", { hero: my.ru, kda, result: both(pick(won ? "result.win" : "result.lose")), n_moments: nMoments })],
    hero: my.ru, kda: kda.text, won });

  found.moments.forEach((m, i) => {
    const f = m.facts, lines = [], chips = [], v = { minute: minute(m.t) };
    let title;
    if (m.type === "death") {
      title = pick(`title.death.${m.sub}`);
      const att = f.attackers.length ? f.attackers : f.killer >= 0 ? [f.killer] : [];
      v.attackers = att.length ? heroes(att) : "враг";
      v.kill_verb = att.length > 1 ? "убивают" : "убивает";
      if (m.sub === "buyback_wasted") { v.bb_gap = seconds(f.prev_buyback); lines.push(fill("death.what.buyback_wasted", v, i)); }
      else if (m.sub === "deep") lines.push(fill("death.what.deep", v, i));
      else lines.push(fill(att.length > 1 ? "death.what.gank" : "death.what.single", v, i));
      if (f.enemy_obs) v.ward_age = duration(f.enemy_obs.age);
      lines.push(fill(`death.why.${m.sub}`, v, i));
      const b = buildingsPhrase(f.buildings, { rosh: f.rosh });
      if (!b.empty) { v.buildings = b; lines.push(fill("death.cons.buildings", v, i)); chips.push(...b.short.map((label) => ({ label, tone: "bad" }))); }
      else if (f.down >= 60) { v.down = seconds(f.down); lines.push(fill("death.cons.down", v, i)); }
      if (f.down >= 20) chips.unshift({ label: `${f.down} с без тебя`, tone: "bad" });
      if (f.buyback) chips.push({ label: "Выкуп потрачен", tone: "bad" });
      lines.push(fill(m.sub === "under_ward" ? `death.tip.under_ward.${isCore(m.t) ? "core" : "support"}` : `death.tip.${m.sub}`, v, i));
    } else if (m.type === "fight_lost") {
      title = pick("title.fight_lost");
      v.ours = TOGETHER[Math.min(5, Math.max(1, f.ours))]; v.theirs = AGAINST[Math.min(5, Math.max(1, f.theirs))];
      v.ours_n = GROUP[Math.min(5, f.ours)]; v.theirs_n = GROUP[Math.min(5, f.theirs)];
      v.score = score(f.dead_them, f.dead_us);
      v.dead_us_deaths = deaths(f.dead_us); v.dead_them_deaths = deaths(f.dead_them);
      lines.push(fill(`fight.what.${m.sub}`, v, i));
      lines.push(fill("fight.score", v, i));
      const b = buildingsPhrase(f.buildings, { rosh: f.rosh });
      if (!b.empty) { v.buildings = b; lines.push(fill("fight.cons.buildings", v, i)); chips.push(...b.short.map((label) => ({ label, tone: "bad" }))); }
      else if (f.swing <= -1500) { v.gold = gold(f.swing); lines.push(fill("fight.cons.gold", v, i)); }
      if (f.swing <= -800) chips.unshift({ label: `−${thousands(Math.round(-f.swing / 100) * 100)} золота`, tone: "bad" });
      chips.unshift({ label: `Драка ${f.dead_them}:${f.dead_us}`, tone: "bad" });
      const tipKey = m.sub === "first" ? `fight.tip.first.${isCore(m.t) ? "core" : "support"}` : `fight.tip.${m.sub}`;
      lines.push(fill(tipKey, v, i));
    } else if (m.type === "rosh_lost") {
      title = pick("title.rosh_lost");
      v.alive = f.alive >= 5 ? "все пятеро" : GROUP[f.alive];
      lines.push(fill("rosh.what", v, i));
      lines.push(fill(`rosh.why.${m.sub}`, v, i));
      const b = buildingsPhrase(f.buildings);
      if (!b.empty) { v.buildings = b; lines.push(fill("rosh.cons", v, i)); chips.push(...b.short.map((label) => ({ label, tone: "bad" }))); }
      chips.unshift({ label: "Аегис у врага", tone: "bad" });
      lines.push(fill("rosh.tip", v, i));
    } else if (m.type === "no_objective") {
      title = pick("title.no_objective");
      v.score = score(f.dead_them, f.dead_us);
      lines.push(fill("noobj.what", v, i));
      lines.push(fill(`noobj.why.${m.sub}`, v, i));
      chips.push({ label: "Башни целы", tone: "bad" });
      if (f.rosh_up) chips.push({ label: "Рошан жив", tone: "bad" });
      lines.push(fill("noobj.tip", v, i));
    } else {
      title = pick("title.highlight");
      v.score = score(f.dead_them, f.dead_us);
      const w = plural(f.my_kills, "убийство", "убийства", "убийств");
      v.my_kills = both(`${f.my_kills} ${w}`, `${cardinal(f.my_kills)} ${w}`.replace(/^один /, "одно ").replace(/^два /, "два "));
      lines.push(fill("good.what", v, i));
      lines.push(fill("good.why", v, i));
      if (f.swing >= 800) chips.push({ label: `+${thousands(Math.round(f.swing / 100) * 100)} золота`, tone: "good" });
      chips.push({ label: `${f.my_kills} ${w}`, tone: "good" });
      lines.push(fill("good.tip", v, i));
    }
    // роли фраз: что случилось, почему, чем кончилось, что делать
    lines.forEach((l, j) => { l.role = j === 0 ? "what" : j === lines.length - 1 ? "tip" : j === 1 ? "why" : "cons"; });
    if (!cons) for (let j = lines.length - 1; j >= 0; j--) if (lines[j].role === "cons") lines.splice(j, 1);
    segments.push({ kind: "moment", index: i, type: m.type, sub: m.sub, good: m.type === "highlight", title, clock: mmss(m.t), lines, chips: chips.slice(0, 3) });
  });

  // вывод: по самой частой ошибке (при равенстве — по самой тяжёлой)
  const bad = found.moments.filter((m) => m.type !== "highlight");
  const weight = {};
  for (const m of bad) weight[m.type] = (weight[m.type] || 0) + 100 + m.score;
  const main = Object.entries(weight).sort((a, b) => b[1] - a[1])[0];
  segments.push({ kind: "outro", lines: [fill(`outro.${main ? main[0] : "highlight"}`), fill("outro.cta")] });
  return { v: 1, match_id: data.match_id, me, team: T, segments };
}
