// Telegram Mini App: разбор матча Dota 2 внутри Телеграма.
import {
  analyze, createDictionary, isParsed, mmss, num, plural, proItemCounts, CATEGORIES, BAD, WARN, GOOD,
} from "./engine.js?v=6";

// Медали ранга Доты: старший разряд ранг-тира — медаль, младший — звёзды
const MEDALS = ["Рекрут", "Страж", "Рыцарь", "Герой", "Легенда", "Властелин", "Божество", "Титан"];
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const BOT_USERNAME = "DotaRazbor_bot";

// Иконки нижней навигации (контурные, под CSP: собираются в JS, без innerHTML)
const NAV_ICONS = {
  home: "M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9",
  match: "M4 5h16M4 5v14M4 19h16M8 15l3-4 2 2 3-5",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0",
};

const API = "https://api.opendota.com/api";
const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com";
const STEAM64_OFFSET = 76561197960265728n;
const PARSE_POLL_MS = 15000;
const PARSE_POLL_MAX = 20;
const BG_COLOR = "#070404";
const DAMAGE_TYPES = { Physical: "физический", Magical: "магический", Pure: "чистый" };
const SEVERITY_LABEL = { [BAD]: "Проблема", [WARN]: "Ошибка", [GOOD]: "Хорошо" };
const PHASE_LABEL = { good: "выиграна", even: "ровно", bad: "проиграна" };
const TURBO_MODE = 23;

const tg = window.Telegram && window.Telegram.WebApp;
const app = document.getElementById("app");
let dictionary = null, knowledge = null, texts = null, itemIds = null, norms = {}, glossary = [];
let pollTimer = null;
let section = "home", lastAnalysis = null, tabbar = null;
const proCache = new Map();
// Подсказки графиков прячутся по тапу вне графика: один общий обработчик на документ
const chartHiders = new Set();
document.addEventListener("pointerdown", (evt) => {
  if (!(evt.target instanceof Element) || !evt.target.closest(".chart")) chartHiders.forEach((hide) => hide());
});
const benchCache = new Map();

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
  chartHiders.clear();
  app.replaceChildren(h("div", { class: "fade-in" }, ...nodes));
  window.scrollTo(0, 0);
  updateTabbar();
}

function img(path, cls, alt = "") {
  if (!path) return null;
  return h("img", { src: STEAM_CDN + path, class: cls, alt, loading: "lazy" });
}

function heroImg(heroId, cls = "hero-img") {
  return img(dictionary.heroImage(heroId), cls, dictionary.heroName(heroId));
}

function scoreColor(score) {
  if (score >= 7) return "var(--gold)";
  if (score >= 5) return "var(--warn)";
  return "var(--bad)";
}

function haptic(type = "light") {
  try { if (tg && tg.isVersionAtLeast("6.1")) tg.HapticFeedback.impactOccurred(type); } catch { /* старый клиент */ }
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

async function proItems(heroId) {
  if (!proCache.has(heroId)) {
    try {
      proCache.set(heroId, proItemCounts(await api(`/heroes/${heroId}/itemPopularity`), itemIds));
    } catch {
      return {};
    }
  }
  return proCache.get(heroId);
}

async function heroBench(heroId) {
  if (!benchCache.has(heroId)) {
    try {
      const data = await api(`/benchmarks?hero_id=${heroId}`);
      benchCache.set(heroId, (data && data.result) || {});
    } catch {
      return {};
    }
  }
  return benchCache.get(heroId);
}

function toAccountId(raw) {
  const digits = String(raw).trim();
  if (!/^\d{1,20}$/.test(digits)) return null;
  const n = BigInt(digits);
  const id = n > STEAM64_OFFSET ? n - STEAM64_OFFSET : n;
  return id > 0n && id < 2n ** 32n ? Number(id) : null;
}

// ---------- хранение аккаунта (облако Телеграма, иначе браузер) ----------

const cloud = () => Boolean(tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9"));

const storage = {
  get(key) {
    return new Promise((resolve) => {
      if (cloud()) {
        tg.CloudStorage.getItem(key, (err, value) => resolve(err ? null : value || null));
        return;
      }
      try { resolve(localStorage.getItem(key)); } catch { resolve(null); }
    });
  },
  set(key, value) {
    if (cloud()) { tg.CloudStorage.setItem(key, value); return; }
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  },
};

// ---------- навигация ----------

const navStack = [];
const backSupported = () => Boolean(tg && tg.BackButton && tg.isVersionAtLeast && tg.isVersionAtLeast("6.1"));

function go(screen, ...args) {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  navStack.push([screen, args]);
  if (backSupported()) navStack.length > 1 ? tg.BackButton.show() : tg.BackButton.hide();
  return screen(...args);
}

function back() {
  navStack.pop();
  const prev = navStack.pop();
  go(prev ? prev[0] : homeScreen, ...(prev ? prev[1] : []));
}

// Переход на корень вкладки: сбрасываем историю внутри вкладки
function navRoot(sec, screen, ...args) {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  navStack.length = 0;
  section = sec;
  if (tg && tg.BackButton) tg.BackButton.hide();
  go(screen, ...args);
}

// Нижняя навигация: собираем один раз, держим вне #app, чтобы не пересобирать при каждом рендере
function tabButton(tab, label) {
  const icon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: NAV_ICONS[tab] }));
  return h("button", {
    class: "tabbtn", "data-tab": tab, "aria-label": label,
    onclick: () => {
      haptic();
      if (tab === "home") navRoot("home", homeScreen);
      else if (tab === "profile") navRoot("profile", profileScreen);
      else if (tab === "match") lastAnalysis ? navRoot("match", analysisScreen, lastAnalysis) : navRoot("match", matchEmpty);
    },
  }, icon, h("span", {}, label));
}

