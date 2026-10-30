// Прогон приложения в настоящем браузере (Chromium через Playwright) на матче из fixtures.
// OpenDota и воркер тренера подменяются, Телеграма нет. Скриншоты экранов — в tests/ui/out/.
// Запуск: npm run test:ui   (UI_ONLY=home,overview — только эти шаги; UI_HEADED=1 — с окном)
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "tests", "ui", "out");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const gz = (n) => JSON.parse(gunzipSync(readFileSync(join(ROOT, "tests", "fixtures", n))).toString("utf8"));
const match = gz("match_9052987576.json.gz");
const constants = gz("constants.json.gz");
const proItems = gz("pro_items.json.gz");
const heroBench = gz("hero_bench.json.gz");
const ME = match.players[0];
const ACCOUNT = ME.account_id;

// ---------- статика docs/ ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = join(DOCS, path);
  if (!file.startsWith(DOCS) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- подменённая OpenDota ----------
const won = (p) => (p.player_slot < 128) === match.radiant_win;
const history = Array.from({ length: 24 }, (_, i) => ({
  match_id: match.match_id - 1000 * (i + 1), player_slot: i % 3 ? 0 : 130, radiant_win: i % 2 === 0, hero_id: i % 4 ? ME.hero_id : 74,
  kills: 3 + (i % 7), deaths: 4 + (i % 5), assists: 8 + (i % 6), duration: 1900 + i * 37, start_time: match.start_time - 86400 * (i + 1),
  game_mode: 22, gold_per_min: 380 + ((i * 37) % 140), xp_per_min: 450 + ((i * 29) % 120), last_hits: 90 + ((i * 13) % 80),
}));
// Свежая катка: закончилась пару часов назад, чтобы на главной был блок «Последняя катка»
const recent = [{ match_id: match.match_id, player_slot: ME.player_slot, radiant_win: match.radiant_win, hero_id: ME.hero_id,
  kills: ME.kills, deaths: ME.deaths, assists: ME.assists, duration: match.duration, start_time: Math.floor(Date.now() / 1000) - match.duration - 7200, game_mode: match.game_mode,
  gold_per_min: ME.gold_per_min, xp_per_min: ME.xp_per_min, last_hits: ME.last_hits }, ...history.slice(0, 19)];
const itemIds = Object.fromEntries(Object.keys(constants.items).map((k) => [k, k]));
let hideMatches = false; // шаг «hidden»: в Доте закрыты данные матчей
function opendota(url) {
  const p = url.pathname.replace(/^\/api/, "");
  if (p === "/constants/heroes") return constants.heroes;
  if (p === "/constants/items") return constants.items;
  if (p === "/constants/abilities") return constants.abilities;
  if (p === "/constants/item_ids") return itemIds;
  if (p === `/matches/${match.match_id}`) return match;
  let m;
  if ((m = /^\/heroes\/(\d+)\/itemPopularity$/.exec(p))) return { early_game_items: proItems[m[1]] || {} };
  if ((m = /^\/heroes\/(\d+)\/matchups$/.exec(p))) return match.players.filter((x) => x.isRadiant !== ME.isRadiant)
    .map((x, i) => ({ hero_id: x.hero_id, games_played: 120, wins: 50 + i * 4 }));
  if (p === "/benchmarks") return { result: heroBench[url.searchParams.get("hero_id")] || {} };
  if (p === `/players/${ACCOUNT}`) return { profile: { personaname: "Ax3|", avatarfull: null }, rank_tier: 22 };
  if (p === `/players/${ACCOUNT}/wl`) return { win: 12, lose: 10 };
  if (p === `/players/${ACCOUNT}/recentMatches`) return hideMatches ? [] : recent;
  if (p === `/players/${ACCOUNT}/heroes`) {
    if (url.searchParams.get("hero_id")) return match.players.filter((x) => x.isRadiant !== ME.isRadiant).map((x, i) => ({ hero_id: x.hero_id, against_games: 6 + i, against_win: 3 + (i % 3) }));
    return [{ hero_id: ME.hero_id, games: 48, win: 26 }, { hero_id: 74, games: 22, win: 9 }, { hero_id: 21, games: 15, win: 8 }, { hero_id: 65, games: 9, win: 3 }];
  }
  if (p === `/players/${ACCOUNT}/matches`) {
    const hero = Number(url.searchParams.get("hero_id")) || null;
    const days = Number(url.searchParams.get("date")) || 0;
    // свежие игры: первые сыграны в последние дни, чтобы «Неделя» было с чем считать
    return history.map((x, i) => (days ? { ...x, start_time: Math.floor(Date.now() / 1000) - 86400 * (i * 0.6 + 0.5) } : x))
      .filter((x) => (!hero || x.hero_id === hero) && (!days || Date.now() / 1000 - x.start_time < days * 86400));
  }
  if (p === "/scenarios/itemTimings") {
    // по каждому купленному предмету — корзины по 5 минут
    const keys = [...new Set((ME.purchase_log || []).map((x) => x.key))];
    return keys.flatMap((item, i) => [900, 1200, 1500, 1800, 2100, 2400].map((time, j) => ({ hero_id: ME.hero_id, item, time, games: String(5 + ((i + j * 3) % 9)), wins: String(2 + ((i + j) % 5)) })));
  }
  if (p.startsWith("/request/") || p.endsWith("/refresh")) return {};
  // другие игроки (друзья): профиль и последние игры, у друга винрейт выше
  if ((m = /^\/players\/(\d+)$/.exec(p))) return { profile: { personaname: `Друг ${m[1].slice(-3)}` }, rank_tier: 34 };
  if ((m = /^\/players\/(\d+)\/recentMatches$/.exec(p))) return history.slice(0, 20).map((x, i) => ({ ...x, radiant_win: i % 3 !== 0, player_slot: 0 }));
  return null;
}

// ---------- подменённый воркер тренера ----------
const COACH_TEXT = `Главное: дороже всего стоили смерти в куче с командой: Tiny ловил тебя в одной точке с союзниками.

Моменты:
— 17:08 Ошибка: умер в драке первым при равном золоте, и следом команда отдала перевес. Надо было: держать дистанцию от своих, чтобы Beastmaster не зацепил сразу нескольких.
— 18:38 Ошибка: снова умер от Tiny при одном обсе, и без тебя враги сломали T2 на боте. Надо было: сначала поставить обс у входа и не стоять в одной точке с командой.

План на следующую игру:
— В каждой драке держи дистанцию от команды: Tiny ищет кучу.
— Перед дракой ставь обс у входа в лес.
— Купи Glimmer Cape: 55% урона по тебе магией.`;
function coach(body) {
  const raw = JSON.parse(body || "{}");
  if (raw.mode === "chat") return { text: `По сводке: ${String(raw.question).slice(0, 40)} — держи дистанцию от Tiny и ставь обс перед дракой.`, offtopic: false };
  if (raw.mode === "compare") return { text: "Разница: в лучшей катке ты меньше умирал.\n— Меньше смертей до 10:00.\n— Больше обсов.\n— Раньше BKB." };
  if (raw.mode === "card") {
    // тот же предел, что у воркера (MAX_CARD_BYTES)
    const bytes = Math.floor(String(raw.image || raw.png || "").replace(/^data:image\/(png|jpeg);base64,/, "").length * 0.75);
    cardSizes.push(bytes);
    if (bytes > 700000) errors.push(`карточка ${bytes} байт больше предела воркера 700000`);
    return { url: "https://coach.example/card/000000000000000000000000.png" };
  }
  if (raw.mode === "watch") return { ok: true };
  if (raw.mode === "gate") return gateCalls++ === 0 ? { ok: false, channel: true, chat: false } : { ok: true, channel: true, chat: true };
  if (raw.mode === "feedback") return { ok: true };
  // платный тренер: в шаге paywall пробные кончились, пока не «оплатят» в окне Телеграма
  const PACKS = [{ id: "p10", stars: 49, title: "10 разборов тренера", credits: 10, days: 0 }, { id: "month", stars: 129, title: "Тренер на месяц", credits: 0, days: 30 }];
  if (raw.mode === "wallet") return { credits: pay.paid ? 10 : 0, free_left: 0, until: 0, sub_left: 0, packs: PACKS, cards: true };
  if (raw.mode === "pay_link") return { url: "https://bezzz22.github.io/KORPl/pay.html#t=8.9999999999.Ax.axel.0123456789abcdef0123456789abcdef" };
  if (raw.mode === "buy") return { link: `https://t.me/$inv_${raw.pack}` };
  if (pay.on && !pay.paid) return { __status: 402, error: "Бесплатные разборы тренера закончились. Возьми пакет или подписку, и тренер продолжит.", paywall: true, wallet: { credits: 0, free_left: 0, until: 0, sub_left: 0, packs: PACKS, cards: true } };
  return { text: COACH_TEXT, ...(pay.on ? { wallet: { credits: 9, free_left: 0, until: 0, sub_left: 0, packs: PACKS } } : {}) };
}

// Настоящий разбор реплея этого матча (GitHub Actions + odota/parser)
const REPLAY = gz("replay_9052987576.json.gz");
// UI_REPLAY_BROKEN=1 — кривой файл позиций: трёх героев нет, у остальных дыры и обрезанный конец (вылет из игры, сбой парсера)
if (process.env.UI_REPLAY_BROKEN) {
  const slots = Object.keys(REPLAY.pos);
  for (const s of slots.slice(5, 8)) delete REPLAY.pos[s];
  for (const s of Object.keys(REPLAY.pos)) {
    const tr = REPLAY.pos[s];
    REPLAY.pos[s] = tr.slice(0, Math.floor(tr.length * (0.4 + Math.random() * 0.6))).map((p, i) => (i % 7 < 3 ? null : p));
  }
  delete REPLAY.heroes[slots[1]];
}
const PLACEHOLDER = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const errors = [];
const cardSizes = [];
let gateCalls = 0;
const pay = { on: false, paid: false };
// запросы из service worker тоже идут через подмену, иначе офлайн-проверка зависит от живой OpenDota
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const browser = await chromium.launch({ headless: !process.env.UI_HEADED, ...(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {}) });
const context = await browser.newContext({
  // UI_WIDTH=320 — проверить узкий телефон
  viewport: { width: Number(process.env.UI_WIDTH) || 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "ru-RU", serviceWorkers: "block",
  colorScheme: "dark", reducedMotion: process.env.UI_MOTION ? "no-preference" : "reduce",
});
// Привязанный аккаунт и одна уже открытая раньше катка, чтобы было с чем сравнить
// UI_DESIGN=v2 — прогон нового дизайна (тёмный минимал), иначе классика
await context.addInitScript(([acc, other, design]) => {
  try {
    if (design) localStorage.setItem("design", design);
    localStorage.setItem("account_id", String(acc));
    if (!localStorage.getItem(`cmp:${acc}`)) localStorage.setItem(`cmp:${acc}`, JSON.stringify([other]));
    // задача с прошлой катки: не больше одной смерти до 10:00 (у Tusk в этой катке две — провал)
    if (!localStorage.getItem(`goal:${acc}`)) localStorage.setItem(`goal:${acc}`, JSON.stringify({ text: "Цель на следующую катку: не больше одной смерти до 10:00", check: { group: "lane_deaths", metric: "lane_deaths", op: "<=", target: 1 }, match: 1, t: 1000 }));
  } catch { /* */ }
}, [ACCOUNT, { match: 1, hero: "Invoker", hero_id: 74, won: true, kda: "12/3/9", t: 0, payload: { hero: "Invoker", won: true, kda: "12/3/9", duration: "41:02" } }, process.env.UI_DESIGN || ""]);
let netDown = false;
const localFailed = new Set();
let busyOnce = false; // офлайн-проверка: все запросы рвутся, как без сети
async function handleRoute(route) {
  if (netDown) return route.abort("internetdisconnected");
  const url = new URL(route.request().url());
  // UI_LOCAL_FAIL=texts.json,items.json — свои справочники не отдались с первого раза (мобильная сеть, GitHub Pages
  // моргнул): приложение должно повторить или взять запасной путь, а не показать ошибку. UI_LOCAL_FAIL_ALL=1 — всегда
  const flaky = url.origin === BASE && process.env.UI_LOCAL_FAIL && process.env.UI_LOCAL_FAIL.split(",").find((f) => url.pathname.endsWith(`/${f}`));
  if (flaky && (process.env.UI_LOCAL_FAIL_ALL || !localFailed.has(flaky))) { localFailed.add(flaky); return route.fulfill({ status: 503, body: "" }); }
  if (url.origin === BASE) return route.continue();
  if (url.hostname === "api.opendota.com") {
    // UI_CONSTANTS_DOWN=1: справочники OpenDota отдают 503, приложение должно взять их с зеркала
    if (process.env.UI_CONSTANTS_DOWN && url.pathname.startsWith("/api/constants/")) return route.fulfill({ status: 503, body: "" });
    // шаг «busy»: OpenDota под нагрузкой один раз отвечает 429
    if (busyOnce && url.pathname.endsWith("/recentMatches")) { busyOnce = false; return route.fulfill({ status: 429, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" }); }
    const data = opendota(url);
    return data === null ? route.fulfill({ status: 404, body: "{}" }) : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  }
  // запасной путь к OpenDota через воркер (/od/...) отвечает тем же, что OpenDota
  if (url.hostname.endsWith("workers.dev") && url.pathname.startsWith("/od/")) {
    const data = opendota(new URL(`https://api.opendota.com/api${url.pathname.slice(3)}${url.search}`));
    return data === null ? route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" }) : route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(data) });
  }
  if (url.hostname.endsWith("workers.dev")) {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" } });
    const { __status, ...out } = coach(route.request().postData());
    return route.fulfill({ status: __status || 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(out) });
  }
  if (url.hostname === "raw.githubusercontent.com") {
    const mirror = url.pathname.match(/^\/odota\/dotaconstants\/master\/build\/(\w+)\.json$/);
    if (mirror) return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(opendota(new URL(`https://api.opendota.com/api/constants/${mirror[1]}`))) });
    return url.pathname.endsWith(`/r/${match.match_id}.json`) ? route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(REPLAY) }) : route.fulfill({ status: 404, body: "" });
  }
  if (url.hostname === "telegram.org") return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  // UI_IMAGES=1 — настоящие картинки Steam (посмотреть вид глазами), иначе заглушка
  if (/steamstatic\.com$/.test(url.hostname)) return process.env.UI_IMAGES ? route.continue() : route.fulfill({ status: 200, contentType: "image/png", body: PLACEHOLDER });
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return process.env.UI_OFFLINE ? route.abort() : route.continue();
  return route.abort();
}
await context.route("**/*", handleRoute);

const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror",(e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  // предупреждения GSAP: сломанный твин (пятно за пальцем перестало ходить из-за gsap.set поверх quickTo)
  if (m.type() === "warning" && /not eligible for reset|Invalid property|GSAP target .* not found/.test(m.text()) && !errors.some((x) => x.endsWith(m.text()))) errors.push(`gsap: ${m.text()}`);
});

