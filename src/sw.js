/**
 * Service Worker for isotone
 * - Lightweight precache (index.js, favicon, default soundfonts)
 * - Adds COOP/COEP headers on same-origin responses so midy wasm-threads*
 *   (SharedArrayBuffer) can run on GitHub Pages
 */
const cacheName = "2026-11-20 00:00";
const urlsToCache = [
  "/isotone/index.js",
  "/isotone/favicon/favicon.svg",
  "https://soundfonts.pages.dev/GeneralUser_GS_v2.0.3/000/000.sf3",
  "https://soundfonts.pages.dev/GeneralUser_GS_v2.0.3/128/000.sf3",
];

const COOP = "same-origin";
// credentialless: keeps third-party scripts (gtag/ads/CDN) working while
// still enabling SharedArrayBuffer in modern browsers.
const COEP = "credentialless";

function withIsolationHeaders(response) {
  if (!response || response.type === "opaque" || response.status === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", COOP);
  headers.set("Cross-Origin-Embedder-Policy", COEP);
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
  const request = event.request;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Cache-first for precached assets; network otherwise.
  const cached = await caches.match(request);
  if (cached) {
    // Only rewrite headers for same-origin responses (COOP/COEP on document).
    return sameOrigin ? withIsolationHeaders(cached) : cached;
  }

  const response = await fetch(request);
  if (sameOrigin) {
    return withIsolationHeaders(response);
  }
  return response;
}

async function cleanOldCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map((name) => (name !== cacheName ? caches.delete(name) : null)),
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
