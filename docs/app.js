// Telegram Mini App: разбор матча Dota 2 внутри Телеграма.
import {
  analyze, createDictionary, isParsed, mmss, num, plural, proItemCounts, CATEGORIES, BAD, WARN, GOOD,
} from "./engine.js?v=13";

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
const PHASE_LABEL = { good: "выиграна", even: "ровно", bad: "проиграна" };
const TURBO_MODE = 23;

const tg = window.Telegram && window.Telegram.WebApp;
const app = document.getElementById("app");
let dictionary = null, knowledge = null, texts = null, itemIds = null, norms = {};
let pollTimer = null;
let section = "home", lastAnalysis = null, tabbar = null;
// Растёт при каждом переходе: экран, догрузившийся после ухода с него, не перерисовывает чужой
let navSeq = 0;
const stale = (seq) => seq !== navSeq;
const proCache = new Map();
// Подсказки графиков прячутся по тапу вне графика: один общий обработчик на документ
const chartHiders = new Set();
document.addEventListener("pointerdown", (evt) => {
  if (!(evt.target instanceof Element) || !evt.target.closest(".chart")) chartHiders.forEach((hide) => hide());
});
const benchCache = new Map();
const matchupCache = new Map();

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

function hapticTick() {
  try { if (tg && tg.isVersionAtLeast("6.1")) tg.HapticFeedback.selectionChanged(); } catch { /* старый клиент */ }
}