const only = process.env.UI_ONLY ? new Set(process.env.UI_ONLY.split(",")) : null;
const shots = [];
async function shot(name, { full = true } = {}) {
  if (only && !only.has(name)) return;
  await page.waitForTimeout(350);
  const file = join(OUT, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: full && !process.env.UI_VIEWPORT });
  shots.push(file);
}
// После каждого шага: на экране не должно быть служебного мусора вроде «undefined» или «NaN»
const step = async (name, fn) => {
  // UI_MONKEY_ONLY=1 — только главная и обезьяна, без остального набора
  if (process.env.UI_MONKEY_ONLY && name !== "home" && name !== "monkey") return;
  try { await fn(); } catch (e) { errors.push(`${name}: ${e.message.split("\n").slice(0, process.env.UI_DEBUG ? 12 : 1).join("\n")}`); }
  // вёрстка не шире экрана: иначе страница ездит вбок
  const wide = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 1) return null;
    const el = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== "fixed")
      .sort((x, y) => y.getBoundingClientRect().right - x.getBoundingClientRect().right)[0];
    return el ? `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ").join(".")} (${Math.round(el.getBoundingClientRect().right)} > ${innerWidth})` : "?";
  }).catch(() => null);
  if (wide) errors.push(`${name}: шире экрана: ${wide}`);
  // UI_A11Y=1 — кнопки и ссылки без имени: диктор VoiceOver читает их как «кнопка» без смысла
  if (process.env.UI_A11Y) {
    const unnamed = await page.evaluate(() => [...document.querySelectorAll("button, a[href], [role=button]")]
      .filter((e) => e.offsetParent !== null && !(e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent.trim() || e.querySelector("img[alt]:not([alt=''])")))
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").join(".")}`)).catch(() => []);
    if (unnamed.length) errors.push(`${name}: без имени для диктора: ${[...new Set(unnamed)].join(", ")}`);
  }
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  // регистр важен: утёкшие значения JS пишутся строчными, а «Gem of True Sight» — название предмета
  const junk = /(^|[^a-zA-Zа-яё])(undefined|NaN|null|false|true|\[object Object\])([^a-zA-Zа-яё]|$)/.exec(text);
  if (junk) errors.push(`${name}: на экране «${junk[2]}»: …${text.slice(Math.max(0, junk.index - 60), junk.index + 40).replace(/\s+/g, " ")}…`);
};