function buildTabbar() {
  tabbar = h("nav", { class: "tabbar", role: "tablist" },
    tabButton("home", "Главная"), tabButton("match", "Разбор"), tabButton("profile", "Профиль"));
  document.body.append(tabbar);
}

function updateTabbar() {
  if (!tabbar) return;
  for (const btn of tabbar.children) {
    const t = btn.dataset.tab;
    btn.classList.toggle("active", t === section);
    if (t === "match") btn.classList.toggle("disabled", !lastAnalysis);
  }
}

// ---------- экраны ----------

function loading(text) {
  render(h("div", { class: "center" }, h("div", { class: "spinner" }), h("div", { class: "muted" }, text)));
}

function errorScreen(message, retry) {
  render(h("div", { class: "center" },
    h("p", { class: "error" }, message),
    retry && h("button", { onclick: retry }, "Попробовать ещё раз"),
  ));
}

async function homeScreen() {
  section = "home";
  const account = await storage.get("account_id");
  const matchInput = h("input", { inputmode: "numeric", placeholder: "ID матча или ссылка", "aria-label": "ID матча" });
  const openMatch = () => {
    const m = /(?<!\d)(\d{7,11})(?!\d)/.exec(matchInput.value);
    if (m) go(matchScreen, Number(m[1]), null);
    else matchInput.focus();
  };
  const nodes = [
    h("div", { class: "app-top" },
      h("div", { class: "sigil" }),
      h("div", { class: "t" },
        h("h1", {}, "Dota-тренер"),
        h("p", {}, "Разбор каждой ошибки — от линии до последней драки"),
      ),
    ),
    h("div", { class: "card" },
      h("div", { class: "row" }, h("div", { class: "grow" }, matchInput), h("button", { onclick: openMatch }, "Разобрать")),
    ),
  ];
  if (!account) {
    render(...nodes, accountForm());
    return;
  }
  const list = h("div", {}, h("div", { class: "center" }, h("div", { class: "spinner" })));
  render(...nodes,
    h("div", { class: "row" },
      h("h2", { class: "grow" }, "Последние игры"),
      h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); go(homeScreen); } }, "Сменить"),
    ),
    list,
  );
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
    h("div", { class: "display" }, "Привяжи аккаунт"),
    h("div", { class: "row" }, h("div", { class: "grow" }, input), h("button", { onclick: save }, "Ок")),
    status,
  );
}

// ---------- ранг ----------

function rankLabel(tier) {
  if (!tier) return "Калибровка";
  const medal = Math.floor(tier / 10), stars = tier % 10;
  if (medal < 1 || medal > 8) return "Калибровка";
  return MEDALS[medal - 1] + (medal < 8 && stars ? ` ${ROMAN[stars] || stars}` : "");
}

function rankPip(tier) {
  const medal = tier ? Math.floor(tier / 10) : 0;
  const col = ["#9b8576", "#8fa36b", "#7fae8a", "#7f8fd0", "#c08adf", "#6fc9d6", "#ead6a0", "#ff6a2a"][medal - 1] || "#8f817a";
  return svg("svg", { class: "pip", viewBox: "0 0 24 24", "aria-hidden": "true" },
    svg("path", {
      d: "M12 3 4 7v5c0 5 3.4 7.6 8 9 4.6-1.4 8-4 8-9V7l-8-4Z",
      fill: col, "fill-opacity": "0.9", stroke: "rgba(0,0,0,0.3)", "stroke-width": "0.6",
    }),
    svg("path", { d: "M12 8.5l1.1 2.3 2.5.3-1.8 1.7.5 2.5L12 14l-2.3 1.3.5-2.5-1.8-1.7 2.5-.3L12 8.5Z", fill: "#060606", "fill-opacity": "0.55" }));
}

// ---------- экран «Профиль» (ранг-медаль, форма, любимые герои) ----------

