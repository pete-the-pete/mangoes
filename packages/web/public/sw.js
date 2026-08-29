// v2: "/" is now auth-dependent (it redirects a signed-in member to their
// current session, or shows the chooser, or the splash) — precaching it would
// serve whichever of those snapshots happened to be current at install time
// to every offline visitor thereafter, regardless of who they are now. The
// offline shell lives at the static, auth-free /offline route instead. Cache
// name bumped so `activate` evicts the old v1 entry for "/" rather than
// leaving it to rot as an unreachable, never-updated cache key.
//
// v4: the precached icon-192 was redrawn in the design pass too — same
// reasoning as v3, and the same reason this bump is not optional.
// v3: the design pass rebuilt /offline's Splash component. The precached copy
// is a rendered snapshot, so without a new cache name every already-installed
// user would keep the pre-redesign splash forever — `activate` only evicts
// caches whose key differs from this one. Bump this on any change to a
// precached route's markup or styling, not just to this file's logic.
const CACHE = "mango-shell-v4";
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

  // Everything else is left to the browser, and that is deliberate.
  //
  // This handler never calls `cache.put`, so the cache can only ever contain
  // the three precached SHELL entries — which makes SHELL the interception
  // allowlist as well as the precache list. Keep the two meanings together: a
  // path added there becomes a path this worker serves.
  //
  // The previous version ran `caches.match(request).then((c) => c ?? fetch(request))`
  // for every same-origin GET. That bought nothing — the match missed for
  // everything but those three — and it cost a real bug: nothing caught that
  // `fetch`, so any request failing at the network layer (an aborted RSC link
  // prefetch, an extension-blocked Clerk or analytics script) became
  // "Uncaught (in promise) TypeError: Failed to fetch" attributed to this file.
  // Declining to respond hands those back to the browser, which reports a
  // failed request the ordinary way instead.
  //
  // Note this is a synchronous decision on purpose: `respondWith` must be called
  // during dispatch, so "only intercept what we might have" cannot be expressed
  // as a check on the cache itself.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !SHELL.includes(url.pathname)) {
    return;
  }

  event.respondWith(
    // Cache-first, and the fallback is still guarded: an offline miss here
    // must fail as a network error, not as an unhandled rejection.
    caches.match(request).then((cached) => cached ?? fetch(request).catch(() => Response.error())),
  );
});