await step("home", async () => {
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector(".match-item", { timeout: 15000 });
  await shot("home");
  // UI_AEGIS=1 — кадры 3D-Аегиса в разных фазах вращения (посмотреть объём и оборот)
  if (process.env.UI_AEGIS) {
    // щит застывает на угле: анфас, вбок, ребром, сзади и наискосок (поворот по двум осям)
    await page.waitForSelector(".app-top .aegis.ready", { timeout: 10000 });
    for (const angle of [0, 40, 90, 180, 300, [35, 30], [-50, -40], [0, 80], 270, [90, 15]]) {
      await page.evaluate((a) => document.querySelector(".app-top .aegis").aegisPose(a), angle);
      await page.waitForTimeout(120);
      await page.locator(".app-top .aegis").screenshot({ path: join(OUT, `aegis-${[].concat(angle).join("_")}.png`) });
    }
    await page.evaluate(() => document.querySelector(".app-top .aegis").aegisPose(null));
  }
});
// Приложение не запустилось (синтаксис, импорт): дальше каждый шаг ждал бы таймаут, падаем сразу
if (errors.some((e) => e.startsWith("pageerror")) && !(await page.$(".app-top"))) {
  console.error(errors.join("\n"));
  await browser.close();
  process.exit(1);
}
await step("showcase", async () => {
  // тап по Аегису — витрина; Sketchfab в тесте недоступен, поэтому вместо вечной загрузки должен крутиться свой щит
  await page.locator(".app-top .aegis").click();
  await page.waitForSelector(".showcase", { timeout: 3000 });
  // телефон (сенсор): живую модель Sketchfab не качаем вовсе — она роняла Телеграм на айфоне по памяти
  await page.waitForSelector(".sc-stage.local .aegis.sc-local", { timeout: 1500 });
  if (await page.evaluate(() => Boolean(document.querySelector(".showcase iframe")))) throw new Error("витрина на телефоне держит iframe Sketchfab");
  // щит на главной под витриной стоит, а не рисует впустую
  await page.waitForFunction(() => !document.querySelector(".app-top .aegis").aegisState().running, null, { timeout: 2000 });
  for (const name of ["Сбоку", "Сзади", "Спереди", "Поднять Аегис"]) await page.evaluate((n) => [...document.querySelectorAll(".showcase button")].find((b) => b.textContent === n).click(), name);
  await shot("showcase");
  await page.locator(".showcase .sc-head button").click();
  await page.waitForSelector(".showcase", { state: "detached", timeout: 3000 });
  await page.waitForFunction(() => document.querySelector(".app-top .aegis").aegisState().running, null, { timeout: 2000 });
  // открыть-закрыть десять раз подряд: контексты WebGL отдаются сразу, щит на главной живой
  for (let i = 0; i < 10; i++) await page.evaluate(() => { document.querySelector(".app-top .aegis").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); document.querySelector(".showcase .sc-head button").click(); });
  await page.waitForFunction(() => document.querySelector(".app-top .aegis.ready") && document.querySelector(".app-top .aegis").aegisState().running, null, { timeout: 2000 });
});
await step("overview", async () => {
  // свежая катка открывается из большого блока сверху
  await page.locator(".fresh-match").click();
  await page.waitForSelector(".hero-head", { timeout: 20000 });
  await shot("overview");
});
// ссылка из бота (?match=): матч качается со старта, разбор открывается сразу, без главной
await step("deeplink", async () => {
  const p5 = await context.newPage();
  const asked = [];
  p5.on("request", (r) => { if (r.url().includes(`/api/matches/${match.match_id}`)) asked.push(r.url()); });
  await p5.goto(`${BASE}/index.html?match=${match.match_id}`);
  await p5.waitForSelector(".hero-head", { timeout: 20000 });
  if (asked.length !== 1) throw new Error(`матч запрошен ${asked.length} раз вместо одного`);
  await p5.close();
});
// OpenDota ответила 429: приложение повторяет запрос и всё равно показывает катки
await step("busy", async () => {
  busyOnce = true;
  const p6 = await context.newPage();
  await p6.goto(`${BASE}/index.html`);
  await p6.waitForSelector(".match-item", { timeout: 20000 });
  if (busyOnce) throw new Error("429 не случился — шаг ничего не проверил");
  await p6.close();
});
// Круги по экранам (драфт, разбор со всеми вкладками, профиль, герой): старые экраны не должны копиться в памяти
// (медаль и 3D-карта держали их слушателем документа, медаль — ещё и таймером). Клики через evaluate: хэндлы Playwright сами держат узлы
await step("leak", async () => {
  const pl = await context.newPage();
  const cdp = await context.newCDPSession(pl);
  await cdp.send("Performance.enable");
  const nodes = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const m = await cdp.send("Performance.getMetrics");
    return m.metrics.find((x) => x.name === "Nodes").value;
  };
  const click = (sel, text) => pl.evaluate(([s, t]) => [...document.querySelectorAll(s)].find((x) => !t || x.textContent.trim() === t).click(), [sel, text]);
  const wait = (sel) => pl.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: 20000 }).then((h) => h.dispose());
  await pl.goto(`${BASE}/index.html`);
  await wait(".fresh-match");
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await click(".draft-entry");
    await pl.waitForTimeout(1500);
    await click('.tabbtn[data-tab="home"]');
    await wait(".fresh-match");
    await click(".fresh-match");
    await wait(".hero-head");
    // все вкладки разбора: на них карта, графики и 3D-стол
    const tabs = await pl.evaluate(() => document.querySelectorAll(".tabs .tab").length);
    for (let t = 0; t < tabs; t++) {
      await pl.evaluate((k) => { const x = document.querySelectorAll(".tabs .tab")[k]; if (x) x.click(); }, t);
      await pl.waitForTimeout(500);
    }
    await click('.tabbtn[data-tab="profile"]');
    await pl.waitForTimeout(1000);
    await pl.evaluate(() => { const x = document.querySelector(".hero-stat"); if (x) x.click(); });
    await pl.waitForTimeout(1000);
    await click('.tabbtn[data-tab="home"]');
    await wait(".fresh-match");
    await pl.waitForTimeout(2300);
    seen.push(await nodes());
  }
  await pl.close();
  if (seen[3] - seen[0] > 300) throw new Error(`узлы DOM копятся при переходах: ${seen.join(" → ")}`);
});

