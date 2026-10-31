// Telegram Mini App: разбор матча Dota 2 внутри Телеграма.
import {
  analyze, createDictionary, isParsed, mmss, num, plural, proItemCounts, itemTimings, draftAdvice, checkGoal, achievements, formatMetric, formatRankMetric, itemPlan, skillPlan,
  CATEGORIES, BAD, WARN, GOOD, ZONE_NAMES,
} from "./engine.js?v=42";
import { aegisBadge, openShowcase } from "./aegis.js?v=9";
import { mapX, mapY, minimap, replayModel, liveMap } from "./dotamap.js?v=5";
import { matchVerdicts } from "./blame.js?v=8";
import { rankMedal3d } from "./medal3d.js?v=7";
import { heroCard3d } from "./herocard3d.js?v=5";
import { tacticalTable } from "./map3d.js?v=10";

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
// Запасной путь: OpenDota не ответила или режет — тот же запрос через воркер (он повторяет и кэширует)
const API_PROXY = "https://dotacoach.2007rggg.workers.dev/od";
const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com";
const STEAM_MIRROR = "https://cdn.akamai.steamstatic.com";
const STEAM64_OFFSET = 76561197960265728n;
const PARSE_POLL_MS = 15000;
const PARSE_POLL_MAX = 20;
const V2 = document.documentElement.classList.contains("v2");
const BG_COLOR = V2 ? "#09090b" : "#08090c";
const DAMAGE_TYPES = { Physical: "физический", Magical: "магический", Pure: "чистый" };
const PHASE_LABEL = { good: "в плюс", even: "ровно", bad: "в минус" };
const TURBO_MODE = 23;

const tg = window.Telegram && window.Telegram.WebApp;
const app = document.getElementById("app");
let dictionary = null, knowledge = null, texts = null, itemIds = null, norms = {}, guides = null, builds = null;
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
  return h("img", { src: STEAM_CDN + path, class: cls, alt, loading: "lazy", onerror: imgFallback });
}
// Картинка не пришла с одного CDN Steam (бывает у отдельных файлов и провайдеров) — берём с зеркала,
// не пришла и оттуда — пустая плашка вместо значка битой картинки
function imgFallback(e) {
  const el = e.currentTarget;
  if (el.src.startsWith(STEAM_CDN)) el.src = STEAM_MIRROR + el.src.slice(STEAM_CDN.length);
  else el.classList.add("img-missing");
}

