// Telegram Mini App: разбор матча Dota 2 внутри Телеграма.
import {
  analyze, createDictionary, isParsed, mmss, num, plural, proItemCounts, itemTimings, draftAdvice, checkGoal, achievements, formatMetric, formatRankMetric,
  CATEGORIES, BAD, WARN, GOOD,
} from "./engine.js?v=20";

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
const BG_COLOR = "#08090c";
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
  if (score >= 7) return "var(--radiant)";
  if (score >= 5) return "var(--warn)";
  return "var(--dire)";
}

const reducedMotion = () => Boolean(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

// 3D: плита наклоняется за пальцем, по ней бежит блик, картинка внутри едет в обратную сторону (параллакс)
function tilt(el, max = 6) {
  if (!el || reducedMotion()) return el;
  el.classList.add("tilt");
  el.append(h("span", { class: "glare", "aria-hidden": "true" }));
  let raf = 0;
  const set = (px, py, on) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.setProperty("--ry", `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty("--px", `${((0.5 - px) * 16).toFixed(1)}px`);
      el.style.setProperty("--py", `${((0.5 - py) * 12).toFixed(1)}px`);
      el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
      el.style.setProperty("--go", on ? "1" : "0");
    });
  };
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    if (px >= 0 && px <= 1 && py >= 0 && py <= 1) set(px, py, true);
  };
  const reset = () => { el.classList.remove("tilting"); set(0.5, 0.5, false); };
  el.addEventListener("pointerdown", (e) => { el.classList.add("tilting"); move(e); });
  el.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || el.classList.contains("tilting")) { el.classList.add("tilting"); move(e); } });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(type, reset);
  return el;
}

// Оценка: золотой медальон, заполненный по кругу на score из 10
function medal(score) {
  const el = h("div", { class: "medal", role: "img", "aria-label": `Оценка ${score.toFixed(1)} из 10` },
    h("b", {}, score.toFixed(1)), h("small", {}, "из 10"));
  el.style.setProperty("--p", String(Math.max(0, Math.min(100, score * 10))));
  return el;
}

// Знак приложения: Аегис Бессмертного. Золотой щит с рогами, грань по центру и камень;
// плавает и поворачивается в 3D (style.css .aegis). id градиентов уникальны: знак бывает на экране не один
let aegisSeq = 0;
function aegis() {
  const id = `ae${++aegisSeq}`;
  const shield = "M32 3C37 9 45 10 53 7L60 5C58 15 58 25 56 34C53 48 44 60 32 69C20 60 11 48 8 34C6 25 6 15 4 5L11 7C19 10 27 9 32 3Z";
  const inner = "M32 11C36 15 43 16 50 14C49 22 49 29 47.5 35C45 45 39.5 54 32 60C24.5 54 19 45 16.5 35C15 29 15 22 14 14C21 16 28 15 32 11Z";
  return h("div", { class: "aegis", role: "img", "aria-label": "Аегис" },
    svg("svg", { viewBox: "0 0 64 72", "aria-hidden": "true" },
      svg("defs", {},
        svg("linearGradient", { id: `${id}g`, x1: "0", y1: "0", x2: "1", y2: "1" },
          svg("stop", { offset: "0", "stop-color": "#fbe7b4" }),
          svg("stop", { offset: ".45", "stop-color": "#d7a957" }),
          svg("stop", { offset: ".7", "stop-color": "#f3d595" }),
          svg("stop", { offset: "1", "stop-color": "#8d6428" })),
        svg("linearGradient", { id: `${id}i`, x1: "0", y1: "0", x2: "0", y2: "1" },
          svg("stop", { offset: "0", "stop-color": "#2b2215" }),
          svg("stop", { offset: "1", "stop-color": "#0d0b08" })),
        svg("radialGradient", { id: `${id}j`, cx: ".38", cy: ".32", r: ".7" },
          svg("stop", { offset: "0", "stop-color": "#fff3cf" }),
          svg("stop", { offset: ".35", "stop-color": "#f0b44c" }),
          svg("stop", { offset: "1", "stop-color": "#7a3f10" }))),
      svg("path", { d: shield, fill: `url(#${id}g)` }),
      svg("path", { d: inner, fill: `url(#${id}i)`, stroke: "#f6dda4", "stroke-opacity": ".55", "stroke-width": ".8" }),
      svg("path", { d: "M32 13V58", stroke: "#e8c27a", "stroke-opacity": ".35", "stroke-width": "1" }),
      svg("path", { d: "M20 20C25 22 29 22 32 20C35 22 39 22 44 20", fill: "none", stroke: "#e8c27a", "stroke-opacity": ".5", "stroke-width": "1.2", "stroke-linecap": "round" }),
      svg("circle", { cx: "32", cy: "34", r: "8.5", fill: `url(#${id}g)` }),
      svg("circle", { cx: "32", cy: "34", r: "6.2", fill: `url(#${id}j)` }),
      svg("ellipse", { cx: "30", cy: "31.5", rx: "2.2", ry: "1.4", fill: "#fff", opacity: ".75" }),
      svg("path", { d: "M11 9C14 20 15 31 19 40", fill: "none", stroke: "#fff", "stroke-opacity": ".45", "stroke-width": "1.2", "stroke-linecap": "round" })));
}

// Ачивка: монета в 3D. Аверс со знаком, реверс со счётом; открытая золотая и иногда сама крутится
const ACH_ICONS = {
  clean_lane: ["M5 21 10 3", "M19 21 14 3", "M12 6v2", "M12 11v2", "M12 16v3"],
  no_feed: ["M12 20s-7-4.3-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4c0 5.3-7 9.6-7 9.6Z"],
  teamplayer: ["M14.5 17.5 3 6V3h3l11.5 11.5", "M13 19l6-6", "M16 16l4 4", "M19 21l2-2", "M14.5 6.5 18 3h3v3l-3.5 3.5", "M5 14l4 4", "M7 17l-3 3", "M3 19l2 2"],
  buttons: ["M13 2 4 14h7l-1 8 9-12h-7l1-8Z"],
  farmer: ["M8 13A5 5 0 1 0 8 3a5 5 0 0 0 0 10Z", "M18.1 10.4a5 5 0 1 1-6.7 7.2", "M7 6h1v4", "M16.7 13.9l.7.7-2.8 2.8"],
  eyes: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  alive: ["M3 12h4l2-5 4 10 2-5h6"],
  goals5: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M8 12l3 3 5-6"],
};
function achCoin(x) {
  return h("span", { class: "coin", "aria-hidden": "true" },
    h("span", { class: "coin-face" }, svg("svg", { viewBox: "0 0 24 24" }, (ACH_ICONS[x.id] || ACH_ICONS.goals5).map((d) => svg("path", { d })))),
    h("span", { class: "coin-face coin-back" }, x.done ? "✓" : `${x.have}/${x.need}`));
}

const games = (n) => `${n} ${plural(n, "игра", "игры", "игр")}`;

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

// CloudStorage пишет асинхронно: чтение сразу после записи отдавало старое значение
// (сменённый аккаунт не менялся, привязку приходилось вводить дважды). Свежие значения держим в памяти.
const memStore = new Map();
const storage = {
  get(key) {
    if (memStore.has(key)) return Promise.resolve(memStore.get(key));
    return new Promise((resolve) => {
      if (cloud()) {
        tg.CloudStorage.getItem(key, (err, value) => resolve(err ? null : value || null));
        return;
      }
      try { resolve(localStorage.getItem(key)); } catch { resolve(null); }
    });
  },
  set(key, value) {
    memStore.set(key, value || null);
    return new Promise((resolve) => {
      if (cloud()) { tg.CloudStorage.setItem(key, value, () => resolve()); return; }
      try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
      resolve();
    });
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
      aegis(),
      h("div", { class: "t" },
        h("h1", {}, "Dota-тренер"),
        h("p", {}, "Разбор каждой ошибки — от линии до последней драки"),
      ),
    ),
    h("div", { class: "card" },
      h("div", { class: "row" }, h("div", { class: "grow" }, matchInput), h("button", { onclick: openMatch }, "Разобрать")),
    ),
    h("button", { class: "draft-entry", type: "button", onclick: () => { haptic(); go(draftScreen); } },
      h("span", { class: "de-icon", "aria-hidden": "true" }, svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M12 3 4 7v5c0 5 3.4 7.6 8 9 4.6-1.4 8-4 8-9V7l-8-4ZM9 12l2 2 4-4" }))),
      h("div", { class: "grow" }, h("b", {}, "Драфт перед игрой"), h("span", {}, "Кого пикнуть и что собирать"))),
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
    const fresh = freshMatchCard(matches[0], account);
    list.replaceChildren(...[fresh, ...matches.slice(fresh ? 1 : 0, 15).map((m) => matchListItem(m, account))].filter(Boolean));
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
      await storage.set("account_id", String(id));
      if (stale(seq)) return;
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
        h("div", { class: "metric" }, h("b", {}, String(wins)), h("span", {}, plural(wins, "победа", "победы", "побед"))),
        h("div", { class: "metric" }, h("b", {}, String(losses)), h("span", {}, plural(losses, "поражение", "поражения", "поражений"))),
      ),
    ),
    recent.length > 0 && h("h2", {}, "Форма — последние игры"),
    recent.length > 0 && h("div", { class: "card" },
      h("div", { class: "form-strip" }, ...dots),
      h("div", { class: "small muted" }, `${((w) => `${w} ${plural(w, "победа", "победы", "побед")}`)(recent.filter((m) => (m.player_slot < 128) === m.radiant_win).length)} из ${recent.length}`),
    ),
    trendBlock(recent),
    ...progressBlocks(account),
    friendsBlock(account),
    topHeroes.length > 0 && h("h2", {}, "Любимые герои"),
    topHeroes.length > 0 && h("div", { class: "card" }, ...topHeroes.map((hx) => {
      const wr = hx.games ? Math.round((hx.win / hx.games) * 100) : 0;
      return h("button", { class: "hero-stat", onclick: () => { haptic(); go(heroStatsScreen, hx.hero_id); } },
        heroImg(hx.hero_id),
        h("div", { class: "grow" },
          h("div", { class: "hn" }, dictionary.heroName(hx.hero_id)),
          h("div", { class: "hg" }, games(hx.games)),
          h("div", { class: "wrbar" }, h("i", { "data-pct": wr })),
        ),
        h("div", { class: `wr ${wr >= 50 ? "win-text" : "loss-text"}` }, `${wr}%`),
      );
    })),
    weakHeroesBlock(heroes),
    h("button", { class: "ghost", onclick: () => { storage.set("account_id", ""); navRoot("home", homeScreen); } }, "Сменить аккаунт"),
  );
  tilt(app.querySelector(".profile-card") && app.querySelector(".profile-card").parentElement);
}

