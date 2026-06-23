// SPDX-License-Identifier: Apache-2.0
const CACHE_NAME = "geo7-v104";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=104",
  "./js/codec.js?v=104",
  "./js/regions.gen.js?v=104",
  "./js/app.js?v=104",
  "./manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

// Install: cache core assets
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for assets, network-first for map tiles
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Map tiles: cache as they come (stale-while-revalidate)
  if (
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.includes("basemaps.cartocdn.com") ||
    url.hostname.includes("arcgisonline.com")
  ) {
    e.respondWith(
      caches.open("geo7-tiles").then((cache) =>
        cache.match(e.request).then((cached) => {
          const fetchPromise = fetch(e.request).then((res) => {
            cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Nominatim: always network (search queries)
  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Everything else: cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
