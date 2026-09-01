// ProfitSnap offline app-shell service worker — v4 (rebuilt clean).
//
// Goal, kept deliberately narrow: let the app OPEN with no connection.
// Every network attempt below is wrapped so a failure degrades to a
// cached response or a plain error Response — never an uncaught
// exception, which is what causes Chrome to abandon the page entirely
// and show its native ERR_FAILED screen instead of our app.

const CACHE_VERSION = "v4";
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
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("profitsnap-shell-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .catch(() => {})
  );
  self.clients.claim();
});

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET" || !isSameOrigin(request.url)) return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const network = await fetch(request);
        caches
          .open(SHELL_CACHE)
          .then((cache) => cache.put(request, network.clone()))
          .catch(() => {});
        return network;
      } catch {
        const cached = await caches.match(request).catch(() => undefined);
        if (cached) return cached;

        if (request.mode === "navigate") {
          const home = await caches.match("/").catch(() => undefined);
          if (home) return home;
        }

        return new Response("Offline and not cached yet.", {
          status: 503,
          statusText: "Offline",
          headers: { "Content-Type": "text/plain" },
        });
      }
    })()
  );
});
