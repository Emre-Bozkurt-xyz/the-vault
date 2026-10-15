/*
 * Vault service worker.
 *
 * Deliberately update-safe: HTML/navigations are ALWAYS network-first, so a new
 * deployment shows immediately with no stale-content delay. Fingerprinted build
 * assets (`/_next/static/*`) are cache-first, which is safe because their URLs
 * change on every rebuild. `/icons/*` and the manifest are NOT fingerprinted, so
 * they are served from cache but revalidated in the background. Everything else
 * (APIs, dynamic routes, asset streams) is passed straight through to the
 * network and never cached. `skipWaiting` + `clients.claim` make a redeployed
 * worker take over without waiting for all tabs to close.
 *
 * Both caches are bounded. Old build chunks are never requested again after a
 * deploy, so without a cap they piled up on disk forever; visited pages can
 * hold private documents, so only the most recent few are kept for offline use,
 * and they are dropped on sign-out (a `CLEAR_PAGES` message) or when a
 * navigation lands on the login page.
 */

const STATIC_CACHE = "vault-static-v2";
const PAGES_CACHE = "vault-pages-v2";
const CURRENT_CACHES = new Set([STATIC_CACHE, PAGES_CACHE]);
const OFFLINE_URL = "/workspace";
// One build's entry chunks are a few dozen files; this keeps a couple of
// deploys' worth while capping the disk the cache can ever take.
const MAX_STATIC_ENTRIES = 400;
const MAX_PAGE_ENTRIES = 20;

self.addEventListener("install", () => {
  // Activate this worker as soon as it finishes installing.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older worker versions (including `vault-runtime-v1`,
      // which held every chunk and page ever fetched).
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Allow the page to tell a waiting worker to activate right away.
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Sent on sign-out: the next person on this device must not get the last
  // user's pages as an offline fallback.
  if (event.data === "CLEAR_PAGES") {
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});

function isFingerprintedAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isRevalidatedAsset(url) {
  return url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest";
}

function isLoginPath(pathname) {
  return pathname === "/login" || pathname.startsWith("/login/");
}

/**
 * Stores `response` as the newest entry and evicts the oldest beyond `max`.
 * Cache keys keep insertion order, so deleting before putting makes this a
 * least-recently-stored list.
 */
async function putBounded(cacheName, request, response, max) {
  const cache = await caches.open(cacheName);
  await cache.delete(request);
  await cache.put(request, response);
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever handle same-origin GETs; let the browser do everything else.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so new deploys appear instantly. Cache only as an
  // offline fallback, never preferred over a live network response.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const landedOnLogin =
            isLoginPath(url.pathname) ||
            (response.redirected && isLoginPath(new URL(response.url).pathname));

          if (landedOnLogin) {
            // Signed out (or the session expired): forget the previous pages.
            event.waitUntil(caches.delete(PAGES_CACHE));
          } else if (response.ok && !response.redirected) {
            event.waitUntil(
              putBounded(PAGES_CACHE, request, response.clone(), MAX_PAGE_ENTRIES),
            );
          }

          return response;
        } catch {
          const cache = await caches.open(PAGES_CACHE);
          const cached = (await cache.match(request)) || (await cache.match(OFFLINE_URL));
          if (cached) return cached;
          throw new Error("offline and no cached page available");
        }
      })(),
    );
    return;
  }

  // Fingerprinted, immutable assets: cache-first is safe (URL changes on build).
  if (isFingerprintedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          event.waitUntil(
            putBounded(STATIC_CACHE, request, response.clone(), MAX_STATIC_ENTRIES),
          );
        }
        return response;
      })(),
    );
    return;
  }

  // Stable URLs whose content can change between deploys: answer from cache
  // when possible, and refresh the cached copy for next time.
  if (isRevalidatedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const refresh = fetch(request).then(async (response) => {
          if (response.ok) {
            await cache.put(request, response.clone());
          }
          return response;
        });

        if (cached) {
          event.waitUntil(refresh.catch(() => {}));
          return cached;
        }

        return refresh;
      })(),
    );
    return;
  }

  // Everything else (APIs, asset streams, dynamic data): straight to network so
  // it is always fresh.
});