async function profileScreen() {
  section = "profile";
  const account = await storage.get("account_id");
  if (!account) {
    render(h("div", { class: "page-head" }, h("h1", {}, "Профиль")),
      h("p", { class: "muted" }, "Привяжи аккаунт — покажу ранг, форму и любимых героев."), accountForm());
    return;
  }
  loading("Открываю профиль...");
  let player, wl, matches, heroes;
  try {
    [player, wl, matches, heroes] = await Promise.all([
      api(`/players/${account}`),
      api(`/players/${account}/wl?limit=30`),
      api(`/players/${account}/recentMatches`),
      api(`/players/${account}/heroes`),
    ]);
  } catch {
    errorScreen("OpenDota не отвечает.", profileScreen);
    return;
  }
  if (!player || !player.profile) {
    render(h("div", { class: "page-head" }, h("h1", {}, "Профиль")),
      h("div", { class: "card muted" }, "OpenDota потерял этот аккаунт. Привяжи заново."),
      h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); go(homeScreen); } }, "Сменить аккаунт"));
    return;
  }

  const prof = player.profile;
  const avatar = prof.avatarfull || prof.avatarmedium;
  const wins = (wl && wl.win) || 0, losses = (wl && wl.lose) || 0, total = wins + losses;
  const winrate = total ? Math.round((wins / total) * 100) : 0;
  const recent = (matches || []).slice(0, 20);
  const dots = recent.map((m) => {
    const won = (m.player_slot < 128) === m.radiant_win;
    return h("span", { class: `dot ${won ? "win" : "loss"}`, title: won ? "Победа" : "Поражение" });
  });
  const topHeroes = (heroes || []).filter((hx) => hx.games > 0).sort((a, b) => b.games - a.games).slice(0, 6);

  render(
    h("div", { class: "card" },
      h("div", { class: "profile-card" },
        avatar ? h("img", { class: "avatar", src: avatar, alt: "", loading: "lazy" }) : h("div", { class: "avatar" }),
        h("div", { class: "grow" },
          h("div", { class: "profile-name" }, prof.personaname || "Инкогнито"),
          h("div", { class: "rank-medal" }, rankPip(player.rank_tier), rankLabel(player.rank_tier)),
        ),
      ),
      h("div", { class: "profile-metrics" },
        h("div", { class: "metric" }, h("b", {}, String(winrate) + "%"), h("span", {}, "винрейт")),
        h("div", { class: "metric" }, h("b", {}, String(wins)), h("span", {}, "побед")),
        h("div", { class: "metric" }, h("b", {}, String(losses)), h("span", {}, "поражений")),
      ),
    ),
    recent.length > 0 && h("h2", {}, "Форма — последние игры"),
    recent.length > 0 && h("div", { class: "card" },
      h("div", { class: "form-strip" }, ...dots),
      h("div", { class: "small muted" }, `${recent.filter((m) => (m.player_slot < 128) === m.radiant_win).length} побед из ${recent.length}`),
    ),
    topHeroes.length > 0 && h("h2", {}, "Любимые герои"),
    topHeroes.length > 0 && h("div", { class: "card" }, ...topHeroes.map((hx) => {
      const wr = hx.games ? Math.round((hx.win / hx.games) * 100) : 0;
      return h("div", { class: "hero-stat" },
        heroImg(hx.hero_id),
        h("div", { class: "grow" },
          h("div", { class: "hn" }, dictionary.heroName(hx.hero_id)),
          h("div", { class: "hg" }, `${hx.games} игр`),
          h("div", { class: "wrbar" }, h("i", { "data-pct": wr })),
        ),
        h("div", { class: `wr ${wr >= 50 ? "win-text" : "loss-text"}` }, `${wr}%`),
      );
    })),
    h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); navRoot("home", homeScreen); } }, "Сменить аккаунт"),
  );
}

function matchEmpty() {
  section = "match";
  render(h("div", { class: "match-empty" },
    h("div", { class: "sigil" }),
    h("h1", {}, "Разбор пуст"),
    h("p", { class: "muted" }, "Открой матч на «Главной» — разбор появится здесь."),
    h("button", { onclick: () => navRoot("home", homeScreen) }, "На главную"),
  ));
}