// Стеклянная панель вкладок. «Линза» подчиняется пружине: едет за пальцем, тянется от скорости,
// при нажатии разбухает, на отпускании мягко садится на вкладку. Содержимое меняется после паузы,
// чтобы тяжёлая перерисовка не мешала жесту. live: переключать на лету (разбор) или при отпускании (навигация)
function glassBar(bar, itemSelector, { live, onPick }) {
  const lens = h("div", { class: "lens", "aria-hidden": "true" });
  bar.prepend(lens);
  const items = () => [...bar.querySelectorAll(itemSelector)];
  const S = { x: 0, sx: 1, sy: 1, vx: 0, vsx: 0, vsy: 0 };
  const T = { x: 0, sx: 1, sy: 1 };
  let active = -1, hover = -1, dragging = false, pressed = false, raf = 0, last = 0, timer = 0, width = 0, lastTarget = 0;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const geometry = (i) => {
    const el = items()[i];
    return el ? { l: el.offsetLeft, w: el.offsetWidth } : null;
  };
  const apply = () => {
    lens.style.transform = `translate3d(${S.x.toFixed(2)}px,0,0) scale(${S.sx.toFixed(4)},${S.sy.toFixed(4)})`;
  };
  const tick = (now) => {
    const dt = Math.min(0.032, (now - last) / 1000 || 0.016);
    last = now;
    // пружины: чуть недозатухающие, чтобы был живой «ход», но без раскачки
    const spring = (key, vkey, target, k, c) => {
      const a = k * (target - S[key]) - c * S[vkey];
      S[vkey] += a * dt;
      S[key] += S[vkey] * dt;
    };
    const speed = Math.abs(S.vx);
    T.sx = (pressed ? 1.1 : 1) + Math.min(0.2, speed / 3200);
    T.sy = (pressed ? 1.12 : 1) - Math.min(0.08, speed / 9000);
    spring("x", "vx", T.x, 380, 30);
    spring("sx", "vsx", T.sx, 320, 24);
    spring("sy", "vsy", T.sy, 320, 24);
    apply();
    const settled = Math.abs(T.x - S.x) < 0.2 && Math.abs(S.vx) < 2 && Math.abs(T.sx - S.sx) < 0.002 && Math.abs(T.sy - S.sy) < 0.002;
    if (settled) { S.x = T.x; S.sx = T.sx; S.sy = T.sy; S.vx = S.vsx = S.vsy = 0; apply(); raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  const run = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  const snap = (i) => {
    const g = geometry(i);
    if (!g) return;
    width = g.w;
    lens.style.width = `${g.w}px`;
    T.x = g.l;
  };
  const place = (i, instant = false) => {
    active = i; hover = i;
    snap(i);
    items().forEach((el, n) => el.classList.toggle("hot", n === i));
    if (instant || reduce) { S.x = T.x; S.vx = 0; apply(); } else run();
  };
  const indexAt = (x) => {
    const r = bar.getBoundingClientRect();
    let best = 0, bestDist = Infinity;
    items().forEach((el, i) => {
      const c = r.left + el.offsetLeft + el.offsetWidth / 2;
      const d = Math.abs(x - c);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };
  const follow = (clientX) => {
    const r = bar.getBoundingClientRect();
    const list = items();
    const first = list[0], lastEl = list[list.length - 1];
    const min = first.offsetLeft, max = lastEl.offsetLeft + lastEl.offsetWidth - width;
    T.x = Math.max(min, Math.min(max, clientX - r.left - width / 2));
    const i = indexAt(clientX);
    if (i !== hover) {
      hover = i;
      items().forEach((el, n) => el.classList.toggle("hot", n === i));
      hapticTick();
      if (live) { clearTimeout(timer); timer = setTimeout(() => { active = i; onPick(i); }, 90); }
    }
    run();
  };

  bar.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = pressed = true;
    bar.classList.add("pressed");
    snap(Math.max(0, active));
    try { bar.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    follow(e.clientX);
  });
  bar.addEventListener("pointermove", (e) => { if (dragging) follow(e.clientX); });
  const end = (e) => {
    if (!dragging) return;
    dragging = pressed = false;
    bar.classList.remove("pressed");
    clearTimeout(timer);
    const cancelled = e.type === "pointercancel";
    const target = cancelled ? Math.max(0, active) : hover;
    if (!cancelled && target !== active) { active = target; onPick(target); }
    place(Math.max(0, target));
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("lostpointercapture", end);
  // Клавиатура и скринридеры: обычный click без указателя
  bar.addEventListener("click", (e) => {
    if (e.detail !== 0) return;
    const i = items().indexOf(e.target.closest(itemSelector));
    if (i >= 0) { onPick(i); place(i); }
  });
  if (window.ResizeObserver) new ResizeObserver(() => { if (active >= 0 && !dragging) place(active, true); }).observe(bar);
  return { place, current: () => active };
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

async function heroMatchups(heroId) {
  if (!matchupCache.has(heroId)) {
    try {
      const data = await api(`/heroes/${heroId}/matchups`);
      matchupCache.set(heroId, Array.isArray(data) ? data : []);
    } catch {
      return [];
    }
  }
  return matchupCache.get(heroId);
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
  navSeq++;
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
const NAV_TABS = ["home", "match", "profile"];

function tabButton(tab, label) {
  const icon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: NAV_ICONS[tab] }));
  return h("button", { class: "tabbtn", "data-tab": tab, "aria-label": label }, icon, h("span", {}, label));
}

function goTab(tab) {
  if (tab === "home") navRoot("home", homeScreen);
  else if (tab === "profile") navRoot("profile", profileScreen);
  else if (tab === "match") lastAnalysis ? navRoot("match", analysisScreen, lastAnalysis) : navRoot("match", matchEmpty);
}

let tabLens = null;

function buildTabbar() {
  tabbar = h("nav", { class: "tabbar", role: "tablist" },
    tabButton("home", "Главная"), tabButton("match", "Разбор"), tabButton("profile", "Профиль"));
  document.body.append(tabbar);
  tabLens = glassBar(tabbar, ".tabbtn", { live: false, onPick: (i) => { haptic(); goTab(NAV_TABS[i]); } });
}

function updateTabbar() {
  if (!tabbar) return;
  for (const btn of tabbar.querySelectorAll(".tabbtn")) {
    const t = btn.dataset.tab;
    btn.classList.toggle("active", t === section);
    if (t === "match") btn.classList.toggle("disabled", !lastAnalysis);
  }
  if (tabLens) tabLens.place(Math.max(0, NAV_TABS.indexOf(section)), tabLens.current() < 0);
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
  const seq = navSeq;
  const account = await storage.get("account_id");
  if (stale(seq)) return;
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
      h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); navRoot("home", homeScreen); } }, "Сменить"),
    ),
    list,
  );
  try {
    const matches = (await api(`/players/${account}/recentMatches`)) || [];
    if (!matches.length) {
      list.replaceChildren(h("div", { class: "card muted" },
        "Матчей не видно. В Доте включи: Настройки (шестерёнка) → Расширенные настройки → Социальное → «Expose Public Match Data» (публичные данные матчей), " +
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
    const seq = navSeq;
    try {
      const player = await api(`/players/${id}`);
      if (stale(seq)) return;
      if (!player || !player.profile) { status.textContent = "OpenDota не знает такой аккаунт."; return; }
      storage.set("account_id", String(id));
      haptic("medium");
      if (section === "profile") navRoot("profile", profileScreen);
      else navRoot("home", homeScreen);
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
  const seq = navSeq;
  const account = await storage.get("account_id");
  if (stale(seq)) return;
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
    if (!stale(seq)) errorScreen("OpenDota не отвечает.", () => navRoot("profile", profileScreen));
    return;
  }
  if (stale(seq)) return;
  if (!player || !player.profile) {
    render(h("div", { class: "page-head" }, h("h1", {}, "Профиль")),
      h("div", { class: "card muted" }, "OpenDota потерял этот аккаунт. Привяжи заново."),
      h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); navRoot("home", homeScreen); } }, "Сменить аккаунт"));
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
    trendBlock(recent),
    topHeroes.length > 0 && h("h2", {}, "Любимые герои"),
    topHeroes.length > 0 && h("div", { class: "card" }, ...topHeroes.map((hx) => {
      const wr = hx.games ? Math.round((hx.win / hx.games) * 100) : 0;
      return h("button", { class: "hero-stat", onclick: () => { haptic(); go(heroStatsScreen, hx.hero_id); } },
        heroImg(hx.hero_id),
        h("div", { class: "grow" },
          h("div", { class: "hn" }, dictionary.heroName(hx.hero_id)),
          h("div", { class: "hg" }, `${hx.games} игр`),
          h("div", { class: "wrbar" }, h("i", { "data-pct": wr })),
        ),
        h("div", { class: `wr ${wr >= 50 ? "win-text" : "loss-text"}` }, `${wr}%`),
      );
    })),
    weakHeroesBlock(heroes),
    h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); navRoot("home", homeScreen); } }, "Сменить аккаунт"),
  );
}

