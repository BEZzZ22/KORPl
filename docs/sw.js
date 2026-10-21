// Офлайн-кэш приложения. Свои файлы — сначала сеть (обновления приходят сразу), без сети — из кэша.
// Разобранный матч OpenDota уже не меняется: отдаём из кэша мгновенно. Справочники — из кэша с фоновым обновлением.
const APP = "app-v2";
const DATA = "opendota-v2";
const MATCHES_KEEP = 40;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (![APP, DATA].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) { cache.put(req, res.clone()); return res; }
    // OpenDota отвечает 429/5xx при нагрузке: старая копия лучше ошибки
    return (await cache.match(req)) || res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
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
  // картинки с версией в адресе не меняются: из кэша сразу, обновление в фоне (раскадровка Аегиса ~0,7 МБ)
  if (url.origin === self.location.origin && url.pathname.includes("/img/") && url.search) { e.respondWith(staleWhileRevalidate(req, APP)); return; }
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req, APP)); return; }
  if (url.hostname !== "api.opendota.com") return;
  if (/^\/api\/matches\/\d+$/.test(url.pathname)) e.respondWith(parsedMatch(req));
  else if (url.pathname.startsWith("/api/constants/") || url.pathname === "/api/benchmarks" || /^\/api\/heroes\/\d+\//.test(url.pathname)) e.respondWith(staleWhileRevalidate(req, DATA));
  else e.respondWith(networkFirst(req, DATA));
});