// Вертикальный портрет, как в сетке героев в Доте. У новых героев (Muerta, Marci…) его нет — тогда обычная картинка, обрезанная по центру
function portrait(x) {
  return h("img", { src: `${STEAM_CDN}/apps/dota2/images/heroes/${x.key}_vert.jpg`, class: "hero-vert", alt: x.name, loading: "lazy",
    onerror: (e) => {
      const el = e.currentTarget;
      if (!el.classList.contains("wide")) { el.classList.add("wide"); el.src = STEAM_CDN + x.img; } else imgFallback(e);
    } });
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

// Знак приложения: Аегис чемпионов с 3D-модели (docs/aegis.js). Тап — витрина с живой моделью
function aegis() {
  return aegisBadge({ reduced: reducedMotion(), haptic: aegisHaptic, tick: hapticTick, onOpen: () => openShowcase({ haptic: aegisHaptic, openLink }) });
}
const aegisHaptic = (type) => {
  try {
    if (!tg || !tg.isVersionAtLeast("6.1")) return;
    if (type === "success") tg.HapticFeedback.notificationOccurred("success");
    else tg.HapticFeedback.impactOccurred(type);
  } catch { /* старый клиент */ }
};
const openLink = (url) => (tg && tg.openLink ? tg.openLink(url) : window.open(url, "_blank"));
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
  let active = -1, hover = -1, dragging = false, pressed = false, raf = 0, last = 0, timer = 0, width = 0;
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

// Списки OpenDota (катки, герои, тайминги): вместо массива иногда приходит {error: …} с кодом 200 или чужой ответ
// запасного пути — тогда .slice/.filter роняли экран. Не тот вид ответа считаем ошибкой: человек видит «Повторить»
const LIST_PATH = /\/(?:recentMatches|matchups)$|\/players\/\d+\/(?:matches|heroes)(?:\?|$)|^\/scenarios\//;
function shaped(path, data) {
  if (data != null && LIST_PATH.test(path) && !Array.isArray(data)) throw new Error("OpenDota ответила не списком");
  return data;
}

async function api(path, { method = "GET", timeout = 20000, retry = method === "GET" } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await fetch(API + path, { method, signal: ctrl.signal });
    status = res.status;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OpenDota ответила ${res.status}`);
    return shaped(path, await res.json());
  } catch (e) {
    // под нагрузкой OpenDota быстро отвечает 429/502/503: один повтор через пару секунд обычно проходит.
    // Таймаут не повторяем — человек и так ждал
    const busy = status === 429 || status === 502 || status === 503 || status === 504;
    if (!retry || !busy || Date.now() - t0 > timeout / 2) {
      if (method !== "GET" || !retry) throw e;
      return viaProxy(path, e);
    }
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
    return api(path, { method, timeout, retry: false }).catch((e2) => viaProxy(path, e2));
  } finally {
    clearTimeout(timer);
  }
}

async function viaProxy(path, original) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(API_PROXY + path, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw original;
    return shaped(path, await res.json());
  } catch {
    throw original;
  } finally {
    clearTimeout(timer);
  }
}

// Справочники OpenDota — это сборка dotaconstants. Если OpenDota лежит или режет запросы,
// берём те же файлы с GitHub, чтобы приложение хотя бы запускалось
const CONSTANTS_MIRROR = "https://raw.githubusercontent.com/odota/dotaconstants/master/build";
async function constants(name, timeout = 20000) {
  try {
    const data = await api(`/constants/${name}`, { timeout: timeout / 2, retry: false });
    if (data && typeof data === "object") return data;
  } catch {}
  const ctrl = new AbortController();
  // заблокированный GitHub часто не отказывает, а висит: долго его не ждём, дальше есть воркер
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeout, 8000));
  try {
    const res = await fetch(`${CONSTANTS_MIRROR}/${name}.json`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Справочник ${name}: ${res.status}`);
    return await res.json();
  } catch (e) {
    // у части провайдеров недоступны и OpenDota, и GitHub: третий путь — через наш воркер
    const data = await viaProxy(`/constants/${name}`, e);
    if (data && typeof data === "object") return data;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Скиллы и предметы: свои урезанные справочники (tools/fetch-constants.mjs, раз в неделю): 110 КБ сжатого вместо 370 КБ
// у OpenDota. Нет файла или он битый — полный у OpenDota
// Свой файл с таймаутом: fetch без него на плохой сети висит минутами, и человек видит вечную загрузку
async function fetchJson(url, timeout = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Свои тексты и база знаний: без них приложение не стартует, а мобильная сеть рвёт отдельный запрос.
// Один повтор через секунду вместо экрана ошибки
const ownJson = (url) => fetchJson(url).catch(() => new Promise((r) => setTimeout(r, 1000)).then(() => fetchJson(url)));

async function localDict(name, min) {
  try {
    const res = await fetch(`${name}.json`, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    const data = res.ok ? await res.json() : null;
    if (data && Object.keys(data).length > min) return data;
  } catch {}
  return constants(name, name === "abilities" ? 40000 : 20000);
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

// Friend ID, Steam ID, ссылки на профиль Steam (/profiles/7656...), Dotabuff, OpenDota, Stratz (/players/123)
function toAccountId(raw) {
  const text = String(raw).trim();
  // старые форматы Steam ID из консоли и сайтов статистики: STEAM_0:1:12345 и [U:1:24691]
  const legacy = /^STEAM_[0-5]:([01]):(\d{1,10})$/i.exec(text);
  if (legacy) { const id = Number(legacy[2]) * 2 + Number(legacy[1]); return id > 0 && id < 2 ** 32 ? id : null; }
  const u3 = /^\[?U:1:(\d{1,10})\]?$/i.exec(text);
  if (u3) { const id = Number(u3[1]); return id > 0 && id < 2 ** 32 ? id : null; }
  const link = /(?:profiles|players)\/(\d{1,20})(?!\d)/.exec(text);
  // Friend ID иногда копируют с пробелами или дефисами («123 456 789»)
  const digits = link ? link[1] : /^[\d\s-]+$/.test(text) ? text.replace(/[\s-]/g, "") : text;
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
// Облако Телеграма на части клиентов иногда не зовёт колбэк: без запасного пути главная вечно крутила загрузку.
// Поэтому копия лежит и в localStorage, а облако ждём не дольше CLOUD_WAIT
const CLOUD_WAIT = 3000;
const localGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const storage = {
  get(key) {
    if (memStore.has(key)) return Promise.resolve(memStore.get(key));
    return new Promise((resolve) => {
      if (cloud()) {
        const timer = setTimeout(() => resolve(localGet(key)), CLOUD_WAIT);
        try {
          // пусто в облаке, а в браузере есть: запись в облако когда-то не дошла (колбэк не пришёл за CLOUD_WAIT).
          // Без запасного пути человек заново привязывал аккаунт при каждом запуске
          tg.CloudStorage.getItem(key, (err, value) => { clearTimeout(timer); resolve(err ? localGet(key) : value || localGet(key) || null); });
        } catch { clearTimeout(timer); resolve(localGet(key)); }
        return;
      }
      resolve(localGet(key));
    });
  },
  set(key, value) {
    memStore.set(key, value || null);
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
    return new Promise((resolve) => {
      if (cloud()) {
        const timer = setTimeout(resolve, CLOUD_WAIT);
        try { tg.CloudStorage.setItem(key, value, () => { clearTimeout(timer); resolve(); }); } catch { clearTimeout(timer); resolve(); }
        return;
      }
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
  if (SCREEN_EVENTS[screen.name]) step(SCREEN_EVENTS[screen.name]);
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
  // справочники не загрузились (экран ошибки): вкладка — это ещё одна попытка, а не экран без данных
  if (!dictionary) { if (document.querySelector("#app .error")) boot(); return; }
  if (tab === "home") navRoot("home", homeScreen);
  else if (tab === "profile") navRoot("profile", profileScreen);
  else if (tab === "match") lastAnalysis ? navRoot("match", analysisScreen, lastAnalysis) : navRoot("match", matchEmpty);
}

let tabLens = null;

function buildTabbar() {
  tabbar = h("nav", { class: "tabbar", "aria-label": "Разделы" },
    tabButton("home", "Главная"), tabButton("match", "Разбор"), tabButton("profile", "Профиль"));
  document.body.append(tabbar);
  tabLens = glassBar(tabbar, ".tabbtn", { live: false, onPick: (i) => { haptic(); goTab(NAV_TABS[i]); } });
}

function updateTabbar() {
  if (!tabbar) return;
  for (const btn of tabbar.querySelectorAll(".tabbtn")) {
    const t = btn.dataset.tab;
    btn.classList.toggle("active", t === section);
    // для экранного диктора: какой раздел открыт
    if (t === section) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
    if (t === "match") btn.classList.toggle("disabled", !lastAnalysis);
  }
  if (tabLens) tabLens.place(Math.max(0, NAV_TABS.indexOf(section)), tabLens.current() < 0);
}

// ---------- экраны ----------

function loading(text) {
  render(h("div", { class: "center" }, h("div", { class: "spinner" }), h("div", { class: "muted" }, text)));
}

function errorScreen(message, retry) {
  step(ERROR_STEPS.find(([t]) => message.startsWith(t))?.[1] || "err_other");
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
    // без lookbehind: Safari до iOS 16.4 падает на нём при разборе всего app.js, и приложение не открывается
    const m = /(?:^|\D)(\d{7,11})(?!\d)/.exec(matchInput.value);
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
    render(...nodes, accountForm(), demoEntry());
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
    const early = takeRecent(account);
    const matches = ((early && await early) || await api(`/players/${account}/recentMatches`)) || [];
    step(matches.length ? "home_list" : "home_empty");
    if (!matches.length) {
      list.replaceChildren(hiddenMatchesCard(account));
      api(`/players/${account}/refresh`, { method: "POST" }).catch(() => {});
      return;
    }
    const fresh = freshMatchCard(matches[0], account);
    list.replaceChildren(...[fresh, ...matches.slice(fresh ? 1 : 0, 15).map((m) => matchListItem(m, account))].filter(Boolean));
  } catch {
    step("err_opendota");
    // раньше тут был тупик: только текст, и человек закрывал приложение
    list.replaceChildren(h("div", { class: "center" },
      h("p", { class: "error" }, "OpenDota не отвечает. Обычно это на минуту."),
      h("button", { type: "button", onclick: () => navRoot("home", homeScreen) }, "Попробовать ещё раз")));
  }
}

// Ранний запрос последних каток (на старте, пока грузятся справочники). Не падает: при ошибке главная спросит сама
let recentEarly = null, matchEarly = null;
function prefetchRecent(account) {
  recentEarly = { account: String(account), t: Date.now(), p: api(`/players/${account}/recentMatches`).catch(() => undefined) };
}
function takeRecent(account) {
  const e = recentEarly;
  recentEarly = null;
  return e && e.account === String(account) && Date.now() - e.t < 60000 ? e.p : null;
}

// Кнопка примера: человек видит разбор за секунду, ещё не найдя свой Friend ID
function demoEntry() {
  return h("button", { class: "draft-entry demo-entry", type: "button", onclick: () => { haptic(); step("demo"); go(matchScreen, DEMO_MATCH, null, DEMO_ACCOUNT, 0, true); } },
    h("span", { class: "de-icon", "aria-hidden": "true" }, svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M8 5.5v13l10.5-6.5z" }))),
    h("div", { class: "grow" }, h("b", {}, "Посмотреть пример"), h("span", {}, "Разбор настоящей катки: кто слил, повтор на карте, тренер")));
}

// Матчей не видно: почти всегда в Доте закрыты публичные данные матчей. Новые от этого уходили сразу (25.10),
// поэтому — шаги по пунктам и кнопка проверить снова, а не абзац текста
function hiddenMatchesCard(account) {
  const status = h("p", { class: "small muted", role: "status" });
  const btn = h("button", { type: "button" }, "Проверить снова");
  btn.onclick = async () => {
    btn.disabled = true;
    step("empty_retry");
    haptic("light");
    status.textContent = "Проверяю…";
    try {
      await api(`/players/${account}/refresh`, { method: "POST" }).catch(() => {});
      const matches = (await api(`/players/${account}/recentMatches`)) || [];
      if (matches.length) { step("empty_found"); haptic("medium"); navRoot("home", homeScreen); return; }
      status.textContent = "Пока пусто. Открытые данные видны только с новых каток: сыграй одну обычную (не с ботами) и проверь снова.";
    } catch {
      status.textContent = "OpenDota не отвечает. Попробуй через минуту.";
    }
    btn.disabled = false;
  };
  return h("div", { class: "card hidden-matches" },
    h("div", { class: "display" }, "Матчи скрыты в настройках Доты"),
    h("p", { class: "small" }, "Аккаунт нашёлся, но Дота не отдаёт твои игры. Это одна галочка:"),
    h("ol", { class: "steps" },
      h("li", {}, "Открой Доту и нажми шестерёнку (настройки) в левом верхнем углу."),
      h("li", {}, "Перейди на вкладку «Социальное» (в старом меню: «Расширенные настройки» → «Социальное»)."),
      h("li", {}, "Включи пункт про публичные данные матчей — Expose Public Match Data."),
      h("li", {}, "Сыграй одну обычную катку: старые игры так и останутся скрытыми."),
      h("li", {}, "Вернись сюда и нажми «Проверить снова». Катка появляется через 5–15 минут после конца."),
    ),
    btn,
    status,
  );
}

function accountForm() {
  const input = h("input", { inputmode: "numeric", placeholder: "Friend ID или ссылка на профиль", "aria-label": "Friend ID" });
  const status = h("div", { class: "small muted" }, "Friend ID есть в Доте в профиле под ником. Подойдёт и ссылка на Steam, Dotabuff, OpenDota или Stratz.");
  const bind = async (id, seq = null) => {
    await storage.set("account_id", String(id));
    step("link");
    if (seq !== null && stale(seq)) return;
    haptic("medium");
    if (section === "profile") navRoot("profile", profileScreen);
    else navRoot("home", homeScreen);
  };
  const save = async () => {
    let id = toAccountId(input.value);
    // ссылка с ником (steamcommunity.com/id/ник): Steam отдаёт по ней steamID64, спрашиваем через воркер
    const vanity = !id && /steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})/.exec(input.value);
    if (vanity && COACH_URL) {
      status.textContent = "Ищу профиль в Steam…";
      const seq0 = navSeq;
      try {
        const { steam64 } = await postCoach({ mode: "vanity", name: vanity[1] }, 12000);
        if (stale(seq0)) return;
        id = toAccountId(steam64);
        if (id) track("link_vanity_ok");
      } catch (e) {
        if (stale(seq0)) return;
        if (e && e.status === 404) { track("link_vanity_none"); status.textContent = e.message; return; }
      }
    }
    if (!id) {
      step("link_bad");
      // что за ввод (без самого текста): по этому видно, какую подсказку дописать
      const v = input.value.trim();
      const kind = !v ? "empty" : /steamcommunity\.com\/id\//.test(v) ? "vanity" : /https?:|\.com|\.ru|\//.test(v) ? "url" : /^\d+$/.test(v) ? "num" : "text";
      track(`link_bad_${kind}`);
      status.textContent = kind === "vanity"
        ? "Это ссылка с ником: по ней аккаунт не найти. Нужен Friend ID из профиля в Доте или ссылка вида steamcommunity.com/profiles/7656…"
        : kind === "text" ? "Ник не подойдёт: нужен Friend ID — только цифры, например 123456789. Он в Доте в профиле, под ником."
          : "Это не похоже на Friend ID. Это только цифры, например 123456789: в Доте открой профиль, номер под ником.";
      return;
    }
    status.textContent = "Проверяю…";
    const seq = navSeq;
    try {
      const player = await api(`/players/${id}`);
      if (stale(seq)) return;
      if (!player || !player.profile) {
        // Аккаунт со скрытыми данными матчей OpenDota не видит ни в одной игре, поэтому «не знает» его.
        // Раньше здесь был тупик; теперь можно привязать как есть и получить шаги, как открыть матчи
        step("link_unknown");
        status.replaceChildren(
          "OpenDota пока не знает этот аккаунт. Проверь цифры: Friend ID в Доте в профиле, под ником. Если ID верный, скорее всего, в Доте скрыты данные матчей — привяжи, и я покажу, как их открыть.",
          h("button", { type: "button", class: "ghost", onclick: () => { step("link_anyway"); bind(id); } }, "Это мой ID, привязать"));
        return;
      }
      await bind(id, seq);
    } catch {
      step("err_opendota");
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
  loading("Открываю профиль…");
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
    V2 && h("div", { class: "rank3d-wrap" }, rankMedal3d(player.rank_tier, { reduced: reducedMotion(), haptic, tick: hapticTick }),
      h("div", { class: "small muted" }, "Крути пальцем, тап — глитч")),
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
      total > 0 && h("div", { class: "small muted" }, `За ${plural(total, "последнюю", "последние", "последние")} ${total} ${plural(total, "игру", "игры", "игр")}`),
    ),
    recent.length > 0 && h("h2", {}, "Форма — последние игры"),
    recent.length > 0 && h("div", { class: "card" },
      h("div", { class: "form-strip" }, ...dots),
      h("div", { class: "small muted" }, `${((w) => `${w} ${plural(w, "победа", "победы", "побед")}`)(recent.filter((m) => (m.player_slot < 128) === m.radiant_win).length)} из ${recent.length} · слева последняя`),
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
  loading(`Считаю игры на ${name}…`);
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
      h("div", { class: "small muted" }, `GPM: ${a} → ${b}. Побед: ${wa} из ${half} → ${wb} из ${last.length - half}. Точка — игра: зелёная — победа, красная — поражение.`)));
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
const HERO_ATTRS = [["str", "Сила"], ["agi", "Ловкость"], ["int", "Интеллект"], ["all", "Универсальные"]];

async function draftScreen() {
  section = "home";
  const seq = navSeq;
  const account = await storage.get("account_id");
  await extrasReady;
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
    goBtn.disabled = !enemies.length;
  };
  // Как в Доте: по главному атрибуту, внутри по алфавиту
  const drawGrid = () => {
    const q = search.value.trim().toLowerCase();
    const list = all.filter((x) => !enemies.includes(x.id) && (!q || x.name.toLowerCase().includes(q)));
    const tile = (x) => h("button", { type: "button", class: "draft-hero", "aria-label": x.name, title: x.name, disabled: enemies.length >= 5,
      onclick: () => { if (enemies.length < 5) { enemies.push(x.id); hapticTick(); search.value = ""; drawChosen(); drawGrid(); } } },
    portrait(x));
    const groups = HERO_ATTRS.map(([attr, label]) => [label, attr, list.filter((x) => x.attr === attr)])
      .concat([["Другие", "", list.filter((x) => !HERO_ATTRS.some(([a]) => a === x.attr))]]);
    grid.replaceChildren(...groups.filter(([, , xs]) => xs.length).map(([label, attr, xs]) =>
      h("section", { class: `attr-block ${attr}` }, h("div", { class: "draft-attr" }, h("i", { "aria-hidden": "true" }), label),
        h("div", { class: "attr-tiles" }, ...xs.map(tile)))));
    if (!list.length) grid.append(h("p", { class: "muted small" }, "Нет такого героя. Имя пиши по-английски, как в игре."));
  };
  search.addEventListener("input", drawGrid);
  goBtn.onclick = async () => {
    goBtn.disabled = true;
    haptic("medium");
    result.replaceChildren(h("div", { class: "center" }, h("div", { class: "spinner" }),
      h("div", { class: "muted small" }, account ? "Смотрю твоих героев против этих врагов…" : "Ищу контрпики…")));
    try {
      const [counter, mine, last] = await Promise.all([counterpicks(),
        account ? api(`/players/${account}/heroes`) : [], account ? api(`/players/${account}/recentMatches`) : []]);
      const recent = {};
      for (const m of (last || []).slice(0, 20)) recent[m.hero_id] = (recent[m.hero_id] || 0) + 1;
      const pool = (mine || []).filter((x) => x.games >= 3);
      // цифры матчапов OpenDota только по самым игранным: запросы идут по одному
      const top = pool.slice().sort((a, b) => (recent[b.hero_id] || 0) - (recent[a.hero_id] || 0) || b.games - a.games).slice(0, DRAFT_POOL);
      const matchups = {};
      // по 4 разом: по одному 12 запросов шли до 10 секунд, все сразу OpenDota режет
      for (let i = 0; i < top.length; i += 4) {
        const part = top.slice(i, i + 4);
        (await Promise.all(part.map((x) => heroMatchups(x.hero_id)))).forEach((rows, j) => { matchups[part[j].hero_id] = rows; });
      }
      if (stale(seq)) return;
      const advice = draftAdvice({ enemies: [...enemies], pool, recent, matchups, counter, knowledge, od: dictionary, role });
      result.replaceChildren(draftResult(advice, Boolean(account), { enemies: [...enemies], role }));
    } catch {
      result.replaceChildren(h("p", { class: "error" }, "Не загрузилось. Проверь интернет и попробуй ещё раз."));
    } finally {
      goBtn.disabled = !enemies.length;
    }
  };
  drawChosen();
  drawGrid();
  render(
    h("div", { class: "page-head" }, h("h1", {}, "Драфт перед игрой")),
    h("p", { class: "muted" }, "Выбери врагов, которых видишь на пике, хватит и одного. Подскажу, кого взять и почему, а потом что собирать."),
    h("div", { class: "card" },
      h("div", { class: "seg-row" }, roleBtn("core", "Я кор"), roleBtn("support", "Я саппорт")),
      chosen, goBtn),
    result,
    h("h2", {}, "Враги"),
    search, grid,
  );
}

// Контрпики dota2.ru: грузим один раз и только для драфта
let counterCache = null;
function counterpicks() {
  if (!counterCache) counterCache = fetch("counterpick.json?v=1").then((r) => r.json()).catch((e) => { counterCache = null; throw e; });
  return counterCache;
}

// Объяснение из статьи dota2.ru коротко: без вводной вроде «Вариант для мидеров.», до ~150 знаков по целым предложениям
const WHY_MAX = 140;
function shortWhy(text) {
  // пункт списка из статьи «Lion (Mana Drain);» — оставляем только способность
  const skill = /^[^()]+\(([^)]+?)\)?[;.]?$/.exec(String(text).trim());
  if (skill && text.length < 60) return `всё решает ${skill[1]}.`;
  const parts = String(text).replace(/([.!?])\s+/g, "$1\u0001").split("\u0001").filter(Boolean);
  if (parts.length > 1 && parts[0].length < 40) parts.shift();
  let out = parts[0] || "";
  for (const s of parts.slice(1)) {
    if (out.length + s.length + 1 > WHY_MAX) break;
    out += ` ${s}`;
  }
  return out.length > WHY_MAX + 20 ?`${out.slice(0, WHY_MAX).replace(/[\s,;:—-]+\S*$/, "")}…` : out;
}

// Позиция по умолчанию для героя в драфте: самая частая у про в выбранной группе (кор или саппорт)
function draftPos(heroId, role) {
  const byPos = (builds && builds.heroes && builds.heroes[heroId]) || {};
  const range = role === "support" ? [4, 5] : [1, 2, 3];
  return range.filter((p) => byPos[p]).sort((a, b) => byPos[b].g - byPos[a].g)[0] || range[0];
}

// Сборка героя под выбранных врагов с переключателем позиции
function draftPlanPanel(heroId, enemies, role) {
  let pos = draftPos(heroId, role);
  const byPos = (builds && builds.heroes && builds.heroes[heroId]) || {};
  const box = h("div", { class: "draft-plan" });
  const draw = () => {
    const plan = itemPlan({ builds, guides, od: dictionary, knowledge, heroId, pos, enemies });
    box.replaceChildren(
      h("div", { class: "pos-row", role: "tablist", "aria-label": "Позиция" }, ...[1, 2, 3, 4, 5].map((p) => h("button", {
        type: "button", class: `pos-chip ${byPos[p] ? "" : "rare"}`, "aria-pressed": String(p === pos),
        title: byPos[p] ? `${games(byPos[p].g)} про` : "у про почти не бывает",
        onclick: () => { if (p !== pos) { pos = p; hapticTick(); draw(); } },
      }, `поз. ${p}`, h("small", {}, byPos[p] ? games(byPos[p].g) : "редко")))),
      plan ? itemPlanCard(plan) : h("p", { class: "muted small" }, "По этому герою пока нет сборок."),
      skillCard(skillPlan(builds, heroId, pos)));
  };
  draw();
  return box;
}

// Кнопка под героем: раскрывает его сборку под этот пик
function planToggle(heroId, ctx) {
  const slot = h("div", { class: "draft-slot" });
  const btn = h("button", { type: "button", class: "ghost draft-build-btn", "aria-expanded": "false" }, "Сборка под этот пик");
  btn.onclick = () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "Скрыть сборку" : "Сборка под этот пик";
    slot.replaceChildren(open ? draftPlanPanel(heroId, ctx.enemies, ctx.role) : "");
    haptic("light");
  };
  return [btn, slot];
}

// Свой герой: поиск по имени и сборка под этих врагов
function ownHeroPlan(ctx) {
  const out = h("div", {});
  const list = h("div", { class: "own-heroes" });
  const input = h("input", { type: "search", placeholder: "Свой герой: имя, как в игре", "aria-label": "Свой герой" });
  const taken = new Set(ctx.enemies);
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const found = q ? dictionary.heroList().filter((x) => !taken.has(x.id) && x.name.toLowerCase().includes(q)).slice(0, 6) : [];
    list.replaceChildren(...found.map((x) => h("button", { type: "button", class: "draft-pick", onclick: () => {
      hapticTick();
      input.value = x.name;
      list.replaceChildren();
      out.replaceChildren(h("h3", { class: "own-hero-name" }, x.name), draftPlanPanel(x.id, ctx.enemies, ctx.role));
    } }, heroImg(x.id), h("span", {}, x.name))));
  });
  return h("div", { class: "card" }, input, list, out);
}

// Один пик: почему он (по статьям dota2.ru), кто его контрит и цифры
function draftPick(p, i, mine, ctx = null) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const stats = [
    mine && `${games(p.games)} на нём`,
    mine && p.recent > 0 && `${p.recent} из последних 20`,
    !mine && p.games > 0 && `ты играл: ${games(p.games)}`,
    p.matchup_wr != null && `против этих врагов ${pct(p.matchup_wr)} побед`,
  ].filter(Boolean);
  return h("div", { class: "draft-row" },
    h("div", { class: "plan-num" }, String(i + 1)), heroImg(p.hero_id),
    h("div", { class: "grow" },
      h("div", { class: "hn" }, p.name),
      ...p.why.slice(0, 2).map((r) => h("p", { class: "draft-why small" }, h("b", {}, `Против ${r.name}: `), shortWhy(r.why))),
      !p.why.length && h("p", { class: "draft-why small" }, "По статистике OpenDota выигрывает у этих врагов чаще, чем проигрывает."),
      p.threats.length > 0 && h("p", { class: "draft-why small loss-text" },
        `Осторожно: ${p.threats.map((t) => t.name).join(", ")} ${p.threats.length > 1 ? "контрят" : "контрит"} его.`),
      stats.length > 0 && h("div", { class: "small muted" }, stats.join(", ")),
      ...(ctx && builds ? planToggle(p.hero_id, ctx) : [])));
}

function draftResult(advice, linked, ctx = null) {
  return h("div", {},
    linked && h("h2", {}, "Из твоих героев"),
    linked && (advice.picks.length
      ? h("div", { class: "card" }, ...advice.picks.map((p, i) => draftPick(p, i, true, ctx)))
      : h("p", { class: "muted" }, "Из твоих частых героев никто не подходит против этих врагов. Глянь контрпики ниже.")),
    !linked && h("p", { class: "muted" }, "Привяжи аккаунт на «Главной», и я сначала предложу героев, на которых ты играешь."),
    advice.counters.length > 0 && h("h2", {}, "Контрпики"),
    advice.counters.length > 0 && h("div", { class: "card" }, ...advice.counters.map((p, i) => draftPick(p, i, false, ctx)),
      h("p", { class: "small muted" }, "Почему именно они — по статьям о контрпиках с dota2.ru.")),
    // сборки под позицию и пик по про-матчам; без них — общие предметы против механик врагов
    ctx && builds && h("h2", {}, "Сборка на своего героя"),
    ctx && builds && ownHeroPlan(ctx),
    !(ctx && builds) && advice.items.length > 0 && h("h2", {}, "Что собирать"),
    !(ctx && builds) && advice.items.length > 0 && h("div", { class: "card" }, ...advice.items.map((it) => h("div", { class: "why-row" },
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
        h("div", { class: "small muted" }, `${m.kills}/${m.deaths}/${m.assists} · ${Math.floor(m.duration / 60)} мин${m.game_mode === TURBO_MODE ? " · турбо" : ""} · ${date}`),
      ),
    ),
  );
}

// Сколько разбор ждёт необязательные данные после того, как пришёл сам матч
const OPTIONAL_WAIT = 2500;
const upTo = (promise, ms, fallback) => Promise.race([promise.catch(() => fallback), new Promise((done) => setTimeout(() => done(fallback), ms))]);

// Пример разбора до привязки аккаунта: настоящая катка с разобранным реплеем, смотрим за Tusk
const DEMO_MATCH = 9052987576, DEMO_ACCOUNT = 163061132;

async function matchScreen(matchId, slot, accountId, attempt = 0, demo = false) {
  if (attempt === 0) loading("Призываю матч…");
  const seq = navSeq;
  // файл позиций качается вместе с матчем, а не после него
  const replayP = fetchReplay(matchId);
  let match;
  try {
    // ссылка на разбор: матч уже качается со старта (boot), второй раз не просим
    const pre = matchEarly && matchEarly.id === matchId && attempt === 0 ? matchEarly.p : null;
    matchEarly = null;
    match = (pre && await pre) || await api(`/matches/${matchId}`);
    if (stale(seq)) return;
  } catch {
    if (stale(seq)) return;
    // ждём разбор реплея: один сбой OpenDota не повод бросать ожидание, просто опрашиваем дальше
    if (attempt > 0 && attempt < PARSE_POLL_MAX) {
      pollTimer = setTimeout(() => matchScreen(matchId, slot, accountId, attempt + 1, demo), PARSE_POLL_MS);
      return;
    }
    errorScreen("OpenDota не отвечает.", () => go(matchScreen, matchId, slot, accountId, 0, demo));
    return;
  }
  if (!match || !match.players) {
    errorScreen("Такого матча нет. Проверь ID.", () => navRoot("home", homeScreen));
    return;
  }
  if (!isParsed(match)) {
    if (attempt === 0) step("match_parsing");
    if (attempt === 0) {
      api(`/request/${matchId}`, { method: "POST" }).catch(() => {});
      watchParse(matchId);
    }
    if (attempt >= PARSE_POLL_MAX) {
      errorScreen("Реплей так и не разобрался. Попробуй позже.", () => go(matchScreen, matchId, slot, accountId, 0, demo));
      return;
    }
    render(h("div", { class: "center" },
      h("div", { class: "spinner" }),
      h("p", { class: "display" }, "Реплей разбирается"),
      h("p", { class: "small muted" }, "Обычно 1–5 минут. Страница обновится сама."),
      watchOk.has(matchId) && h("p", { class: "small muted" }, "Можешь закрыть приложение: бот напишет в Телеграм, когда разбор будет готов."),
      watchNo.has(matchId) && h("p", { class: "small muted" }, "Сообщения от бота ты не разрешил, поэтому он не напишет. Оставь приложение открытым или загляни сюда через пару минут."),
    ));
    pollTimer = setTimeout(() => matchScreen(matchId, slot, accountId, attempt + 1, demo), PARSE_POLL_MS);
    return;
  }

  let player = null;
  if (!player && accountId) player = match.players.find((p) => p.account_id === accountId);
  if (!player) {
    const saved = Number(await storage.get("account_id"));
    if (stale(seq)) return;
    if (saved) player = match.players.find((p) => p.account_id === saved);
  }
  if (!player) { step("not_yours"); notYourMatch(); return; }

  // Сравнение с про, нормы героя, матчапы и позиции — дополнения: медленная OpenDota или GitHub не держат разбор.
  // Опоздавший файл позиций всё равно попадёт на «Карту» (берётся из replayCache)
  const [pro, bench, matchups, replay] = await Promise.all([
    upTo(proItems(player.hero_id), OPTIONAL_WAIT, {}), upTo(heroBench(player.hero_id), OPTIONAL_WAIT, {}),
    upTo(heroMatchups(player.hero_id), OPTIONAL_WAIT, []), upTo(replayP, OPTIONAL_WAIT, null), extrasReady]);
  if (stale(seq)) return;
  let a;
  try {
    a = analyze(match, player, dictionary, knowledge, texts, pro, bench, norms, matchups, replay, { guides, builds });
  } catch (e) {
    // иначе на необычном матче вечно крутится «Призываю матч…»
    console.error(e);
    errorScreen("Не смог разобрать этот матч: у OpenDota в нём необычные данные.", () => navRoot("home", homeScreen));
    return;
  }
  // для блока «Обычно у тебя»: сырые цифры этой игры и чей аккаунт
  rawOf.set(a, { match, replay });
  a.demo = demo;
  a.hist_self = { account: player.account_id, duration: match.duration, kills: player.kills, deaths: player.deaths,
    assists: player.assists, gold_per_min: player.gold_per_min, xp_per_min: player.xp_per_min, last_hits: player.last_hits };
  analysisScreen(a);
}

// Сырые данные разбора для карты и «Кто слил»: в сам разбор не кладём, он уходит в память и тренеру
const rawOf = new WeakMap();

// Подписка на уведомление: воркер проверит подпись Телеграма и напишет в личку, когда реплей разберётся
// «бот напишет» обещаем только после ответа воркера, что подписка записана
const watched = new Set(), watchOk = new Set(), watchNo = new Set();
function watchParse(matchId) {
  if (!COACH_URL || !tg || !tg.initData || watched.has(matchId)) return;
  watched.add(matchId);
  canMessage().then((can) => {
    if (!can) { watchNo.add(matchId); return; }
    postCoach({ mode: "watch", match_id: matchId, initData: tg.initData })
      .then(() => watchOk.add(matchId), () => watched.delete(matchId));
  });
}

// Бот пишет в личку, только если человек ему это разрешил. Кто открыл приложение по ссылке (?startapp из «Поделиться»)
// и ни разу не жал «Старт» у бота, не получил бы ни «разбор готов», ни «карта готова»: Телеграм молча не пропустит.
// Спрашиваем один раз за запуск, в момент, когда сообщение понадобилось
let writeAsk = null;
function canMessage() {
  const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (!u || u.allows_write_to_pm) return Promise.resolve(true);
  // старый клиент: спросить нечем, оставляем как было
  if (!(tg.requestWriteAccess && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9"))) return Promise.resolve(true);
  if (!writeAsk) {
    writeAsk = new Promise((done) => {
      // клиент может так и не ответить: тогда через минуту подписываемся, как раньше
      const late = setTimeout(() => done(true), 60000);
      try {
        tg.requestWriteAccess((ok) => { clearTimeout(late); step(ok ? "write_ok" : "write_no"); done(Boolean(ok)); });
      } catch { clearTimeout(late); done(true); }
    });
  }
  return writeAsk;
}

// Разбираем только свои игры: либо аккаунт не привязан, либо тебя нет в матче
async function notYourMatch() {
  const seq = navSeq;
  const saved = Number(await storage.get("account_id"));
  if (stale(seq)) return;
  render(
    h("h1", {}, saved ? "Это не твоя игра" : "Привяжи аккаунт"),
    h("p", { class: "muted" }, saved
      ? "Тебя нет в этом матче, а чужие игры я не разбираю. Если игра твоя, в ней мог быть скрыт профиль: включи в Доте Настройки (шестерёнка) → «Социальное» (в старом меню: «Расширенные настройки» → «Социальное») → «Expose Public Match Data» (публичные данные матчей)."
      : "Я разбираю только твои игры. Укажи Friend ID или Steam ID."),
    saved ? h("button", { onclick: () => navRoot("home", homeScreen) }, "На главную") : accountForm(),
  );
}

// ---------- экран разбора ----------

const TABS = [
  ["Обзор", overviewTab],
  ["Кто слил", blameTab],
  ["Фазы", phasesTab],
  ["Смерти", killersTab],
  ["Карта", mapTab],
  ["Сборка", buildTab],
  ["Графики", chartsTab],
];

function analysisScreen(a) {
  step("analysis");
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
  // пример — чужая катка: в задачи, сравнение и облако её не пишем
  if (COACH_URL && !a.demo) rememberForCompare(a);
  if (a._goalResult === undefined && !a.demo) { a._goalResult = trackProgress(a); if (a.hist_self) syncSoon(a.hist_self.account); }
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
    tracking = e.touches.length === 1 && !e.target.closest(".chart, .frame, .live-map, .m3d, input, textarea, .chat-chips, .chat-list, .chat-row")&& !scrollsX(e.target);
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
    a.demo && h("div", { class: "demo-banner" },
      h("div", { class: "grow" }, h("b", {}, "Это пример разбора"), h("span", {}, "Настоящая катка на Tusk. Привяжи аккаунт — разберу твои.")),
      h("button", { type: "button", onclick: () => { haptic(); navRoot("home", homeScreen); } }, "Привязать")),
    h("div", { class: "card hero-head" },
      ((banner) => (V2 ? heroCard3d(banner, heroCardBack(a), { reduced: reducedMotion(), haptic }) : banner))(h("div", { class: "hero-banner" },
        img(dictionary.heroImage(f.hero_id), null, f.hero),
        h("div", { class: "hero-title" },
          h("h1", {}, f.hero),
          h("div", { class: "small muted" },
            h("span", { class: `badge ${f.won ? "win" : "loss"}` }, f.won ? "Победа" : "Поражение"),
            ` позиция ${f.position} · ${f.duration}`),
        ),
        h("div", { class: "hero-ring" }, medal(a.overall)),
      )),
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
// Оборот карты героя в шапке разбора (дизайн «Новый»): итог катки одним взглядом
function heroCardBack(a) {
  const f = a.facts;
  const cell = (value, label) => h("div", { class: "hcb-cell" }, h("b", {}, String(value)), h("span", {}, label));
  return h("div", {},
    h("div", { class: "hcb-top" },
      h("div", { class: "grow" }, h("div", { class: "hcb-name" }, f.hero), h("div", { class: "hcb-sub" }, `${f.won ? "Победа" : "Поражение"} · позиция ${f.position} · ${f.duration}`)),
      h("div", { class: "hcb-score" }, h("b", {}, a.overall.toFixed(1)), h("span", {}, "из 10"))),
    h("div", { class: "hcb-grid" }, cell(f.kda, "KDA"), cell(f.gpm, "GPM"), cell(f.xpm, "XPM"), cell(`${f.last_hits}/${f.denies}`, "LH/DN")),
    h("div", { class: "hcb-hint" }, "Тап — перевернуть обратно"));
}

function shareLink(a, custom = null) {
  const f = a.facts;
  const link = `https://t.me/${BOT_USERNAME}?startapp`;
  const text = custom ? custom.text : `${f.hero} · ${f.won ? "Победа" : "Поражение"} · оценка ${a.overall.toFixed(1)}/10\n${a.verdict}`;
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
// Шрифты карточек-картинок: интерфейсу они не нужны, поэтому не держат первый экран, а качаются при первой карточке
let cardFontsP = null;
function cardFonts() {
  if (!cardFontsP) cardFontsP = new Promise((resolve) => {
    const link = h("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Manrope:wght@600;800&family=Unbounded:wght@700&display=swap" });
    link.onload = link.onerror = () => resolve();
    setTimeout(resolve, 4000);
    document.head.append(link);
  });
  return cardFontsP;
}

async function renderCard(a) {
  const f = a.facts;
  const W = 1080, H = 1920, P = 96;
  const C = { ink: "#08090c", text: "#eceae4", muted: "#8a8f9c", aegis: "#e8c27a", radiant: "#4fd1a5", dire: "#f2555a" };
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  try { await cardFonts(); await Promise.all(["700 120px Unbounded", "800 48px Manrope", "600 40px Manrope"].map((s) => document.fonts.load(s))); } catch { /* системный шрифт */ }
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
function shareMatch(a, custom = null) {
  haptic("medium");
  step(custom ? "share_blame" : "share");
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
    status.textContent = "Готовлю картинку…";
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
      tg.shareToStory(await upload(), { text: custom ? custom.text : `${a.facts.hero}: ${a.overall.toFixed(1)}/10. Разбор в @${BOT_USERNAME}` });
    }, true),
    act(canSave ? "Сохранить картинку" : "Открыть картинку", async () => {
      const url = await upload();
      if (canSave) tg.downloadFile({ url, file_name: `razbor-${a.facts.match_id}.${url.endsWith(".png") ? "png" : "jpg"}` });
      else if (tg && tg.openLink) tg.openLink(url);
      else window.open(url, "_blank");
    }, !canStory),
    act("Ссылка в чат", async () => shareLink(a, custom)));
  const sheet = h("div", { class: "sheet-backdrop", onclick: (e) => { if (e.target === sheet) close(); } },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": custom ? `Поделиться: ${custom.label}` : "Поделиться разбором" },
      h("div", { class: "sheet-grip", "aria-hidden": "true" }),
      preview, actions, status,
      h("button", { type: "button", class: "sheet-close ghost", onclick: close }, "Закрыть")));
  document.body.append(sheet);
  document.addEventListener("keydown", onKey);
  (custom ? custom.render() : renderCard(a)).then((url) => {
    dataUrl = url;
    preview.replaceChildren(h("img", { src: url, alt: "Карточка разбора" }));
  }).catch(() => { preview.replaceChildren(h("p", { class: "muted" }, "Картинка не нарисовалась. Можно отправить ссылку.")); });
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
}

// ---------- тренер на Opus (через воркер из worker/coach.js) ----------

const COACH_URL = "https://dotacoach.2007rggg.workers.dev"; // адрес воркера с тренером
const OWNER_ACCOUNT = 801280038; // владелец приложения: тренер для него бесплатный
const isOwner = async () => Number(await storage.get("account_id")) === OWNER_ACCOUNT;
const CHAT_PER_MATCH = 15; // вопросов тренеру по одной катке (сервер считает то же)
const chatLeftText = (n) => n > 0 ? `По этой катке ${plural(n, "остался", "осталось", "осталось")} ${n} ${plural(n, "вопрос", "вопроса", "вопросов")}.` : "Вопросы по этой катке закончились.";
const COACH_TIMEOUT = 75000;
const OPUS_WAIT = 110000;      // заход Opus в фоне: посредник думает 30–70 с, иногда дольше
const OPUS_RETRY = 30 * 60000; // не чаще раза в полчаса пробуем заменить быстрый разбор разбором Opus
const MEMORY_SIZE = 10; // прошлых разборов в памяти тренера
const COMPARE_SIZE = 8; // каток, с которыми можно сравнить

// localStorage у WebView ~5 МБ: кэши матчей по героям (hs:, hm:) за месяцы его забивают, и тогда молча
// перестают сохраняться разборы тренера и чат. Переполнилось — выкидываем эти кэши (их можно скачать заново) и пишем ещё раз
function pruneCaches() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(hs|hm):/.test(k || "")) drop.push(k); }
    drop.forEach((k) => localStorage.removeItem(k));
    return drop.length > 0;
  } catch { return false; }
}
const safeLocal = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {
      // приватный режим или переполнение
      if (pruneCaches()) try { localStorage.setItem(key, value); } catch { /* всё равно не влезло */ }
    }
  },
};
const localJson = (key, fallback) => { try { return JSON.parse(safeLocal.get(key) || "null") ?? fallback; } catch { return fallback; } };


