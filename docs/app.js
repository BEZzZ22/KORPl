// Telegram Mini App: разбор матча Dota 2 в виде приложения внутри Телеграма.
import {
  analyze, createDictionary, isParsed, mmss, plural, CATEGORIES, BAD, WARN, GOOD,
} from "./engine.js";

const API = "https://api.opendota.com/api";
const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com";
const STEAM64_OFFSET = 76561197960265728n;
const PARSE_POLL_MS = 15000;
const PARSE_POLL_MAX = 20;
const DAMAGE_TYPES = { Physical: "физический", Magical: "магический", Pure: "чистый" };
const SEVERITY_LABEL = { [BAD]: "Проблема", [WARN]: "Ошибка", [GOOD]: "Хорошо" };

const tg = window.Telegram && window.Telegram.WebApp;
const app = document.getElementById("app");
let dictionary = null;
let knowledge = null;
let pollTimer = null;

// ---------- утилиты ----------

// Создаёт элемент. Текст всегда через textContent, чтобы данные из API не стали HTML
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const child of children.flat()) {
    if (child == null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function render(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function img(path, cls, alt = "") {
  if (!path) return null;
  return h("img", { src: STEAM_CDN + path, class: cls, alt, loading: "lazy" });
}

function heroImg(heroId, cls = "hero-img") {
  return img(dictionary.heroImage(heroId), cls, dictionary.heroName(heroId));
}

function scoreColor(score) {
  if (score >= 7) return "var(--good)";
  if (score >= 5) return "var(--warn)";
  return "var(--bad)";
}

function haptic(type = "light") {
  try { tg && tg.HapticFeedback.impactOccurred(type); } catch { /* старый клиент */ }
}

async function api(path, { method = "GET", timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(API + path, { method, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OpenDota ответила ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toAccountId(raw) {
  const digits = String(raw).trim();
  if (!/^\d{1,20}$/.test(digits)) return null;
  const n = BigInt(digits);
  const id = n > STEAM64_OFFSET ? n - STEAM64_OFFSET : n;
  return id > 0n && id < 2n ** 32n ? Number(id) : null;
}

// ---------- хранение аккаунта (облако Телеграма, иначе браузер) ----------

const storage = {
  get(key) {
    return new Promise((resolve) => {
      if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) {
        tg.CloudStorage.getItem(key, (err, value) => resolve(err ? null : value || null));
        return;
      }
      try { resolve(localStorage.getItem(key)); } catch { resolve(null); }
    });
  },
  set(key, value) {
    if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) {
      tg.CloudStorage.setItem(key, value);
      return;
    }
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  },
};

// ---------- навигация ----------

const navStack = [];

function go(screen, ...args) {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  navStack.push([screen, args]);
  updateBackButton();
  return screen(...args);
}

function back() {
  navStack.pop();
  const prev = navStack.pop();
  if (prev) go(prev[0], ...prev[1]);
  else go(homeScreen);
}

const backSupported = () => Boolean(tg && tg.BackButton && tg.isVersionAtLeast && tg.isVersionAtLeast("6.1"));

function updateBackButton() {
  if (!backSupported()) return;
  if (navStack.length > 1) tg.BackButton.show();
  else tg.BackButton.hide();
}

// ---------- экраны ----------

function loading(text) {
  render(h("div", { class: "center" }, h("div", { class: "spinner" }), h("div", { class: "muted" }, text)));
}

function errorScreen(message, retry) {
  render(
    h("div", { class: "center" },
      h("p", { class: "error" }, message),
      retry && h("button", { onclick: retry }, "Попробовать ещё раз"),
    ),
  );
}

async function homeScreen() {
  const account = await storage.get("account_id");
  const matchInput = h("input", { inputmode: "numeric", placeholder: "ID матча или ссылка", "aria-label": "ID матча" });
  const openMatch = () => {
    const m = /(?<!\d)(\d{7,11})(?!\d)/.exec(matchInput.value);
    if (m) go(matchScreen, Number(m[1]), null);
    else matchInput.focus();
  };

  const nodes = [
    h("h1", {}, "Dota-тренер"),
    h("p", { class: "muted" }, "Разбор твоих игр: где ошибся, кто и чем тебя убивал, что покупать."),
    h("div", { class: "card" },
      h("div", { class: "row" }, h("div", { class: "grow" }, matchInput), h("button", { onclick: openMatch }, "Разобрать")),
    ),
  ];

  if (!account) {
    nodes.push(accountForm());
    render(...nodes);
    return;
  }

  const list = h("div", {}, h("div", { class: "center" }, h("div", { class: "spinner" })));
  nodes.push(
    h("div", { class: "row" },
      h("h2", { class: "grow" }, "Последние игры"),
      h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); go(homeScreen); } }, "Сменить аккаунт"),
    ),
    list,
  );
  render(...nodes);

  try {
    const matches = (await api(`/players/${account}/recentMatches`)) || [];
    if (!matches.length) {
      list.replaceChildren(h("div", { class: "card muted" },
        "Матчей не видно. В Доте включи: Настройки → Социальное → «Открыть доступ к данным матчей», " +
        "сыграй катку и зайди сюда снова."));
      api(`/players/${account}/refresh`, { method: "POST" }).catch(() => {});
      return;
    }
    list.replaceChildren(...matches.slice(0, 15).map((m) => matchListItem(m, account)));
  } catch {
    list.replaceChildren(h("p", { class: "error" }, "OpenDota не отвечает. Попробуй позже."));
  }
}

function accountForm() {
  const input = h("input", { inputmode: "numeric", placeholder: "Friend ID или Steam ID", "aria-label": "Friend ID" });
  const status = h("div", { class: "small muted" }, "Friend ID есть в Доте в профиле под ником.");
  const save = async () => {
    const id = toAccountId(input.value);
    if (!id) { status.textContent = "Это не похоже на Friend ID."; return; }
    status.textContent = "Проверяю...";
    try {
      const player = await api(`/players/${id}`);
      if (!player || !player.profile) { status.textContent = "OpenDota не знает такой аккаунт."; return; }
      storage.set("account_id", String(id));
      haptic("medium");
      go(homeScreen);
    } catch {
      status.textContent = "OpenDota не отвечает. Попробуй ещё раз.";
    }
  };
  return h("div", { class: "card" },
    h("b", {}, "Привяжи аккаунт"),
    h("div", { class: "row" }, h("div", { class: "grow" }, input), h("button", { onclick: save }, "Ок")),
    status,
  );
}

function matchListItem(m, account) {
  const won = (m.player_slot < 128) === m.radiant_win;
  const date = new Date(m.start_time * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return h("button", { class: "match-item", onclick: () => { haptic(); go(matchScreen, m.match_id, null, Number(account)); } },
    h("div", { class: "row" },
      heroImg(m.hero_id),
      h("div", { class: "grow" },
        h("div", {}, h("span", { class: `result ${won ? "win" : "loss"}` }, won ? "Победа" : "Поражение"), " · ",
          dictionary.heroName(m.hero_id)),
        h("div", { class: "small muted" }, `${m.kills}/${m.deaths}/${m.assists} · ${Math.floor(m.duration / 60)} мин · ${date}`),
      ),
    ),
  );
}

async function matchScreen(matchId, slot, accountId, attempt = 0) {
  if (attempt === 0) loading("Загружаю матч...");
  let match;
  try {
    match = await api(`/matches/${matchId}`);
  } catch {
    errorScreen("OpenDota не отвечает.", () => go(matchScreen, matchId, slot, accountId));
    return;
  }
  if (!match || !match.players) {
    errorScreen("Такого матча нет. Проверь ID.", () => go(homeScreen));
    return;
  }

  if (!isParsed(match)) {
    if (attempt === 0) api(`/request/${matchId}`, { method: "POST" }).catch(() => {});
    if (attempt >= PARSE_POLL_MAX) {
      errorScreen("Реплей так и не разобрался. Возможно, он ещё не доступен — попробуй позже.",
        () => go(matchScreen, matchId, slot, accountId));
      return;
    }
    render(h("div", { class: "center" },
      h("div", { class: "spinner" }),
      h("p", {}, "Реплей разбирается на OpenDota"),
      h("p", { class: "small muted" }, "Обычно 1-5 минут. Страница обновится сама."),
    ));
    pollTimer = setTimeout(() => matchScreen(matchId, slot, accountId, attempt + 1), PARSE_POLL_MS);
    return;
  }

  let player = null;
  if (slot != null) player = match.players.find((p) => p.player_slot === slot);
  if (!player && accountId) player = match.players.find((p) => p.account_id === accountId);
  if (!player) {
    const saved = Number(await storage.get("account_id"));
    if (saved) player = match.players.find((p) => p.account_id === saved);
  }
  if (!player) {
    heroPicker(match);
    return;
  }

  const result = analyze(match, player, dictionary, knowledge);
  analysisScreen(result);
}

function heroPicker(match) {
  const button = (p) => h("button", { onclick: () => { haptic(); go(matchScreen, match.match_id, p.player_slot); } },
    img(dictionary.heroImage(p.hero_id), null, ""), dictionary.heroName(p.hero_id));
  const radiant = match.players.filter((p) => p.isRadiant);
  const dire = match.players.filter((p) => !p.isRadiant);
  render(
    h("h1", {}, "За кого разбор?"),
    h("p", { class: "muted" }, "Тебя нет в этом матче или аккаунт не привязан. Выбери героя."),
    h("div", { class: "picker" },
      h("b", { class: "win" }, "Свет"), h("b", { class: "loss" }, "Тьма"),
      ...radiant.flatMap((r, i) => [button(r), dire[i] ? button(dire[i]) : h("span")]),
    ),
  );
}

// ---------- экран разбора ----------

const TABS = [
  ["Обзор", overviewTab],
  ["Ошибки", findingsTab],
  ["Кто убивал", killersTab],
  ["Предметы", itemsTab],
  ["Графики", chartsTab],
];

function analysisScreen(a) {
  const f = a.facts;
  const content = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const select = (i) => {
    [...tabs.children].forEach((t, j) => t.classList.toggle("active", i === j));
    content.replaceChildren(TABS[i][1](a));
  };
  TABS.forEach(([name], i) => tabs.append(h("button", { class: "tab", role: "tab", onclick: () => { haptic(); select(i); } }, name)));

  render(
    h("div", { class: "card" },
      h("div", { class: "row" },
        heroImg(f.hero_id, "hero-img big"),
        h("div", { class: "grow" },
          h("h1", {}, f.hero),
          h("div", { class: "small muted" },
            h("span", { class: `badge ${f.won ? "win" : "loss"}` }, f.won ? "Победа" : "Поражение"),
            ` позиция ${f.position} · ${f.duration}`),
          f.lane_opponent && h("div", { class: "small muted" }, `против ${f.lane_opponent}`),
        ),
        scoreRing(a.overall),
      ),
      h("div", { class: "stats" },
        stat(f.kda, "KDA"), stat(f.gpm, "GPM"), stat(f.xpm, "XPM"), stat(`${f.last_hits}/${f.denies}`, "LH/DN"),
      ),
    ),
    tabs,
    content,
  );
  select(0);
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
}

function scoreRing(score) {
  const r = 26, c = 2 * Math.PI * r;
  return svg("svg", { class: "ring", width: 64, height: 64, viewBox: "0 0 64 64", "aria-label": `Оценка ${score} из 10` },
    svg("circle", { cx: 32, cy: 32, r, fill: "none", stroke: "var(--line)", "stroke-width": 6 }),
    svg("circle", {
      cx: 32, cy: 32, r, fill: "none", stroke: scoreColor(score), "stroke-width": 6, "stroke-linecap": "round",
      "stroke-dasharray": `${(score / 10) * c} ${c}`, transform: "rotate(-90 32 32)",
    }),
    svg("text", { x: 32, y: 37, "text-anchor": "middle", "font-size": 16 }, score.toFixed(1)),
  );
}

function overviewTab(a) {
  const problems = a.findings.filter((f) => f.severity === BAD && f.kind !== "killer").slice(0, 3);
  const goods = a.findings.filter((f) => f.severity === GOOD).slice(0, 3);
  const focus = a.findings.filter((f) => (f.severity === BAD || f.severity === WARN) && f.tip && f.kind !== "killer").slice(0, 3);
  return h("div", {},
    h("div", { class: "card" },
      ...CATEGORIES.map((c) => h("div", { class: "score-row" },
        h("span", {}, c),
        h("div", { class: "bar" }, h("i", { "data-w": a.scores[c] })),
        h("b", {}, a.scores[c]),
      )),
    ),
    problems.length > 0 && h("h2", {}, "Главное"),
    ...problems.map(findingCard),
    focus.length > 0 && h("h2", {}, "Над чем работать"),
    focus.length > 0 && h("div", { class: "card" }, h("ol", {}, ...focus.map((f) => h("li", {}, f.tip)))),
    goods.length > 0 && h("h2", {}, "Что получилось"),
    ...goods.map(findingCard),
  );
}

function findingCard(f) {
  return h("div", { class: `finding ${f.severity}` },
    h("div", { class: "cat" }, `${SEVERITY_LABEL[f.severity]} · ${f.category}`),
    h("div", {}, f.text),
    f.tip && h("div", { class: "tip" }, "→ " + f.tip),
  );
}

function findingsTab(a) {
  const groups = CATEGORIES
    .map((c) => [c, a.findings.filter((f) => f.category === c && f.kind !== "killer")])
    .filter(([, list]) => list.length);
  if (!groups.length) return h("p", { class: "muted" }, "Явных ошибок не нашёл. Красавчик.");
  const order = { [BAD]: 0, [WARN]: 1, [GOOD]: 2 };
  return h("div", {}, ...groups.map(([c, list]) => h("div", {},
    h("h2", {}, `${c} · ${a.scores[c]}/10`),
    ...list.sort((x, y) => order[x.severity] - order[y.severity]).map(findingCard),
  )));
}

function killersTab(a) {
  if (!a.killers.length) {
    return h("p", { class: "muted" }, "Никто не убил тебя больше одного раза. Выживание на уровне.");
  }
  return h("div", {}, ...a.killers.map((k) => {
    const total = Object.values(k.damage_by_type).reduce((x, y) => x + y, 0) || 1;
    return h("div", { class: "card" },
      h("div", { class: "row" },
        heroImg(k.hero_id),
        h("div", { class: "grow" },
          h("b", {}, k.hero),
          h("div", { class: "small muted" }, `${k.deaths} ${plural(k.deaths, "смерть", "смерти", "смертей")} · ${k.damage} урона по тебе`),
        ),
      ),
      h("div", { class: "dmg-bar" }, ...Object.entries(k.damage_by_type).map(([t, v]) =>
        h("i", { class: t, "data-w": (v / total) * 100 }))),
      h("div", { class: "legend" }, ...Object.entries(k.damage_by_type).map(([t, v]) =>
        h("span", {}, h("i", { class: t }), `${DAMAGE_TYPES[t]} ${Math.round((v / total) * 100)}%`))),
      h("h2", {}, "Чем убивал"),
      ...k.sources.map((s) => h("div", { class: "source" }, h("span", {}, s.name), h("b", {}, s.damage))),
      k.disables.length > 0 && h("h2", {}, "Контроль на тебе"),
      ...k.disables.map((d) => h("div", { class: "source" }, h("span", {}, d.name), h("b", {}, `×${d.count}`))),
      k.mechanics.length > 0 && h("div", { class: "small muted" }, "Опасен: " + k.mechanics.join(", ")),
      ...k.tips.map((t) => h("div", { class: "finding warn" }, h("div", {}, t))),
      k.counter_keys.length > 0 && h("h2", {}, "Что купить"),
      k.counter_keys.length > 0 && h("div", { class: "chips" }, ...k.counter_keys.map((key) => itemChip(key, "chip need"))),
      k.had_counter_keys.length > 0 && h("div", { class: "small muted" }, "Уже было: " + k.had_counters.join(", ")),
    );
  }));
}

function itemChip(key, cls = "chip") {
  return h("span", { class: cls }, img(dictionary.itemImage(key), null, ""), dictionary.itemName(key));
}

function itemsTab(a) {
  if (!a.items.length) return h("p", { class: "muted" }, "Крупных предметов не было.");
  return h("div", { class: "card" }, ...a.items.map((it) =>
    h("div", { class: "item-row" }, img(dictionary.itemImage(it.key), null, ""), h("span", {}, it.item), h("time", {}, mmss(it.time)))));
}

function chartsTab(a) {
  const t = a.timeline;
  const series = [{ values: t.player, color: "var(--accent)", label: t.hero }];
  if (t.opponent) series.push({ values: t.opponent, color: "var(--opponent)", label: t.opponent_name });
  return h("div", {},
    h("h2", {}, "Нетворс против оппонента"),
    h("div", { class: "card" }, lineChart(series, { markers: t.deaths, unit: "k" }), legend(series, true)),
    h("h2", {}, "Преимущество твоей команды"),
    h("div", { class: "card" }, lineChart([{ values: t.team_gold_adv, color: "var(--good)" }], { zero: true, unit: "k" })),
    h("h2", {}, "Ластхиты по минутам"),
    h("div", { class: "card" }, lineChart([{ values: t.last_hits, color: "var(--warn)" }], {})),
  );
}

function legend(series, deaths) {
  return h("div", { class: "legend" },
    ...series.map((s) => h("span", {}, h("i", { "data-color": s.color }), s.label)),
    deaths && h("span", {}, h("i", { class: "Physical" }), "твои смерти"),
  );
}

// Линейный график на SVG без библиотек
function lineChart(series, { markers = [], zero = false, unit = "" } = {}) {
  const W = 340, H = 170, L = 34, R = 8, T = 10, B = 20;
  const all = series.flatMap((s) => s.values);
  let min = Math.min(...all), max = Math.max(...all);
  if (zero) { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; min = -m; max = m; }
  else { min = Math.min(0, min); }
  if (max === min) max = min + 1;
  const n = Math.max(...series.map((s) => s.values.length)) - 1 || 1;
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const fmt = (v) => (unit === "k" ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

  const chart = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img" });
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    chart.append(svg("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }), svg("text", { x: 2, y: y(v) + 3 }, fmt(v)));
  }
  for (let m = 0; m <= n; m += 10) chart.append(svg("text", { x: x(m) - 4, y: H - 4 }, m));
  if (zero) chart.append(svg("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: "var(--muted)", "stroke-width": 1 }));
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    chart.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
  }
  const base = series[0].values;
  for (const t of markers) {
    const i = Math.min(Math.floor(t / 60), base.length - 1);
    chart.append(svg("circle", { cx: x(t / 60), cy: y(base[i]), r: 3.5, fill: "var(--bad)" }));
  }
  return chart;
}

// Ширины полосок и цвета легенды выставляем из JS: CSP запрещает inline-стили в разметке
function applyDynamicStyles(root) {
  root.querySelectorAll("[data-w]").forEach((el) => {
    el.style.width = `${Number(el.dataset.w) * (el.closest(".bar") ? 10 : 1)}%`;
    if (el.closest(".bar")) el.style.background = scoreColor(Number(el.dataset.w));
  });
  root.querySelectorAll("[data-color]").forEach((el) => { el.style.background = el.dataset.color; });
}
new MutationObserver(() => applyDynamicStyles(app)).observe(app, { childList: true, subtree: true });

// ---------- запуск ----------

function startParams() {
  const q = new URLSearchParams(location.search);
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
  // start_param из ссылки t.me/бот/app?startapp=m9052987576_s4
  const sm = /^m(\d{7,11})(?:_s(\d{1,3}))?$/.exec(start);
  const matchId = q.get("match") || (sm && sm[1]);
  const slot = q.get("slot") || (sm && sm[2]);
  const account = q.get("account");
  return {
    matchId: /^\d{7,11}$/.test(matchId || "") ? Number(matchId) : null,
    slot: /^\d{1,3}$/.test(slot || "") ? Number(slot) : null,
    account: account ? toAccountId(account) : null,
  };
}

async function boot() {
  if (tg) {
    tg.ready();
    tg.expand();
    if (backSupported()) tg.BackButton.onClick(back);
  }
  loading("Загружаю справочники...");
  try {
    const [heroes, items, abilities, kb] = await Promise.all([
      api("/constants/heroes"), api("/constants/items"), api("/constants/abilities", { timeout: 40000 }),
      fetch("knowledge.json").then((r) => r.json()),
    ]);
    dictionary = createDictionary({ heroes, items, abilities });
    knowledge = kb;
  } catch {
    errorScreen("Не удалось загрузить данные OpenDota.", boot);
    return;
  }

  const { matchId, slot, account } = startParams();
  if (account) storage.set("account_id", String(account));
  if (matchId) {
    navStack.push([homeScreen, []]);
    go(matchScreen, matchId, slot, account);
  } else {
    go(homeScreen);
  }
}

boot();
