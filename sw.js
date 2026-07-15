// Minimal service worker — just enough to make the app "installable".
// This game is real-time online, so we deliberately do NOT cache game
// data or try to work offline; only static shell files are cached.
const CACHE = "big2-shell-v1";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // network-first for everything (this is a real-time app); fall back to
  // cached shell only if totally offline
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