// Тренд по последним играм: свежие 10 против предыдущих 10 (по данным recentMatches)
function trendBlock(recent) {
  const pool = recent.filter((m) => m.duration > 600 && m.game_mode !== 23);
  if (pool.length < 12) return null;
  const fresh = pool.slice(0, Math.floor(pool.length / 2)), old = pool.slice(Math.floor(pool.length / 2));
  const avg = (list, f) => list.reduce((s, m) => s + f(m), 0) / list.length;
  const rows = [
    ["Смертей за игру", (m) => m.deaths, true, (v) => v.toFixed(1)],
    ["GPM", (m) => m.gold_per_min, false, (v) => String(Math.round(v))],
    ["Крипов в минуту", (m) => (m.last_hits * 60) / m.duration, false, (v) => v.toFixed(1)],
    ["Ассистов за игру", (m) => m.assists, false, (v) => v.toFixed(1)],
  ].map(([label, f, lowerBetter, fmt]) => {
    const a = avg(fresh, f), b = avg(old, f);
    const delta = lowerBetter ? b - a : a - b;
    const still = Math.abs(a - b) <= Math.abs(b) * 0.05;
    const cls = still ? "muted" : delta > 0 ? "win-text" : "loss-text";
    const mark = still ? "≈" : delta > 0 ? "▲" : "▼";
    return h("div", { class: "score-row trend" }, h("span", {}, label), h("span", { class: "muted" }, `${fmt(b)} → ${fmt(a)}`), h("b", { class: cls }, mark));
  });
  return h("div", {}, h("h2", {}, "Тренд"), h("div", { class: "card" }, ...rows,
    h("div", { class: "small muted" }, `Последние ${fresh.length} игр против предыдущих ${old.length}`)));
}

// Герои с низким винрейтом за всё время — на них стоит меньше играть или разобрать отдельно
function weakHeroesBlock(heroes) {
  const weak = (heroes || []).filter((hx) => hx.games >= 8 && hx.win / hx.games <= 0.4)
    .sort((a, b) => b.games - a.games).slice(0, 3);
  if (!weak.length) return null;
  return h("div", {}, h("h2", {}, "Не заходят"),
    h("div", { class: "card" }, ...weak.map((hx) => h("div", { class: "problem-fact" },
      `${dictionary.heroName(hx.hero_id)}: ${Math.round((hx.win / hx.games) * 100)}% побед за ${hx.games} игр. Пока лучше не пикай его в рейтинг.`))));
}

// ---------- экран «Статистика по герою» (только свои игры) ----------

const HERO_TTL = 6 * 3600 * 1000;
const HERO_FIELDS = "hero_id,kills,deaths,assists,gold_per_min,xp_per_min,last_hits,duration,player_slot,radiant_win,start_time,game_mode";

// Матчи на герое и враги против него. Кэш в localStorage на 6 часов: OpenDota не любит частые запросы
async function heroStatsData(account, heroId) {
  const key = `hs:${account}:${heroId}`;
  try {
    const hit = JSON.parse(safeLocal.get(key) || "null");
    if (hit && Date.now() - hit.t < HERO_TTL) return hit;
  } catch { /* битый кэш — просто качаем заново */ }
  const [matches, vs] = await Promise.all([
    api(`/players/${account}/matches?hero_id=${heroId}&project=${HERO_FIELDS.split(",").join("&project=")}`),
    api(`/players/${account}/heroes?hero_id=${heroId}`),
  ]);
  const data = {
    t: Date.now(),
    matches: (matches || []).filter((m) => m.game_mode !== TURBO_MODE),
    vs: (vs || []).filter((x) => x.against_games >= 5)
      .map((x) => ({ id: x.hero_id, g: x.against_games, w: x.against_win })),
  };
  safeLocal.set(key, JSON.stringify(data));
  return data;
}