function matchListItem(m, account) {
  const won = (m.player_slot < 128) === m.radiant_win;
  const date = new Date(m.start_time * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return h("button", { class: `match-item ${won ? "win" : "loss"}`, onclick: () => { haptic(); go(matchScreen, m.match_id, null, Number(account)); } },
    h("div", { class: "row" },
      heroImg(m.hero_id),
      h("div", { class: "grow" },
        h("div", {}, h("span", { class: `result ${won ? "win-text" : "loss-text"}` }, won ? "Победа" : "Поражение"), " · ",
          dictionary.heroName(m.hero_id)),
        h("div", { class: "small muted" }, `${m.kills}/${m.deaths}/${m.assists} · ${Math.floor(m.duration / 60)} мин · ${date}`),
      ),
    ),
  );
}

async function matchScreen(matchId, slot, accountId, attempt = 0) {
  if (attempt === 0) loading("Призываю матч...");
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
      errorScreen("Реплей так и не разобрался. Попробуй позже.", () => go(matchScreen, matchId, slot, accountId));
      return;
    }
    render(h("div", { class: "center" },
      h("div", { class: "spinner" }),
      h("p", { class: "display" }, "Реплей разбирается"),
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
  if (!player) { heroPicker(match); return; }

  const [pro, bench] = await Promise.all([proItems(player.hero_id), heroBench(player.hero_id)]);
  analysisScreen(analyze(match, player, dictionary, knowledge, texts, pro, bench, norms));
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
      h("div", { class: "side win-text" }, "Свет"), h("div", { class: "side loss-text" }, "Тьма"),
      ...radiant.flatMap((r, i) => [button(r), dire[i] ? button(dire[i]) : h("span")]),
    ),
  );
}

// ---------- экран разбора ----------

const TABS = [
  ["Обзор", overviewTab],
  ["Фазы", phasesTab],
  ["Ошибки", findingsTab],
  ["Убийцы", killersTab],
  ["Сборка", buildTab],
  ["Сравнение", compareTab],
  ["Графики", chartsTab],
];

