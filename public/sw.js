// ProfitSnap offline app-shell service worker.
//
// Scope: get the app itself to OPEN and be NAVIGABLE with no connection,
// so the already-built offline queue (src/lib/offlineQueue.ts) actually
// gets a chance to run. This does NOT cache your live data (Supabase
// reads, api.weersme.com.lk, the raw-IP backend) — those stay
// live-network-only on purpose, since caching stale stock/sales numbers
// would be worse than showing nothing. Writes made offline go through
// the existing queue, not this worker.

const CACHE_VERSION = "v3";
const SHELL_CACHE = `profitsnap-shell-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/sales",
  "/stock",
  "/credit-sales",
  "/profit",
  "/items",
  "/manifest.json",
  "/favicon.ico",
  "/offline-mascot.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("profitsnap-shell-") && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isSameOrigin(url) {
  return new URL(url).origin === self.location.origin;
}

function isCacheableAsset(request) {
  if (request.method !== "GET") return false;
  if (!isSameOrigin(request.url)) return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (!isSameOrigin(request.url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match("/"));
        })
    );
    return;
  }

  if (isCacheableAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