// Мини-график GPM по играм (старые слева), точки — победа/поражение
function sparkline(list) {
  const W = 300, H = 56, P = 5;
  const vals = list.map((m) => m.gold_per_min || 0);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [P + (i * (W - 2 * P)) / Math.max(1, vals.length - 1), H - P - ((v - lo) / span) * (H - 2 * P)]);
  return svg("svg", { class: "spark", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" },
    svg("polyline", { points: pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ") }),
    ...pts.map(([x, y], i) => {
      const won = (list[i].player_slot < 128) === list[i].radiant_win;
      return svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: "3", class: won ? "w" : "l" });
    }));
}

async function heroStatsScreen(heroId) {
  section = "profile";
  const seq = navSeq;
  const account = await storage.get("account_id");
  if (stale(seq)) return;
  if (!account) { navRoot("profile", profileScreen); return; }
  const name = dictionary.heroName(heroId);
  loading(`Считаю игры на ${name}...`);
  let data;
  try {
    data = await heroStatsData(account, heroId);
  } catch {
    if (!stale(seq)) errorScreen("OpenDota не отвечает.", () => go(heroStatsScreen, heroId));
    return;
  }
  if (stale(seq)) return;
  const head = h("div", { class: "page-head" }, heroImg(heroId), h("h1", {}, name));
  const list = data.matches.slice().sort((a, b) => b.start_time - a.start_time);
  if (!list.length) {
    render(head, h("div", { class: "card muted" },
      `Игр на ${name} не видно. Если игры были, проверь в Доте: Настройки → Расширенные настройки → Социальное → «Expose Public Match Data».`));
    return;
  }

  const won = (m) => (m.player_slot < 128) === m.radiant_win;
  const wins = list.filter(won).length;
  const wr = Math.round((wins / list.length) * 100);
  const avg = (f) => list.reduce((s, m) => s + (f(m) || 0), 0) / list.length;
  const row = (label, value) => h("div", { class: "score-row trend" }, h("span", {}, label), h("b", {}, value), h("span", {}));

  // Тренд: последние 20 игр, первая половина против второй
  const last = list.slice(0, 20).reverse();
  let trend = null;
  if (last.length >= 10) {
    const half = Math.floor(last.length / 2);
    const mean = (arr) => Math.round(arr.reduce((s, m) => s + (m.gold_per_min || 0), 0) / arr.length);
    const a = mean(last.slice(0, half)), b = mean(last.slice(half));
    const wa = last.slice(0, half).filter(won).length, wb = last.slice(half).filter(won).length;
    trend = h("div", {}, h("h2", {}, `Тренд за последние ${last.length} игр`), h("div", { class: "card" },
      sparkline(last),
      h("div", { class: "small muted" }, `GPM: ${a} → ${b}. Побед: ${wa} из ${half} → ${wb} из ${last.length - half}. Точка — игра, золотая — победа.`)));
  }

  // Враги: с кем встречался чаще всего, от 5 игр против
  const foes = data.vs.slice().sort((x, y) => y.g - x.g).slice(0, 8);
  const foesBlock = foes.length > 0 && h("div", {}, h("h2", {}, "Чаще всего против"), h("div", { class: "card" },
    ...foes.map((f) => {
      const fwr = Math.round((f.w / f.g) * 100);
      return h("div", { class: "hero-stat" },
        heroImg(f.id),
        h("div", { class: "grow" },
          h("div", { class: "hn" }, dictionary.heroName(f.id)),
          h("div", { class: "hg" }, `${f.g} игр: ${f.w} побед, ${f.g - f.w} поражений`)),
        h("div", { class: `wr ${fwr >= 50 ? "win-text" : "loss-text"}` }, `${fwr}%`));
    }),
    h("div", { class: "small muted" }, "Только враги, против которых было 5+ игр.")));

  render(head,
    h("div", { class: "card" },
      h("div", { class: "profile-metrics" },
        h("div", { class: "metric" }, h("b", {}, String(list.length)), h("span", {}, "игр")),
        h("div", { class: "metric" }, h("b", { class: wr >= 50 ? null : "loss-text" }, `${wr}%`), h("span", {}, "винрейт")),
        h("div", { class: "metric" }, h("b", {}, String(wins)), h("span", {}, "побед")),
      ),
      row("Средний KDA", `${avg((m) => m.kills).toFixed(1)}/${avg((m) => m.deaths).toFixed(1)}/${avg((m) => m.assists).toFixed(1)}`),
      row("GPM / XPM", `${Math.round(avg((m) => m.gold_per_min))} / ${Math.round(avg((m) => m.xp_per_min))}`),
      row("Добитые крипы", String(Math.round(avg((m) => m.last_hits)))),
      list.length < 10 && h("div", { class: "small muted" }, "Мало игр, выводы появятся от 10 игр."),
    ),
    trend,
    list.length >= 10 && foesBlock,
    h("h2", {}, "Последние игры на герое"),
    ...list.slice(0, 10).map((m) => matchListItem(m, account)),
    h("div", { class: "small muted" }, "Турбо не считается. Данные обновляются раз в 6 часов."),
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
  const seq = navSeq;
  let match;
  try {
    match = await api(`/matches/${matchId}`);
    if (stale(seq)) return;
  } catch {
    if (stale(seq)) return;
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
  if (!player && accountId) player = match.players.find((p) => p.account_id === accountId);
  if (!player) {
    const saved = Number(await storage.get("account_id"));
    if (stale(seq)) return;
    if (saved) player = match.players.find((p) => p.account_id === saved);
  }
  if (!player) { notYourMatch(); return; }

  const [pro, bench, matchups] = await Promise.all([proItems(player.hero_id), heroBench(player.hero_id), heroMatchups(player.hero_id)]);
  if (stale(seq)) return;
  const a = analyze(match, player, dictionary, knowledge, texts, pro, bench, norms, matchups);
  // для блока «Обычно у тебя»: сырые цифры этой игры и чей аккаунт
  a.hist_self = { account: player.account_id, duration: match.duration, kills: player.kills, deaths: player.deaths,
    assists: player.assists, gold_per_min: player.gold_per_min, xp_per_min: player.xp_per_min, last_hits: player.last_hits };
  analysisScreen(a);
}

// Разбираем только свои игры: либо аккаунт не привязан, либо тебя нет в матче
async function notYourMatch() {
  const saved = Number(await storage.get("account_id"));
  render(
    h("h1", {}, saved ? "Это не твоя игра" : "Привяжи аккаунт"),
    h("p", { class: "muted" }, saved
      ? "Тебя нет в этом матче, а чужие игры я не разбираю. Если игра твоя, в ней мог быть скрыт профиль: включи в Доте Настройки (шестерёнка) → Расширенные настройки → Социальное → «Expose Public Match Data» (публичные данные матчей)."
      : "Я разбираю только твои игры. Укажи Friend ID или Steam ID."),
    saved ? h("button", { onclick: () => navRoot("home", homeScreen) }, "На главную") : accountForm(),
  );
}

// ---------- экран разбора ----------

const TABS = [
  ["Обзор", overviewTab],
  ["Фазы", phasesTab],
  ["Смерти", killersTab],
  ["Сборка", buildTab],
  ["Графики", chartsTab],
];

function analysisScreen(a) {
  section = "match";
  lastAnalysis = a;
  const f = a.facts;
  const content = h("div", { class: "tab-content" });
  const tabs = h("div", { class: "tabs", role: "tablist" });
  let index = -1, lens = null;
  const pages = new Map();
  const select = (i) => {
    if (i === index) return;
    const dir = index < 0 ? 0 : Math.sign(i - index);
    index = i;
    [...tabs.querySelectorAll(".tab")].forEach((t, j) => { t.classList.toggle("active", i === j); t.setAttribute("aria-selected", String(i === j)); });
    // страницы строим один раз и держим в памяти: переключение мгновенное
    if (!pages.has(i)) pages.set(i, TABS[i][1](a));
    const page = pages.get(i);
    page.classList.remove("slide-from-right", "slide-from-left", "fade-in");
    void page.offsetWidth;
    page.classList.add(dir > 0 ? "slide-from-right" : dir < 0 ? "slide-from-left" : "fade-in");
    content.replaceChildren(page);
    if (lens && lens.current() !== i) lens.place(i);
  };
  TABS.forEach(([name]) => tabs.append(h("button", { class: "tab", role: "tab" }, name)));
  lens = glassBar(tabs, ".tab", { live: true, onPick: select });
  // Свайп по содержимому листает вкладки; графики со своим жестом не трогаем
  let sx = 0, sy = 0, tracking = false;
  content.addEventListener("touchstart", (e) => {
    tracking = e.touches.length === 1 && !e.target.closest(".chart, .frame, input");
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  content.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const next = index + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < TABS.length) { hapticTick(); select(next); window.scrollTo({ top: 0 }); }
  }, { passive: true });

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
    h("div", { class: "tabs-wrap" }, tabs),
    content,
  );
  select(0);
  lens.place(0, true);
}