// Тренд по последним играм: свежие 10 против предыдущих 10 (по данным recentMatches)
function trendBlock(recent) {
  const pool = recent.filter((m) => m.duration > 600 && m.game_mode !== TURBO_MODE);
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
    h("div", { class: "small muted" }, `${plural(fresh.length, "Последняя", "Последние", "Последние")} ${games(fresh.length)} против ${plural(old.length, "предыдущей", "предыдущих", "предыдущих")} ${old.length}`)));
}

// Герои с низким винрейтом за всё время — на них стоит меньше играть или разобрать отдельно
function weakHeroesBlock(heroes) {
  const weak = (heroes || []).filter((hx) => hx.games >= 8 && hx.win / hx.games <= 0.4)
    .sort((a, b) => b.games - a.games).slice(0, 3);
  if (!weak.length) return null;
  return h("div", {}, h("h2", {}, "Не заходят"),
    h("div", { class: "card" }, ...weak.map((hx) => h("div", { class: "problem-fact" },
      `${dictionary.heroName(hx.hero_id)}: ${Math.round((hx.win / hx.games) * 100)}% побед за ${hx.games} ${plural(hx.games, "игру", "игры", "игр")}. Пока лучше не пикай его в рейтинге.`))));
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
    trend = h("div", {}, h("h2", {}, `Тренд за последние ${last.length} ${plural(last.length, "игру", "игры", "игр")}`), h("div", { class: "card" },
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
          h("div", { class: "hg" }, `${games(f.g)}: ${f.w} ${plural(f.w, "победа", "победы", "побед")}, ${f.g - f.w} ${plural(f.g - f.w, "поражение", "поражения", "поражений")}`)),
        h("div", { class: `wr ${fwr >= 50 ? "win-text" : "loss-text"}` }, `${fwr}%`));
    }),
    h("div", { class: "small muted" }, "Только враги, против которых было 5+ игр.")));

  render(head,
    h("div", { class: "card" },
      h("div", { class: "profile-metrics" },
        h("div", { class: "metric" }, h("b", {}, String(list.length)), h("span", {}, plural(list.length, "игра", "игры", "игр"))),
        h("div", { class: "metric" }, h("b", { class: wr >= 50 ? null : "loss-text" }, `${wr}%`), h("span", {}, "винрейт")),
        h("div", { class: "metric" }, h("b", {}, String(wins)), h("span", {}, plural(wins, "победа", "победы", "побед"))),
      ),
      row("Средний KDA", `${avg((m) => m.kills).toFixed(1)}/${avg((m) => m.deaths).toFixed(1)}/${avg((m) => m.assists).toFixed(1)}`),
      row("GPM / XPM", `${Math.round(avg((m) => m.gold_per_min))} / ${Math.round(avg((m) => m.xp_per_min))}`),
      row("Добитые крипы", String(Math.round(avg((m) => m.last_hits)))),
      list.length < 10 && h("div", { class: "small muted" }, "Мало игр: выводы появятся, когда наберётся 10."),
    ),
    trend,
    list.length >= 10 && foesBlock,
    h("h2", {}, "Последние игры на герое"),
    ...list.slice(0, 10).map((m) => matchListItem(m, account)),
    h("div", { class: "small muted" }, "Турбо не считается. Данные обновляются раз в 6 часов."),
  );
}

// ---------- драфт до игры ----------

const DRAFT_POOL = 12; // своих героев проверяем против врагов

async function draftScreen() {
  section = "home";
  const seq = navSeq;
  const account = await storage.get("account_id");
  if (stale(seq)) return;
  const enemies = [];
  let role = "core";
  const all = dictionary.heroList();
  const chosen = h("div", { class: "draft-chosen" });
  const grid = h("div", { class: "draft-grid" });
  const result = h("div", { class: "draft-result" });
  const search = h("input", { type: "search", placeholder: "Найди врага: имя героя", "aria-label": "Поиск героя" });
  const goBtn = h("button", { type: "button", class: "draft-go" }, "Подсказать пик и сборку");
  const roleBtn = (value, label) => h("button", { type: "button", class: "seg", "aria-pressed": String(role === value), onclick: (e) => {
    role = value;
    for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
  } }, label);
  const drawChosen = () => {
    chosen.replaceChildren(...enemies.map((id) => h("button", { type: "button", class: "draft-pick", "aria-label": `Убрать ${dictionary.heroName(id)}`,
      onclick: () => { enemies.splice(enemies.indexOf(id), 1); hapticTick(); drawChosen(); drawGrid(); } },
    heroImg(id), h("span", {}, dictionary.heroName(id)))),
    ...Array.from({ length: 5 - enemies.length }, () => h("div", { class: "draft-pick empty" })));
    goBtn.disabled = enemies.length < 2;
  };
  const drawGrid = () => {
    const q = search.value.trim().toLowerCase();
    const list = all.filter((x) => !enemies.includes(x.id) && (!q || x.name.toLowerCase().includes(q))).slice(0, q ? 40 : 60);
    grid.replaceChildren(...list.map((x) => h("button", { type: "button", class: "draft-hero", "aria-label": x.name, disabled: enemies.length >= 5,
      onclick: () => { if (enemies.length < 5) { enemies.push(x.id); hapticTick(); search.value = ""; drawChosen(); drawGrid(); } } },
    img(x.img, "hero-img"), h("span", {}, x.name))));
  };
  search.addEventListener("input", drawGrid);
  goBtn.onclick = async () => {
    if (!account) { result.replaceChildren(h("p", { class: "muted" }, "Привяжи аккаунт на «Главной»: подсказываю из твоих героев.")); return; }
    goBtn.disabled = true;
    haptic("medium");
    result.replaceChildren(h("div", { class: "center" }, h("div", { class: "spinner" }), h("div", { class: "muted small" }, "Смотрю твоих героев против этих врагов...")));
    try {
      const heroes = ((await api(`/players/${account}/heroes`)) || []).filter((x) => x.games >= 3)
        .sort((a, b) => b.games - a.games).slice(0, DRAFT_POOL);
      const matchups = {};
      // по очереди: OpenDota режет частые запросы
      for (const x of heroes) matchups[x.hero_id] = await heroMatchups(x.hero_id);
      if (stale(seq)) return;
      const advice = draftAdvice({ enemies: [...enemies], pool: heroes, matchups, knowledge, od: dictionary, role });
      result.replaceChildren(draftResult(advice));
    } catch {
      result.replaceChildren(h("p", { class: "error" }, "OpenDota не отвечает. Попробуй ещё раз."));
    } finally {
      goBtn.disabled = enemies.length < 2;
    }
  };
  drawChosen();
  drawGrid();
  render(
    h("div", { class: "page-head" }, h("h1", {}, "Драфт перед игрой")),
    h("p", { class: "muted" }, "Выбери врагов, которых видишь на пике. Подскажу, кого из твоих героев взять и что собирать."),
    h("div", { class: "card" },
      h("div", { class: "seg-row" }, roleBtn("core", "Я кор"), roleBtn("support", "Я саппорт")),
      chosen, goBtn),
    result,
    h("h2", {}, "Враги"),
    search, grid,
  );
}

function draftResult(advice) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  return h("div", {},
    h("h2", {}, "Кого пикнуть из твоих"),
    advice.picks.length ? h("div", { class: "card" }, ...advice.picks.map((p, i) => h("div", { class: "draft-row" },
      h("div", { class: "plan-num" }, String(i + 1)), heroImg(p.hero_id),
      h("div", { class: "grow" },
        h("div", { class: "hn" }, p.name),
        h("div", { class: "small muted" }, p.vs.map((v) => `${v.name} ${pct(v.wr)}`).join(" · ")),
        h("div", { class: "small muted" }, `твоих игр: ${p.games}`)),
      h("b", { class: p.matchup_wr >= 0.5 ? "win-text" : "loss-text" }, pct(p.matchup_wr)))),
    h("p", { class: "small muted" }, "Процент — как герой выигрывает против этих врагов по всем играм OpenDota."))
      : h("p", { class: "muted" }, "Мало данных по твоим героям против этих врагов. Сыграй больше на 3–4 героях."),
    advice.items.length > 0 && h("h2", {}, "Что собирать"),
    advice.items.length > 0 && h("div", { class: "card" }, ...advice.items.map((it) => h("div", { class: "why-row" },
      itemChip(it.key, "chip need"), h("div", { class: "small muted" }, `против: ${it.why} (${it.from})`)))));
}

function matchEmpty() {
  section = "match";
  render(h("div", { class: "match-empty" },
    aegis(),
    h("h1", {}, "Разбор пуст"),
    h("p", { class: "muted" }, "Открой матч на «Главной» — разбор появится здесь."),
    h("button", { onclick: () => navRoot("home", homeScreen) }, "На главную"),
  ));
}

const FRESH_HOURS = 12;

