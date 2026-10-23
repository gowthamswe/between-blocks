// Offline support. App files and data/*.json: network first (so updates show up), cached copy when offline.
// Pose model, MediaPipe runtime, fonts and voice clips: cache first (big and rarely change).
const VERSION = "bbc-v7";
const SHELL = ["./", "index.html", "coach.html", "css/app.css", "css/plan.css", "js/app.js", "js/planapp.js",
  "js/plan.js", "js/store.js", "js/exercises.js", "js/figures.js", "js/moves.js", "js/squat.js", "js/bridge.js", "js/rdl.js", "data/plan.json", "data/history.json", "js/pushup.js", "js/coach.js", "js/voice.js", "js/pose.js",
  "cues.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const cacheFirst = (url) => url.origin !== location.origin || url.pathname.includes("/audio/");

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (cacheFirst(url) && !url.pathname.endsWith("manifest.json")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
