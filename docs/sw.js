// Офлайн-кэш приложения. Свои файлы — сначала сеть (обновления приходят сразу), без сети — из кэша.
// Разобранный матч OpenDota уже не меняется: отдаём из кэша мгновенно. Справочники — из кэша с фоновым обновлением.
const APP = "app-v3";
const DATA = "opendota-v2";
const MATCHES_KEEP = 40;
const PLAYERS_KEEP = 150;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (![APP, DATA].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// wait — сколько ждать сеть, если в кэше есть копия: на плохом мобильном интернете страница открывается из кэша
// сразу, а свежая ложится в кэш к следующему запуску
async function networkFirst(req, cacheName, wait = 0, event = null) {
  const cache = await caches.open(cacheName);
  const net = (async () => {
    const res = await fetch(req);
    if (res.ok) {
      const put = cache.put(req, res.clone());
      // ответы OpenDota по игрокам (история, друзья, пики) на каждый новый адрес: без чистки кэш рос без предела
      if (cacheName === DATA) put.then(() => trim(cache, "https://api.opendota.com/api/players/", PLAYERS_KEEP)).catch(() => {});
      return res;
    }
    // OpenDota отвечает 429/5xx при нагрузке: старая копия лучше ошибки
    return (await cache.match(req)) || res;
  })();
  if (wait) {
    const first = await Promise.race([net.catch(() => null), new Promise((r) => setTimeout(r, wait, null))]);
    if (first) return first;
    const hit = await cache.match(req);
    if (hit) {
      const bg = net.catch(() => {});
      if (event) event.waitUntil(bg);
      return hit;
    }
  }
  try {
    return await net;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).then(() => !hit && dropOldVersions(cache, req)).catch(() => {});
    return res;
  });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}

// Скрипт Телеграма грузится в <head> и держит первую отрисовку: с плохой связью до telegram.org экран оставался
// белым. Со второго запуска — из кэша сразу, свежая версия в фоне. Ответ без CORS непрозрачный (status 0), его тоже кладём
async function telegramScript(req, event) {
  const cache = await caches.open(APP);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; });
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

// Новая ?v= — новый адрес, старые копии того же файла больше не понадобятся: без чистки кэш рос с каждым выпуском
async function dropOldVersions(cache, req) {
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !/[?&]v=/.test(url.search)) return;
  for (const k of await cache.keys()) {
    const u = new URL(k.url);
    if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(k);
  }
}

// Храним только последние keep адресов с этим префиксом: позиции реплеев не меняются, но копятся
async function trim(cache, prefix, keep) {
  const keys = (await cache.keys()).filter((k) => k.url.startsWith(prefix));
  for (const old of keys.slice(0, Math.max(0, keys.length - keep))) await cache.delete(old);
}

async function cacheFirstOk(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    await trim(cache, req.url.slice(0, req.url.lastIndexOf("/") + 1), MATCHES_KEEP);
  }
  return res;
}

// Матч кладём в кэш, только если реплей разобран: неразобранный ещё изменится
async function parsedMatch(req) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const data = await res.clone().json().catch(() => null);
    if (data && data.players && data.players.length && data.players[0].lh_t != null) {
      await cache.put(req, res.clone());
      const keys = (await cache.keys()).filter((k) => /\/api\/matches\/\d+$/.test(new URL(k.url).pathname));
      for (const old of keys.slice(0, Math.max(0, keys.length - MATCHES_KEEP))) await cache.delete(old);
    }
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // файлы с версией в адресе (app.js?v=…, справочники, картинки) не меняются: из кэша сразу, обновление в фоне.
  // Новая версия — новый адрес, поэтому второй запуск не ждёт сеть за мегабайт скриптов и JSON
  // свои справочники скиллов и предметов обновляются раз в неделю: из кэша сразу, свежий — к следующему запуску
  if (url.origin === self.location.origin && /\/(abilities|items)\.json$/.test(url.pathname)) { e.respondWith(staleWhileRevalidate(req, DATA)); return; }
  if (url.origin === self.location.origin && /[?&]v=/.test(url.search)) { e.respondWith(staleWhileRevalidate(req, APP)); return; }
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req, APP, req.mode === "navigate" ? 2500 : 0, e)); return; }
  if (url.hostname === "telegram.org" && url.pathname === "/js/telegram-web-app.js") { e.respondWith(telegramScript(req, e)); return; }
  // зеркало справочников на GitHub (когда OpenDota лежит): тоже из кэша с фоновым обновлением
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith("/odota/dotaconstants/")) { e.respondWith(staleWhileRevalidate(req, DATA)); return; }
  // файл позиций реплея после разбора не меняется: второй раз открывается без сети. 404 не кэшируем — реплей ещё могут разобрать
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith("/BEZzZ22/KORPl/replays/")) { e.respondWith(cacheFirstOk(req, DATA)); return; }
  // файл позиций через воркер (GitHub недоступен): так же, как с GitHub
  if (url.hostname.endsWith(".workers.dev") && /^\/rp\/\d+\.json$/.test(url.pathname)) { e.respondWith(cacheFirstOk(req, DATA)); return; }
  // справочники через наш воркер (OpenDota и GitHub у провайдера недоступны): тоже нужны без сети
  if (url.hostname.endsWith(".workers.dev") && url.pathname.startsWith("/od/constants/")) { e.respondWith(staleWhileRevalidate(req, DATA)); return; }
  if (url.hostname !== "api.opendota.com") return;
  if (/^\/api\/matches\/\d+$/.test(url.pathname)) e.respondWith(parsedMatch(req));
  else if (url.pathname.startsWith("/api/constants/") || url.pathname === "/api/benchmarks" || /^\/api\/heroes\/\d+\//.test(url.pathname)) e.respondWith(staleWhileRevalidate(req, DATA));
  else e.respondWith(networkFirst(req, DATA));
});