// Шеринг: короткий вердикт + прямая ссылка на этот матч в приложении (растит бота)
function shareMatch(a) {
  const f = a.facts;
  const link = `https://t.me/${BOT_USERNAME}?startapp`;
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

// ---------- тренер на Gemini (через воркер из worker/coach.js) ----------

const COACH_URL = "https://dotacoach.2007rggg.workers.dev"; // адрес воркера с тренером
const COACH_DAILY = 5; // разборов тренера в день на устройство

const safeLocal = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* приватный режим */ } },
};

function coachPayload(a) {
  const s = a.summary || {}, f = a.facts;
  return {
    hero: f.hero, role: s.role || "", rank: s.rank || "", won: f.won, kda: f.kda, duration: f.duration,
    problems: (s.problems || []).slice(0, 3).map((p) => ({ title: p.title, fact: p.fact, action: p.action })),
    strengths: (s.strengths || []).slice(0, 2).map((x) => ({ title: x.title, fact: x.fact })),
    micro: a.findings.filter((x) => x.kind === "micro" && x.severity !== GOOD).slice(0, 4).map((x) => ({ text: x.text, tip: x.tip })),
    plan: a.build_plan ? a.build_plan.missing.slice(0, 3).map((i) => ({ item: i.item, why: i.why })) : [],
    draft: a.draft ? a.draft.notes.slice(0, 2).map((n) => n.text) : [],
  };
}