// Последняя катка за полдня: большой блок сверху, а разбор реплея заказываем сразу,
// чтобы к нажатию «Разобрать» он уже был готов
function freshMatchCard(m, account) {
  if (!m || Date.now() / 1000 - (m.start_time + (m.duration || 0)) > FRESH_HOURS * 3600) return null;
  const flag = `req:${m.match_id}`;
  if (!safeLocal.get(flag)) {
    safeLocal.set(flag, "1");
    api(`/request/${m.match_id}`, { method: "POST" }).catch(() => {});
  }
  const won = (m.player_slot < 128) === m.radiant_win;
  const ago = Math.max(1, Math.round((Date.now() / 1000 - m.start_time - (m.duration || 0)) / 60));
  const when = ago < 60 ? `${ago} ${plural(ago, "минуту", "минуты", "минут")} назад` : `${Math.round(ago / 60)} ${plural(Math.round(ago / 60), "час", "часа", "часов")} назад`;
  return tilt(h("button", { class: `fresh-match ${won ? "win" : "loss"}`, type: "button", onclick: () => { haptic("medium"); go(matchScreen, m.match_id, null, Number(account)); } },
    h("div", { class: "fresh-label" }, "Последняя катка"),
    h("div", { class: "row" },
      heroImg(m.hero_id, "hero-img fresh-img"),
      h("div", { class: "grow" },
        h("div", { class: "fresh-hero" }, dictionary.heroName(m.hero_id)),
        h("div", { class: "small muted" }, `${won ? "Победа" : "Поражение"} · ${m.kills}/${m.deaths}/${m.assists} · ${when}`))),
    h("div", { class: "fresh-cta" }, "Разобрать")));
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
    errorScreen("Такого матча нет. Проверь ID.", () => navRoot("home", homeScreen));
    return;
  }
  if (!isParsed(match)) {
    if (attempt === 0) {
      api(`/request/${matchId}`, { method: "POST" }).catch(() => {});
      watchParse(matchId);
    }
    if (attempt >= PARSE_POLL_MAX) {
      errorScreen("Реплей так и не разобрался. Попробуй позже.", () => go(matchScreen, matchId, slot, accountId));
      return;
    }
    render(h("div", { class: "center" },
      h("div", { class: "spinner" }),
      h("p", { class: "display" }, "Реплей разбирается"),
      h("p", { class: "small muted" }, "Обычно 1–5 минут. Страница обновится сама."),
      watched.has(matchId) && h("p", { class: "small muted" }, "Можешь закрыть приложение: бот напишет в Телеграм, когда разбор будет готов."),
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

  const [pro, bench, matchups, replay] = await Promise.all([proItems(player.hero_id), heroBench(player.hero_id), heroMatchups(player.hero_id), fetchReplay(matchId)]);
  if (stale(seq)) return;
  let a;
  try {
    a = analyze(match, player, dictionary, knowledge, texts, pro, bench, norms, matchups, replay);
  } catch (e) {
    // иначе на необычном матче вечно крутится «Призываю матч...»
    console.error(e);
    errorScreen("Не смог разобрать этот матч: у OpenDota в нём необычные данные.", () => navRoot("home", homeScreen));
    return;
  }
  // для блока «Обычно у тебя»: сырые цифры этой игры и чей аккаунт
  a.hist_self = { account: player.account_id, duration: match.duration, kills: player.kills, deaths: player.deaths,
    assists: player.assists, gold_per_min: player.gold_per_min, xp_per_min: player.xp_per_min, last_hits: player.last_hits };
  analysisScreen(a);
}

// Подписка на уведомление: воркер проверит подпись Телеграма и напишет в личку, когда реплей разберётся
const watched = new Set();
function watchParse(matchId) {
  if (!COACH_URL || !tg || !tg.initData || watched.has(matchId)) return;
  watched.add(matchId);
  postCoach({ mode: "watch", match_id: matchId, initData: tg.initData }).catch(() => watched.delete(matchId));
}

// Разбираем только свои игры: либо аккаунт не привязан, либо тебя нет в матче
async function notYourMatch() {
  const seq = navSeq;
  const saved = Number(await storage.get("account_id"));
  if (stale(seq)) return;
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
  ["Карта", mapTab],
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
  a._select = (i) => { select(i); if (lens) lens.place(i); };
  if (COACH_URL) rememberForCompare(a);
  if (a._goalResult === undefined) { a._goalResult = trackProgress(a); if (a.hist_self) syncSoon(a.hist_self.account); }
  TABS.forEach(([name]) => tabs.append(h("button", { class: "tab", role: "tab" }, name)));
  lens = glassBar(tabs, ".tab", { live: true, onPick: select });
  // Свайп по содержимому листает вкладки; графики со своим жестом не трогаем
  // и всё, что само листается вбок (чипсы вопросов тренеру, таблицы): иначе прокрутка ряда уводит на соседнюю вкладку
  const scrollsX = (el) => {
    for (; el && el !== content; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };
  let sx = 0, sy = 0, tracking = false;
  content.addEventListener("touchstart", (e) => {
    tracking = e.touches.length === 1 && !e.target.closest(".chart, .frame, input, textarea, .chat-chips, .chat-list, .chat-row")&& !scrollsX(e.target);
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
        h("div", { class: "hero-ring" }, medal(a.overall)),
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
  tilt(app.querySelector(".hero-head"));
  lens.place(0, true);
}

// Шеринг: короткий вердикт + ссылка на бота (растит бота)
function shareLink(a) {
  const f = a.facts;
  const link = `https://t.me/${BOT_USERNAME}?startapp`;
  const text = `${f.hero} · ${f.won ? "Победа" : "Поражение"} · оценка ${a.overall}/10\n${a.verdict}`;
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

// Переносит текст по ширине и рисует не больше maxLines строк
function drawWrapped(ctx, text, x, y, width, lineHeight, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + shown.length * lineHeight;
}

// Карточка 1080×1920 для истории в стиле приложения: ночная карта (свет баз в углах, река),
// герой, итог, золотой медальон оценки, цифры и главный вывод тренера
async function renderCard(a) {
  const f = a.facts;
  const W = 1080, H = 1920, P = 96;
  const C = { ink: "#08090c", text: "#eceae4", muted: "#8a8f9c", aegis: "#e8c27a", radiant: "#4fd1a5", dire: "#f2555a" };
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  try { await Promise.all(["700 120px Unbounded", "800 48px Manrope", "600 40px Manrope"].map((s) => document.fonts.load(s))); } catch { /* системный шрифт */ }
  const display = (s) => `700 ${s}px Unbounded, Manrope, -apple-system, sans-serif`;
  const sans = (w, s) => `${w} ${s}px Manrope, -apple-system, "Segoe UI", sans-serif`;
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  glow(W * 0.95, 120, 1000, "rgba(242,85,90,0.30)");
  glow(80, H - 80, 1100, "rgba(79,209,165,0.26)");
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(Math.PI / 5);
  const river = ctx.createLinearGradient(-W, 0, W, 0);
  river.addColorStop(0, "rgba(90,143,214,0)"); river.addColorStop(0.5, "rgba(90,143,214,0.16)"); river.addColorStop(1, "rgba(90,143,214,0)");
  // мягкие края реки: размытие там, где браузер его умеет, иначе просто бледная полоса
  ctx.filter = "blur(36px)";
  ctx.fillStyle = river; ctx.fillRect(-W * 1.2, -90, W * 2.4, 180);
  ctx.filter = "none";
  ctx.restore();

  ctx.fillStyle = C.muted; ctx.font = sans(700, 40);
  ctx.fillText("Разбор катки", P, 210);
  ctx.fillStyle = C.text; ctx.font = display(f.hero.length > 12 ? 92 : 120);
  const afterName = drawWrapped(ctx, f.hero, P, 360, W - 2 * P, f.hero.length > 12 ? 104 : 132, 2);

  // плашка итога
  const pill = `${f.won ? "Победа" : "Поражение"} · ${f.duration}`;
  ctx.font = sans(800, 44);
  const pw = ctx.measureText(pill).width + 64;
  ctx.fillStyle = f.won ? C.radiant : C.dire;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(P, afterName - 30, pw, 84, 42); else ctx.rect(P, afterName - 30, pw, 84);
  ctx.fill();
  ctx.fillStyle = f.won ? "#062a1e" : "#2b0507"; ctx.fillText(pill, P + 32, afterName + 26);

  // медальон оценки
  const cx = W / 2, cy = 900, r = 210;
  ctx.lineWidth = 34; ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, "#f6dda4"); ring.addColorStop(0.5, C.aegis); ring.addColorStop(1, "#b98a3e");
  ctx.strokeStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * a.overall) / 10); ctx.stroke();
  const disc = ctx.createRadialGradient(cx - 60, cy - 70, 10, cx, cy, r - 20);
  disc.addColorStop(0, "#2c2f3a"); disc.addColorStop(1, "#11131a");
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(cx, cy, r - 26, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = C.text; ctx.font = display(150); ctx.fillText(a.overall.toFixed(1), cx, cy + 50);
  ctx.fillStyle = C.muted; ctx.font = sans(700, 36); ctx.fillText("оценка из 10", cx, cy + 112);

  // цифры в три колонки
  [["KDA", f.kda], ["GPM", String(f.gpm)], ["XPM", String(f.xpm)]].forEach(([label, value], i) => {
    const col = (W - 2 * P) / 3;
    const x = P + col * (i + 0.5);
    // длинный KDA вроде 14/12/30 не должен заезжать на соседнюю колонку
    let size = 58;
    ctx.font = display(size);
    while (size > 30 && ctx.measureText(value).width > col - 24) ctx.font = display(size -= 4);
    ctx.fillStyle = C.text; ctx.fillText(value, x, 1250);
    ctx.fillStyle = C.muted; ctx.font = sans(700, 32); ctx.fillText(label, x, 1300);
  });
  ctx.textAlign = "left";

  const coach = safeLocal.get(coachKey(a));
  const main = (coach && parseCoach(coach).main) || a.verdict;
  ctx.fillStyle = C.aegis; ctx.font = sans(800, 38); ctx.fillText(coach ? "Тренер говорит" : "Вердикт", P, 1420);
  ctx.fillStyle = C.text; ctx.font = sans(700, 52);
  drawWrapped(ctx, main, P, 1500, W - 2 * P, 68, 4);

  // подпись с медальоном-знаком
  const sx = P + 34, sy = H - 150;
  const sig = ctx.createLinearGradient(sx - 34, sy - 34, sx + 34, sy + 34);
  sig.addColorStop(0, "#f6dda4"); sig.addColorStop(1, "#b98a3e");
  ctx.fillStyle = sig; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.text; ctx.font = sans(800, 40); ctx.fillText("Разбери свою катку", P + 92, sy - 6);
  ctx.fillStyle = C.muted; ctx.font = sans(700, 34); ctx.fillText(`@${BOT_USERNAME}`, P + 92, sy + 38);
  // JPEG: тот же вид в несколько раз легче PNG (плавные градиенты PNG жмёт плохо)
  return canvas.toDataURL("image/jpeg", 0.9);
}

// Шторка «Поделиться»: картинка в историю, сохранить картинку или ссылка в чат
function shareMatch(a) {
  haptic("medium");
  const canStory = Boolean(tg && tg.shareToStory && tg.isVersionAtLeast && tg.isVersionAtLeast("7.8"));
  const canSave = Boolean(tg && tg.downloadFile && tg.isVersionAtLeast && tg.isVersionAtLeast("8.0"));
  const preview = h("div", { class: "sheet-preview" }, h("div", { class: "spinner" }));
  const status = h("p", { class: "small muted", role: "status" });
  let cardUrl = null, dataUrl = null;
  const close = () => { sheet.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  // Ссылка на картинку нужна Телеграму: загружаем её в воркер один раз
  const upload = async () => {
    if (cardUrl) return cardUrl;
    if (!dataUrl) throw Object.assign(new Error("Картинка ещё рисуется, секунду."), { fromCoach: true });
    status.textContent = "Готовлю картинку...";
    const data = await postCoach({ mode: "card", image: dataUrl });
    cardUrl = data.url;
    status.textContent = "";
    return cardUrl;
  };
  const act = (label, fn, primary = false) => h("button", { type: "button", class: primary ? "sheet-btn" : "sheet-btn ghost", onclick: async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await fn(); } catch (err) { status.textContent = coachError(err); } finally { btn.disabled = false; }
  } }, label);
  const actions = h("div", { class: "sheet-actions" },
    canStory && act("Выложить в историю", async () => {
      tg.shareToStory(await upload(), { text: `${a.facts.hero}: ${a.overall.toFixed(1)}/10. Разбор в @${BOT_USERNAME}` });
    }, true),
    act(canSave ? "Сохранить картинку" : "Открыть картинку", async () => {
      const url = await upload();
      if (canSave) tg.downloadFile({ url, file_name: `razbor-${a.facts.match_id}.png` });
      else if (tg && tg.openLink) tg.openLink(url);
      else window.open(url, "_blank");
    }, !canStory),
    act("Ссылка в чат", async () => shareLink(a)));
  const sheet = h("div", { class: "sheet-backdrop", onclick: (e) => { if (e.target === sheet) close(); } },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Поделиться разбором" },
      h("div", { class: "sheet-grip", "aria-hidden": "true" }),
      preview, actions, status,
      h("button", { type: "button", class: "sheet-close ghost", onclick: close }, "Закрыть")));
  document.body.append(sheet);
  document.addEventListener("keydown", onKey);
  renderCard(a).then((url) => {
    dataUrl = url;
    preview.replaceChildren(h("img", { src: url, alt: "Карточка разбора" }));
  }).catch(() => { preview.replaceChildren(h("p", { class: "muted" }, "Картинка не нарисовалась. Можно отправить ссылку.")); });
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
}

// ---------- тренер на Opus (через воркер из worker/coach.js) ----------

const COACH_URL = "https://dotacoach.2007rggg.workers.dev"; // адрес воркера с тренером
const COACH_DAILY = 5; // разборов тренера в день на устройство
const CHAT_DAILY = 40; // сообщений тренеру в день на устройство
const COACH_TIMEOUT = 75000;
const MEMORY_SIZE = 10; // прошлых разборов в памяти тренера
const COMPARE_SIZE = 8; // каток, с которыми можно сравнить

const safeLocal = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* приватный режим */ } },
};
const localJson = (key, fallback) => { try { return JSON.parse(safeLocal.get(key) || "null") ?? fallback; } catch { return fallback; } };

