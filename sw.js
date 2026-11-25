// Service Worker: speichert nur die App-Dateien zwischen, damit die App schnell startet.
// Daten kommen immer live aus der Datenbank.
const VERSION = "werkstatt-v5";
const DATEIEN = [
  "./", "index.html", "config.js", "css/style.css", "js/app.js", "js/db.js", "js/papierkorb.js", "js/sicherung.js", "js/kalender.js", "js/nachrichten.js", "vendor/jszip.min.js",
  "vendor/supabase.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
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

// Netzwerk zuerst (immer neueste Version), Cache nur als Notlösung
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const kopie = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, kopie));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