// Ответ воркера: «Главное: ...», пустая строка, «План на следующую игру:», шаги с «— ».
// Если формат поплыл, всё, что не шаг и не заголовок, уходит в «Главное».
function parseCoach(text) {
  const main = [], steps = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || /^план[\s:]/i.test(line)) continue; // \b в JS не видит границ кириллических слов
    const step = line.match(/^(?:[—–-]|\d+[.)])\s*(.+)$/);
    if (step) steps.push(step[1]);
    else main.push(line.replace(/^главное\s*:\s*/i, ""));
  }
  return { main: main.join(" "), steps };
}

function coachBlock(a) {
  if (!COACH_URL) return null;
  const key = `coach:${a.facts.match_id}:${a.facts.slot}`;
  const box = h("section", { class: "card coach", "aria-labelledby": "coach-title" });
  const title = h("div", { class: "coach-title", id: "coach-title" }, "Разбор тренера");

  const show = (text, fresh) => {
    const { main, steps } = parseCoach(text);
    let done = [];
    try { done = JSON.parse(safeLocal.get(`${key}:done`) || "[]"); } catch { /* битое значение */ }
    let i = 0;
    const seq = (el) => { el.style.setProperty("--i", i++); return el; };
    const list = h("ol", { class: "coach-steps" }, steps.map((s, n) => {
      const btn = h("button", { class: "coach-step", type: "button", "aria-pressed": String(done.includes(n)) },
        h("span", { class: "coach-mark", "aria-hidden": "true" }), h("span", { class: "coach-step-text" }, s));
      btn.onclick = () => {
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(on));
        done = on ? [...done, n] : done.filter((x) => x !== n);
        safeLocal.set(`${key}:done`, JSON.stringify(done));
        haptic(on ? "medium" : "light");
      };
      return seq(h("li", {}, btn));
    }));
    box.classList.toggle("coach-fresh", !!fresh);
    box.replaceChildren(
      title,
      main && seq(h("div", { class: "coach-label" }, "Главное")),
      main && seq(h("p", { class: "coach-main" }, main)),
      steps.length > 0 && seq(h("div", { class: "coach-label" }, "Задачи на следующую катку")),
      steps.length > 0 && list);
  };
  const cached = safeLocal.get(key);
  if (cached) { show(cached, false); return box; }

  const ask = h("button", { class: "coach-btn", type: "button" }, "Разобрать с тренером");
  const note = h("p", { class: "coach-note small muted", role: "status" },
    "Тренер выберет главное из разбора и даст три задачи на следующую катку.");
  ask.onclick = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const used = safeLocal.get("coach_day") === day ? Number(safeLocal.get("coach_n") || 0) : 0;
    if (used >= COACH_DAILY) { note.textContent = `Сегодня уже ${COACH_DAILY} разборов, это лимит. Завтра снова.`; return; }
    ask.disabled = true;
    ask.textContent = "Тренер смотрит катку…";
    haptic("medium");
    try {
      const res = await fetch(COACH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(coachPayload(a)) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error || "Тренер сейчас недоступен.");
      safeLocal.set("coach_day", day);
      safeLocal.set("coach_n", String(used + 1));
      safeLocal.set(key, data.text);
      show(data.text, true);
    } catch (e) {
      ask.disabled = false;
      ask.textContent = "Попробовать ещё раз";
      note.textContent = e && e.message && e.message.length < 80 ? e.message : "Тренер сейчас недоступен.";
    }
  };
  box.append(title, ask, note);
  return box;
}

function overviewTab(a) {
  const s = a.summary || {};
  const who = [s.role, s.rank && `ранг ${s.rank}`].filter(Boolean).join(" · ");
  const problems = (s.problems || []).slice(0, 3);
  const strengths = (s.strengths || []).slice(0, 2);
  return h("div", {},
    who && h("div", { class: "who" }, who, s.role_sure === false && h("span", { class: "muted" }, " · роль определена неточно")),
    coachBlock(a),
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
    historyBlock(a),
    microBlock(a),
    draftBlock(a),
    h("h2", {}, "Оценки"),
    h("div", { class: "card" }, ...CATEGORIES.map((c) => h("div", { class: "score-row" },
      h("span", {}, c), h("div", { class: "bar" }, h("i", { "data-w": a.scores[c] })), h("b", {}, a.scores[c])))),
  );
}