// Счётчик на день: [использовано, записать+1]
function dailyCounter(name) {
  const day = new Date().toISOString().slice(0, 10);
  const used = safeLocal.get(`${name}_day`) === day ? Number(safeLocal.get(`${name}_n`) || 0) : 0;
  return [used, () => { safeLocal.set(`${name}_day`, day); safeLocal.set(`${name}_n`, String(used + 1)); }];
}

// Запрос к воркеру. Ошибка с текстом воркера помечена fromCoach, остальные переводятся на русский
async function postCoach(body) {
  const ctrl = new AbortController();
  // воркер в худшем случае ждёт Opus и запасные модели около минуты: дольше ждать нет смысла
  const timer = setTimeout(() => ctrl.abort(), COACH_TIMEOUT);
  try {
    const res = await fetch(COACH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Тренер сейчас недоступен."), { fromCoach: true });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function coachError(e) {
  // текст ошибки показываем только от воркера: у fetch он английский («Failed to fetch»)
  if (e && e.fromCoach && e.message.length < 80) return e.message;
  return e && e.name === "AbortError" ? "Тренер думал слишком долго. Попробуй ещё раз." : "Нет связи с тренером. Проверь интернет.";
}

// Память тренера: главные выводы прошлых разборов этого аккаунта, свежие первыми
const memoryKey = (a) => `coach_mem:${(a.hist_self && a.hist_self.account) || "anon"}`;
function pastReviews(a) {
  return localJson(memoryKey(a), []).filter((m) => m.match !== a.facts.match_id).slice(0, 5)
    .map((m) => ({ hero: m.hero, won: m.won, main: m.main }));
}
function rememberReview(a, main) {
  if (!main) return;
  const list = localJson(memoryKey(a), []).filter((m) => m.match !== a.facts.match_id);
  list.unshift({ match: a.facts.match_id, hero: a.facts.hero, won: a.facts.won, main: main.slice(0, 240), t: Date.now() });
  safeLocal.set(memoryKey(a), JSON.stringify(list.slice(0, MEMORY_SIZE)));
}

function coachPayload(a) {
  const s = a.summary || {}, f = a.facts;
  return {
    hero: f.hero, role: s.role || "", rank: s.rank || "", won: f.won, kda: f.kda, duration: f.duration,
    problems: (s.problems || []).slice(0, 3).map((p) => ({ title: p.title, fact: p.fact, action: p.action })),
    strengths: (s.strengths || []).slice(0, 2).map((x) => ({ title: x.title, fact: x.fact })),
    micro: a.findings.filter((x) => x.kind === "micro" && x.severity !== GOOD).slice(0, 4).map((x) => ({ text: x.text, tip: x.tip })),
    plan: a.build_plan ? a.build_plan.missing.slice(0, 3).map((i) => ({ item: i.item, why: i.why })) : [],
    draft: a.draft ? a.draft.notes.slice(0, 2).map((n) => n.text) : [],
    episodes: (a.episodes || []).slice(0, 4).map((e) => ({ clock: e.clock, kind: e.kind, facts: e.facts })),
    past: pastReviews(a),
  };
}

// Ответ воркера: «Главное: ...», пустая строка, «План на следующую игру:», шаги с «— ».
// Если формат поплыл, всё, что не шаг и не заголовок, уходит в «Главное».
function parseCoach(text) {
  const main = [], moments = [], steps = [];
  let into = steps;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // \b в JS не видит границ кириллических слов, поэтому [\s:]
    if (/^моменты[\s:]/i.test(line)) { into = moments; continue; }
    if (/^план[\s:]/i.test(line)) { into = steps; continue; }
    const step = line.match(/^(?:[—–-]|\d+[.)])\s*(.+)$/);
    if (step) into.push(step[1]);
    else main.push(line.replace(/^главное\s*:\s*/i, ""));
  }
  return { main: main.join(" "), moments, steps };
}

// coach3: моменты с фактами о линии и размене; старые ответы писались по другим фактам и рядом с новыми врут
// с разобранным реплеем у тренера другие факты: отдельный ответ
const coachKey = (a) => `coach3:${a.facts.match_id}:${a.facts.slot}${a.replay ? ":r" : ""}`;

function coachBlock(a) {
  if (!COACH_URL) return null;
  const key = coachKey(a);
  const box = h("section", { class: "card coach", "aria-labelledby": "coach-title" });
  const title = h("div", { class: "coach-title", id: "coach-title" }, "Разбор тренера");

  const show = (text, fresh) => {
    const { main, moments, steps } = parseCoach(text);
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
      moments.length > 0 && seq(h("div", { class: "coach-label" }, "Где ошибся")),
      ...moments.map((m) => {
        // Факты момента берём из движка (проверенные), от тренера только «Ошибка» и «Надо было»
        const t = /^(\d{1,2}:\d{2})\s+(.+)$/.exec(m);
        const ep = t && (a.episodes || []).find((e) => e.clock === t[1]);
        const [err, todo] = t ? t[2].split(/\s*Надо было:\s*/) : [m];
        const more = t && h("button", { class: "coach-more", type: "button" }, "Спросить подробнее");
        if (more) more.onclick = () => chatFor(a).ask(`Расскажи подробнее про ${t[1]}: что именно я сделал не так и как надо было сыграть?`);
        return seq(h("div", { class: "coach-moment" },
          t && h("time", {}, t[1]),
          ep && h("p", { class: "coach-facts" }, ep.facts.join("; ")),
          h("p", {}, err.replace(/^Ошибка:\s*/, "")),
          todo && h("p", { class: "coach-todo" }, h("b", {}, "Надо было: "), todo),
          more));
      }),
      steps.length > 0 && seq(h("div", { class: "coach-label" }, "Задачи на следующую катку")),
      steps.length > 0 && list);
    rememberReview(a, main);
  };
  const cached = safeLocal.get(key);
  if (cached) { show(cached, false); return box; }

  const ask = h("button", { class: "coach-btn", type: "button" }, "Разобрать с тренером");
  const note = h("p", { class: "coach-note small muted", role: "status" },
    "Тренер разберёт ключевые моменты катки и даст три задачи на следующую. Потом можно задать ему вопросы.");
  ask.onclick = async () => {
    const [used, spend] = dailyCounter("coach");
    if (used >= COACH_DAILY) { note.textContent = `Сегодня уже ${COACH_DAILY} разборов, это лимит. Завтра снова.`; return; }
    ask.disabled = true;
    ask.textContent = "Тренер смотрит катку…";
    box.classList.add("coach-thinking");
    haptic("medium");
    try {
      const data = await postCoach(coachPayload(a));
      if (!data.text) throw Object.assign(new Error("Тренер сейчас недоступен."), { fromCoach: true });
      if (!data.cached) spend();
      safeLocal.set(key, data.text);
      show(data.text, true);
    } catch (e) {
      ask.disabled = false;
      ask.textContent = "Попробовать ещё раз";
      note.textContent = coachError(e);
    } finally {
      box.classList.remove("coach-thinking");
    }
  };
  box.append(title, ask, note);
  return box;
}

