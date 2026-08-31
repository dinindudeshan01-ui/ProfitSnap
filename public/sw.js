// ProfitSnap offline app-shell service worker.
//
// Scope: get the app itself to OPEN with no connection, so the
// already-built offline queue (src/lib/offlineQueue.ts) actually gets a
// chance to run. This does NOT cache your live data (Supabase reads,
// api.weersme.com.lk, the raw-IP backend) — those stay live-network-only
// on purpose, since caching stale stock/sales numbers would be worse
// than showing nothing. Writes made offline go through the existing
// queue, not this worker.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `profitsnap-shell-${CACHE_VERSION}`;

// Same-origin static assets we always want available offline once
// they've been fetched once. Next.js hashes its build output, so we
// don't try to pre-list /_next/static files here — they get cached
// opportunistically the first time they're requested (see fetch handler).
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
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

// Only cache GET requests to our own static/app-shell surface. Never
// cache API routes, Supabase calls, or any cross-origin request — those
// must stay live so numbers are never silently stale.
function isCacheableAsset(request) {
  if (request.method !== "GET") return false;
  if (!isSameOrigin(request.url)) return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false;
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|webp|ico|woff2?|css|js)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // App navigations (opening/switching screens): network-first, so
  // people always get the freshest UI when online, but fall back to a
  // cached shell when there's no connection at all.
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

  // Static assets: cache-first, refresh in background.
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
  // Everything else (API calls, Supabase, external domains) — untouched,
  // always goes straight to the network.
});
