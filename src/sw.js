const cacheName = "2026-02-08 00:00";
const urlsToCache = [
  "/isotone/index.js",
  "/isotone/favicon/favicon.svg",
  "https://marmooo.github.io/midi-player/midi-player-icons.woff2",
  "https://soundfonts.pages.dev/GeneralUser_GS_v1.471/000.sf3",
  "https://soundfonts.pages.dev/GeneralUser_GS_v1.471/128.sf3",
];

async function preCache() {
  const cache = await caches.open(cacheName);
  await Promise.all(
    urlsToCache.map((url) =>
      cache.add(url).catch((err) => console.warn("Failed to cache", url, err))
    ),
  );
  self.skipWaiting();
}

async function handleFetch(event) {
  const cached = await caches.match(event.request);
  return cached || fetch(event.request);
}

async function cleanOldCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map((name) => name !== cacheName ? caches.delete(name) : null),
  );
  self.clients.claim();
}

self.addEventListener("install", (event) => {
  event.waitUntil(preCache());
});
self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(cleanOldCaches());
});