// ---------- чат с тренером ----------

const chatKey = (a) => `chat1:${a.facts.match_id}:${a.facts.slot}`;
const CHAT_KEEP = 30;

// Готовые вопросы под эту катку: нажал — спросил, печатать не надо
function chatSuggestions(a) {
  const out = [];
  const ep = (a.episodes || [])[0];
  if (ep) out.push(`Что надо было делать на ${ep.clock}?`);
  const killer = (a.killers || [])[0];
  if (killer) out.push(`Что собирать против ${killer.hero}?`);
  out.push(a.facts.won ? "За счёт чего мы выиграли?" : "Почему мы проиграли?");
  out.push(`Как выигрывать линию на ${a.facts.hero}?`);
  return out.slice(0, 4);
}

// Один чат на разбор: блок живёт в «Обзоре», спросить можно из любой вкладки
function chatFor(a) {
  if (!a._chat) a._chat = chatBlock(a);
  return a._chat;
}

function chatBlock(a) {
  let history = localJson(chatKey(a), []);
  const list = h("div", { class: "chat-list", role: "log", "aria-live": "polite" });
  const input = h("textarea", { class: "chat-input", rows: "1", maxlength: "400", placeholder: "Спроси про эту катку", "aria-label": "Вопрос тренеру" });
  const send = h("button", { class: "chat-send", type: "button", "aria-label": "Отправить" },
    svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: "M5 12h13M13 6l6 6-6 6" })));
  const note = h("p", { class: "chat-note small muted", role: "status" });
  const chips = h("div", { class: "chat-chips" }, chatSuggestions(a).map((q) =>
    h("button", { class: "chat-chip", type: "button", onclick: () => ask(q) }, q)));
  let busy = false;
  const bubble = (m) => h("div", { class: `chat-msg ${m.role}` }, m.text);
  const draw = (typing = false) => {
    const dots = typing ? [h("div", { class: "chat-msg assistant typing", "aria-label": "Тренер печатает" }, h("i"), h("i"), h("i"))] : [];
    list.replaceChildren(...history.map(bubble), ...dots);
    list.hidden = !history.length && !typing;
  };
  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  send.onclick = () => ask(input.value);

  async function ask(question) {
    const q = String(question || "").trim().slice(0, 400);
    if (!q || busy) return;
    const [used, spend] = dailyCounter("chat");
    if (used >= CHAT_DAILY) { note.textContent = `Сегодня уже ${CHAT_DAILY} вопросов, это лимит. Завтра снова.`; return; }
    busy = true;
    send.disabled = true;
    note.textContent = "";
    const before = history.slice(-10);
    history = [...history, { role: "user", text: q }];
    input.value = "";
    grow();
    draw(true);
    haptic("light");
    try {
      const data = await postCoach({ mode: "chat", summary: coachPayload(a), coach: safeLocal.get(coachKey(a)) || "", history: before, question: q });
      if (!data.text) throw Object.assign(new Error("Тренер сейчас недоступен."), { fromCoach: true });
      spend();
      history = [...history, { role: "assistant", text: data.text }].slice(-CHAT_KEEP);
      safeLocal.set(chatKey(a), JSON.stringify(history));
      haptic("medium");
    } catch (e) {
      // вопрос без ответа не храним: его можно задать снова
      history = history.slice(0, -1);
      input.value = q;
      grow();
      note.textContent = coachError(e);
    } finally {
      busy = false;
      send.disabled = false;
      draw();
    }
  }

  draw();
  const box = h("section", { class: "card chat", "aria-labelledby": "chat-title" },
    h("div", { class: "coach-title", id: "chat-title" }, "Спроси тренера"),
    h("p", { class: "small muted chat-hint" }, "Только про Доту и эту катку: моменты, сборку, линию, драки."),
    list, chips, h("div", { class: "chat-row" }, input, send), note);
  return {
    box,
    // Вопрос из другой вкладки или из момента: показать чат и спросить
    ask(q) {
      if (a._select) a._select(0);
      requestAnimationFrame(() => box.scrollIntoView({ behavior: "smooth", block: "start" }));
      ask(q);
    },
  };
}

// ---------- прогресс: задачи, ачивки, неделя, ранг ----------

const PROGRESS_KEEP = 60;
const progKey = (acc) => `prog:${acc}`;
const goalKey = (acc) => `goal:${acc}`;
const goalHistKey = (acc) => `goal_hist:${acc}`;

// Катка уходит в историю прогресса, а задача с прошлой катки проверяется по её цифрам.
// Задача одна: её ставит самая свежая разобранная катка, старые катки задачу не трогают
function trackProgress(a) {
  const acc = a.hist_self && a.hist_self.account;
  if (!acc || !a.progress) return null;
  const t = a.facts.start_time || 0;
  const top = ((a.summary || {}).problems || [])[0];
  const list = localJson(progKey(acc), []).filter((x) => x.match !== a.facts.match_id);
  list.push({ match: a.facts.match_id, t, hero_id: a.facts.hero_id, hero: a.facts.hero, won: a.facts.won, score: a.overall,
    kda: a.facts.kda, m: a.progress, problem: top && !top.minor ? top.title : null, next_rank: a.next_rank });
  list.sort((x, y) => x.t - y.t);
  safeLocal.set(progKey(acc), JSON.stringify(list.slice(-PROGRESS_KEEP)));

  const hist = localJson(goalHistKey(acc), []);
  let result = hist.find((g) => g.checked === a.facts.match_id) || null;
  let cur = localJson(goalKey(acc), null);
  if (!result && cur && cur.match !== a.facts.match_id && t > cur.t) {
    const r = checkGoal(cur.check, a.progress);
    result = { text: cur.text, check: cur.check, from: cur.match, checked: a.facts.match_id, status: r ? r.status : "skip", value: r ? r.value : null, t };
    hist.unshift(result);
    safeLocal.set(goalHistKey(acc), JSON.stringify(hist.slice(0, 30)));
  }
  const check = (a.summary || {}).goal_check;
  if (check && (!cur || t >= cur.t)) {
    cur = { text: a.summary.goal, check, match: a.facts.match_id, t };
    safeLocal.set(goalKey(acc), JSON.stringify(cur));
  }
  return result;
}

const GOAL_STATUS = { done: "Выполнено", failed: "Не вышло", skip: "В этой катке не проверить" };
const goalText = (text) => String(text || "").replace(/^Цель на следующую катку:\s*/, "");

// Задача с прошлой катки (итог) и задача на следующую
function goalBlock(a) {
  const r = a._goalResult;
  const next = (a.summary || {}).goal_check && (a.summary || {}).goal;
  if (!r && !next) return null;
  return h("section", { class: "card goal-card" },
    r && h("div", { class: `goal-result ${r.status}` },
      h("div", { class: "goal-head" }, h("span", {}, "Задача с прошлой катки"), h("b", {}, GOAL_STATUS[r.status] || "")),
      h("p", {}, goalText(r.text)),
      r.value != null && h("p", { class: "small muted" }, `В этой катке: ${formatMetric(r.check.metric, r.value)}`)),
    next && h("div", { class: "goal-next" },
      h("div", { class: "goal-head" }, h("span", {}, "Задача на следующую катку")),
      h("p", {}, goalText(next)),
      h("p", { class: "small muted" }, "Проверю сам, когда разберёшь следующую игру.")));
}

// Профиль: задачи, ачивки, неделя и что подтянуть до следующего ранга
function progressBlocks(account) {
  const list = localJson(progKey(account), []);
  const hist = localJson(goalHistKey(account), []);
  const cur = localJson(goalKey(account), null);
  const done = hist.filter((g) => g.status === "done").length;
  const checked = hist.filter((g) => g.status !== "skip").length;
  const blocks = [];

  blocks.push(h("h2", {}, "Задачи тренера"));
  blocks.push(h("div", { class: "card goals" },
    cur ? h("div", { class: "goal-next" }, h("div", { class: "goal-head" }, h("span", {}, "Сейчас")), h("p", {}, goalText(cur.text)))
      : h("p", { class: "muted" }, "Разбери катку — тренер поставит задачу на следующую и сам проверит."),
    checked > 0 && h("p", { class: "small muted" }, `Выполнено ${done} из ${checked}`),
    ...hist.filter((g) => g.status !== "skip").slice(0, 6).map((g) => h("div", { class: `goal-row ${g.status}` },
      h("i", { "aria-hidden": "true" }), h("span", { class: "grow" }, goalText(g.text)),
      h("b", {}, g.value != null ? formatMetric(g.check.metric, g.value) : "")))));

  const ach = achievements(list, done);
  blocks.push(h("h2", {}, "Ачивки"));
  blocks.push(h("div", { class: "ach-grid" }, ...ach.map((x, n) => h("button", {
    class: `ach ${x.done ? "on" : ""} coin-delay-${n % 4}`, type: "button", title: x.desc,
    // тап переворачивает монету: на обороте прогресс
    onclick: (e) => { hapticTick(); e.currentTarget.classList.toggle("flip"); },
  },
    achCoin(x),
    h("b", {}, x.title),
    h("span", {}, x.desc),
    !x.done && h("div", { class: "ach-bar" }, h("i", { "data-pct": Math.round((x.have / x.need) * 100) })),
    h("em", {}, x.done ? "Открыто" : `${x.have} из ${x.need}`)))));
  if (!list.length) blocks.push(h("p", { class: "small muted" }, "Ачивки считаются по разобранным каткам: открывай свои игры."));

  const rank = rankGoalBlock(list);
  if (rank) blocks.push(rank);
  blocks.push(weekBlock(account, list));
  return blocks;
}

