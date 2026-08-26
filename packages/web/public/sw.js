// v2: "/" is now auth-dependent (it redirects a signed-in member to their
// current session, or shows the chooser, or the splash) — precaching it would
// serve whichever of those snapshots happened to be current at install time
// to every offline visitor thereafter, regardless of who they are now. The
// offline shell lives at the static, auth-free /offline route instead. Cache
// name bumped so `activate` evicts the old v1 entry for "/" rather than
// leaving it to rot as an unreachable, never-updated cache key.
const CACHE = "mango-shell-v2";
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // The outbox lives in IndexedDB and the page owns it. The service worker never
  // replays POSTs — that would double-count taps the page has already settled.
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    // Falls back to the static offline splash, never to a cached "/" — see
    // the SHELL comment above. A page already open and rendered before the
    // network dropped keeps running from memory; this fallback only fires
    // for a fresh/reloaded navigation while offline, and it can only ever
    // show the same signed-out splash regardless of which route was requested.
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline").then((r) => r ?? Response.error())),
    );
    return;
  }

  if (new URL(request.url).pathname.startsWith("/api/")) return; // never cache API reads

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  );
});
