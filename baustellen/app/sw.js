// Service Worker: hält die App-Dateien auf dem Gerät vor, damit die App
// auch ohne Verbindung zum Server (z.B. auf der Baustelle) startet.
// Die Daten selbst liegen ohnehin auf dem Gerät (IndexedDB).
const VERSION = "baustellen-v2";
const DATEIEN = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "js/app.js", "js/store.js", "js/sync.js", "js/grundriss.js", "js/fotos.js",
  "icons/icon.svg", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst Netz (neueste Version), bei Fehler/Timeout aus dem Zwischenspeicher. Sync-Anfragen nie cachen.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([
        fetch(e.request),
        new Promise((_, f) => setTimeout(() => f(new Error("timeout")), 3000)),
      ]);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
    }
  })());
});