// До следующего ранга: средние последних разобранных каток на той же позиции против медианы ранга выше
function rankGoalBlock(list) {
  const last = [...list].reverse().find((x) => x.next_rank);
  if (!last) return null;
  const nr = last.next_rank;
  const same = list.filter((x) => x.m && x.m.pos === nr.pos).slice(-10);
  const rows = nr.metrics.map((k) => {
    const vals = same.map((x) => x.m[k.key]).filter((v) => v != null && Number.isFinite(v));
    if (vals.length < 2) return null;
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const ok = k.lower ? avg <= k.need : avg >= k.need;
    return h("div", { class: "score-row trend" },
      h("span", {}, k.what),
      h("span", { class: "muted" }, `${formatRankMetric(k.key, avg)} → ${formatRankMetric(k.key, k.need)}`),
      h("b", { class: ok ? "win-text" : "loss-text" }, ok ? "✓" : "!"));
  }).filter(Boolean);
  if (!rows.length) return null;
  return h("div", {}, h("h2", {}, `До ранга ${nr.rank}`), h("div", { class: "card" }, ...rows,
    h("p", { class: "small muted" }, `Слева твоё среднее по ${same.length} ${plural(same.length, "разобранной катке", "разобранным каткам", "разобранным каткам")} на этой позиции, справа медиана игроков ранга ${nr.rank}.`)));
}

const WEEK_FIELDS = ["hero_id", "kills", "deaths", "assists", "gold_per_min", "duration", "player_slot", "radiant_win", "start_time", "game_mode"];

// Неделя: эта неделя против прошлой по играм OpenDota, лучшая и худшая катка, главная ошибка недели
function weekBlock(account, list) {
  const box = h("div", {}, h("h2", {}, "Неделя"), h("div", { class: "card small muted" }, "Собираю игры за две недели..."));
  const seq = navSeq;
  (async () => {
    const rows = ((await api(`/players/${account}/matches?date=14&${WEEK_FIELDS.map((f) => `project=${f}`).join("&")}`)) || [])
      .filter((m) => m.game_mode !== TURBO_MODE && m.duration >= 600);
    if (stale(seq)) return;
    const now = Date.now() / 1000, week = 7 * 86400;
    const cur = rows.filter((m) => now - m.start_time < week), prev = rows.filter((m) => now - m.start_time >= week);
    if (!cur.length) { box.replaceChildren(h("h2", {}, "Неделя"), h("div", { class: "card muted" }, "На этой неделе игр не было.")); return; }
    const won = (m) => (m.player_slot < 128) === m.radiant_win;
    const kda = (m) => (m.kills + m.assists) / Math.max(1, m.deaths);
    const avg = (xs, f) => (xs.length ? xs.reduce((s, m) => s + f(m), 0) / xs.length : null);
    const line = (label, f, fmt, lowerBetter = false) => {
      const a = avg(cur, f), b = avg(prev, f);
      const better = b == null ? null : lowerBetter ? a < b : a > b;
      return h("div", { class: "score-row trend" }, h("span", {}, label),
        h("span", { class: "muted" }, b == null ? fmt(a) : `${fmt(b)} → ${fmt(a)}`),
        h("b", { class: better == null ? "muted" : better ? "win-text" : "loss-text" }, better == null ? "" : better ? "▲" : "▼"));
    };
    const best = cur.reduce((x, m) => (kda(m) > kda(x) ? m : x));
    const worst = cur.reduce((x, m) => (kda(m) < kda(x) ? m : x));
    // главная ошибка недели: чаще всего первая проблема в разобранных катках этой недели
    const counts = new Map();
    for (const x of list) if (x.problem && now - x.t < week) counts.set(x.problem, (counts.get(x.problem) || 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    box.replaceChildren(h("h2", {}, "Неделя"), h("div", { class: "card" },
      h("div", { class: "profile-metrics" },
        h("div", { class: "metric" }, h("b", {}, String(cur.length)), h("span", {}, plural(cur.length, "игра", "игры", "игр"))),
        h("div", { class: "metric" }, h("b", {}, `${Math.round((cur.filter(won).length / cur.length) * 100)}%`), h("span", {}, "побед")),
        h("div", { class: "metric" }, h("b", {}, avg(cur, kda).toFixed(1)), h("span", {}, "KDA"))),
      line("Винрейт", (m) => (won(m) ? 100 : 0), (v) => `${Math.round(v)}%`),
      line("Смертей за игру", (m) => m.deaths, (v) => v.toFixed(1), true),
      line("GPM", (m) => m.gold_per_min, (v) => String(Math.round(v))),
      top && h("div", { class: "week-mistake" }, h("span", {}, "Главная ошибка недели"), h("b", {}, top[0]),
        h("em", {}, `в ${top[1]} ${plural(top[1], "разобранной катке", "разобранных катках", "разобранных катках")}`)),
      h("div", { class: "week-pair" },
        weekMatch("Лучшая", best, account), cur.length > 1 && weekMatch("Худшая", worst, account)),
      h("p", { class: "small muted" }, prev.length ? `Эта неделя против прошлой (${prev.length} ${plural(prev.length, "игра", "игры", "игр")}). Турбо не считаю.` : "Прошлой недели для сравнения нет.")));
  })().catch(() => { if (!stale(seq)) box.replaceChildren(h("h2", {}, "Неделя"), h("div", { class: "card muted" }, "OpenDota не отдала игры за неделю.")); });
  return box;
}

function weekMatch(label, m, account) {
  return h("button", { class: "week-match", type: "button", onclick: () => { haptic(); go(matchScreen, m.match_id, null, Number(account)); } },
    h("span", { class: "muted small" }, label), heroImg(m.hero_id, "hero-img small"),
    h("b", {}, dictionary.heroName(m.hero_id)), h("span", { class: "small muted" }, `${m.kills}/${m.deaths}/${m.assists}`));
}

// ---------- синхронизация с сервером и друзья ----------

const friendsKey = (acc) => `friends:${acc}`;
const friendsRemovedKey = (acc) => `friends_removed:${acc}`;
let syncTimer = 0, syncing = null;

// История, задачи, память тренера и друзья живут на сервере (воркер, KV) и сливаются с локальными.
// Работает только внутри Телеграма: сервер узнаёт пользователя по подписанной initData
async function syncProfile(account) {
  if (!COACH_URL || !tg || !tg.initData || !account) return false;
  if (syncing) return syncing;
  syncing = (async () => {
    const data = {
      account_id: Number(account),
      progress: localJson(progKey(account), []),
      goal: localJson(goalKey(account), null),
      goal_hist: localJson(goalHistKey(account), []),
      memory: localJson(`coach_mem:${account}`, []),
      friends: localJson(friendsKey(account), []),
      removed_friends: localJson(friendsRemovedKey(account), []),
    };
    const res = await postCoach({ mode: "sync", initData: tg.initData, data });
    const d = res && res.data;
    if (!d) return false;
    safeLocal.set(progKey(account), JSON.stringify([...d.progress].sort((x, y) => x.t - y.t)));
    if (d.goal) safeLocal.set(goalKey(account), JSON.stringify(d.goal));
    safeLocal.set(goalHistKey(account), JSON.stringify(d.goal_hist));
    safeLocal.set(`coach_mem:${account}`, JSON.stringify(d.memory));
    safeLocal.set(friendsKey(account), JSON.stringify(d.friends));
    safeLocal.set(friendsRemovedKey(account), "[]");
    return true;
  })().catch(() => false).finally(() => { syncing = null; });
  return syncing;
}

// После разбора — не сразу, а пачкой: несколько открытых подряд каток уйдут одним запросом
function syncSoon(account) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncProfile(account), 4000);
}

const leaderCache = new Map();

// Друзья: Friend ID, рейтинг по последним 20 играм (винрейт, KDA, GPM) вместе с тобой
function friendsBlock(account) {
  const friends = localJson(friendsKey(account), []);
  const input = h("input", { inputmode: "numeric", placeholder: "Friend ID друга", "aria-label": "Friend ID друга" });
  const status = h("p", { class: "small muted", role: "status" });
  const board = h("div", { class: "leaderboard" }, h("div", { class: "center" }, h("div", { class: "spinner" })));
  const seq = navSeq;
  const add = async () => {
    const id = toAccountId(input.value);
    if (!id || String(id) === String(account)) { status.textContent = "Это не похоже на Friend ID друга."; return; }
    if (friends.some((f) => f.account_id === id)) { status.textContent = "Этот игрок уже в списке."; return; }
    status.textContent = "Ищу...";
    try {
      const p = await api(`/players/${id}`);
      if (stale(seq)) return;
      if (!p || !p.profile) { status.textContent = "OpenDota не знает такой аккаунт."; return; }
      const list = [...friends, { account_id: id, name: p.profile.personaname || `#${id}`, t: Date.now() }];
      safeLocal.set(friendsKey(account), JSON.stringify(list));
      haptic("medium");
      syncProfile(account);
      navRoot("profile", profileScreen);
    } catch { status.textContent = "OpenDota не отвечает. Попробуй ещё раз."; }
  };
  const remove = (id) => {
    safeLocal.set(friendsKey(account), JSON.stringify(friends.filter((f) => f.account_id !== id)));
    safeLocal.set(friendsRemovedKey(account), JSON.stringify([...localJson(friendsRemovedKey(account), []), id]));
    syncProfile(account);
    navRoot("profile", profileScreen);
  };
  (async () => {
    const people = [{ account_id: Number(account), name: "Ты", me: true }, ...friends];
    const rows = [];
    // по одному: OpenDota режет частые запросы
    for (const f of people) {
      if (!leaderCache.has(f.account_id)) leaderCache.set(f.account_id, ((await api(`/players/${f.account_id}/recentMatches`)) || []).slice(0, 20));
      const games = leaderCache.get(f.account_id).filter((m) => m.game_mode !== TURBO_MODE);
      if (!games.length) continue;
      const won = games.filter((m) => (m.player_slot < 128) === m.radiant_win).length;
      rows.push({ ...f, games: games.length, wr: won / games.length,
        kda: games.reduce((s, m) => s + (m.kills + m.assists) / Math.max(1, m.deaths), 0) / games.length,
        gpm: games.reduce((s, m) => s + (m.gold_per_min || 0), 0) / games.length });
    }
    if (stale(seq)) return;
    rows.sort((a, b) => b.wr - a.wr || b.kda - a.kda);
    board.replaceChildren(...rows.map((r, i) => h("div", { class: `leader-row${r.me ? " me" : ""}` },
      h("span", { class: "plan-num" }, String(i + 1)),
      h("div", { class: "grow" }, h("b", {}, r.name), h("span", { class: "small muted" }, `KDA ${r.kda.toFixed(1)} · GPM ${Math.round(r.gpm)} · ${r.games} ${plural(r.games, "игра", "игры", "игр")}`)),
      h("b", { class: r.wr >= 0.5 ? "win-text" : "loss-text" }, `${Math.round(r.wr * 100)}%`),
      !r.me && h("button", { class: "leader-remove", type: "button", "aria-label": `Убрать ${r.name}`, onclick: () => remove(r.account_id) }, "×"))));
    if (rows.length < 2) board.append(h("p", { class: "small muted" }, "Добавь друзей по Friend ID — посмотрим, кто из вас сейчас в форме."));
  })().catch(() => { if (!stale(seq)) board.replaceChildren(h("p", { class: "muted small" }, "OpenDota не отдала игры друзей.")); });
  return h("div", {}, h("h2", {}, "Друзья"), h("div", { class: "card" }, board,
    h("div", { class: "row friend-add" }, h("div", { class: "grow" }, input), h("button", { type: "button", onclick: add }, "Добавить")),
    status,
    h("p", { class: "small muted" }, "Рейтинг по последним 20 играм без Турбо: винрейт, потом KDA.")));
}

