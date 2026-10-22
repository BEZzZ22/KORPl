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
  if (p === `/players/${ACCOUNT}/recentMatches`) return recent;
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
  return { text: COACH_TEXT };
}

// Настоящий разбор реплея этого матча (GitHub Actions + odota/parser)
const REPLAY = gz("replay_9052987576.json.gz");
const PLACEHOLDER = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const errors = [];
const cardSizes = [];
// запросы из service worker тоже идут через подмену, иначе офлайн-проверка зависит от живой OpenDota
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const browser = await chromium.launch({ headless: !process.env.UI_HEADED });
const context = await browser.newContext({
  // UI_WIDTH=320 — проверить узкий телефон
  viewport: { width: Number(process.env.UI_WIDTH) || 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "ru-RU", serviceWorkers: "block",
  colorScheme: "dark", reducedMotion: process.env.UI_MOTION ? "no-preference" : "reduce",
});
// Привязанный аккаунт и одна уже открытая раньше катка, чтобы было с чем сравнить
await context.addInitScript(([acc, other]) => {
  try {
    localStorage.setItem("account_id", String(acc));
    if (!localStorage.getItem(`cmp:${acc}`)) localStorage.setItem(`cmp:${acc}`, JSON.stringify([other]));
    // задача с прошлой катки: не больше одной смерти до 10:00 (у Tusk в этой катке две — провал)
    if (!localStorage.getItem(`goal:${acc}`)) localStorage.setItem(`goal:${acc}`, JSON.stringify({ text: "Цель на следующую катку: не больше одной смерти до 10:00", check: { group: "lane_deaths", metric: "lane_deaths", op: "<=", target: 1 }, match: 1, t: 1000 }));
  } catch { /* */ }
}, [ACCOUNT, { match: 1, hero: "Invoker", hero_id: 74, won: true, kda: "12/3/9", t: 0, payload: { hero: "Invoker", won: true, kda: "12/3/9", duration: "41:02" } }]);
let netDown = false; // офлайн-проверка: все запросы рвутся, как без сети
async function handleRoute(route) {
  if (netDown) return route.abort("internetdisconnected");
  const url = new URL(route.request().url());
  if (url.origin === BASE) return route.continue();
  if (url.hostname === "api.opendota.com") {
    const data = opendota(url);
    return data === null ? route.fulfill({ status: 404, body: "{}" }) : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  }
  if (url.hostname.endsWith("workers.dev")) {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" } });
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(coach(route.request().postData())) });
  }
  if (url.hostname === "raw.githubusercontent.com") {
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
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });

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
  try { await fn(); } catch (e) { errors.push(`${name}: ${e.message.split("\n").slice(0, process.env.UI_DEBUG ? 12 : 1).join("\n")}`); }
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
    for (const angle of [0, 40, 90, 180, 300, [35, 30], [-50, -40], [0, 80]]) {
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
  // тап по Аегису — витрина; Sketchfab в тесте недоступен, поэтому должна быть понятная ошибка, а не вечная загрузка
  await page.locator(".app-top .aegis").click();
  await page.waitForSelector(".showcase", { timeout: 3000 });
  await page.waitForFunction(() => /не загрузилась/.test(document.querySelector(".sc-wait").textContent), null, { timeout: 5000 });
  await shot("showcase");
  await page.locator(".showcase .sc-head button").click();
  await page.waitForSelector(".showcase", { state: "detached", timeout: 3000 });
});
await step("overview", async () => {
  // свежая катка открывается из большого блока сверху
  await page.locator(".fresh-match").click();
  await page.waitForSelector(".hero-head", { timeout: 20000 });
  await shot("overview");
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
  await page.locator(".tabs .tab").nth(1).click();
  const before = await page.locator(".chat-msg.assistant").count();
  await page.locator("summary", { hasText: "Хронология" }).click();
  await page.locator(".moment.askable").first().click();
  // вопрос уходит в чат на «Обзоре»
  await page.waitForFunction((n) => document.querySelectorAll(".chat-msg.assistant:not(.typing)").length > n, before, { timeout: 10000 });
  await page.locator(".tabs .tab").nth(0).click();
});
for (const [i, name] of ["phases", "deaths", "map", "build", "charts"].entries()) {
  await step(name, async () => {
    await page.locator(".tabs .tab").nth(i + 1).click();
    await page.waitForTimeout(250);
    await shot(name);
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