await step("goal", async () => {
  // задача с прошлой катки проверена по этой: у Tusk две смерти до 10:00 — не вышло
  const text = await page.locator(".goal-result").innerText();
  if (!/Не вышло/.test(text) || !/В этой катке: 2/.test(text)) throw new Error(`проверка задачи: ${text.replace(/\s+/g, " ")}`);
  await page.locator(".goal-card").scrollIntoViewIfNeeded();
  await shot("goal", { full: false });
});
await step("share", async () => {
  await page.locator(".share").click();
  await page.waitForSelector(".sheet-preview img", { timeout: 15000 });
  await shot("share", { full: false });
  // загрузка картинки в воркер: размер не должен упираться в предел
  await page.locator(".sheet-btn").first().click();
  await page.waitForFunction(() => !document.querySelector(".sheet-status-busy"), null, { timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 40 && !cardSizes.length; i++) await page.waitForTimeout(100);
  if (!cardSizes.length) throw new Error("карточка не ушла в воркер");
  console.log(`карточка: ${cardSizes[0]} байт`);
  await page.locator(".sheet-close").click();
  await page.waitForSelector(".sheet-backdrop", { state: "detached", timeout: 5000 });
});
await step("coach", async () => {
  await page.locator(".coach-btn").click();
  await page.waitForSelector(".coach-moment", { timeout: 10000 });
  await shot("coach");
});
await step("chat", async () => {
  const input = page.locator(".chat-input");
  if (!(await input.count())) throw new Error("нет поля чата");
  await input.fill("что делать против Tiny?");
  await page.locator(".chat-send").click();
  await page.waitForSelector(".chat-msg.assistant", { timeout: 10000 });
  await page.locator(".chat").scrollIntoViewIfNeeded();
  await shot("chat", { full: false });
});
await step("chip", async () => {
  const before = await page.locator(".chat-msg.assistant").count();
  await page.locator(".chat-chip").first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".chat-msg.assistant:not(.typing)").length > n, before, { timeout: 10000 });
});
// Свайп по ряду чипсов листает чипсы, а не вкладки разбора; свайп по обычному тексту листает вкладки
await step("swipe", async () => {
  const activeTab = () => page.evaluate(() => [...document.querySelectorAll(".tab")].findIndex((t) => t.classList.contains("active")));
  const swipe = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(r.right - 20)], changedTouches: [touch(r.right - 20)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [touch(r.right - 160)] }));
  }, selector);
  const start = await activeTab();
  await swipe(".chat-chips");
  if ((await activeTab()) !== start) throw new Error("свайп по чипсам переключил вкладку");
  await swipe(".coach-title");
  if ((await activeTab()) !== start + 1) throw new Error("свайп по тексту не переключил вкладку");
  await page.evaluate(() => document.querySelector(".tab").click());
});
await step("compare", async () => {
  await page.locator(".compare summary").click();
  await page.locator(".compare-item").first().click();
  await page.waitForSelector(".compare-out p", { timeout: 10000 });
  await page.locator(".compare").scrollIntoViewIfNeeded();
  await shot("compare", { full: false });
});
await step("moment-ask", async () => {
  await page.locator(".tabs .tab").nth(2).click();
  const before = await page.locator(".chat-msg.assistant").count();
  await page.locator("summary", { hasText: "Хронология" }).click();
  await page.locator(".moment.askable").first().click();
  // вопрос уходит в чат на «Обзоре»
  await page.waitForFunction((n) => document.querySelectorAll(".chat-msg.assistant:not(.typing)").length > n, before, { timeout: 10000 });
  await page.locator(".tabs .tab").nth(0).click();
});
for (const [i, name] of ["blame", "phases", "deaths", "map", "build", "charts"].entries()) {
  await step(name, async () => {
    await page.locator(".tabs .tab").nth(i + 1).click();
    await page.waitForTimeout(250);
    await shot(name);
    if (name === "map") {
      // повтор: все десять героев на карте в разгар драки, плей двигает время
      await page.waitForSelector(".live-map .lm-h[display=inline]", { timeout: 5000 });
      const heroes = await page.evaluate(() => { document.querySelector(".live-map").seek(1030); return document.querySelectorAll(".lm-h[display=inline]").length; });
      if (heroes < 8 && !process.env.UI_REPLAY_BROKEN) throw new Error(`на карте героев: ${heroes}`);
      await page.locator(".live-map").scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.locator(".live-card").screenshot({ path: join(OUT, "map-live.png") });
      const before = await page.locator(".lm-clock").innerText();
      await page.locator(".lm-play").click();
      await page.waitForTimeout(600);
      await page.locator(".lm-play").click();
      if ((await page.locator(".lm-clock").innerText()) === before) throw new Error("плей не двигает время");
      // перемотка пальцем: тап в любое место шкалы и протяжка, не только по ручке
      const box = await page.locator(".lm-scrub").boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      const atTap = await page.locator(".lm-clock").innerText();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      const atDrag = await page.locator(".lm-clock").innerText();
      const sec = (c) => c.split(":").reduce((m, x) => m * 60 + Number(x), 0);
      if (!(sec(atDrag) > sec(atTap) + 300)) throw new Error(`протяжка по шкале: ${atTap} → ${atDrag}`);
      if (!(await page.locator(".tab.active").first().innerText()).includes("Карт")) throw new Error("протяжка по шкале увела на другую вкладку");
      // тактический стол: тап мышью по столбу показывает, что там было (захват пальца раньше уводил клик столу)
      if (await page.$(".m3d .m3d-pin.death")) {
        const pin = await page.evaluate(() => {
          const el = document.querySelector(".m3d .m3d-pin.death .m3d-cap"); el.scrollIntoView({ block: "center" });
          const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        await page.mouse.click(pin.x, pin.y);
        const info = await page.locator(".m3d-info").innerText();
        if (!/Смерт|смерти|Обс/.test(info)) throw new Error(`тап по столбу не показал, что там: «${info}»`);
      }
      // слежение за героем: карта приближается
      await page.evaluate(() => document.querySelector(".live-map").seek(1000));
      await page.locator(".lm-follow").click();
      if ((await page.locator(".minimap.live").getAttribute("viewBox")) === "0 0 128 128") throw new Error("«Следить» не приближает карту");
      await page.locator(".live-card").screenshot({ path: join(OUT, "map-follow.png") });
      await page.locator(".lm-follow").click();
      // UI_PERF=1: кадры повтора на слабом телефоне (процессор замедлен в 4 раза)
      if (process.env.UI_PERF) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        // seek рисует ровно один кадр: меряем свой код и пересчёт вёрстки (rAF в безоконном браузере не показателен)
        const gaps = await page.evaluate(() => {
          const map = document.querySelector(".live-map"), out = [];
          for (let i = 0; i < 60; i++) {
            const t0 = performance.now();
            map.seek(600 + i * 20);
            document.querySelector(".minimap.live").getBoundingClientRect();
            out.push(performance.now() - t0);
          }
          return out;
        });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        gaps.sort((x, y) => x - y);
        console.log(`повтор, кадр при CPU x4: медиана ${gaps[30].toFixed(1)} мс, 95% ${gaps[57].toFixed(1)} мс`);
      }
    }
  });
}
await step("draft", async () => {
  await page.locator('.tabbtn[data-tab="home"]').click();
  await page.locator(".draft-entry").click();
  await page.waitForSelector(".draft-hero", { timeout: 10000 });
  // сетка как в Доте: Сила, Ловкость, Интеллект, Универсальные; портреты без подписей
  const blocks = await page.locator(".attr-block .draft-attr").allTextContents();
  if (blocks.join(",") !== "Сила,Ловкость,Интеллект,Универсальные") throw new Error(`блоки атрибутов: ${blocks}`);
  if (process.env.UI_IMAGES) {
    // все портреты сразу, а не по мере прокрутки; потом список тех, что не загрузились
    await page.evaluate(() => document.querySelectorAll(".hero-vert").forEach((i) => { i.loading = "eager"; }));
    await page.waitForTimeout(6000);
    const broken = await page.evaluate(() => [...document.querySelectorAll(".hero-vert")]
      .filter((i) => !i.complete || !i.naturalWidth || i.classList.contains("img-missing")).map((i) => `${i.alt} ${i.src}`));
    console.log(`портретов без картинки: ${broken.length}${broken.length ? `\n${broken.join("\n")}` : ""}`);
  }
  await shot("draft-grid");
  for (const name of ["Tiny", "Clinkz", "Enigma"]) {
    await page.locator('input[type="search"]').fill(name);
    await page.locator(`.draft-hero[aria-label="${name}"]`).first().click();
  }
  await page.locator(".draft-go").click();
  await page.waitForSelector(".draft-row", { timeout: 15000 });
  await shot("draft");
});
await step("profile", async () => {
  await page.locator('.tabbtn[data-tab="profile"]').click();
  await page.waitForSelector(".profile-card", { timeout: 10000 });
  await shot("profile");
});
await step("friends", async () => {
  await page.locator(".friend-add input").fill("123456789");
  await page.locator(".friend-add button").click();
  await page.waitForFunction(() => document.querySelectorAll(".leader-row").length >= 2, null, { timeout: 15000 });
  // друг с винрейтом 65% выше тебя
  const first = await page.locator(".leader-row").first().innerText();
  if (!/Друг 789/.test(first)) throw new Error(`рейтинг: ${first.replace(/\s+/g, " ")}`);
  await page.locator(".leaderboard").scrollIntoViewIfNeeded();
  await shot("friends", { full: false });
});
await step("hero", async () => {
  await page.locator(".hero-stat").first().click();
  await page.waitForSelector(".page-head", { timeout: 10000 });
  await shot("hero");
});

// Матчи скрыты в настройках Доты: инструкция по шагам, «Проверить снова» без матчей — подсказка, с матчами — список
if (!only || only.has("hidden")) {
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx3.addInitScript((acc) => { try { localStorage.setItem("account_id", String(acc)); } catch { /* */ } }, ACCOUNT);
  await ctx3.route("**/*", handleRoute);
  const p3 = await ctx3.newPage();
  p3.on("pageerror", (e) => errors.push(`hidden pageerror: ${e.message}`));
  await step("hidden", async () => {
    hideMatches = true;
    await p3.goto(`${BASE}/index.html`);
    await p3.waitForSelector(".hidden-matches .steps li", { timeout: 15000 });
    await p3.locator(".hidden-matches button").click();
    await p3.waitForFunction(() => /Пока пусто/.test(document.querySelector(".hidden-matches [role=status]").textContent), null, { timeout: 10000 });
    await p3.waitForTimeout(300);
    const file = join(OUT, `${String(shots.length + 1).padStart(2, "0")}-hidden.png`);
    await p3.screenshot({ path: file, fullPage: true });
    shots.push(file);
    hideMatches = false;
    await p3.locator(".hidden-matches button").click();
    await p3.waitForSelector(".match-item", { timeout: 10000 });
  });
  hideMatches = false;
  await ctx3.close();
}

// Вход из Телеграма без подписки на чат: экран «Последний шаг», после подписки пускает на главную
if (!only || only.has("gate")) {
  const ctx5 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx5.addInitScript((acc) => {
    try { localStorage.setItem("account_id", String(acc)); } catch { /* */ }
    const noop = () => {};
    window.Telegram = { WebApp: { initData: "query_id=test", initDataUnsafe: {}, platform: "test", ready: noop, expand: noop, isVersionAtLeast: () => false,
      openTelegramLink: (u) => { window.__opened = u; }, BackButton: { show: noop, hide: noop, onClick: noop }, HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop } } };
  }, ACCOUNT);
  await ctx5.route("**/*", handleRoute);
  const p5 = await ctx5.newPage();
  p5.on("pageerror", (e) => errors.push(`gate pageerror: ${e.message}`));
  await step("gate", async () => {
    gateCalls = 0;
    await p5.goto(`${BASE}/index.html`);
    await p5.waitForSelector(".gate .gate-row", { timeout: 15000 });
    const done = await p5.locator(".gate-row.done").count();
    if (done !== 1) throw new Error(`отмечено готовых: ${done}, ждали канал`);
    await p5.locator(".gate-row:not(.done) .gate-btn").click();
    if (!/dotarazbor_chat/.test(await p5.evaluate(() => window.__opened || ""))) throw new Error("кнопка «Вступить» не открыла чат");
    const file = join(OUT, `${String(shots.length + 1).padStart(2, "0")}-gate.png`);
    await p5.screenshot({ path: file });
    shots.push(file);
    await p5.locator(".gate-check").click();
    await p5.waitForSelector(".match-item", { timeout: 15000 });
  });
  await ctx5.close();
}