// ---------- сравнение двух каток ----------

const compareKey = (a) => `cmp:${(a.hist_self && a.hist_self.account) || "anon"}`;

// Катка попадает в список для сравнения, как только её открыли
function rememberForCompare(a) {
  const list = localJson(compareKey(a), []).filter((x) => x.match !== a.facts.match_id);
  list.unshift({ match: a.facts.match_id, hero: a.facts.hero, hero_id: a.facts.hero_id, won: a.facts.won, kda: a.facts.kda, t: Date.now(), payload: { ...coachPayload(a), past: [] } });
  safeLocal.set(compareKey(a), JSON.stringify(list.slice(0, COMPARE_SIZE)));
}

function compareBlock(a) {
  const others = localJson(compareKey(a), []).filter((x) => x.match !== a.facts.match_id);
  if (!others.length) return null;
  const out = h("div", { class: "compare-out", role: "status" });
  const pick = async (other, btn) => {
    const [used, spend] = dailyCounter("chat");
    if (used >= CHAT_DAILY) { out.textContent = "На сегодня вопросов тренеру хватит. Завтра снова."; return; }
    btn.disabled = true;
    out.replaceChildren(h("div", { class: "chat-msg assistant typing" }, h("i"), h("i"), h("i")));
    try {
      const data = await postCoach({ mode: "compare", a: { ...coachPayload(a), past: [] }, b: other.payload });
      spend();
      out.replaceChildren(...String(data.text || "").split("\n").filter(Boolean).map((l) => h("p", {}, l)));
    } catch (e) {
      out.replaceChildren(h("p", { class: "error" }, coachError(e)));
    } finally {
      btn.disabled = false;
    }
  };
  return h("details", { class: "card timeline-box compare" },
    h("summary", {}, "Сравнить с другой каткой"),
    h("p", { class: "small muted" }, "Тренер скажет, что ты делал по-другому. В списке катки, которые ты уже открывал."),
    h("div", { class: "compare-list" }, ...others.map((o) => {
      const btn = h("button", { class: `compare-item ${o.won ? "win" : "loss"}`, type: "button" },
        heroImg(o.hero_id, "hero-img small"), h("span", { class: "grow" }, o.hero), h("span", { class: "muted" }, o.kda));
      btn.onclick = () => { haptic(); pick(o, btn); };
      return btn;
    })),
    out);
}

function overviewTab(a) {
  const s = a.summary || {};
  const who = [s.role, s.rank && `ранг ${s.rank}`].filter(Boolean).join(" · ");
  const problems = (s.problems || []).slice(0, 3);
  const strengths = (s.strengths || []).slice(0, 2);
  return h("div", {},
    who && h("div", { class: "who" }, who, s.role_sure === false && h("span", { class: "muted" }, " · роль определена неточно")),
    goalBlock(a),
    coachBlock(a),
    COACH_URL && chatFor(a).box,
    COACH_URL && compareBlock(a),
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
    laneDuelBlock(a),
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
      COACH_URL && h("p", { class: "small muted" }, "Нажми на смерть или драку — тренер разберёт её подробно."),
      h("div", { class: "timeline" }, ...a.moments.map((m) => {
        // Смерти и пропущенные драки можно отдать тренеру на разбор
        if (!COACH_URL || (m.severity !== BAD && m.severity !== WARN)) {
          return h("div", { class: `moment ${m.severity}` }, h("time", {}, m.clock), m.text);
        }
        return h("button", {
          class: `moment ${m.severity} askable`, type: "button",
          onclick: () => { haptic(); chatFor(a).ask(`Разбери момент ${m.clock}: ${m.text}. Что я сделал не так и как надо было?`); },
        }, h("time", {}, m.clock), h("span", {}, m.text));
      }))),
  );
}

// ---------- миникарта: смерти в драках и обсы ----------

// Клетки OpenDota 64..192 -> координаты SVG 0..128 (север сверху)
const mapX = (x) => Math.max(2, Math.min(126, x - 64));
const mapY = (y) => Math.max(2, Math.min(126, 192 - y));

function minimap(points, { label }) {
  const lane = (d) => svg("path", { d, class: "mm-lane" });
  return svg("svg", { class: "minimap", viewBox: "0 0 128 128", role: "img", "aria-label": label },
    svg("defs", {}, svg("radialGradient", { id: "mm-bg", cx: "50%", cy: "50%", r: "70%" },
      svg("stop", { offset: "0%", "stop-color": "#1b1514" }), svg("stop", { offset: "100%", "stop-color": "#0a0807" }))),
    svg("rect", { x: 0, y: 0, width: 128, height: 128, rx: 10, fill: "url(#mm-bg)" }),
    // река идёт с северо-запада на юго-восток через центр
    svg("path", { d: "M4 10 C 40 40, 52 58, 64 64 S 92 92, 124 118", class: "mm-river" }),
    lane("M14 116 L14 14 L114 14"), lane("M14 116 L114 116 L114 14"), lane("M16 112 L112 16"),
    svg("rect", { x: 4, y: 104, width: 20, height: 20, rx: 4, class: "mm-base radiant" }),
    svg("rect", { x: 104, y: 4, width: 20, height: 20, rx: 4, class: "mm-base dire" }),
    ...points);
}

// ---------- реплей: позиции героев (GitHub Actions разбирает, файл лежит в ветке replays) ----------

const REPLAY_RAW = "https://raw.githubusercontent.com/BEZzZ22/KORPl/replays/r";
const replayCache = new Map();