// ---------- сравнение с прошлыми играми (только свой аккаунт) ----------

const HIST_TTL = 30 * 60 * 1000;
const HIST_MIN = 5;
const HIST_FIELDS = ["hero_id", "duration", "game_mode", "kills", "deaths", "assists", "gold_per_min", "xp_per_min", "last_hits"];

async function histMatches(account, heroId) {
  const key = `hm:v1:${account}:${heroId || "all"}`;
  try {
    const c = JSON.parse(safeLocal.get(key) || "null");
    if (c && Date.now() - c.t < HIST_TTL && Array.isArray(c.rows)) return c.rows;
  } catch { /* битый кэш — перезапросим */ }
  const q = `limit=${heroId ? 30 : 20}&significant=1${heroId ? `&hero_id=${heroId}` : ""}&` + HIST_FIELDS.map((f) => `project=${f}`).join("&");
  const rows = await api(`/players/${account}/matches?${q}`);
  if (!Array.isArray(rows)) return [];
  safeLocal.set(key, JSON.stringify({ t: Date.now(), rows }));
  return rows;
}

const histKda = (m) => (m.kills + m.assists) / Math.max(1, m.deaths);
const HIST_ROWS = [
  ["GPM", (m) => m.gold_per_min, false, (v) => String(Math.round(v))],
  ["XPM", (m) => m.xp_per_min, false, (v) => String(Math.round(v))],
  ["Крипов в минуту", (m) => (m.last_hits == null ? NaN : (m.last_hits * 60) / m.duration), false, (v) => v.toFixed(1)],
  ["Смерти", (m) => m.deaths, true, (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))],
  ["KDA", histKda, false, (v) => v.toFixed(1)],
];

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function historyRows(self, pool) {
  let up = 0, down = 0;
  const rows = HIST_ROWS.map(([label, f, lowerBetter, fmt]) => {
    const v = f(self);
    const vals = pool.map(f).filter(Number.isFinite).sort((x, y) => x - y);
    if (!Number.isFinite(v) || vals.length < HIST_MIN) return null; // у OpenDota бывают пустые поля
    const med = quantile(vals, 0.5), q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75);
    const better = vals.filter((x) => (lowerBetter ? v < x : v > x)).length;
    const good = lowerBetter ? v < q1 : v > q3, bad = lowerBetter ? v > q3 : v < q1;
    if (good) up++;
    if (bad) down++;
    const cls = good ? "win-text" : bad ? "loss-text" : "muted";
    return h("div", { class: "score-row hist" },
      h("span", {}, label, h("em", { class: "muted" }, ` лучше, чем в ${better} из ${vals.length}`)),
      h("span", { class: "muted" }, `${fmt(med)} → ${fmt(v)}`),
      h("b", { class: cls }, good ? "▲" : bad ? "▼" : "≈"));
  });
  const verdict = up >= 2 && up > down ? "Лучше обычного." : down >= 2 && down > up ? "Хуже обычного." : "На твоём обычном уровне.";
  return { rows, verdict };
}

// Обычно у тебя: эта игра против медианы твоих прошлых (тот же герой, иначе все игры)
function historyBlock(a) {
  const self = a.hist_self;
  if (!self || !self.account || !(self.duration > 0)) return null;
  const box = h("details", { class: "card timeline-box hist-box" }, h("summary", {}, "Обычно у тебя"),
    h("div", { class: "small muted" }, "Собираю прошлые игры..."));
  const seq = navSeq;
  const usable = (m) => m.match_id !== a.facts.match_id && m.duration >= 600 && m.game_mode !== TURBO_MODE && m.gold_per_min != null;
  (async () => {
    let pool = (await histMatches(self.account, a.facts.hero_id)).filter(usable);
    let sample = `на ${a.facts.hero}`;
    if (pool.length < HIST_MIN) {
      pool = (await histMatches(self.account, null)).filter(usable);
      sample = "на всех героях";
    }
    if (stale(seq)) return;
    const body = [h("summary", {}, "Обычно у тебя")];
    if (pool.length < HIST_MIN) {
      body.push(h("div", { class: "small muted" }, "Мало прошлых игр для сравнения, нужно хотя бы пять."));
    } else {
      const { rows, verdict } = historyRows(self, pool);
      body[0] = h("summary", {}, "Обычно у тебя", h("span", { class: "muted" }, ` · ${verdict.toLowerCase().replace(/\.$/, "")}`));
      body.push(...rows.filter(Boolean),
        h("div", { class: "small muted" }, `${verdict} Медиана ${pool.length} ${plural(pool.length, "прошлой игры", "прошлых игр", "прошлых игр")} ${sample} → эта игра. Турбо и игры короче 10 минут не считаю.`));
    }
    box.replaceChildren(...body);
  })().catch(() => {
    if (!stale(seq)) box.replaceChildren(h("summary", {}, "Обычно у тебя"), h("div", { class: "small muted" }, "OpenDota не отдала прошлые игры."));
  });
  return box;
}

