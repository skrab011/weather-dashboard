const CACHE = "weather-v3";

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

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached); // offline: fall back to cache

      // Return cached copy immediately if available, update in background
      return cached ?? networkFetch;
    })
  );
});