// Платный тренер: пробные кончились — покупка звёздами в окне Телеграма, после оплаты разбор приходит сам
if (!only || only.has("paywall")) {
  const ctx8 = await browser.newContext({ viewport: { width: Number(process.env.UI_WIDTH) || 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx8.addInitScript((acc) => {
    try { localStorage.setItem("account_id", String(acc)); localStorage.setItem("gate_ok", String(Date.now() + 3600_000)); } catch { /* */ }
    const noop = () => {};
    window.Telegram = { WebApp: { initData: "query_id=test", initDataUnsafe: {}, platform: "test", ready: noop, expand: noop, isVersionAtLeast: () => true,
      setHeaderColor: noop, setBackgroundColor: noop, disableVerticalSwipes: noop, openTelegramLink: noop,
      openLink: (u) => { window.__link = u; },
      openInvoice: (link, cb) => { window.__invoice = link; setTimeout(() => { window.__pay(); cb("paid"); }, 50); },
      BackButton: { show: noop, hide: noop, onClick: noop }, HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop } } };
  }, ACCOUNT);
  await ctx8.exposeFunction("__pay", () => { pay.paid = true; });
  await ctx8.route("**/*", handleRoute);
  const p8 = await ctx8.newPage();
  p8.on("pageerror", (e) => errors.push(`paywall pageerror: ${e.message}`));
  await step("paywall", async () => {
    Object.assign(pay, { on: true, paid: false });
    await p8.goto(`${BASE}/index.html?match=${match.match_id}`);
    await p8.locator(".coach-btn").click({ timeout: 20000 });
    await p8.waitForSelector(".paywall .paywall-pack", { timeout: 10000 });
    const packs = await p8.locator(".paywall-pack").count();
    if (packs !== 2) throw new Error(`пакетов ${packs}, ждали 2`);
    await p8.locator(".paywall-card").click();
    await p8.waitForFunction(() => /pay\.html#t=/.test(window.__link || ""), null, { timeout: 5000 });
    await p8.locator(".paywall").scrollIntoViewIfNeeded();
    const file = join(OUT, `${String(shots.length + 1).padStart(2, "0")}-paywall.png`);
    await p8.screenshot({ path: file });
    shots.push(file);
    await p8.locator(".paywall-pack").first().click();
    await p8.waitForSelector(".coach-moment", { timeout: 15000 });
    if (!/inv_p10/.test(await p8.evaluate(() => window.__invoice || ""))) throw new Error("счёт не открылся");
    if (await p8.locator(".paywall").count()) throw new Error("после оплаты пейвол не убрался");
  });
  Object.assign(pay, { on: false, paid: false });
  await ctx8.close();
}

// Облако Телеграма не отвечает (колбэк CloudStorage не приходит): главная всё равно открывается с привязкой из localStorage
if (!only || only.has("cloud")) {
  const ctx7 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx7.addInitScript((acc) => {
    try { localStorage.setItem("account_id", String(acc)); localStorage.setItem("gate_ok", String(Date.now() + 3600_000)); } catch { /* */ }
    const noop = () => {};
    window.Telegram = { WebApp: { initData: "query_id=test", initDataUnsafe: {}, platform: "test", ready: noop, expand: noop, isVersionAtLeast: () => true,
      setHeaderColor: noop, setBackgroundColor: noop, disableVerticalSwipes: noop, openTelegramLink: noop,
      BackButton: { show: noop, hide: noop, onClick: noop }, HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      CloudStorage: { getItem: noop, setItem: noop } } };
  }, ACCOUNT);
  await ctx7.route("**/*", handleRoute);
  const p7 = await ctx7.newPage();
  p7.on("pageerror", (e) => errors.push(`cloud pageerror: ${e.message}`));
  await step("cloud", async () => {
    await p7.goto(`${BASE}/index.html`);
    await p7.waitForSelector(".match-item", { timeout: 15000 });
  });
  await ctx7.close();
}

// Без привязки: пример разбора открывается с главной, сверху плашка «Это пример»
if (!only || only.has("demo")) {
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx4.route("**/*", handleRoute);
  const p4 = await ctx4.newPage();
  p4.on("pageerror", (e) => errors.push(`demo pageerror: ${e.message}`));
  await step("demo", async () => {
    await p4.goto(`${BASE}/index.html`);
    await p4.locator(".demo-entry").click();
    await p4.waitForSelector(".demo-banner", { timeout: 20000 });
    await p4.waitForSelector(".hero-head", { timeout: 5000 });
    const file = join(OUT, `${String(shots.length + 1).padStart(2, "0")}-demo.png`);
    await p4.screenshot({ path: file });
    shots.push(file);
    // пример не пишет задачу и сравнение в память устройства
    const stored = await p4.evaluate(() => Object.keys(localStorage).filter((k) => /^(goal|cmp):/.test(k)));
    if (stored.length) throw new Error(`пример записал в память: ${stored}`);
  });
  // привязка: Friend ID, скопированный с пробелами, тоже подходит
  await step("link", async () => {
    await p4.goto(`${BASE}/index.html`);
    const spaced = String(ACCOUNT).replace(/(\d{3})(?=\d)/g, "$1 ");
    await p4.locator('input[aria-label="Friend ID"]').fill(spaced);
    await p4.locator('input[aria-label="Friend ID"] >> xpath=ancestor::div[contains(@class,"row")]//button').click();
    await p4.waitForSelector(".match-item", { timeout: 15000 });
  });
  await ctx4.close();
  // карта героя (только с анимацией): видна одна сторона, тап переворачивает на оборот
  const ctx6 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await ctx6.addInitScript(() => { try { localStorage.setItem("design", "v2"); } catch { /* */ } });
  await ctx6.route("**/*", handleRoute);
  const p6 = await ctx6.newPage();
  p6.on("pageerror", (e) => errors.push(`herocard pageerror: ${e.message}`));
  await step("herocard", async () => {
    await p6.goto(`${BASE}/index.html`);
    await p6.locator(".demo-entry").click();
    await p6.waitForSelector(".hero-banner.hc", { timeout: 20000 });
    const sides = () => p6.evaluate(() => [".hc-front", ".hc-back"].map((c) => getComputedStyle(document.querySelector(c)).visibility).join(","));
    if (await sides() !== "visible,hidden") throw new Error(`до тапа: ${await sides()}`);
    await p6.locator(".hero-banner.hc").click({ force: true });
    await p6.waitForFunction(() => getComputedStyle(document.querySelector(".hc-back")).visibility === "visible", null, { timeout: 3000 });
    await p6.waitForTimeout(1200);
    if (await sides() !== "hidden,visible") throw new Error(`после тапа: ${await sides()}`);
    const file = join(OUT, `${String(shots.length + 1).padStart(2, "0")}-herocard-back.png`);
    await p6.locator(".hero-banner.hc").screenshot({ path: file });
    shots.push(file);
  });
  await ctx6.close();
}

// UI_MONKEY=<число действий>: «обезьяна» тыкает куда попало — кнопки, вкладки, свайпы, «Назад», 3D-объекты —
// с анимациями и сбоями сети (часть ответов OpenDota 500 или с задержкой). Ловит падения JS и пустой экран
if (process.env.UI_MONKEY) {
  const N = Number(process.env.UI_MONKEY) || 300;
  let seed = Number(process.env.UI_SEED) || 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ctx7 = await browser.newContext({ viewport: { width: Number(process.env.UI_MONKEY_W) || 375, height: 667 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, locale: "ru-RU",
    serviceWorkers: "block", colorScheme: "dark", reducedMotion: "no-preference" });
  await ctx7.addInitScript((acc) => { try { localStorage.setItem("account_id", String(acc)); localStorage.setItem("gate_ok", String(Date.now() + 864e5)); } catch { /* */ } }, ACCOUNT);
  await ctx7.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "api.opendota.com" && !u.pathname.startsWith("/api/constants/")) {
      const r = rnd();
      if (r < 0.08) return route.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "" });
      // OpenDota иногда отдаёт {error} с кодом 200 вместо списка
      if (r < 0.11) return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "rate limited" }) });
      if (r < 0.16) await new Promise((res) => setTimeout(res, 1500));
    }
    return handleRoute(route);
  });
  const p7 = await ctx7.newPage();
  const log = [];
  p7.on("pageerror", (e) => errors.push(`monkey pageerror: ${e.message} (после: ${log.slice(-6).join(" → ")})`));
  p7.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|status of 500/.test(m.text())) errors.push(`monkey console: ${m.text()} (после: ${log.slice(-6).join(" → ")})`); });
  await step("monkey", async () => {
    await p7.goto(`${BASE}/index.html`);
    await p7.waitForSelector(".match-item", { timeout: 20000 });
    for (let i = 0; i < N; i++) {
      const r = rnd();
      const did = await p7.evaluate(([r, r2]) => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4 && b.bottom > 0 && b.top < innerHeight * 3; };
        const pool = [...document.querySelectorAll("button:not([disabled]), a[href]:not([href^=http]):not([target]), [role=button], [role=tab], .match-item, .tab, summary, .aegis, .m3d, .hc")]
          .filter(vis).filter((e) => !/Закрыть приложение|Оплатить|Купить|звёзд/i.test(e.textContent || ""));
        // «Назад» Телеграма: в браузере его нет, поэтому реже и только внутри приложения
        if (r < 0.03 && history.length > 2) { history.back(); return "back"; }
        if (r < 0.12) { window.scrollTo(0, r2 * document.body.scrollHeight); return "scroll"; }
        if (!pool.length) return "пусто";
        // нижняя панель видна всегда и съедала половину тапов: внутри экрана — в 85% случаев
        const inside = pool.filter((e) => !e.closest(".tabbar, nav"));
        const from = inside.length && r2 < 0.85 ? inside : pool;
        const el = from[Math.floor(((r2 * 7919) % 1) * from.length)];
        el.scrollIntoView({ block: "center" });
        const b = el.getBoundingClientRect();
        return { name: `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]}:${(el.textContent || "").trim().slice(0, 18)}`, x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, [r, rnd()]).catch(() => "переход");
      log.push(typeof did === "string" ? did : did.name);
      if (typeof did === "object") {
        const r3 = rnd(), { x, y } = did;
        // тап, свайп или долгое нажатие по выбранному элементу — по координатам, как пальцем
        try {
          if (r3 < 0.7) await p7.mouse.click(x, y);
          else if (r3 < 0.9) { await p7.mouse.move(x, y); await p7.mouse.down(); await p7.mouse.move(x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 100, { steps: 6 }); await p7.mouse.up(); }
          else { await p7.mouse.move(x, y); await p7.mouse.down(); await p7.waitForTimeout(700); await p7.mouse.up(); }
        } catch { /* элемент ушёл */ }
      }
      await p7.waitForTimeout(60 + rnd() * 300);
      // ушли со страницы приложения (about.html и т. п.) — назад в приложение
      if (!/index\.html/.test(p7.url())) { log.push(`ушёл на ${p7.url().split("/").pop()}`); await p7.goto(`${BASE}/index.html`).catch(() => {}); await p7.waitForTimeout(800); }
      // экран не должен остаться пустым
      if (i % 25 === 24) {
        await p7.waitForLoadState().catch(() => {});
        const len = await p7.evaluate(() => document.querySelector("#app") ? document.querySelector("#app").innerText.trim().length : 0).catch(() => 99);
        if (len < 5) throw new Error(`пустой экран после: ${log.slice(-6).join(" → ")}`);
        // окно витрины/диалога закрываем, чтобы обезьяна не залипла в нём навсегда
        await p7.evaluate(() => { for (const b of document.querySelectorAll(".showcase .sc-head button")) b.click(); }).catch(() => {});
      }
    }
    const nodes = await p7.evaluate(() => document.getElementsByTagName("*").length);
    const heap = await p7.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0));
    console.log(`обезьяна: память JS ${heap} МБ`);
    const freq = new Map();
    for (const x of log) { const k = String(x).split(":")[0]; freq.set(k, (freq.get(k) || 0) + 1); }
    console.log(`обезьяна: ${N} действий, узлов DOM в конце ${nodes}; чаще всего: ${[...freq].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  });
  await ctx7.close();
}

// Офлайн: с живым service worker открыть приложение, потом без сети — главная должна открыться из кэша
if (!only || only.has("offline")) {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow", colorScheme: "dark", reducedMotion: "reduce" });
  await ctx2.addInitScript((acc) => { try { localStorage.setItem("account_id", String(acc)); } catch { /* */ } }, ACCOUNT);
  await ctx2.route("**/*", handleRoute);
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(`offline pageerror: ${e.message}`));
  await step("offline", async () => {
    await p2.goto(`${BASE}/index.html`);
    await p2.waitForSelector(".match-item", { timeout: 15000 }).catch(async (e) => {
      throw new Error(`первый заход: ${e.message.split("\n")[0]} | на экране: ${(await p2.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
    });
    await p2.evaluate(() => navigator.serviceWorker.ready);
    // второй заход уже под контролем service worker: он складывает ответы в кэш
    await p2.reload();
    await p2.waitForSelector(".match-item", { timeout: 15000 });
    // новая ?v= вытесняет из кэша прошлую копию того же файла
    const left = await p2.evaluate(async () => {
      await fetch("about.html?v=900");
      await fetch("about.html?v=901");
      for (let i = 0; i < 20; i++) {
        const keys = (await (await caches.open("app-v3")).keys()).map((k) => k.url).filter((u) => u.includes("about.html"));
        if (keys.length === 1) return keys;
        await new Promise((r) => setTimeout(r, 100));
      }
      return (await (await caches.open("app-v3")).keys()).map((k) => k.url).filter((u) => u.includes("about.html"));
    });
    if (left.length !== 1 || !left[0].endsWith("v=901")) throw new Error(`в кэше копии about.html: ${left.join(", ")}`);
    netDown = true;
    await ctx2.setOffline(true);
    await p2.reload();
    await p2.waitForSelector(".match-item", { timeout: 15000 }).catch(async (e) => {
      throw new Error(`${e.message.split("\n")[0]} | на экране: ${(await p2.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
    });
  });
  await ctx2.close();
}

await browser.close();
server.close();
console.log(shots.map((s) => `screenshot ${s}`).join("\n"));
if (errors.length) {
  console.log(`\nОШИБКИ (${errors.length}):\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("\nUI ok: ошибок в консоли нет");