// Мелочи с точным временем: сверху текст, совет раскрывается по нажатию
function microBlock(a) {
  const micro = a.findings.filter((f) => f.kind === "micro" && f.severity !== GOOD)
    .sort((x, y) => (x.severity === BAD ? 0 : 1) - (y.severity === BAD ? 0 : 1)).slice(0, 4);
  if (!micro.length) return null;
  return h("div", {},
    h("h2", {}, "Мелочи"),
    h("div", { class: "card micro" }, ...micro.map((f) => h("details", { class: `finding ${f.severity}` },
      h("summary", {}, f.text),
      f.tip && h("div", { class: "tip" }, f.tip)))),
  );
}

// Драфт: матчапы героя против вражеской пятёрки по статистике OpenDota
function draftBlock(a) {
  const d = a.draft;
  if (!d || !d.notes.length) return null;
  return h("div", {},
    h("h2", {}, "Драфт"),
    h("div", { class: "card" }, ...d.notes.slice(0, 2).map((n) => h("div", { class: n.severity === GOOD ? "strength" : "problem-fact" }, n.text))),
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
    a.moments.length > 0 && h("details", { class: "card timeline-box" },
      h("summary", {}, "Хронология"),
      h("div", { class: "timeline" }, ...a.moments.map((m) =>
        h("div", { class: `moment ${m.severity}` }, h("time", {}, m.clock), m.text)))),
  );
}

function killersTab(a) {
  if (!a.killers.length) return h("p", { class: "muted" }, "Никто не убил тебя больше одного раза.");
  return h("div", {}, ...a.killers.map((k) => {
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
      ...k.sources.slice(0, 3).map((s) => h("div", { class: "source" }, h("span", {}, s.name), h("b", {}, num(s.damage)))),
      k.control && k.control.length > 0 && h("div", { class: "sub" }, "Контроль на тебе"),
      ...(k.control || []).map((c) => h("div", { class: "source control" },
        h("span", {}, c.name, h("em", {}, ` ${c.label}`)),
        h("b", {}, `×${c.count}`),
        h("div", { class: "ctl-tags" },
          h("i", { class: c.bkb_blocks ? "yes" : "no" }, c.bkb_blocks ? "БКБ блокирует" : "БКБ пробивает"),
          h("i", { class: c.dispellable ? "yes" : "no" }, c.dispellable ? "снимается диспелом" : "диспел не снимает")))),
      k.counter_keys.length > 0 && h("div", { class: "sub" }, "Что брать против этого героя"),
      ...k.counter_keys.map((key) => h("div", { class: "why-row" }, itemChip(key, "chip need"),
        k.counter_why && k.counter_why[key] && h("div", { class: "small muted" }, k.counter_why[key]))),
      k.had_counter_keys.length > 0 && h("div", { class: "small muted" }, "Уже было: " + k.had_counters.join(", ")),
    );
  }));
}

function itemChip(key, cls = "chip") {
  return h("span", { class: cls }, img(dictionary.itemImage(key), null, ""), dictionary.itemName(key));
}

function buildPlanBlock(a) {
  const plan = a.build_plan;
  if (!plan) return null;
  return h("div", {},
    h("h2", {}, "Сборка под эту катку"),
    h("div", { class: "card plan" },
      ...plan.facts.map((t) => h("div", { class: "plan-fact" }, t)),
      plan.missing.length === 0 && h("div", { class: "strength" }, "Ничего особенного против тебя не играло: сборка по про-матчам подходит."),
      ...plan.missing.map((it, i) => h("div", { class: "plan-item" },
        h("div", { class: "plan-num" }, String(i + 1)),
        img(dictionary.itemImage(it.key), null, ""),
        h("div", { class: "grow" },
          h("div", { class: "plan-name" }, it.item, it.popular && h("span", { class: "tag" }, "берут про")),
          h("div", { class: "small muted" }, it.why)))),
      plan.have.length > 0 && h("div", { class: "small muted" }, "Уже было: " + plan.have.map((it) => it.item).join(", "))));
}

function buildTab(a) {
  const planBlock = buildPlanBlock(a);
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
  if (!pro && !yours && !planBlock) return h("p", { class: "muted" }, "Крупных предметов не было.");
  return h("div", {}, planBlock, pro, yours);
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
    h("h2", {}, "Добито крипов"),
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
      fetch("knowledge.json?v=12").then((r) => r.json()), fetch("texts.json?v=13").then((r) => r.json()),
    ]);
    dictionary = createDictionary({ heroes, items, abilities });
    itemIds = ids;
    knowledge = kb;
    texts = tx;
    // Нормы по рангам необязательны: без них разбор работает по общим порогам
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