// Запрос к воркеру. Ошибка с текстом воркера помечена fromCoach, остальные переводятся на русский
async function postCoach(body, timeout = COACH_TIMEOUT) {
  const ctrl = new AbortController();
  // воркер в худшем случае ждёт Opus и запасные модели около минуты: дольше ждать нет смысла
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(COACH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Тренер сейчас недоступен."), { fromCoach: true, status: res.status, wallet: data.wallet });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- платный тренер: звёзды Телеграма (воркер, worker/pay.js) ----------

let walletState = null; // последний ответ воркера: пробные, пакеты, подписка
async function getWallet(refresh = false) {
  if (!tg || !tg.initData || !COACH_URL) return null;
  if (walletState && !refresh) return walletState;
  try {
    const w = await postCoach({ mode: "wallet", initData: tg.initData }, 10000);
    walletState = w && !w.off ? w : null;
  } catch { /* нет связи — покажем, когда тренер ответит */ }
  return walletState;
}
const dateRu = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join(".");
// Строка под кнопкой тренера: что осталось
function walletLine(w) {
  if (!w) return "";
  if (w.owner) return "Для тебя тренер бесплатный.";
  if (w.until) return `Подписка до ${dateRu(w.until)}, сегодня ${plural(w.sub_left, "остался", "осталось", "осталось")} ${w.sub_left} ${plural(w.sub_left, "разбор", "разбора", "разборов")}.`;
  if (w.free_left) return `${plural(w.free_left, "Бесплатный", "Бесплатных", "Бесплатных")}: ${w.free_left} ${plural(w.free_left, "разбор", "разбора", "разборов")}, потом по пакету или подписке.`;
  if (w.credits) return `На счету ${w.credits} ${plural(w.credits, "разбор", "разбора", "разборов")} тренера.`;
  return "Бесплатные разборы закончились: тренер по пакету или подписке.";
}

// Покупка: счёт от воркера, оплата в окне Телеграма. onPaid — когда звёзды дошли и кошелёк обновился
function paywallBlock(onPaid, text = "Бесплатные разборы тренера закончились.") {
  const status = h("p", { class: "small muted", role: "status" });
  const packs = (walletState && walletState.packs) || [];
  const buy = async (pack, btn) => {
    // старый клиент: openInvoice в скрипте Телеграма есть, но бросает WebAppMethodUnsupported — выходило «нет связи»
    if (!tg || !tg.openInvoice || !(tg.isVersionAtLeast && tg.isVersionAtLeast("6.1"))) { status.textContent = "Оплата работает в приложении Телеграма. Обнови Телеграм."; return; }
    btn.disabled = true;
    status.textContent = "Открываю оплату…";
    step("buy");
    try {
      const { link } = await postCoach({ mode: "buy", pack: pack.id, initData: tg.initData }, 15000);
      tg.openInvoice(link, async (result) => {
        btn.disabled = false;
        if (result === "cancelled") { status.textContent = ""; return; }
        if (result === "failed") { status.textContent = "Оплата не прошла. Звёзды не списаны."; return; }
        // paid или pending: зачисление приходит вебхуком через пару секунд
        status.textContent = "Оплата прошла, открываю тренера…";
        track("paid");
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const w = await getWallet(true);
          if (w && (w.credits || w.until || w.owner)) { haptic("heavy"); onPaid(w); return; }
        }
        status.textContent = "Звёзды списаны, но зачисление задерживается. Открой катку ещё раз через минуту, а если не поможет — напиши боту /paysupport.";
      });
      status.textContent = "";
    } catch (e) {
      btn.disabled = false;
      status.textContent = coachError(e);
    }
  };
  const packBtn = (p) => {
    const btn = h("button", { class: `paywall-pack${p.days ? " best" : ""}`, type: "button" },
      h("b", {}, p.days ? "Месяц тренера" : `${p.credits} ${plural(p.credits, "разбор", "разбора", "разборов")}`),
      h("span", { class: "paywall-sub" }, p.days ? "до 10 разборов в сутки" : "не сгорают"),
      h("span", { class: "paywall-price" }, `${p.stars} ⭐`));
    btn.onclick = () => { haptic(); buy(p, btn); };
    return btn;
  };
  const packBox = h("div", { class: "paywall-packs" }, ...packs.map(packBtn));
  // кошелёк не успел прийти (сеть моргнула) — без пакетов купить было нечего: дотягиваем
  if (!packs.length) getWallet(true).then((w) => { if (w && w.packs && !packBox.children.length) packBox.append(...w.packs.map(packBtn)); });
  // картой или СБП: страница оплаты на сайте во внешнем браузере, вход уже выполнен (ссылка с токеном на сутки)
  const card = walletState && walletState.cards && h("button", { class: "paywall-card", type: "button" }, "Картой или СБП (₽)");
  if (card) card.onclick = async () => {
    haptic();
    step("buy_card");
    card.disabled = true;
    try {
      const { url } = await postCoach({ mode: "pay_link", initData: tg.initData }, 15000);
      if (tg.openLink) tg.openLink(url); else window.open(url, "_blank", "noopener");
      status.textContent = "Оплата открылась в браузере. После оплаты вернись сюда и нажми «Разобрать с тренером».";
    } catch (e) {
      status.textContent = coachError(e);
    } finally {
      card.disabled = false;
    }
  };
  return h("div", { class: "paywall" },
    h("p", { class: "paywall-title" }, text),
    h("p", { class: "small muted" }, "Разбор катки, карта и «Кто слил» остаются бесплатными. Платный только ИИ-тренер: разбор моментов, задачи, чат и сравнение каток."),
    packBox,
    card,
    status,
    h("p", { class: "small muted" }, "Вопросы по оплате — боту, команда /paysupport."));
}
// 402 от воркера: кошелёк в ответе, показываем покупку
function isPaywall(e) {
  if (e && e.status === 402) { if (e.wallet) walletState = { ...walletState, ...e.wallet }; track("paywall"); step("paywall"); return true; }
  return false;
}

// ---------- счётчики для владельца: что делают в приложении (воркер копит по дням и шлёт отчёт) ----------

// Экраны через go(); разбор открывается из matchScreen напрямую, поэтому отмечается в analysisScreen
const SCREEN_EVENTS = { homeScreen: "home", matchScreen: "match", profileScreen: "profile", heroStatsScreen: "hero_stats", draftScreen: "draft" };
const ERROR_STEPS = [["OpenDota не отвечает", "err_opendota"], ["Такого матча нет", "err_no_match"], ["Реплей так и не", "err_replay"],
  ["Не смог разобрать", "err_parse"], ["Не удалось загрузить", "err_boot"]];
const stats = { open: true, events: {}, secs: 0, since: Date.now(), dirty: true, start: Date.now(), path: [], jsError: "" };

function track(name) {
  stats.events[name] = (stats.events[name] || 0) + 1;
  stats.dirty = true;
}

// Шаг пути за этот запуск: «экран:секунда от открытия». По пути в отчёте видно, после чего человек ушёл
function step(name) {
  track(name);
  const last = stats.path[stats.path.length - 1];
  if (last && last.split(":")[0] === name) return;
  if (stats.path.length < 30) stats.path.push(`${name}:${Math.round((Date.now() - stats.start) / 1000)}`);
}

// Ошибки в коде: счётчик плюс текст последней, чтобы найти по нему место
// «Script error.» без файла — ошибка в чужом скрипте (telegram-web-app.js, Sketchfab или код самого Телеграма):
// браузер прячет подробности, и приложению она не мешает. Считаем отдельно, в «ошибку в коде» не пишем
addEventListener("error", (e) => {
  const msg = String((e && e.message) || "error");
  const file = String((e && e.filename) || "");
  if (/^Script error\.?$/.test(msg) || (file && !file.startsWith(location.origin))) { track("err_ext"); return; }
  stats.jsError = `${msg} @ ${file.split("/").pop().split("?")[0] || "?"}:${(e && e.lineno) || 0}`.slice(0, 120);
  track("err_js");
});
addEventListener("unhandledrejection", (e) => { stats.jsError = String((e && e.reason && e.reason.message) || e.reason || "rejection").slice(0, 120); track("err_js"); });

// Пачкой: через несколько секунд после запуска, когда приложение сворачивают, и раз в 2 минуты.
// sendBeacon доходит и при закрытии, text/plain — без лишнего предзапроса CORS
function flushStats() {
  if (!COACH_URL || !tg || !tg.initData) return;
  if (stats.since) { stats.secs += (Date.now() - stats.since) / 1000; stats.since = document.hidden ? 0 : Date.now(); }
  if (!stats.dirty && stats.secs < 30) return;
  const start = (tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
  const body = JSON.stringify({ mode: "track", initData: tg.initData, open: stats.open, secs: Math.round(stats.secs), events: stats.events, src: start,
    path: stats.path.join(","), jserr: stats.jsError, ua: tg.platform || "" });
  const sent = navigator.sendBeacon && navigator.sendBeacon(COACH_URL, new Blob([body], { type: "text/plain" }));
  if (!sent) fetch(COACH_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body, keepalive: true }).catch(() => {});
  stats.open = false; stats.events = {}; stats.secs = 0; stats.dirty = false;
}

function startStats() {
  setTimeout(flushStats, 5000);
  setInterval(flushStats, 120000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushStats();
    else stats.since = Date.now();
  });
  addEventListener("pagehide", flushStats);
}

