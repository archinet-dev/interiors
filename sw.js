// sw.js — minimal service worker: precache the app shell, serve it offline, never touch the API.
//
// Strategy:
//  - Precache the local shell on install (deterministic list).
//  - fetch(): bypass non-GET and /api/* entirely (so REST + the Live WebSocket always hit the
//    network and the key proxy keeps working). Same-origin shell + the @google/genai CDN are served
//    cache-first with runtime caching, so after one online visit the app loads offline too.
//  - Network is still required for inference (edits/voice) — only the navigation shell works offline.

const CACHE = "smv-shell-v1";

const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/js/state.js",
  "/js/main.js",
  "/js/apiClient.js",
  "/js/actions/editImage.js",
  "/js/actions/setPhoto.js",
  "/js/actions/voiceSession.js",
  "/js/actions/history.js",
  "/js/audio/audioIO.js",
  "/js/audio/recorder-worklet.js",
  "/js/components/camera-capture.js",
  "/js/components/voice-indicator.js",
  "/js/components/edit-history.js",
  "/js/components/before-after.js",
  "/js/db/idb.js",
  "/js/settings.js",
  "/js/theme.js",
  "/js/toast.js",
  "/js/pwa.js",
  "/assets/sample-room.jpg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

// Hosts whose responses we runtime-cache (the ESM CDN for @google/genai).
const CDN_HOSTS = new Set(["esm.run", "cdn.jsdelivr.net"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET or the API (REST + WS upgrades) — they must reach the proxy/network.
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  const sameOrigin = url.origin === location.origin;
  const isCdn = CDN_HOSTS.has(url.hostname);
  if (!sameOrigin && !isCdn) return; // other cross-origin: let the browser handle it

  // Cache-first with runtime caching; offline navigation falls back to the cached shell.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && (res.type === "basic" || res.type === "cors")) {
            const copy = res.clone();
            // Keep the SW alive until the cache write finishes — otherwise the worker
            // can terminate mid-write (fire-and-forget) and the runtime cache entry is lost.
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
          }
          return res;
        })
        .catch(() => (request.mode === "navigate" ? caches.match("/index.html") : Response.error()));
    })
  );
});