// Файл позиций, если реплей уже разобран; нет файла или сети — null, разбор идёт без него
async function fetchReplay(matchId) {
  if (replayCache.has(matchId)) return replayCache.get(matchId);
  let data = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${REPLAY_RAW}/${matchId}.json`, { signal: ctrl.signal });
    clearTimeout(timer);
    data = res.ok ? await res.json() : null;
  } catch { data = null; }
  if (data) replayCache.set(matchId, data);
  return data;
}

function replayBlock(a) {
  const r = a.replay;
  if (!r) {
    const status = h("p", { class: "small muted", role: "status" }, "Тренер увидит, где ты стоял и кто был рядом в каждой смерти. Реплей разбирается 10–30 минут.");
    const btn = h("button", { type: "button", class: "replay-btn" }, "Разобрать реплей по позициям");
    btn.onclick = async () => {
      btn.disabled = true;
      haptic("medium");
      try {
        const data = await postCoach({ mode: "replay", match_id: a.facts.match_id, initData: (tg && tg.initData) || "" });
        status.textContent = data.status === "done"
          ? "Реплей уже разобран: открой матч заново."
          : tg && tg.initData ? "В очереди. Бот напишет, когда будет готово." : "В очереди. Загляни сюда через полчаса.";
      } catch (e) {
        btn.disabled = false;
        status.textContent = coachError(e);
      }
    };
    return h("div", {}, h("h2", {}, "Позиции по реплею"), h("div", { class: "card replay-card" }, btn, status));
  }
  const dots = r.heat.map((p) => svg("circle", { cx: mapX(p[0]).toFixed(1), cy: mapY(p[1]).toFixed(1), r: 1.6, class: "mm-heat" }));
  const deaths = r.deaths.map((d) => svg("g", {},
    d.path.length > 1 && svg("polyline", { class: "mm-path", points: d.path.map((p) => `${mapX(p[0]).toFixed(1)},${mapY(p[1]).toFixed(1)}`).join(" ") }),
    svg("g", { class: "mm-death", transform: `translate(${mapX(d.x).toFixed(1)} ${mapY(d.y).toFixed(1)})` },
      svg("title", {}, `смерть ${mmss(d.t)}`), svg("path", { d: "M-2.6 -2.6 L2.6 2.6 M-2.6 2.6 L2.6 -2.6" }))));
  const zoneRow = (label, z) => z && h("div", { class: "zone-row" }, h("span", {}, label),
    h("div", { class: "zone-bar" },
      h("i", { class: "own", "data-pct": Math.round(z.own * 100) }), h("i", { class: "river", "data-pct": Math.round(z.river * 100) }), h("i", { class: "enemy", "data-pct": Math.round(z.enemy * 100) })),
    h("b", {}, `${Math.round(z.enemy * 100)}%`));
  const alone = r.deaths.filter((d) => d.allies_near === 0).length;
  return h("div", {},
    h("h2", {}, "Где ты был"),
    h("div", { class: "card map-card" },
      minimap(dots, { label: "Тепловая карта твоих позиций" }),
      h("div", { class: "zones" }, zoneRow("Линия", r.zones.lane), zoneRow("Мидгейм", r.zones.mid), zoneRow("Лейт", r.zones.late)),
      h("div", { class: "legend" }, h("span", {}, h("i", { class: "lg-zone own" }), "своя половина"), h("span", {}, h("i", { class: "lg-zone river" }), "река"),
        h("span", {}, h("i", { class: "lg-zone enemy" }), "чужая (её доля справа)"))),
    r.deaths.length > 0 && h("h2", {}, "Перед каждой смертью"),
    r.deaths.length > 0 && h("div", { class: "card map-card" },
      minimap(deaths, { label: `Пути за 20 секунд до смертей: ${r.deaths.length}` }),
      h("p", { class: "small muted" }, `Линия — где ты шёл последние 20 секунд. Один, без своих в радиусе 1 500: ${alone} из ${r.deaths.length}.`),
      ...r.deaths.map((d) => h("div", { class: `death-row ${d.allies_near ? "" : "alone"}` },
        h("time", {}, mmss(d.t)),
        h("span", { class: "grow" }, d.allies_near ? `рядом своих ${d.allies_near}` : `один${d.nearest_ally ? `, до ближайшего своего ${num(d.nearest_ally)}` : ""}`),
        h("b", {}, `врагов ${d.enemies_near}`)))));
}

function mapTab(a) {
  const m = a.map || { deaths: [], wards: [] };
  const deathDots = m.deaths.map((d) => svg("g", { class: "mm-death", transform: `translate(${mapX(d.x).toFixed(1)} ${mapY(d.y).toFixed(1)})` },
    svg("title", {}, `смерть ${mmss(d.t)}`),
    svg("path", { d: "M-2.6 -2.6 L2.6 2.6 M-2.6 2.6 L2.6 -2.6" })));
  const wardDots = m.wards.map((w) => svg("circle", {
    cx: mapX(w.x).toFixed(1), cy: mapY(w.y).toFixed(1), r: w.mine ? 2.6 : 2,
    class: `mm-ward${w.mine ? " mine" : ""}${w.dewarded ? " dewarded" : ""}`,
  }, svg("title", {}, `обс ${mmss(w.t)}${w.mine ? ", твой" : ""}${w.dewarded ? ", снесли" : ""}`)));
  const side = m.radiant ? "Твоя база слева внизу (Свет)." : "Твоя база справа вверху (Тьма).";
  const far = m.deaths.filter((d) => d.enemy_half).length;
  const mine = m.wards.filter((w) => w.mine);
  const dewarded = m.wards.filter((w) => w.dewarded).length;
  const deep = m.wards.filter((w) => w.enemy_half).length;
  return h("div", {},
    replayBlock(a),
    h("h2", {}, "Где умирал в драках"),
    h("div", { class: "card map-card" },
      m.deaths.length ? minimap(deathDots, { label: `Смерти в драках на карте: ${m.deaths.length}` }) : h("p", { class: "muted" }, "В больших драках ты не умирал."),
      m.deaths.length > 0 && h("p", { class: "small muted" },
        `${m.deaths.length} ${plural(m.deaths.length, "смерть", "смерти", "смертей")} в драках, из них на вражеской половине: ${far}. ${side} Смерти вне больших драк OpenDota без координат не отдаёт.`)),
    h("h2", {}, "Обсы команды"),
    h("div", { class: "card map-card" },
      m.wards.length ? minimap(wardDots, { label: `Обсы команды на карте: ${m.wards.length}` }) : h("p", { class: "muted" }, "Обсов за игру не было."),
      m.wards.length > 0 && h("div", { class: "legend" },
        h("span", {}, h("i", { class: "lg-ward mine" }), `твои: ${mine.length}`),
        h("span", {}, h("i", { class: "lg-ward" }), `команды: ${m.wards.length - mine.length}`),
        h("span", {}, h("i", { class: "lg-ward dewarded" }), `снесли раньше времени: ${dewarded}`)),
      m.wards.length > 0 && h("p", { class: "small muted" }, `На вражеской половине: ${deep} из ${m.wards.length}. ${side}`)),
  );
}

// ---------- линия минута в минуту ----------

function laneDuelBlock(a) {
  const l = a.lane;
  if (!l || !l.rows.length) return null;
  const diff = (pair, fmt = num) => {
    const [me, opp] = pair;
    if (me == null || opp == null) return h("td", { class: "muted" }, "—");
    const d = me - opp;
    return h("td", {}, h("b", {}, fmt(me)), h("span", { class: `delta ${d > 0 ? "win-text" : d < 0 ? "loss-text" : "muted"}` }, d === 0 ? "=" : (d > 0 ? "+" : "−") + fmt(Math.abs(d))));
  };
  return h("div", {},
    h("h2", {}, `Линия против ${l.opponent}`),
    h("div", { class: "card lane-duel" },
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "мин"), h("th", {}, "крипы"), h("th", {}, "нетворс"), h("th", {}, "опыт"))),
        h("tbody", {}, ...l.rows.map((r) => h("tr", {}, h("th", {}, String(r.m)), diff(r.lh, String), diff(r.nw), diff(r.xp))))),
      h("p", { class: "small muted" }, "Твоё значение и разница с оппонентом. Зелёное — ты впереди.")));
}

// ---------- тайминги предметов против всех игр на герое ----------

const timingCache = new Map();
function itemTimingBlock(a) {
  const core = (a.items || []).filter((it) => it.time > 0);
  if (!core.length) return null;
  const box = h("div", {}, h("h2", {}, "Тайминги предметов"), h("div", { class: "card small muted" }, "Сравниваю с играми на герое..."));
  const seq = navSeq;
  (async () => {
    if (!timingCache.has(a.facts.hero_id)) timingCache.set(a.facts.hero_id, await api(`/scenarios/itemTimings?hero_id=${a.facts.hero_id}`));
    if (stale(seq)) return;
    const rows = itemTimings(core, timingCache.get(a.facts.hero_id)).slice(0, 5);
    if (!rows.length) { box.remove(); return; }
    box.replaceChildren(h("h2", {}, "Тайминги предметов"), h("div", { class: "card" },
      ...rows.map((r) => h("div", { class: "timing-row" },
        img(dictionary.itemImage(r.key), null, ""),
        h("div", { class: "grow" },
          h("div", {}, r.item),
          h("div", { class: "small muted" }, `обычно к ${mmss(r.usual)}` +
            (r.wr_by != null && r.wr_after != null ? ` · до этого побеждают в ${r.wr_by}%, позже в ${r.wr_after}%` : ""))),
        h("b", { class: r.verdict === "late" ? "loss-text" : r.verdict === "early" ? "win-text" : "" }, mmss(r.time)))),
      h("p", { class: "small muted" }, "Твоё время справа. Статистика OpenDota по публичным играм на этом герое.")));
  })().catch(() => { if (!stale(seq)) box.remove(); });
  return box;
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
  return h("div", {}, planBlock, itemTimingBlock(a), pro, yours);
}

function chartsTab(a) {
  const t = a.timeline;
  const series = [{ values: t.player, color: "#e8c27a", label: t.hero, glow: true }];
  if (t.opponent) series.push({ values: t.opponent, color: "#9d8cff", label: t.opponent_name });
  return h("div", {},
    h("p", { class: "small muted" }, "Веди пальцем по графику, чтобы увидеть значения на каждой минуте."),
    h("h2", {}, "Нетворс против оппонента"),
    h("div", { class: "card" }, lineChart(series, { markers: t.deaths, unit: "k" }), legend(series, t.deaths.length > 0)),
    t.team_gold_adv.length > 0 && h("h2", {}, "Преимущество команды"),
    t.team_gold_adv.length > 0 && h("div", { class: "card" }, areaChart(t.team_gold_adv)),
    h("h2", {}, "Добито крипов"),
    h("div", { class: "card" }, lineChart([{ values: t.last_hits, color: "#e8c27a" }], {})),
  );
}

function legend(series, deaths) {
  return h("div", { class: "legend" },
    ...series.map((s) => h("span", {}, h("i", { "data-color": s.color }), s.label)),
    deaths && h("span", {}, h("i", { "data-color": "#f2555a" }), "твои смерти"),
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
  const guide = svg("line", { y1: T, y2: H - B, stroke: "#e8c27a", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  const dots = series.map((s) => svg("circle", { r: 4, fill: s.color, stroke: "#08090c", "stroke-width": 2, opacity: 0 }));
  const box = svg("rect", { rx: 8, fill: "rgba(13,15,20,0.94)", stroke: "rgba(232,194,122,0.4)", opacity: 0 });
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
    const cx = x(Math.min(t / 60, base.length - 1)), cy = y(base[i]);
    chart.append(
      svg("line", { x1: cx - 3.5, y1: cy - 3.5, x2: cx + 3.5, y2: cy + 3.5, stroke: "#f2555a", "stroke-width": 2 }),
      svg("line", { x1: cx - 3.5, y1: cy + 3.5, x2: cx + 3.5, y2: cy - 3.5, stroke: "#f2555a", "stroke-width": 2 }),
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
    svg("path", { d: area(values.map((v) => Math.max(v, 0))), fill: "#4fd1a5", "fill-opacity": 0.45 }),
    svg("path", { d: area(values.map((v) => Math.min(v, 0))), fill: "#f2555a", "fill-opacity": 0.55 }),
    svg("line", { x1: x(0), x2: x(last), y1: y(0), y2: y(0), stroke: "#5d6270", "stroke-width": 1 }),
  );
  return makeInteractive(frame, [{ values, color: "#e8c27a", label: "команда" }], { valueFmt: (v) => (v > 0 ? "+" : "") + num(v) });
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

// Один раз за запуск: повтор boot после ошибки сети не должен второй раз собирать панель и вешать «Назад»
let booted = false;

async function boot() {
  if (!booted && tg) {
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
  if (!booted) {
    // фон «ночная карта»: свет баз в углах и река
    document.body.prepend(h("div", { class: "backdrop", "aria-hidden": "true" }, h("i", { class: "radiant" }), h("i", { class: "dire" }), h("i", { class: "river" })));
    buildTabbar();
    // Офлайн-кэш: открытые разборы и справочники работают без сети
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  booted = true;
  loading("Разжигаю огонь...");
  try {
    const [heroes, items, abilities, ids, kb, tx] = await Promise.all([
      api("/constants/heroes"), api("/constants/items"), api("/constants/abilities", { timeout: 40000 }),
      api("/constants/item_ids"),
      fetch("knowledge.json?v=12").then((r) => r.json()), fetch("texts.json?v=15").then((r) => r.json()),
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
  // история и задачи с других устройств: в фоне, экран не ждёт
  storage.get("account_id").then((acc) => acc && syncProfile(acc)).catch(() => {});
  if (matchId) {
    navStack.push([homeScreen, []]);
    go(matchScreen, matchId, slot, account);
  } else {
    go(homeScreen);
  }
}

boot();