function coachError(e) {
  // текст ошибки показываем только от воркера: у fetch он английский («Failed to fetch»)
  if (e && e.fromCoach && e.message.length < 200) return e.message; // «Лимит: N в сутки…» длиннее 80 — раньше показывалось «нет связи»
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

// Мелочи для тренера: две свои, главное по сборке и прокачке, остальное — снова свои (воркер берёт четыре)
function coachMicro(a) {
  const own = a.findings.filter((x) => x.kind === "micro" && x.severity !== GOOD).map((x) => ({ text: x.text, tip: x.tip }));
  const build = ((a.item_plan && a.item_plan.verdict) || []).slice(0, 1).map((t) => ({ text: `Сборка: ${t}` }));
  const skill = ((a.skill_plan && a.skill_plan.notes) || []).slice(0, 1).map((t) => ({ text: `Прокачка: ${t}` }));
  const first = own.slice(0, 4 - build.length - skill.length);
  return [...first.slice(0, 2), ...build, ...skill, ...first.slice(2)].slice(0, 4);
}

function coachPayload(a) {
  const s = a.summary || {}, f = a.facts;
  return {
    match_id: f.match_id, hero: f.hero, role: s.role || "", rank: s.rank || "", won: f.won, kda: f.kda, duration: f.duration,
    problems: (s.problems || []).slice(0, 3).map((p) => ({ title: p.title, fact: p.fact, action: p.action })),
    strengths: (s.strengths || []).slice(0, 2).map((x) => ({ title: x.title, fact: x.fact })),
    micro: coachMicro(a),
    plan: a.build_plan ? a.build_plan.missing.slice(0, 3).map((i) => ({ item: i.item, why: i.why })) : [],
    draft: a.draft ? a.draft.notes.slice(0, 2).map((n) => n.text) : [],
    episodes: (a.episodes || []).slice(0, 4).map((e) => ({ clock: e.clock, kind: e.kind, facts: e.facts })),
    map: (a.replay_notes || []).slice(0, 5),
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
  // после «Главное:» модель часто пишет с маленькой буквы; моменты бывают не по порядку — ставим по времени
  const lead = main.join(" ");
  const sec = (m) => { const t = /^(\d{1,2}):(\d{2})/.exec(m); return t ? Number(t[1]) * 60 + Number(t[2]) : Infinity; };
  return { main: lead.charAt(0).toUpperCase() + lead.slice(1), moments: moments.sort((x, y) => sec(x) - sec(y)), steps };
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
  // Разбор в два захода: быстрый тренер (Groq/Gemini, 5–20 с) сразу на экран, Opus (30–60 с у посредника)
  // дописывает в фоне и тихо заменяет. Какой ответ лежит в кэше — в `${key}:by`
  const status = h("p", { class: "coach-upgrade small muted", role: "status" });
  const upgrade = async () => {
    safeLocal.set(`${key}:up`, String(Date.now()));
    status.textContent = "Opus дописывает подробный разбор — заменю, когда будет готов…";
    if (!status.isConnected) box.insertBefore(status, title.nextSibling);
    try {
      const data = await postCoach({ ...coachPayload(a), tier: "opus", cont: true, initData: (tg && tg.initData) || "" }, OPUS_WAIT);
      if (!data.text || !data.opus) throw new Error("не Opus");
      safeLocal.set(key, data.text);
      safeLocal.set(`${key}:by`, "opus");
      if (box.isConnected) { show(data.text, true); status.textContent = "Разбор обновлён: это версия Opus."; box.insertBefore(status, title.nextSibling); }
    } catch {
      status.remove();
    }
  };
  const cached = safeLocal.get(key);
  if (cached) {
    show(cached, false);
    // старый быстрый разбор: раз в полчаса пробуем получить версию Opus
    if (safeLocal.get(`${key}:by`) === "fast" && Date.now() - Number(safeLocal.get(`${key}:up`) || 0) > OPUS_RETRY) upgrade();
    return box;
  }

  const ask = h("button", { class: "coach-btn", type: "button" }, "Разобрать с тренером");
  const ABOUT = "Тренер разберёт ключевые моменты катки и даст три задачи на следующую. Потом можно задать ему вопросы.";
  const note = h("p", { class: "coach-note small muted", role: "status" }, ABOUT);
  let wall = null;
  getWallet().then((w) => { if (w && note.isConnected && !wall) note.textContent = `${ABOUT} ${walletLine(w)}`; });
  ask.onclick = async () => {
    if (wall) { wall.remove(); wall = null; }
    ask.disabled = true;
    step("coach");
    ask.textContent = "Тренер смотрит катку…";
    box.classList.add("coach-thinking");
    haptic("medium");
    try {
      let data;
      // быстрые модели иногда заняты: одна повторная попытка через пару секунд, потом ждём Opus
      for (let attempt = 0; !data; attempt++) {
        try {
          data = await postCoach({ ...coachPayload(a), tier: "fast", initData: (tg && tg.initData) || "" });
          if (!data.text) throw new Error("пусто");
        } catch (e) {
          data = null;
          // лимит, оплата или битый запрос: Opus тут не поможет, говорим причину сразу
          if (e && (e.status === 429 || e.status === 400 || e.status === 413 || e.status === 402 || e.status === 403)) throw e;
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 2000)); continue; }
          ask.textContent = "Быстрые модели заняты, жду Opus…";
          note.textContent = "Opus отвечает от 30 секунд до двух минут. Можно свернуть приложение, разбор сохранится.";
          data = await postCoach({ ...coachPayload(a), tier: "opus", initData: (tg && tg.initData) || "" }, OPUS_WAIT);
        }
      }
      if (!data.text) throw Object.assign(new Error("Тренер сейчас недоступен."), { fromCoach: true });
      if (data.wallet) walletState = { ...walletState, ...data.wallet };
      safeLocal.set(key, data.text);
      safeLocal.set(`${key}:by`, data.opus ? "opus" : "fast");
      show(data.text, true);
      if (!data.opus) upgrade();
    } catch (e) {
      ask.disabled = false;
      if (isPaywall(e)) {
        ask.textContent = "Разобрать с тренером";
        note.textContent = "";
        wall = paywallBlock(() => { if (wall) wall.remove(); wall = null; note.textContent = walletLine(walletState); ask.click(); });
        box.append(wall);
        return;
      }
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
  let busy = false, wall = null;
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
    if (wall) { wall.remove(); wall = null; }
    busy = true;
    send.disabled = true;
    note.textContent = "";
    const before = history.slice(-10);
    history = [...history, { role: "user", text: q }];
    input.value = "";
    grow();
    draw(true);
    haptic("light");
    step("chat");
    try {
      // сервер всё равно режет реплики до 700 знаков и разбор до 1600: длинная переписка не должна упираться в 413
      const data = await postCoach({ mode: "chat", summary: coachPayload(a), coach: (safeLocal.get(coachKey(a)) || "").slice(0, 2000),
        history: before.map((m) => ({ role: m.role, text: String(m.text || "").slice(0, 900) })), question: q, initData: (tg && tg.initData) || "" });
      if (!data.text) throw Object.assign(new Error("Тренер сейчас недоступен."), { fromCoach: true });
      if (data.wallet) walletState = { ...walletState, ...data.wallet };
      note.textContent = Number.isInteger(data.left) && data.left < 5 ? chatLeftText(data.left) : "";
      history = [...history, { role: "assistant", text: data.text }].slice(-CHAT_KEEP);
      safeLocal.set(chatKey(a), JSON.stringify(history));
      haptic("medium");
    } catch (e) {
      // вопрос без ответа не храним: его можно задать снова
      history = history.slice(0, -1);
      input.value = q;
      grow();
      if (isPaywall(e)) {
        note.textContent = "";
        wall = paywallBlock(() => { if (wall) wall.remove(); wall = null; ask(input.value); }, "Чат с тренером — по пакету или подписке.");
        note.after(wall);
      } else note.textContent = coachError(e);
    } finally {
      busy = false;
      send.disabled = false;
      draw();
    }
  }

  draw();
  const box = h("section", { class: "card chat", "aria-labelledby": "chat-title" },
    h("div", { class: "coach-title", id: "chat-title" }, "Спроси тренера"),
    h("p", { class: "small muted chat-hint" }, `Только про Доту и эту катку: моменты, сборку, линию, драки. До ${CHAT_PER_MATCH} вопросов по катке.`),
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
const goalText = (text) => {
  const s = String(text || "").replace(/^Цель на следующую катку:\s*/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Задача с прошлой катки (итог) и задача на следующую
function goalBlock(a) {
  if (a.demo) return null;
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
  const box = h("div", {}, h("h2", {}, "Неделя"), h("div", { class: "card small muted" }, "Собираю игры за две недели…"));
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
      // без прошлой недели винрейт уже в плитке сверху, строка его только повторит
      prev.length > 0 && line("Винрейт", (m) => (won(m) ? 100 : 0), (v) => `${Math.round(v)}%`),
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
    status.textContent = "Ищу…";
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
    btn.disabled = true;
    step("compare");
    out.replaceChildren(h("div", { class: "chat-msg assistant typing" }, h("i"), h("i"), h("i")));
    try {
      const data = await postCoach({ mode: "compare", a: { ...coachPayload(a), past: [] }, b: other.payload, initData: (tg && tg.initData) || "" });
      if (data.wallet) walletState = { ...walletState, ...data.wallet };
      out.replaceChildren(...String(data.text || "").split("\n").filter(Boolean).map((l) => h("p", {}, l)));
    } catch (e) {
      out.replaceChildren(isPaywall(e) ? paywallBlock(() => pick(other, btn), "Сравнение каток — по пакету или подписке.") : h("p", { class: "error" }, coachError(e)));
    } finally {
      btn.disabled = false;
    }
  };
  return h("details", { class: "card timeline-box compare" },
    h("summary", {}, "Сравнить с другой каткой"),
    h("p", { class: "small muted" }, `Тренер скажет, что ты делал по-другому. В списке — катки, которые ты уже открывал.`),
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

async function histMatches(account, heroId, turbo = false) {
  const key = `hm:v1:${account}:${heroId || "all"}${turbo ? ":turbo" : ""}`;
  try {
    const c = JSON.parse(safeLocal.get(key) || "null");
    if (c && Date.now() - c.t < HIST_TTL && Array.isArray(c.rows)) return c.rows;
  } catch { /* битый кэш — перезапросим */ }
  // significant=1 у OpenDota выкидывает турбо, поэтому для турбо просим именно его
  const mode = turbo ? `significant=0&game_mode=${TURBO_MODE}` : "significant=1";
  const q = `limit=${heroId ? 30 : 20}&${mode}${heroId ? `&hero_id=${heroId}` : ""}&` + HIST_FIELDS.map((f) => `project=${f}`).join("&");
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
    h("div", { class: "small muted" }, "Собираю прошлые игры…"));
  const seq = navSeq;
  // турбо сравниваем только с турбо: там золото и опыт идут быстрее
  const turbo = a.facts.game_mode === TURBO_MODE;
  const usable = (m) => m.match_id !== a.facts.match_id && m.duration >= 600 && (m.game_mode === TURBO_MODE) === turbo && m.gold_per_min != null;
  (async () => {
    let pool = (await histMatches(self.account, a.facts.hero_id, turbo)).filter(usable);
    let sample = `на ${a.facts.hero}`;
    if (pool.length < HIST_MIN) {
      pool = (await histMatches(self.account, null, turbo)).filter(usable);
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
        h("div", { class: "small muted" }, `Медиана ${pool.length} ${plural(pool.length, "прошлой игры", "прошлых игр", "прошлых игр")} ${sample}${turbo ? " в турбо" : ""} → эта игра. ${turbo ? "Турбо сравниваю только с турбо" : "Турбо и игры короче 10 минут не считаю"}.`));
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
    h("div", { class: "card draft-notes" }, ...d.notes.slice(0, 2).map((n) => h("div", { class: `draft-note ${n.severity}` },
      n.hero_id ? heroImg(n.hero_id, "mini-hero") : h("span", { class: "draft-note-dot" }), h("span", {}, n.text)))),
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

// ---------- кто слил, кто тащил: все десять игроков ----------

const BLAME_TAGS = { mvp: "MVP", anchor: "слил", carry: "тащил", passenger: "пассажир" };

function verdictsOf(a) {
  const raw = rawOf.get(a);
  if (!raw) return null;
  if (!raw.verdicts) {
    raw.verdicts = matchVerdicts(raw.match, a.hist_self && a.hist_self.account, { heroName: (id) => dictionary.heroName(id), heroKey: (id) => dictionary.heroKey(id) });
  }
  return raw.verdicts;
}

function blameHeadline(v) {
  const me = v.meRow;
  if (v.anchor && v.anchor === me) return ["Похоже, слил ты", "Не обижайся: цифры матча так говорят. Ниже — что поправить."];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  if (v.anchor) return [`Слил, похоже, ${v.anchor.name}`, `${cap(v.anchor.minus || "вклад ниже всех в команде")}. Ниже цифры по всем десяти.`];
  return ["Явного виновника нет", me && !me.won
    ? "Проиграли всей командой: вклад у вас близкий. Ниже цифры по всем десяти."
    : "У проигравших вклад близкий: слили всей командой. Ниже цифры по всем десяти."];
}

// ширина через CSSOM: атрибут style запрещён политикой CSP
function barFill(pct) {
  const i = h("i", {});
  i.style.width = `${Math.max(4, pct)}%`;
  return i;
}

function blameRow(r) {
  return h("div", { class: `blame-row${r.me ? " me" : ""}${r.tag ? ` tag-${r.tag}` : ""}` },
    heroImg(r.hero_id, "blame-hero"),
    h("div", { class: "blame-main" },
      h("div", { class: "blame-name" },
        h("b", {}, r.name), r.me && h("span", { class: "you" }, "ты"),
        h("span", { class: "muted" }, ` · ${r.role} · ${r.kda}`),
        r.tag && h("span", { class: `blame-tag ${r.tag}` }, BLAME_TAGS[r.tag])),
      h("div", { class: "blame-bar", role: "img", "aria-label": `Вклад ${r.impact} из 100` },
        barFill(r.impact), h("b", {}, String(r.impact))),
      r.plus && h("div", { class: "blame-fact plus" }, r.plus),
      r.minus && h("div", { class: "blame-fact minus" }, r.minus)));
}

const AWARD_ICONS = {
  ctrl: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  heal: "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10ZM12 9v5M9.5 11.5h5",
  eyes: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  wall: "M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6l-8-3Z",
  dmg: "M5 19 19 5M14 5h5v5M5 14l5 5",
  push: "M6 21V9l6-5 6 5v12M10 21v-5h4v5",
  feed: "M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3ZM9.5 11h.01M14.5 11h.01M10 21h4",
};

function awardsGrid(v) {
  return h("div", { class: "award-grid" }, ...v.awards.map((x) => h("div", { class: `award${x.anti ? " anti" : ""}${x.row.me ? " me" : ""}` },
    h("span", { class: "award-ic", "aria-hidden": "true" }, svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: AWARD_ICONS[x.id] }))),
    h("div", { class: "award-body" },
      h("span", { class: "award-title" }, x.title),
      h("b", {}, x.row.name + (x.row.me ? " (ты)" : "")),
      h("span", { class: "small muted" }, x.text)))));
}

function blameTab(a) {
  const v = verdictsOf(a);
  if (!v) return h("div", {}, h("p", { class: "muted" }, "Нет данных матча."));
  step("blame");
  const [title, sub] = blameHeadline(v);
  const myRadiant = v.meRow ? v.meRow.radiant : true;
  const team = (radiant) => v.rows.filter((r) => r.radiant === radiant).sort((x, y) => y.impact - x.impact);
  const side = (radiant) => {
    const won = radiant === v.radiantWin;
    return h("div", { class: `card blame-team ${won ? "won" : "lost"}` },
      h("div", { class: "blame-team-head" }, h("b", {}, radiant === myRadiant ? "Твоя команда" : "Враги"), h("span", { class: won ? "win-text" : "loss-text" }, won ? "победа" : "поражение")),
      ...team(radiant).map(blameRow));
  };
  const problems = ((a.summary || {}).problems || []).slice(0, 2);
  const me = v.meRow;
  return h("div", {},
    h("div", { class: `card blame-hero-card${v.anchor && v.anchor === me ? " me" : ""}` },
      h("span", { class: "eyebrow" }, "Кто слил катку"),
      h("div", { class: "display" }, title),
      h("p", { class: "small" }, sub),
      h("div", { class: "blame-mvp" }, h("span", { class: "blame-tag mvp" }, "MVP"), h("b", {}, v.mvp.name + (v.mvp.me ? " (ты)" : "")), h("span", { class: "muted small" }, v.mvp.plus || "")),
      h("div", { class: "row blame-actions" },
        h("button", { type: "button", class: "ghost", onclick: () => shareMatch(a, { render: () => renderBlameCard(a, v), label: "Итог матча", text: `${title}. Разбор в @${BOT_USERNAME}` }) }, "Поделиться"),
        disagreeBtn(a, "blame", title))),
    me && h("div", { class: "card blame-you" },
      h("div", { class: "row" }, h("b", { class: "grow" }, "Ты в этой катке"), h("span", { class: "blame-score" }, `${me.impact}`, h("small", {}, "/100"))),
      h("p", { class: "small muted" }, `Вклад среди ${me.core ? "коров" : "саппортов"} обеих команд: ${me.impact >= 60 ? "выше большинства" : me.impact >= 40 ? "в середине" : "ниже большинства"}.`),
      problems.length > 0 && h("div", { class: "blame-fix" },
        h("span", { class: "eyebrow" }, me.won ? "Что сделать ещё лучше" : "Что было делать, чтобы вытащить"),
        ...problems.map((p) => h("div", { class: "fix-row" }, h("b", {}, p.title), p.action && h("span", { class: "small" }, p.action)))),
      COACH_URL && h("button", { type: "button", class: "ghost", onclick: () => { haptic(); chatFor(a).ask(me.won ? "Что мне сделать ещё лучше в такой катке?" : "Что мне было делать, чтобы вытащить эту катку?"); } }, "Спросить тренера")),
    side(myRadiant),
    side(!myRadiant),
    v.awards.length > 0 && h("h2", {}, "Награды матча"),
    v.awards.length > 0 && awardsGrid(v),
    h("p", { class: "small muted" }, "Вклад считаю по цифрам матча: нетворс, урон, драки, варды и смерти без размена (своя команда никого не убила в ±10 секунд). Кор сравнивается с корами, саппорт — с саппортами. Это не приговор: не согласен — жми кнопку, поправлю правило."),
  );
}

// «Не согласен»: счётчик в отчёте владельца и текст вывода, чтобы найти кривое правило
function disagreeBtn(a, kind, text) {
  const btn = h("button", { type: "button", class: "ghost disagree" }, "Не согласен");
  btn.onclick = async () => {
    haptic("light");
    step(`disagree_${kind}`);
    if (!COACH_URL || !tg || !tg.initData) { btn.textContent = "Отправить можно из Телеграма"; btn.disabled = true; return; }
    btn.disabled = true;
    btn.textContent = "Отправляю…";
    try {
      await postCoach({ mode: "feedback", initData: tg.initData, match_id: a.facts.match_id, kind, text: String(text).slice(0, 300) });
      btn.textContent = "Принял, проверю";
    } catch {
      btn.textContent = "Не отправилось, ещё раз";
      btn.disabled = false;
    }
  };
  return btn;
}

// Карточка 1080×1350 «Итог матча»: кто тащил, кто слил, все десять с вкладом
async function renderBlameCard(a, v) {
  const W = 1080, H = 1350, P = 72;
  const C = { ink: "#08090c", text: "#eceae4", muted: "#8a8f9c", aegis: "#e8c27a", radiant: "#4fd1a5", dire: "#f2555a" };
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  try { await cardFonts(); await Promise.all(["700 80px Unbounded", "800 40px Manrope", "600 30px Manrope"].map((s) => document.fonts.load(s))); } catch { /* системный шрифт */ }
  const display = (s) => `700 ${s}px Unbounded, Manrope, -apple-system, sans-serif`;
  const sans = (w, s) => `${w} ${s}px Manrope, -apple-system, "Segoe UI", sans-serif`;
  const glow = (x, y, r, color) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  glow(W, 0, 800, "rgba(242,85,90,0.22)");
  glow(0, H, 900, "rgba(79,209,165,0.2)");
  const [title] = blameHeadline(v);
  ctx.fillStyle = C.aegis; ctx.font = sans(800, 32); ctx.fillText("КТО СЛИЛ КАТКУ", P, 110);
  ctx.fillStyle = C.text; ctx.font = display(title.length > 22 ? 52 : 64);
  const y0 = drawWrapped(ctx, title, P, 190, W - 2 * P, 74, 2);
  ctx.fillStyle = C.muted; ctx.font = sans(700, 30);
  ctx.fillText(`MVP: ${v.mvp.name} · ${a.facts.duration}`, P, y0 + 10);
  const myRadiant = v.meRow ? v.meRow.radiant : true;
  let y = y0 + 80;
  for (const radiant of [myRadiant, !myRadiant]) {
    const won = radiant === v.radiantWin;
    ctx.fillStyle = won ? C.radiant : C.dire; ctx.font = sans(800, 28);
    ctx.fillText(`${radiant === myRadiant ? "Команда" : "Враги"} · ${won ? "победа" : "поражение"}`, P, y);
    y += 26;
    for (const r of v.rows.filter((x) => x.radiant === radiant).sort((x, z) => z.impact - x.impact)) {
      const rowH = 74;
      if (r.me) { ctx.fillStyle = "rgba(232,194,122,0.10)"; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(P - 16, y + 6, W - 2 * P + 32, rowH - 8, 18); else ctx.rect(P - 16, y + 6, W - 2 * P + 32, rowH - 8); ctx.fill(); }
      // имя ужимается, чтобы не залезть на плашку и полосу (Keeper of the Light (ты))
      const nameText = r.name + (r.me ? " (ты)" : "");
      const label = r.tag ? BLAME_TAGS[r.tag].toUpperCase() : "";
      ctx.font = sans(800, 22);
      const tw = label ? ctx.measureText(label).width + 28 : 0;
      const nameMax = W - P - 360 - P - (label ? tw + 24 : 16);
      let fs = 34;
      ctx.font = sans(800, fs);
      while (fs > 22 && ctx.measureText(nameText).width > nameMax) ctx.font = sans(800, fs -= 2);
      ctx.fillStyle = C.text;
      ctx.fillText(nameText, P, y + 52);
      if (label) {
        const tx = P + Math.min(ctx.measureText(nameText).width, nameMax) + 16;
        ctx.font = sans(800, 22);
        ctx.fillStyle = r.tag === "anchor" || r.tag === "passenger" ? C.dire : C.aegis;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(tx, y + 24, tw, 38, 19); else ctx.rect(tx, y + 24, tw, 38); ctx.fill();
        ctx.fillStyle = "#14100a"; ctx.fillText(label, tx + 14, y + 51);
      }
      const bx = W - P - 360, bw = 300;
      ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(bx, y + 34, bw, 14);
      ctx.fillStyle = r.impact >= 60 ? C.radiant : r.impact >= 35 ? C.aegis : C.dire; ctx.fillRect(bx, y + 34, (bw * Math.max(4, r.impact)) / 100, 14);
      ctx.fillStyle = C.text; ctx.font = display(32); ctx.textAlign = "right"; ctx.fillText(String(r.impact), W - P, y + 54); ctx.textAlign = "left";
      y += rowH;
    }
    y += 34;
  }
  ctx.fillStyle = C.text; ctx.font = sans(800, 34); ctx.fillText("Разбери свою катку", P, H - 86);
  ctx.fillStyle = C.muted; ctx.font = sans(700, 28); ctx.fillText(`@${BOT_USERNAME}`, P, H - 44);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// ---------- миникарта: смерти в драках и обсы ----------

// ---------- реплей: позиции героев (GitHub Actions разбирает, файл лежит в ветке replays) ----------

const REPLAY_RAW = "https://raw.githubusercontent.com/BEZzZ22/KORPl/replays/r";
const replayCache = new Map();

// Файл позиций, если реплей уже разобран; нет файла или сети — null, разбор идёт без него
const replayInflight = new Map();
async function fetchReplay(matchId) {
  if (replayCache.has(matchId)) return replayCache.get(matchId);
  if (replayInflight.has(matchId)) return replayInflight.get(matchId);
  const job = (async () => {
    let data = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${REPLAY_RAW}/${matchId}.json`, { signal: ctrl.signal });
      data = res.ok ? await res.json() : null;
      clearTimeout(timer);
    } catch { data = null; }
    if (data) replayCache.set(matchId, data);
    replayInflight.delete(matchId);
    return data;
  })();
  replayInflight.set(matchId, job);
  return job;
}

// Кнопка заказа разбора реплея по позициям
function replayCta(a, intro) {
  const status = h("p", { class: "small muted", role: "status" }, intro || "Тренер увидит, где ты стоял и кто был рядом в каждой смерти. Реплей разбирается 10–30 минут.");
  const btn = h("button", { type: "button", class: "replay-btn" }, "Разобрать реплей по позициям");
  btn.onclick = async () => {
    btn.disabled = true;
    haptic("medium");
    step("replay");
    try {
      // заявка уходит сразу: окно «разрешить сообщения» клиент может не закрыть до минуты, и кнопка всё это время молчала
      const canP = tg && tg.initData ? canMessage() : Promise.resolve(false);
      const data = await postCoach({ mode: "replay", match_id: a.facts.match_id, initData: (tg && tg.initData) || "" });
      if (data.status === "done") { status.textContent = "Реплей уже разобран: открой матч заново."; return; }
      status.textContent = "В очереди. Реплей разбирается 10–30 минут.";
      canP.then((can) => { status.textContent = can ? "В очереди. Бот напишет, когда будет готово." : "В очереди. Загляни сюда через полчаса."; });
    } catch (e) {
      btn.disabled = false;
      status.textContent = coachError(e);
    }
  };
  return intro ? h("div", { class: "replay-inline" }, status, btn) : h("div", { class: "card replay-card" }, btn, status);
}

function replayBlock(a) {
  const r = a.replay;
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
      h("div", { class: "legend" }, h("span", {}, h("i", { class: "lg-zone own" }), "своя половина"), h("span", {}, h("i", { class: "lg-zone river" }), "середина: река и центр линий"),
        h("span", {}, h("i", { class: "lg-zone enemy" }), "чужая (её доля справа)"))),
    farmBlock(r),
    r.deaths.length > 0 && h("h2", {}, "Перед каждой смертью"),
    r.deaths.length > 0 && h("div", { class: "card map-card" },
      minimap(deaths, { label: `Пути за 20 секунд до смертей: ${r.deaths.length}` }),
      h("p", { class: "small muted" }, `Линия — где ты шёл последние 20 секунд. Один — никого из своих в радиусе 1 500, это примерно экран вокруг тебя: ${alone} из ${r.deaths.length}. Карта — около 16 000 по стороне.`),
      ...r.deaths.map((d) => h("div", { class: `death-row ${d.allies_near ? "" : "alone"}` },
        h("time", {}, mmss(d.t)),
        h("span", { class: "grow" }, d.allies_near ? `рядом ${d.allies_near} ${plural(d.allies_near, "свой", "своих", "своих")}` : `один${allyGap(d.nearest_ally)}`,
          h("small", {}, [ZONE_NAMES[d.zone], APPROACH[d.approach]].filter(Boolean).join(" · "))),
        h("b", {}, `${d.enemies_near} ${plural(d.enemies_near, "враг", "врага", "врагов")}`)))));
}

// Насколько далеко были свои, когда умер один: число в игровых единицах мало что говорит
function allyGap(d) {
  if (d == null) return "";
  if (d > 7000) return ", свои через полкарты";
  if (d > 3000) return `, свои далеко: ${num(d)}`;
  return `, ближайший свой в ${num(d)}`;
}

const APPROACH = { toward: "шёл на врагов", away: "отходил, догнали", still: "стоял на месте" };
const FARM_PHASES = [["lane", "Линия, 0–10"], ["mid", "Мидгейм, 10–25"], ["late", "Лейт, 25+"]];

// Где добивал крипов по фазам и сколько был рядом с командой (по реплею)
function farmBlock(r) {
  const rows = FARM_PHASES.map(([k, label]) => {
    const f = (r.farm || {})[k];
    const total = f ? Object.values(f).reduce((x, y) => x + y, 0) : 0;
    if (total < 5) return null;
    const top = Object.entries(f).sort((x, y) => y[1] - x[1]).filter(([, n]) => n / total >= 0.1).slice(0, 3);
    return h("div", { class: "farm-row" },
      h("div", { class: "farm-head" }, h("span", {}, label), h("b", {}, `${total} ${plural(total, "крип", "крипа", "крипов")}`)),
      h("div", { class: "small muted" }, top.map(([z, n]) => `${ZONE_NAMES[z]} ${Math.round((n / total) * 100)}%`).join(" · ")));
  }).filter(Boolean);
  const group = FARM_PHASES.slice(1).filter(([k]) => r.group && r.group[k] != null);
  if (!rows.length && !group.length) return null;
  return h("div", {},
    h("h2", {}, "Где добивал крипов"),
    h("div", { class: "card" },
      ...rows,
      group.length > 0 && h("p", { class: "small muted" },
        `Рядом с двумя и больше своими: ${group.map(([k, label]) => `${label.split(",")[0].toLowerCase()} ${Math.round(r.group[k] * 100)}%`).join(", ")} времени.`),
      r.base_time >= 120 && h("p", { class: "small loss-text" }, `После 10:00 стоял на своей базе ${mmss(r.base_time)} сверх возрождений.`)));
}

function mapTab(a) {
  const m = a.map || { deaths: [], wards: [], sentries: [] };
  const raw = rawOf.get(a);
  const side = m.radiant ? "Твоя база слева внизу (Свет)." : "Твоя база справа вверху (Тьма).";
  const mine = m.wards.filter((w) => w.mine).length;
  const dewarded = m.wards.filter((w) => w.dewarded).length;
  const deep = m.wards.filter((w) => w.enemy_half).length;
  const sentries = m.sentries || [];
  let live = null;
  // файл позиций мог прийти уже после разбора: героев на карте всё равно покажем
  if (raw && !raw.replay && replayCache.has(a.facts.match_id)) raw.replay = replayCache.get(a.facts.match_id);
  if (raw) {
    try {
      const model = replayModel(raw.match, raw.replay, raw.match.players.find((p) => p.account_id === a.hist_self.account) || null, {
        heroKey: (id) => dictionary.heroKey(id).replace("npc_dota_hero_", ""), heroName: (id) => dictionary.heroName(id),
      });
      live = liveMap(model, { iconUrl: (id) => `${STEAM_CDN}/apps/dota2/images/dota_react/heroes/icons/${dictionary.heroKey(id).replace("npc_dota_hero_", "")}.png`, haptic });
    } catch (e) {
      console.warn(e);
    }
  }
  return h("div", {},
    h("h2", {}, "Повтор матча"),
    live && h("div", { class: "card map-card live-card" },
      live,
      !a.replay && !raw.replay && replayCta(a, "Сейчас видно варды, здания и смерти в драках. Разбери реплей — на карте поедут все 10 героев, а тренер увидит, кто где стоял.")),
    !live && !a.replay && replayCta(a),
    V2 && (m.deaths.length > 0 || m.wards.length > 0 || (a.replay && a.replay.deaths.length > 0)) && h("h2", {}, "Тактический стол"),
    V2 && (m.deaths.length > 0 || m.wards.length > 0 || (a.replay && a.replay.deaths.length > 0)) && h("div", { class: "card map3d-card" },
      tacticalTable({ deaths: a.replay && a.replay.deaths.length ? a.replay.deaths : m.deaths, wards: m.wards, reduced: reducedMotion(), haptic })),
    (m.wards.length > 0 || sentries.length > 0) && h("div", { class: "card ward-sum" },
      h("div", { class: "ws-row" },
        h("div", {}, h("b", {}, String(m.wards.length)), h("span", {}, "обсов команды")),
        h("div", {}, h("b", {}, String(mine)), h("span", {}, "твоих")),
        h("div", {}, h("b", {}, String(deep)), h("span", {}, "на чужой половине")),
        h("div", { class: dewarded > m.wards.length / 3 ? "bad" : "" }, h("b", {}, String(dewarded)), h("span", {}, "снесли раньше"))),
      h("p", { class: "small muted" }, `Сентри: ${sentries.length}${sentries.filter((w) => w.mine).length ? `, твоих ${sentries.filter((w) => w.mine).length}` : ""}. ${side}`)),
    a.replay && replayBlock(a),
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
  const st = l.setup;
  return h("div", {},
    h("h2", {}, `Линия против ${l.opponent}`),
    h("div", { class: "card lane-duel" },
      st && h("div", { class: "lane-setup" },
        h("span", { class: `lane-odds ${st.mine < st.theirs ? "hard" : st.mine > st.theirs ? "easy" : ""}` }, `${st.mine} на ${st.theirs}`),
        ...[st.hero_id, ...st.ally_ids].map((id) => heroImg(id, "mini-hero")), h("span", { class: "small muted" }, "против"), ...st.enemy_ids.map((id) => heroImg(id, "mini-hero"))),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "мин"), h("th", {}, "крипы"), h("th", {}, "нетворс"), h("th", {}, "опыт"))),
        h("tbody", {}, ...l.rows.map((r) => h("tr", {}, h("th", {}, String(r.m)), diff(r.lh, String), diff(r.nw), diff(r.xp))))),
      h("p", { class: "small muted" }, "Твоё значение и разница с оппонентом. Зелёное — ты впереди.")));
}

// ---------- тайминги предметов против всех игр на герое ----------

const timingCache = new Map();
// Тайминги пабов (OpenDota по публичным играм на герое) прямо в строках сборки: когда обычно собирают
// и как меняется винрейт, если собрать позже
function pubTimings(a, root) {
  const plan = a.item_plan;
  const keys = [...new Set([...plan.early, ...plan.core, ...plan.counters, ...(plan.extra || [])].map((r) => r.key))];
  if (!keys.length) return;
  const seq = navSeq;
  (async () => {
    if (!timingCache.has(a.facts.hero_id)) timingCache.set(a.facts.hero_id, await api(`/scenarios/itemTimings?hero_id=${a.facts.hero_id}`));
    if (stale(seq)) return;
    const bought = new Map(((plan.bought_order || [])).map((x) => [x.key, x.time]));
    const rows = itemTimings(keys.map((k) => ({ key: k, item: dictionary.itemName(k), time: bought.get(k) || 0 })), timingCache.get(a.facts.hero_id));
    for (const r of rows) {
      for (const el of root.querySelectorAll(`[data-key="${r.key}"] .grow`)) {
        // винрейт «раньше / позже» показываем только на большой выборке и при заметной разнице
        const wr = r.games >= 300 && r.wr_by != null && r.wr_after != null && Math.abs(r.wr_by - r.wr_after) >= 8;
        el.append(h("div", { class: "small muted ip-pub" }, `в пабах к ${mmss(r.usual)}` + (wr ? ` · до этого ${r.wr_by}% побед, позже ${r.wr_after}%` : "")));
      }
    }
  })().catch(() => {});
}

const DEATH_KIND = { lane: "на линии", fight: "в драке", solo: "один", trade: "размен", skirmish: "стычка" };

// Сводка смертей: сколько и где, по пятиминуткам, что повторялось, и все смерти списком
function deathSummaryCard(a) {
  const d = a.death_summary;
  if (!d) return null;
  const role = a.summary && a.summary.rank ? ` у ${POS_GEN_PLURAL[a.facts.position] || "игроков"} на ранге ${a.summary.rank}` : "";
  const max = Math.max(1, ...d.buckets);
  const kinds = ["lane", "fight", "solo", "trade", "skirmish"].filter((k) => d.counts[k]);
  return h("div", { class: "card deaths-sum" },
    h("div", { class: "ds-head" },
      h("b", {}, `${d.total} ${plural(d.total, "смерть", "смерти", "смертей")}`),
      h("span", { class: "small muted" }, `мёртвым ${mmss(d.dead_time)} — ${Math.round(d.dead_share * 100)}% игры` +
        (d.dead_norm != null ? `, обычно${role} ${Math.round(d.dead_norm * 100)}%` : ""))),
    h("div", { class: "ds-kinds" }, ...kinds.map((k) => h("span", { class: `ds-kind ${k}` }, `${DEATH_KIND[k]} `, h("b", {}, String(d.counts[k]))))),
    h("div", { class: "ds-bars", role: "img", "aria-label": "Смерти по пятиминуткам" },
      ...d.buckets.map((n, i) => h("div", { class: "ds-bar" }, h("i", { "data-h": Math.round((n / max) * 100) }), h("small", {}, i % 2 === 0 ? String(i * 5) : "")))),
    d.patterns.length > 0 && h("div", { class: "ip-label" }, "Что повторялось"),
    ...d.patterns.map((p) => h("div", { class: "ds-pattern" }, h("div", {}, p.text), h("div", { class: "small muted" }, p.tip))),
    h("details", { class: "ds-all" }, h("summary", {}, "Все смерти"),
      ...d.rows.map((r) => h("div", { class: "ds-row" },
        h("time", {}, r.clock),
        r.killer_id ? heroImg(r.killer_id, "mini-hero") : h("span", { class: "mini-hero" }),
        h("div", { class: "grow" },
          h("span", { class: `ds-kind ${r.kind}` }, DEATH_KIND[r.kind]),
          r.fresh && h("span", { class: "ds-kind fresh" }, "сразу после возрождения"),
          r.note && h("div", { class: "small muted" }, r.note))))));
}

function killersTab(a) {
  const sum = deathSummaryCard(a);
  if (!a.killers.length) return h("div", {}, sum, h("p", { class: "muted" }, "Никто не убил тебя больше одного раза."));
  return h("div", {}, sum, a.killers.length > 0 && h("h2", {}, "Кто убивал"), ...a.killers.map((k) => {
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
          h("i", { class: c.bkb_blocks ? "yes" : "no" }, c.bkb_blocks ? "BKB блокирует" : "BKB пробивает"),
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

const POS_SHORT = { 1: "керри", 2: "мидер", 3: "офлейнер", 4: "саппорт-четвёрка", 5: "хард-саппорт" };
const POS_GEN = { 1: "керри", 2: "мидера", 3: "офлейнера", 4: "четвёрки", 5: "пятёрки" };
const POS_GEN_PLURAL = { 1: "керри", 2: "мидеров", 3: "офлейнеров", 4: "четвёрок", 5: "пятёрок" };

// Откуда сборка: про-матчи патча, ближайшая позиция героя или гайд
function planSource(p) {
  if (p.source === "none") return "Обычной сборки по этому герою нет: ниже только то, что нужно против этого пика.";
  if (p.source === "guide") return `по гайду ueyo в Steam, патч ${p.patch}: про на этой позиции его почти не играют`;
  const base = `по ${num(p.games)} ${plural(p.games, "игре", "играм", "играм")} про на патче ${p.patch}`;
  if (p.source === "pro") return `${POS_SHORT[p.pos]}, ${base}`;
  return `${base}. На позиции ${p.want} его почти не играют, это сборка ${POS_GEN[p.pos]}`;
}

// Статус предмета после игры: когда купил, поздно или не было
function planStatus(r) {
  if (r.owned == null) return null;
  if (r.pending) return h("span", { class: "ip-st pending" }, "не успел", h("small", {}, "игра кончилась"));
  if (!r.owned) return h("span", { class: "ip-st miss" }, "не было");
  return h("span", { class: `ip-st ${r.late ? "late" : "have"}` }, r.time != null && r.time > 0 ? mmss(r.time) : "было", r.late && h("small", {}, "поздно"));
}

function planRow(r, after = true) {
  const meta = [r.share != null && `у про ${r.share}% игр`, r.med != null && r.med > 0 && `к ${mmss(r.med)}`].filter(Boolean).join(" · ");
  return h("div", { class: `ip-row ${r.owned === false && !r.pending ? "miss" : ""}`, "data-key": r.key },
    img(dictionary.itemImage(r.key), null, ""),
    h("div", { class: "grow" },
      h("div", { class: "ip-name" }, r.item),
      meta && h("div", { class: "small muted" }, meta),
      r.important && h("div", { class: "small ip-why" }, `${after ? "в этой катке" : "против этого пика"} важнее обычного: ${r.important}`)),
    planStatus(r));
}

// Порядок: твои готовые предметы по времени и основа про по медиане — видно, что собрал раньше времени, а что позже
function planOrder(p) {
  const mine = p.bought_order || [];
  const pro = p.core.filter((r) => r.med);
  if (mine.length < 2 || pro.length < 2) return null;
  const off = new Set((p.extra || []).map((e) => e.key));
  const line = (label, list, cls, when) => h("div", { class: `ip-order ${label === "ты" ? "mine" : ""}` }, h("span", { class: "ip-order-label" }, label),
    h("div", { class: "ip-order-items" }, ...list.map((x) => h("span", { class: `ip-step ${cls(x)}`, title: x.item },
      img(dictionary.itemImage(x.key), null, x.item), h("small", {}, mmss(when(x)))))));
  return h("div", {}, h("div", { class: "ip-label" }, "Порядок"),
    line("ты", mine, (x) => (off.has(x.key) ? "off" : ""), (x) => x.time),
    line("про", pro, (x) => (x.owned ? "have" : ""), (x) => x.med),
    h("p", { class: "small muted" }, "Сверху твои готовые предметы по времени (рамка — вне сборки), снизу основа у про; яркие — те, что ты собрал."));
}

function planChips(list, named = false) {
  return h("div", { class: `ip-chips ${named ? "named" : ""}` }, ...list.map((r) => h("span", { class: `ip-chip ${r.owned ? "have" : ""}`, title: r.item },
    img(dictionary.itemImage(r.key), null, r.item), named && h("span", {}, r.item))));
}

// Сборка под пик: обычная сборка героя на позиции и что докупить против этих врагов.
// after — разбор сыгранной катки: рядом с каждым предметом, купил ли и когда
function itemPlanCard(p, { after = false, facts = [] } = {}) {
  if (!p) return null;
  const counters = p.counters.map((c, i) => h("div", { class: "plan-item", "data-key": c.key },
    h("div", { class: "plan-num" }, String(i + 1)),
    img(dictionary.itemImage(c.key), null, ""),
    h("div", { class: "grow" },
      h("div", { class: "plan-name" }, c.item, c.popular && h("span", { class: "tag" }, "берут про")),
      (c.vs_ids || []).length > 0 && h("div", { class: "ip-vs" }, ...c.vs_ids.map((id) => heroImg(id, "mini-hero"))),
      ...c.whys.map((w) => h("div", { class: "small muted" }, w)),
      c.next && h("div", { class: "small plan-extra" }, `потом собирается в ${c.next}`),
      after && h("div", { class: "ip-st-line" }, planStatus(c)))));
  const extra = after && (p.extra || []).length > 0 && [h("div", { class: "ip-label" }, "Купил вне сборки"),
    ...p.extra.map((e) => h("div", { class: "ip-row extra", "data-key": e.key },
      img(dictionary.itemImage(e.key), null, ""),
      h("div", { class: "grow" }, h("div", { class: "ip-name" }, e.item),
        h("div", { class: "small muted" }, e.note || (e.instead ? `вместо ${e.instead}, у про на этой позиции почти не берут` : "у про на этой позиции почти не берут"))),
      h("span", { class: "ip-st" }, e.time > 0 ? mmss(e.time) : "")))];
  return h("div", { class: "card item-plan" },
    h("div", { class: "small muted" }, planSource(p)),
    after && (p.verdict || []).length > 0 && h("div", { class: "ip-verdict" }, h("div", { class: "ip-label" }, "Главное по сборке"),
      ...p.verdict.map((t) => h("p", {}, t))),
    !after && (p.brief || []).length > 0 && h("div", { class: "ip-verdict" }, h("div", { class: "ip-label" }, "Главное под этот пик"),
      ...p.brief.map((t) => h("p", {}, t))),
    ...facts.map((t) => h("div", { class: "plan-fact" }, t)),
    after && p.core_total > 0 && h("div", { class: "ip-score" }, h("b", {}, `${p.core_have} из ${p.core_total}`), " основных предметов собрал"),
    after && planOrder(p),
    p.start.length > 0 && h("div", { class: "ip-label" }, "Старт"),
    p.start.length > 0 && planChips(p.start),
    p.early.length > 0 && h("div", { class: "ip-label" }, "Ранняя игра"),
    ...p.early.map((r) => planRow(r, after)),
    p.core.length > 0 && h("div", { class: "ip-label" }, "Основа"),
    ...p.core.map((r) => planRow(r, after)),
    ...p.notes.map((t) => h("p", { class: "small plan-extra" }, t)),
    h("div", { class: "ip-label" }, "Против этого пика"),
    counters.length ? h("div", {}, ...counters)
      : p.core.some((r) => r.important) ? h("p", { class: "small muted" }, `Главное против этого пика уже в основе: ${p.core.filter((r) => r.important).map((r) => r.item).join(", ")} (отмечено выше).`)
        : h("p", { class: "small muted" }, "Ничего особенного против тебя не играло: обычной сборки хватит."),
    ...(extra || []),
    p.sit.length > 0 && h("div", { class: "ip-label" }, "Ещё берут по ситуации"),
    p.sit.length > 0 && planChips(p.sit, true),
    after && p.turbo && h("p", { class: "small muted" }, "Это турбо: время покупки с обычными играми про не сравниваю."));
}

const tenth = (x) => String(Math.round(x * 10) / 10).replace(".", ",");

// Прокачка: очки в способностях к 10 уровню и таланты — у тебя и у про на этой позиции
function skillCard(sp, { after = false } = {}) {
  if (!sp) return null;
  const head = after ? [h("span", {}, ""), h("b", {}, "ты"), h("b", {}, "про")] : [h("span", {}, ""), h("b", {}, "про")];
  return h("div", { class: "card skills" },
    h("div", { class: "small muted" }, sp.pos === sp.want ? "Очков в способностях к 10-му уровню и таланты, по про-матчам на этой позиции."
      : `На позиции ${sp.want} про его почти не играют: прокачка ${POS_GEN[sp.pos]}.`),
    ...sp.notes.map((t) => h("p", { class: "small plan-extra" }, t)),
    h("div", { class: `sk-grid ${after ? "" : "pro-only"}` }, ...head,
      ...sp.abilities.flatMap((ab) => [
        h("span", { class: "sk-name" }, ab.name, ab.ult && h("small", {}, " ульта")),
        after && h("span", { class: `sk-v ${ab.you != null && Math.abs(ab.you - ab.pro) >= 1.5 ? "off" : ""}` }, String(ab.you ?? "—")),
        h("span", { class: "sk-v muted" }, tenth(ab.pro)),
      ].filter(Boolean))),
    sp.first && h("p", { class: "small muted" }, `На 1-м уровне про берут ${sp.first.name} (${sp.first.share}%).`),
    sp.talents.length > 0 && h("div", { class: "ip-label" }, "Таланты"),
    ...sp.talents.map((t) => h("div", { class: "sk-talent" }, h("b", {}, String(t.level)),
      ...t.options.map((o) => h("span", { class: `sk-opt ${o.picked ? "picked" : ""} ${o.rate >= 60 ? "pop" : ""}` }, o.name, h("small", {}, ` ${o.rate}%`))))));
}

function buildTab(a) {
  const plan = a.item_plan && h("div", {}, h("h2", {}, "Сборка под этот пик"), itemPlanCard(a.item_plan, { after: true, facts: a.item_plan.facts || [] }));
  const skills = a.skill_plan && h("div", {}, h("h2", {}, "Прокачка"), skillCard(a.skill_plan, { after: true }));
  const yours = a.items.length > 0 && h("div", {},
    h("h2", {}, "Твои предметы"),
    h("div", { class: "card" }, ...a.items.map((it) =>
      h("div", { class: "item-row" }, img(dictionary.itemImage(it.key), null, ""), h("span", {}, it.item), h("time", {}, mmss(it.time))))),
  );
  if (!plan && !yours && !skills) return h("p", { class: "muted" }, "Крупных предметов не было.");
  if (plan) pubTimings(a, plan);
  return h("div", {}, plan, skills, yours);
}

const HINT_KEY = "charts_hint_seen";
const C = { me: "#e8c27a", opp: "#9d8cff", win: "#4fd1a5", loss: "#f2555a", muted: "#8a8f9c", norm: "#cfd3dc" };

function chartsTab(a) {
  const t = a.timeline;
  // Ряды OpenDota идут по целым минутам; конец матча (45:18) добавляем последней точкой со значением из итогов
  const end = t.end ? t.end / 60 : null;
  const withEnd = (values, last) => {
    const v = values || [];
    const ts = v.map((_, i) => i);
    if (end != null && last != null && v.length && end > ts[ts.length - 1] + 0.05) return { values: [...v, last], ts: [...ts, end] };
    return { values: v, ts };
  };
  const minuteOf = (sec) => Math.floor(sec / 60);
  const deaths = t.deaths || [];

  // ---- преимущество команды: золото или опыт, драки полосами, вышки и Рошан метками ----
  const fights = (t.fights || []).map((f) => ({ from: f.start / 60, to: Math.max(f.end, f.start + 20) / 60, good: f.delta > 0,
    text: `драка: погибло ваших ${f.our_dead}, врагов ${f.their_dead}` }));
  const events = t.events || [];
  const teamNotes = (tm, isEnd) => [
    ...fights.filter((f) => Math.floor(f.from) === tm).map((f) => f.text),
    ...events.filter((e) => (isEnd ? e.t >= Math.floor(tm) * 60 : minuteOf(e.t) === tm)).map((e) => e.text),
  ];
  let mode = "gold";
  const teamBox = h("div", { class: "card" });
  const drawTeam = () => {
    const values = mode === "gold" ? t.team_gold_adv : t.team_xp_adv;
    teamBox.replaceChildren(
      t.team_xp_adv && t.team_xp_adv.length > 0 && h("div", { class: "chart-seg", role: "tablist" },
        ...[["gold", "Золото"], ["xp", "Опыт"]].map(([k, label]) => {
          const b = h("button", { type: "button", class: k === mode ? "on" : "", "aria-pressed": String(k === mode) }, label);
          b.onclick = () => { if (mode !== k) { mode = k; haptic("light"); drawTeam(); } };
          return b;
        })),
      areaChart(values, { fights, events, deaths, notes: teamNotes, label: mode === "gold" ? "золото" : "опыт" }),
      h("div", { class: "legend" },
        h("span", {}, h("i", { "data-color": C.win }), "вы впереди"), h("span", {}, h("i", { "data-color": C.loss }), "позади"),
        events.length > 0 && h("span", {}, h("b", { class: "lg-mark win-text" }, "▲"), "ваше: вышка, барак, Рошан"),
        events.length > 0 && h("span", {}, h("b", { class: "lg-mark loss-text" }, "▼"), "врагов"),
        fights.length > 0 && h("span", {}, h("i", { class: "lg-band" }), "драка"),
        deaths.length > 0 && h("span", {}, h("i", { "data-color": C.loss }), "твои смерти")));
  };
  if (t.team_gold_adv.length) drawTeam();

  // ---- нетворс: ты против оппонента, готовые предметы точками ----
  const me = withEnd(t.player, t.final && t.final.player);
  const items = (t.items || []).filter((it) => it.time > 0);
  const series = [{ ...me, color: C.me, label: t.hero, glow: true }];
  if (t.opponent) series.push({ ...withEnd(t.opponent, t.final && t.final.opponent), color: C.opp, label: t.opponent_name });
  const nwNotes = (tm, isEnd) => items.filter((it) => (isEnd ? it.time >= Math.floor(tm) * 60 : minuteOf(it.time) === tm)).map((it) => `купил ${it.item}`);

  // ---- крипы: денаи, ориентир по рангу, простои ----
  const lh = withEnd(t.last_hits, t.final && t.final.last_hits);
  const lhSeries = [{ ...lh, color: C.me, label: "крипов", glow: true }];
  if ((t.denies || []).some((v) => v > 0)) lhSeries.push({ ...withEnd(t.denies, t.final && t.final.denies), color: C.opp, label: "денаев" });
  const norm = t.lh_norm;
  if (norm) lhSeries.push({ values: norm.points.map((q) => q[1]), ts: norm.points.map((q) => q[0]), color: C.norm, label: "обычно", dash: true });
  const idle = [
    ...(t.lane_empty || []).map((m) => ({ from: m - 1, to: m, text: `минута без крипов на линии` })),
    ...(t.idle || []).map(([s0, e0]) => ({ from: s0, to: e0, text: `простой ${s0}–${e0} мин: ни крипов, ни драк` })),
  ];
  const lhNotes = (tm) => idle.filter((b) => tm > b.from && tm <= b.to).map((b) => b.text);

  let hint = null;
  try { if (!localStorage.getItem(HINT_KEY)) hint = h("p", { class: "small muted" }, "Веди пальцем по графику: на каждой минуте видно значения и что случилось."); } catch { /* приватный режим */ }
  const seen = () => { if (!hint) return; try { localStorage.setItem(HINT_KEY, "1"); } catch { /* */ } };
  const root = h("div", {},
    hint,
    t.team_gold_adv.length > 0 && h("h2", {}, "Преимущество команды"),
    t.team_gold_adv.length > 0 && teamBox,
    h("h2", {}, "Нетворс против оппонента"),
    h("div", { class: "card" }, lineChart(series, { markers: deaths, unit: "k", end: t.end, dots: items.map((it) => it.time), notes: nwNotes }),
      h("div", { class: "legend" },
        ...series.map((x) => h("span", {}, h("i", { "data-color": x.color }), x.label)),
        items.length > 0 && h("span", {}, h("i", { class: "lg-ring" }), "готовый предмет"),
        deaths.length > 0 && h("span", {}, h("i", { "data-color": C.loss }), "твои смерти"))),
    h("h2", {}, "Добито крипов"),
    h("div", { class: "card" }, lineChart(lhSeries, { end: t.end, bands: idle.map((b) => ({ ...b, cls: "idle" })), notes: lhNotes }),
      h("div", { class: "legend" },
        ...lhSeries.map((x) => h("span", {}, h("i", { class: x.dash ? "lg-dash" : "", "data-color": x.dash ? null : x.color }), x.dash ? norm.label : x.label)),
        idle.length > 0 && h("span", {}, h("i", { class: "lg-band idle" }), "жив, но не фармил и не дрался"))),
  );
  root.addEventListener("pointerdown", seen, { once: true });
  return root;
}

// Круглый шаг шкалы: 1, 2, 2.5, 5 × 10^n — чтобы подписи были 0, 100, 200, а не 89, 179, 268
function niceStep(range, ticks = 4, steps = [1, 2, 2.5, 5, 10]) {
  const raw = range / ticks || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return steps.map((k) => k * p).find((k) => k >= raw);
}

// tmax — длина оси времени в минутах (последняя точка может стоять на дробной минуте, конец матча)
function chartFrame(values, tmax, { zero = false, unit = "" } = {}) {
  const W = 340, H = 170, L = 34, R = 8, T = 10, B = 20;
  let min = Math.min(...values), max = Math.max(...values);
  if (zero) { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; min = -m; max = m; } else { min = Math.min(0, min); }
  if (max === min) max = min + 1;
  // у симметричной шкалы по три деления на сторону, иначе −21k растягивается до −40k
  const step = zero ? niceStep(max, 3, [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) : niceStep(max - min, 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const n = Math.max(tmax, 1);
  const x = (tm) => L + (tm / n) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const fmt = (v) => {
    if (Math.abs(v) < 1e-9) return "0";
    const sign = v < 0 ? "−" : "";
    if (unit !== "k") return sign + Math.round(Math.abs(v));
    const k = Math.abs(v) / 1000;
    return `${sign}${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  };
  const chart = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img" });
  chart.dataset.len = String(n);
  for (let v = min; v <= max + step / 2; v += step) {
    chart.append(svg("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }), svg("text", { x: 2, y: y(v) + 3 }, fmt(v)));
  }
  for (let m = 0; m <= n; m += 10) chart.append(svg("text", { x: x(m) - 4, y: H - 4 }, m));
  return { chart, x, y, W, H, L, R, T, B };
}

// Значение ряда в момент tm (минуты): между точками по прямой; за концом ряда — null
function valueAt(s, tm) {
  const { values, ts } = s;
  if (!values.length || tm > ts[ts.length - 1] + 1e-9) return null;
  if (tm <= ts[0]) return values[0];
  for (let i = 1; i < ts.length; i++) {
    if (tm <= ts[i]) return values[i - 1] + ((values[i] - values[i - 1]) * (tm - ts[i - 1])) / (ts[i] - ts[i - 1] || 1);
  }
  return values[values.length - 1];
}

// Полосы на графике: драки, простои — прямоугольники по времени во всю высоту
function drawBands(frame, bands) {
  const { chart, x, T, H, B } = frame;
  for (const b of bands) {
    chart.append(svg("rect", { class: `band ${b.cls || ""}`, x: x(b.from).toFixed(1), y: T, width: Math.max(1.5, x(b.to) - x(b.from)).toFixed(1), height: H - T - B }));
  }
}

// Палец или мышь над графиком: вертикальная линия, точки и подсказка со значениями этой минуты.
// notes(tm, isEnd) — строки о том, что случилось в эту минуту (покупки, вышки, драки)
function makeInteractive(frame, series, { deaths = [], valueFmt = (v) => num(v), end = null, notes = () => [] } = {}) {
  const { chart, x, y, W, H, L, R, T, B } = frame;
  // все моменты, где есть точка хотя бы у одного ряда: целые минуты и конец матча
  const stops = [...new Set(series.flatMap((s) => s.ts))].sort((a, b) => a - b);
  const MAX_NOTES = 4;
  const guide = svg("line", { y1: T, y2: H - B, stroke: C.me, "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  const dots = series.map((s) => svg("circle", { r: 4, fill: s.color, stroke: "#08090c", "stroke-width": 2, opacity: 0 }));
  const box = svg("rect", { rx: 8, fill: "rgba(13,15,20,0.94)", stroke: "rgba(232,194,122,0.4)", opacity: 0 });
  const lines = [svg("text", { class: "tt tt-title" })]
    .concat(series.map(() => svg("text", { class: "tt" })), [svg("text", { class: "tt tt-death" })],
      Array.from({ length: MAX_NOTES }, () => svg("text", { class: "tt tt-note" })));
  const tip = svg("g", { "pointer-events": "none" }, guide, ...dots, box, ...lines);
  chart.append(tip);

  const show = (evt) => {
    const rect = chart.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const want = ((px - L) / (W - L - R)) * Number(chart.dataset.len);
    const tm = stops.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), stops[0]);
    const cx = x(tm);
    guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("opacity", 1);
    series.forEach((s, k) => {
      const v = valueAt(s, tm);
      if (v == null) { dots[k].setAttribute("opacity", 0); lines[k + 1].textContent = ""; return; }
      dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", y(v)); dots[k].setAttribute("opacity", 1);
      lines[k + 1].textContent = `${s.label ? s.label + ": " : ""}${valueFmt(Math.round(v))}`;
      lines[k + 1].setAttribute("fill", s.color);
    });
    const isEnd = end != null && !Number.isInteger(tm);
    lines[0].textContent = isEnd ? `конец, ${mmss(end)}` : `${tm} мин`;
    // смерти этой минуты (с tm:00 до tm:59), у конца — после последней целой минуты
    const died = deaths.filter((t) => (isEnd ? t >= Math.floor(tm) * 60 : Math.floor(t / 60) === tm));
    lines[series.length + 1].textContent = died.length ? `смерть ${died.map((t) => mmss(t)).join(", ")}` : "";
    // одинаковые строки одной минуты (две T4 подряд) — одной строкой с числом
    const counts = new Map();
    for (const n of notes(tm, isEnd)) counts.set(n, (counts.get(n) || 0) + 1);
    const extra = [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
    const shown = extra.length > MAX_NOTES ? [...extra.slice(0, MAX_NOTES - 1), `и ещё ${extra.length - MAX_NOTES + 1}`] : extra;
    lines.slice(series.length + 2).forEach((l, k) => { l.textContent = shown[k] || ""; });
    const used = lines.filter((l) => l.textContent);
    const longest = Math.max(...used.map((l) => l.textContent.length));
    const boxW = Math.min(W - L - R, Math.max(118, longest * 5.9 + 16)), boxH = 8 + used.length * 13;
    const bx = cx + 10 + boxW > W - R ? Math.max(L, cx - 10 - boxW) : cx + 10;
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

const pathOf = (s, x, y) => s.values.map((v, i) => `${i ? "L" : "M"}${x(s.ts[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");
const byMinute = (values) => ({ values, ts: values.map((_, i) => i) });
const cross = (cx, cy, color = C.loss, r = 3.5) => [
  svg("line", { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, stroke: color, "stroke-width": r > 3 ? 2 : 1.6 }),
  svg("line", { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, stroke: color, "stroke-width": r > 3 ? 2 : 1.6 }),
];

// Линейный график на SVG без библиотек. Ряд: { values, ts } — значения и их время в минутах.
// markers — смерти крестиками на первом ряду, dots — секунды покупок кольцами на первом ряду, bands — полосы
function lineChart(series, { markers = [], unit = "", end = null, dots = [], bands = [], notes } = {}) {
  series = series.map((s) => (s.ts ? s : { ...s, ...byMinute(s.values) }));
  const all = series.flatMap((s) => s.values);
  const tmax = Math.max(...series.map((s) => s.ts[s.ts.length - 1] ?? 0));
  const frame = chartFrame(all.length ? all : [0], tmax, { unit });
  const { chart, x, y } = frame;
  drawBands(frame, bands);
  for (const s of series) {
    const d = pathOf(s, x, y);
    if (s.glow) chart.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 7, "stroke-opacity": 0.18, "stroke-linejoin": "round" }));
    chart.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": s.dash ? 1.6 : 2.2, "stroke-linejoin": "round", ...(s.dash ? { "stroke-dasharray": "4 4", "stroke-opacity": 0.7 } : {}) }));
  }
  const base = series[0];
  for (const t of dots) {
    const v = valueAt(base, Math.min(t / 60, tmax));
    if (v != null) chart.append(svg("circle", { class: "item-dot", cx: x(Math.min(t / 60, tmax)).toFixed(1), cy: y(v).toFixed(1), r: 3.6 }));
  }
  // крестик смерти стоит на линии игрока в её секунду, а не на начале минуты
  for (const t of markers) {
    const tm = Math.min(t / 60, tmax), v = valueAt(base, tm);
    if (v != null) chart.append(...cross(x(tm), y(v)));
  }
  return makeInteractive(frame, series, { deaths: markers, end, notes });
}

// Преимущество команды: плюс — зелёным, минус — красным. Драки полосами, вышки и Рошан — метками сверху и снизу
function areaChart(values, { fights = [], events = [], deaths = [], notes, label = "команда" } = {}) {
  const s = byMinute(values);
  const last = values.length - 1;
  const frame = chartFrame(values, last, { zero: true, unit: "k" });
  const { chart, x, y, T, H, B } = frame;
  drawBands(frame, fights.map((f) => ({ ...f, to: Math.min(f.to, last), cls: f.good ? "fight-win" : "fight-loss" })));
  const area = (clamped) => `${pathOf({ values: clamped, ts: s.ts }, x, y)} L${x(last).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  chart.append(
    svg("path", { d: area(values.map((v) => Math.max(v, 0))), fill: C.win, "fill-opacity": 0.45 }),
    svg("path", { d: area(values.map((v) => Math.min(v, 0))), fill: C.loss, "fill-opacity": 0.55 }),
    svg("line", { x1: x(0), x2: x(last), y1: y(0), y2: y(0), stroke: "#5d6270", "stroke-width": 1 }),
  );
  // свои успехи треугольником вверх по верхнему краю, успехи врагов вниз по нижнему; Рошан крупнее
  for (const e of events) {
    const cx = x(Math.min(e.t / 60, last)), size = e.kind === "tower" ? 3 : 4.5; // бараки, трон и Рошан крупнее
    const cy = e.mine ? T + 4 : H - B - 4;
    const d = e.mine ? `M${cx - size},${cy + size} L${cx + size},${cy + size} L${cx},${cy - size} Z` : `M${cx - size},${cy - size} L${cx + size},${cy - size} L${cx},${cy + size} Z`;
    chart.append(svg("path", { d, class: `ev ${e.mine ? "mine" : "theirs"} ${e.kind}` }, svg("title", {}, `${mmss(e.t)} ${e.text}`)));
  }
  // смерти мелкими крестиками на нулевой линии: видно, после каких из них график пошёл вниз
  for (const t of deaths) if (t / 60 <= last) chart.append(...cross(x(t / 60), y(0), C.loss, 2.4));
  return makeInteractive(frame, [{ ...s, color: C.me, label }], { valueFmt: (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v)), deaths, notes });
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
  root.querySelectorAll("[data-h]").forEach((el) => { el.style.height = `${Number(el.dataset.h)}%`; });
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

// ---------- вход только с подпиской на канал и чат ----------

const COMMUNITY = { channel_url: "https://t.me/Dota_Razbor", chat_url: "https://t.me/dotarazbor_chat" };
const GATE_TTL = 12 * 3600_000; // подписку недавно подтвердили — не держим человека на проверке при каждом запуске

async function checkGate() {
  try {
    return await postCoach({ mode: "gate", initData: tg.initData }, 8000);
  } catch {
    // воркер или сеть легли: не запираем приложение из-за нашего сбоя
    return { ok: true, unknown: true };
  }
}

// Пропускает дальше, когда человек подписан на канал и в чате. Вне Телеграма проверить нельзя — пускаем
async function passGate() {
  if (!COACH_URL || !tg || !tg.initData) return;
  const until = Number(safeLocal.get("gate_ok") || 0);
  if (until > Date.now()) {
    // в фоне перепроверяем: отписался — в следующий запуск снова попросим
    checkGate().then((r) => { if (r.ok && !r.unknown) safeLocal.set("gate_ok", String(Date.now() + GATE_TTL)); else if (!r.ok) safeLocal.set("gate_ok", "0"); });
    return;
  }
  let state = await checkGate();
  if (state.ok) { if (!state.unknown) safeLocal.set("gate_ok", String(Date.now() + GATE_TTL)); return; }
  step("gate");
  // нижняя панель увела бы на главную мимо проверки
  document.body.classList.add("gated");
  await new Promise((done) => {
    const status = h("p", { class: "small muted gate-status", role: "status" });
    const rowFor = (key, title, sub, url, cta) => {
      const btn = h("button", { type: "button", class: "gate-btn" }, cta);
      btn.onclick = () => { haptic(); step(`gate_${key}`); if (tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank"); };
      const row = h("div", { class: "gate-row" },
        h("span", { class: "gate-ic", "aria-hidden": "true" }, svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: key === "channel" ? "M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1ZM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" : "M5 18l-1.5 3.5L8 20a8 8 0 1 0-3-2ZM8.5 10.5h7M8.5 13.5h4.5" }))),
        h("div", { class: "grow" }, h("b", {}, title), h("span", {}, sub)),
        btn);
      return { row, btn };
    };
    const ch = rowFor("channel", "Канал DotaRazbor", "Разборы, советы, обновления бота", COMMUNITY.channel_url, "Подписаться");
    const chat = rowFor("chat", "Чат DotaRazbor", "Кидай разборы, спрашивай, общайся", COMMUNITY.chat_url, "Вступить");
    const paint = () => {
      for (const [r, okNow] of [[ch, state.channel], [chat, state.chat]]) {
        r.row.classList.toggle("done", Boolean(okNow));
        r.btn.textContent = okNow ? "Готово" : r === ch ? "Подписаться" : "Вступить";
        r.btn.disabled = Boolean(okNow);
      }
    };
    let busy = false;
    const recheck = async (manual) => {
      if (busy) return;
      busy = true;
      if (manual) status.textContent = "Проверяю…";
      state = await checkGate();
      busy = false;
      paint();
      if (state.ok) {
        haptic("medium");
        step("gate_pass");
        if (!state.unknown) safeLocal.set("gate_ok", String(Date.now() + GATE_TTL));
        document.removeEventListener("visibilitychange", onBack);
        document.body.classList.remove("gated");
        done();
        return;
      }
      if (manual) status.textContent = !state.channel && !state.chat ? "Пока не вижу подписки ни на канал, ни на чат." : !state.channel ? "Осталось подписаться на канал." : "Осталось вступить в чат.";
    };
    // вернулся из канала или чата — проверяем сами, без лишнего нажатия
    const onBack = () => { if (!document.hidden) setTimeout(() => recheck(false), 400); };
    document.addEventListener("visibilitychange", onBack);
    const check = h("button", { type: "button", class: "gate-check" }, "Я подписался — проверить");
    check.onclick = () => { haptic(); recheck(true); };
    paint();
    render(
      h("div", { class: "gate" },
        h("div", { class: "app-top" }, aegis(), h("div", { class: "t" }, h("h1", {}, "Последний шаг"), h("p", {}, "Бот бесплатный — подпишись на канал и вступи в чат, и разбор откроется"))),
        h("div", { class: "card gate-card" }, ch.row, chat.row),
        check, status,
        h("p", { class: "small muted" }, "После подписки вернись сюда: проверю сам за секунду.")));
  });
}

// Один раз за запуск: повтор boot после ошибки сети не должен второй раз собирать панель и вешать «Назад»
let booted = false;

// Необязательные данные: без них разбор работает по общим порогам. Промис не падает
let extrasReady = null;
function loadExtras() {
  const optional = (url, fallback) => fetch(url).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  return Promise.all([optional("rank_norms.json?v=4", {}), optional("khan_builds.json?v=1", null), optional("builds.json?v=1", null)])
    .then(([rn, kh, bl]) => { norms = rn || {}; guides = kh; builds = bl; });
}

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
    startStats();
    // Офлайн-кэш: открытые разборы и справочники работают без сети
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  booted = true;
  loading("Разжигаю огонь…");
  // проверка подписки идёт вместе с загрузкой справочников, экран ждёт только её итога
  const gate = passGate();
  // список каток главной качается вместе со справочниками, а не после них
  const early = startParams().matchId;
  if (early) { matchEarly = { id: early, p: api(`/matches/${early}`).catch(() => undefined) }; fetchReplay(early); }
  else storage.get("account_id").then((acc) => { if (acc) prefetchRecent(acc); }).catch(() => {});
  try {
    // всё одной волной: раньше нормы и сборки грузились по очереди после справочников
    // нормы по рангам и сборки (~400 КБ) нужны только разбору и драфту: главная их не ждёт, качаются в фоне
    if (!extrasReady) extrasReady = loadExtras();
    const [heroes, items, abilities, ids, kb, tx] = await Promise.all([
      constants("heroes"), localDict("items", 200), localDict("abilities", 1000),
      constants("item_ids"),
      ownJson("knowledge.json?v=12"), ownJson("texts.json?v=19"),
    ]);
    dictionary = createDictionary({ heroes, items, abilities });
    itemIds = ids;
    knowledge = kb;
    texts = tx;
  } catch {
    errorScreen("Не удалось загрузить справочники. Проверь интернет и попробуй ещё раз.", boot);
    return;
  }
  await gate;
  const { matchId, slot, account } = startParams();
  // ?account= из ссылки нужен только, чтобы найти игрока в матче: в привязку его не пишем.
  // Старый бот вшивал аккаунт в кнопку меню, и каждый запуск возвращал его поверх «Сменить»
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