function analysisScreen(a) {
  section = "match";
  lastAnalysis = a;
  const f = a.facts;
  const content = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const select = (i) => {
    [...tabs.children].forEach((t, j) => t.classList.toggle("active", i === j));
    content.replaceChildren(h("div", { class: "fade-in" }, TABS[i][1](a)));
  };
  TABS.forEach(([name], i) => tabs.append(h("button", { class: "tab", role: "tab", onclick: () => { haptic(); select(i); } }, name)));

  render(
    h("div", { class: "card hero-head" },
      h("div", { class: "hero-banner" },
        img(dictionary.heroImage(f.hero_id), null, f.hero),
        h("div", { class: "hero-title" },
          h("h1", {}, f.hero),
          h("div", { class: "small muted" },
            h("span", { class: `badge ${f.won ? "win" : "loss"}` }, f.won ? "Победа" : "Поражение"),
            ` позиция ${f.position} · ${f.duration}`),
        ),
        h("div", { class: "hero-ring" }, scoreRing(a.overall)),
      ),
      h("div", { class: "hero-body" },
        h("div", { class: "verdict" }, a.verdict),
        f.game_mode === TURBO_MODE && h("div", { class: "advice" },
          "Это Турбо: золото и опыт идут быстрее, а нормы разбора рассчитаны на обычную игру. Оценки могут быть неточными."),
        f.lane_opponent && h("div", { class: "small muted" }, `Линия против ${f.lane_opponent}`),
        h("div", { class: "stats" }, stat(f.kda, "KDA"), stat(f.gpm, "GPM"), stat(f.xpm, "XPM"), stat(`${f.last_hits}/${f.denies}`, "LH/DN")),
        h("button", { class: "share", onclick: () => shareMatch(a) },
          svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            svg("path", { d: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" })),
          "Поделиться разбором"),
      ),
    ),
    tabs,
    content,
  );
  select(0);
}

// Шеринг: короткий вердикт + прямая ссылка на этот матч в приложении (растит бота)
function shareMatch(a) {
  const f = a.facts;
  const slot = f.slot != null ? `_s${f.slot}` : "";
  const link = `https://t.me/${BOT_USERNAME}?startapp=m${f.match_id}${slot}`;
  const text = `${f.hero} · ${f.won ? "Победа" : "Поражение"} · оценка ${a.overall}/10\n${a.verdict}`;
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  haptic("medium");
  if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
}

function scoreRing(score) {
  const r = 28, c = 2 * Math.PI * r;
  return svg("svg", { class: "ring", width: 72, height: 72, viewBox: "0 0 72 72", "aria-label": `Оценка ${score} из 10` },
    svg("defs", {}, svg("linearGradient", { id: "fire", x1: 0, y1: 0, x2: 1, y2: 1 },
      svg("stop", { offset: "0%", "stop-color": "#ffb36b" }),
      svg("stop", { offset: "55%", "stop-color": "#ff3b2a" }),
      svg("stop", { offset: "100%", "stop-color": "#b3122b" }))),
    svg("circle", { cx: 36, cy: 36, r: 33, fill: "rgba(7,4,4,0.75)" }),
    svg("circle", { cx: 36, cy: 36, r, fill: "none", stroke: "rgba(255,255,255,0.08)", "stroke-width": 6 }),
    svg("circle", {
      cx: 36, cy: 36, r, fill: "none", stroke: "url(#fire)", "stroke-width": 6, "stroke-linecap": "round",
      "stroke-dasharray": `${(score / 10) * c} ${c}`, transform: "rotate(-90 36 36)",
    }),
    svg("text", { x: 36, y: 42, "text-anchor": "middle", "font-size": 18 }, score.toFixed(1)),
  );
}

function findingCard(f) {
  return h("div", { class: `finding ${f.severity}` },
    h("div", { class: "cat" }, `${SEVERITY_LABEL[f.severity]} · ${f.category}`),
    h("div", {}, f.text),
    f.roast && h("div", { class: "roast" }, f.roast),
    f.tip && h("div", { class: "tip" }, f.tip),
  );
}

function overviewTab(a) {
  const s = a.summary || {};
  const who = [s.role, s.rank && `ранг ${s.rank}`].filter(Boolean).join(" · ");
  const problems = s.problems || [];
  const strengths = s.strengths || [];
  return h("div", {},
    who && h("div", { class: "who" }, who, s.role_sure === false && h("span", { class: "muted" }, " · роль определена неточно")),
    h("h2", {}, problems.length ? "Что было не так" : "Серьёзных ошибок нет"),
    ...problems.map((p, i) => h("div", { class: "card problem" },
      h("div", { class: "problem-num" }, String(i + 1)),
      h("div", { class: "problem-body" },
        h("div", { class: "problem-title" }, p.title),
        h("div", { class: "problem-fact" }, p.fact),
        h("div", { class: "problem-action" }, p.action),
      ),
    )),
    strengths.length > 0 && h("h2", {}, "Что получилось"),
    ...strengths.map((st) => h("div", { class: "strength" }, h("b", {}, st.title), st.fact && h("span", { class: "muted" }, ` — ${st.fact}`))),
    s.goal && h("div", { class: "card goal" }, s.goal),
    h("h2", {}, "Оценки по разделам"),
    h("div", { class: "card" }, ...CATEGORIES.map((c) => h("div", { class: "score-row" },
      h("span", {}, c), h("div", { class: "bar" }, h("i", { "data-w": a.scores[c] })), h("b", {}, a.scores[c])))),
    glossaryBlock(),
  );
}

function glossaryBlock() {
  if (!glossary.length) return null;
  return h("details", { class: "card glossary" },
    h("summary", {}, "Словарик: что значат слова в разборе"),
    ...glossary.map(([term, meaning]) => h("div", { class: "gl-row" }, h("b", {}, term), h("span", {}, meaning))),
  );
}

function phasesTab(a) {
  return h("div", {},
    ...a.phases.map((ph) => h("div", { class: `card phase ${ph.verdict}` },
      h("div", { class: "phase-title" }, h("span", {}, ph.title), h("span", { class: "small" }, PHASE_LABEL[ph.verdict])),
      h("p", {}, ph.text),
      h("div", { class: "phase-stats" },
        h("span", {}, "Убийства ", h("b", {}, ph.kills)),
        h("span", {}, "Смерти ", h("b", {}, ph.deaths)),
        h("span", {}, "Крипы ", h("b", {}, `+${ph.last_hits}`)),
        ph.nw_delta != null && h("span", {}, "Нетворс ", h("b", {}, (ph.nw_delta > 0 ? "+" : "") + num(ph.nw_delta))),
      ),
    )),
    h("h2", {}, "Хронология"),
    h("div", { class: "timeline" }, ...a.moments.map((m) =>
      h("div", { class: `moment ${m.severity}` }, h("time", {}, m.clock), m.text))),
  );
}

function findingsTab(a) {
  const order = { [BAD]: 0, [WARN]: 1, [GOOD]: 2 };
  const groups = CATEGORIES
    .map((c) => [c, a.findings.filter((f) => f.category === c && f.kind !== "killer")])
    .filter(([, list]) => list.length);
  if (!groups.length) return h("p", { class: "muted" }, "Явных ошибок не нашёл. Красавчик.");
  return h("div", {}, ...groups.map(([c, list]) => h("div", {},
    h("h2", {}, `${c} · ${a.scores[c]}/10`),
    ...[...list].sort((x, y) => order[x.severity] - order[y.severity]).map(findingCard),
  )));
}

function killersTab(a) {
  if (!a.killers.length) return h("p", { class: "muted" }, "Никто не убил тебя больше одного раза. Выживание на уровне.");
  const roasts = a.findings.filter((f) => f.kind === "killer").map((f) => f.roast);
  return h("div", {}, ...a.killers.map((k, idx) => {
    const total = Object.values(k.damage_by_type).reduce((x, y) => x + y, 0) || 1;
    return h("div", { class: "card" },
      h("div", { class: "killer-head" },
        heroImg(k.hero_id),
        h("div", { class: "grow" },
          h("div", { class: "killer-name" }, k.hero),
          h("div", { class: "small muted" }, `${k.deaths} ${plural(k.deaths, "смерть", "смерти", "смертей")} · ${num(k.damage)} урона по тебе`),
        ),
      ),
      h("div", { class: "dmg-bar" }, ...Object.entries(k.damage_by_type).map(([t, v]) => h("i", { class: t, "data-w": (v / total) * 100 }))),
      h("div", { class: "legend" }, ...Object.entries(k.damage_by_type).map(([t, v]) =>
        h("span", {}, h("i", { class: t }), `${DAMAGE_TYPES[t]} ${Math.round((v / total) * 100)}%`))),
      h("div", { class: "sub" }, "Чем убивал"),
      ...k.sources.map((s) => h("div", { class: "source" }, h("span", {}, s.name), h("b", {}, num(s.damage)))),
      k.disables.length > 0 && h("div", { class: "sub" }, "Контроль на тебе"),
      ...k.disables.map((d) => h("div", { class: "source" }, h("span", {}, d.name), h("b", {}, `×${d.count}`))),
      k.mechanics.length > 0 && h("div", { class: "sub" }, "Опасен: " + k.mechanics.join(", ")),
      ...k.tips.map((t) => h("div", { class: "advice" }, t)),
      k.counter_keys.length > 0 && h("div", { class: "sub" }, "Что берут на твоём герое против него"),
      k.counter_keys.length > 0 && h("div", { class: "chips" }, ...k.counter_keys.map((key) => itemChip(key, "chip need"))),
      k.had_counter_keys.length > 0 && h("div", { class: "small muted" }, "Уже было: " + k.had_counters.join(", ")),
      roasts[idx] && h("div", { class: "roast" }, roasts[idx]),
    );
  }));
}

function itemChip(key, cls = "chip") {
  return h("span", { class: cls }, img(dictionary.itemImage(key), null, ""), dictionary.itemName(key));
}

function buildTab(a) {
  const pro = a.pro_build.length > 0 && h("div", {},
    h("h2", {}, `Про-сборка ${a.facts.hero}`),
    h("div", { class: "card" },
      ...a.pro_build.map((b) => h("div", { class: `build-row ${b.owned ? "" : "missing"}` },
        img(dictionary.itemImage(b.key), null, ""),
        h("div", {}, h("div", {}, b.item), h("div", { class: "bar" }, h("i", { "data-pct": b.share }))),
        h("div", { class: `build-status ${b.owned ? "have" : "miss"}` },
          b.owned ? (b.time != null ? mmss(b.time) : "было") : "не было"),
      )),
      h("div", { class: "small muted" }, "Полоска — как часто предмет берут на этом герое в про-матчах"),
    ),
  );
  const yours = a.items.length > 0 && h("div", {},
    h("h2", {}, "Твои предметы"),
    h("div", { class: "card" }, ...a.items.map((it) =>
      h("div", { class: "item-row" }, img(dictionary.itemImage(it.key), null, ""), h("span", {}, it.item), h("time", {}, mmss(it.time))))),
  );
  if (!pro && !yours) return h("p", { class: "muted" }, "Крупных предметов не было.");
  return h("div", {}, pro, yours);
}

function compareTab(a) {
  if (!a.compare.length) return h("p", { class: "muted" }, "Нет данных для сравнения с другими игроками на этом герое.");
  return h("div", {},
    h("h2", {}, `Ты против игроков на ${a.facts.hero}`),
    h("div", { class: "card" }, ...a.compare.map((c) => h("div", { class: "cmp-row" },
      h("div", { class: "cmp-head" }, h("span", {}, c.name), h("b", { class: c.pct >= 50 ? "win-text" : "loss-text" }, c.you)),
      h("div", { class: "cmp-scale" }, h("i", { class: "cmp-median" }), h("i", { class: "cmp-marker", "data-left": c.pct })),
      h("div", { class: "cmp-legend" },
        h("span", {}, `средний ${c.median}`),
        h("span", {}, `${c.pct >= 50 ? "лучше" : "хуже"}, чем у ${c.pct >= 50 ? c.pct : 100 - c.pct}%`),
        h("span", {}, `топ-1% ${c.top}`)),
    ))),
    h("div", { class: "small muted" }, "Шкала — твоё место среди всех игроков на этом герое: слева худшие, справа лучшие, черта — середина."),
  );
}

function chartsTab(a) {
  const t = a.timeline;
  const series = [{ values: t.player, color: "#ff6a2a", label: t.hero, glow: true }];
  if (t.opponent) series.push({ values: t.opponent, color: "#9b3b5a", label: t.opponent_name });
  return h("div", {},
    h("p", { class: "small muted" }, "Веди пальцем по графику, чтобы увидеть значения на каждой минуте."),
    h("h2", {}, "Нетворс против оппонента"),
    h("div", { class: "card" }, lineChart(series, { markers: t.deaths, unit: "k" }), legend(series, t.deaths.length > 0)),
    t.team_gold_adv.length > 0 && h("h2", {}, "Преимущество команды"),
    t.team_gold_adv.length > 0 && h("div", { class: "card" }, areaChart(t.team_gold_adv)),
    h("h2", {}, "Ластхиты"),
    h("div", { class: "card" }, lineChart([{ values: t.last_hits, color: "#e6b65c" }], {})),
  );
}

function legend(series, deaths) {
  return h("div", { class: "legend" },
    ...series.map((s) => h("span", {}, h("i", { "data-color": s.color }), s.label)),
    deaths && h("span", {}, h("i", { "data-color": "#ff2a2a" }), "твои смерти"),
  );
}

function chartFrame(values, len, { zero = false, unit = "" } = {}) {
  const W = 340, H = 170, L = 34, R = 8, T = 10, B = 20;
  let min = Math.min(...values), max = Math.max(...values);
  if (zero) { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; min = -m; max = m; } else { min = Math.min(0, min); }
  if (max === min) max = min + 1;
  const n = Math.max(len - 1, 1);
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const fmt = (v) => (unit === "k" ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
  const chart = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img" });
  chart.dataset.len = String(len);
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    chart.append(svg("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }), svg("text", { x: 2, y: y(v) + 3 }, fmt(v)));
  }
  for (let m = 0; m <= n; m += 10) chart.append(svg("text", { x: x(m) - 4, y: H - 4 }, m));
  return { chart, x, y, W, H, L, R, T, B };
}

// Палец или мышь над графиком: вертикальная линия, точки и подсказка со значениями этой минуты
function makeInteractive(frame, series, { deaths = [], valueFmt = (v) => num(v) } = {}) {
  const { chart, x, y, W, H, L, R, T, B } = frame;
  const len = Math.max(...series.map((s) => s.values.length));
  const guide = svg("line", { y1: T, y2: H - B, stroke: "#e6b65c", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  const dots = series.map((s) => svg("circle", { r: 4, fill: s.color, stroke: "#070404", "stroke-width": 2, opacity: 0 }));
  const box = svg("rect", { rx: 6, fill: "rgba(7,4,4,0.92)", stroke: "rgba(255,96,48,0.45)", opacity: 0 });
  const lines = [svg("text", { class: "tt tt-title" })].concat(series.map(() => svg("text", { class: "tt" })), [svg("text", { class: "tt tt-death" })]);
  const tip = svg("g", { "pointer-events": "none" }, guide, ...dots, box, ...lines);
  chart.append(tip);

  const show = (evt) => {
    const rect = chart.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(len - 1, Math.round(((px - L) / (W - L - R)) * (len - 1))));
    const cx = x(i);
    guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("opacity", 1);
    series.forEach((s, k) => {
      const v = s.values[Math.min(i, s.values.length - 1)];
      dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", y(v)); dots[k].setAttribute("opacity", 1);
      lines[k + 1].textContent = `${s.label ? s.label + ": " : ""}${valueFmt(v)}`;
      lines[k + 1].setAttribute("fill", s.color);
    });
    lines[0].textContent = `${i} мин`;
    const died = deaths.filter((t) => Math.floor(t / 60) === i);
    lines[lines.length - 1].textContent = died.length ? `смерть ${died.map((t) => mmss(t)).join(", ")}` : "";
    const rows = lines.filter((l) => l.textContent).length;
    const boxW = 128, boxH = 8 + rows * 13;
    const bx = cx + 10 + boxW > W - R ? cx - 10 - boxW : cx + 10;
    box.setAttribute("x", bx); box.setAttribute("y", T); box.setAttribute("width", boxW); box.setAttribute("height", boxH);
    box.setAttribute("opacity", 1);
    let row = 0;
    lines.forEach((l) => {
      if (!l.textContent) { l.setAttribute("opacity", 0); return; }
      l.setAttribute("x", bx + 8); l.setAttribute("y", T + 15 + row * 13); l.setAttribute("opacity", 1);
      row++;
    });
  };
  const hide = () => [guide, box, ...dots, ...lines].forEach((el) => el.setAttribute("opacity", 0));
  // На телефоне после касания сразу приходит pointerleave, поэтому подсказку прячем только для мыши.
  // Пальцем: тап или протяжка показывают значения, повторный тап вне графика — прячет.
  chart.addEventListener("pointerdown", (evt) => {
    if (evt.pointerType !== "mouse") chart.setPointerCapture(evt.pointerId);
    show(evt);
    haptic("light");
  });
  chart.addEventListener("pointermove", (evt) => {
    if (evt.pointerType === "mouse" || chart.hasPointerCapture(evt.pointerId)) show(evt);
  });
  chart.addEventListener("pointerleave", (evt) => { if (evt.pointerType === "mouse") hide(); });
  // Запасной путь для старых WebView без pointer events
  chart.addEventListener("touchmove", (evt) => {
    const t = evt.touches[0];
    if (t) show({ clientX: t.clientX });
  }, { passive: true });
  chartHiders.add(hide);
  return chart;
}

const pathOf = (values, x, y) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

// Линейный график на SVG без библиотек
function lineChart(series, { markers = [], unit = "" } = {}) {
  const all = series.flatMap((s) => s.values);
  const len = Math.max(...series.map((s) => s.values.length));
  const frame = chartFrame(all.length ? all : [0], len, { unit });
  const { chart, x, y } = frame;
  for (const s of series) {
    const d = pathOf(s.values, x, y);
    if (s.glow) chart.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 7, "stroke-opacity": 0.18, "stroke-linejoin": "round" }));
    chart.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
  }
  const base = series[0].values;
  for (const t of markers) {
    const i = Math.min(Math.floor(t / 60), base.length - 1);
    const cx = x(t / 60), cy = y(base[i]);
    chart.append(
      svg("line", { x1: cx - 3.5, y1: cy - 3.5, x2: cx + 3.5, y2: cy + 3.5, stroke: "#ff2a2a", "stroke-width": 2 }),
      svg("line", { x1: cx - 3.5, y1: cy + 3.5, x2: cx + 3.5, y2: cy - 3.5, stroke: "#ff2a2a", "stroke-width": 2 }),
    );
  }
  return makeInteractive(frame, series, { deaths: markers });
}

// Преимущество команды: плюс — огнём, минус — кровью
function areaChart(values) {
  const frame = chartFrame(values, values.length, { zero: true, unit: "k" });
  const { chart, x, y } = frame;
  const last = values.length - 1;
  const area = (clamped) => `${pathOf(clamped, x, y)} L${x(last).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  chart.append(
    svg("path", { d: area(values.map((v) => Math.max(v, 0))), fill: "#ff8a3d", "fill-opacity": 0.55 }),
    svg("path", { d: area(values.map((v) => Math.min(v, 0))), fill: "#b3122b", "fill-opacity": 0.75 }),
    svg("line", { x1: x(0), x2: x(last), y1: y(0), y2: y(0), stroke: "#9b8576", "stroke-width": 1 }),
  );
  return makeInteractive(frame, [{ values, color: "#ff8a3d", label: "команда" }], { valueFmt: (v) => (v > 0 ? "+" : "") + num(v) });
}

// Ширины полосок и цвета легенды выставляем из JS: CSP запрещает inline-стили в разметке
function applyDynamicStyles(root) {
  root.querySelectorAll("[data-w]").forEach((el) => {
    const inScore = el.closest(".score-row");
    el.style.width = `${Number(el.dataset.w) * (inScore ? 10 : 1)}%`;
    if (inScore) el.style.background = scoreColor(Number(el.dataset.w));
  });
  root.querySelectorAll("[data-pct]").forEach((el) => {
    el.style.width = `${Number(el.dataset.pct)}%`;
    el.style.background = "var(--fire)";
  });
  root.querySelectorAll("[data-color]").forEach((el) => { el.style.background = el.dataset.color; });
  root.querySelectorAll("[data-left]").forEach((el) => { el.style.left = `${Number(el.dataset.left)}%`; });
}
new MutationObserver(() => applyDynamicStyles(app)).observe(app, { childList: true, subtree: true });

// ---------- запуск ----------

function startParams() {
  const q = new URLSearchParams(location.search);
  const start = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
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
    if (tg.isVersionAtLeast && tg.isVersionAtLeast("6.1")) {
      tg.setHeaderColor(BG_COLOR);
      tg.setBackgroundColor(BG_COLOR);
    }
    if (backSupported()) tg.BackButton.onClick(back);
    // Иначе свайп по графику сворачивает приложение вместо подсказки
    if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7") && tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  }
  buildTabbar();
  loading("Разжигаю огонь...");
  try {
    const [heroes, items, abilities, ids, kb, tx] = await Promise.all([
      api("/constants/heroes"), api("/constants/items"), api("/constants/abilities", { timeout: 40000 }),
      api("/constants/item_ids"),
      fetch("knowledge.json").then((r) => r.json()), fetch("texts.json").then((r) => r.json()),
    ]);
    dictionary = createDictionary({ heroes, items, abilities });
    itemIds = ids;
    knowledge = kb;
    texts = tx;
    // Нормы по рангам необязательны: без них разбор работает по общим порогам
    glossary = await fetch("glossary.json?v=5").then((r) => (r.ok ? r.json() : [])).catch(() => []);
    norms = await fetch("rank_norms.json?v=4").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
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
