const CACHE = "weather-v4";

// Core shell files to cache on install.
// Both page shells are included so each is available offline after the
// first visit without needing a network round-trip for the HTML.
const PRECACHE = ["/", "/shared", "/manifest.json", "/manifest-shared.json", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove caches from old versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only cache same-origin GET requests; let API calls pass through
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // API routes have their own Cache-Control headers managed by the serverless
  // functions. Intercepting them causes iOS Safari to return null responses
  // when navigating to them directly, and prevents CDN cache from working.
  if (request.url.includes("/api/")) return;

  // Page navigations (the HTML shell itself) go network-first. Vite renames
  // the JS bundles on every deploy and Vercel deletes the old files, so a
  // cached HTML shell can reference scripts that no longer exist — serving it
  // stale produces a blank page until the next refresh. Fresh HTML always
  // points at live assets; the cached copy is only the offline fallback.
  // waitUntil keeps the SW alive until the cache write finishes — without it
  // the browser may terminate the SW right after the response is delivered
  // and silently drop the write.
  const store = (response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  };

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(store)
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then(store)
        .catch(() => cached); // offline: fall back to cache

      // Return cached copy immediately if available, update in background
      return cached ?? networkFetch;
    })
  );
});
