/*
 * Vault service worker.
 *
 * Deliberately update-safe: HTML/navigations are ALWAYS network-first, so a new
 * deployment shows immediately with no stale-content delay. Only fingerprinted,
 * immutable build assets (`/_next/static/*`, `/icons/*`) are cache-first, which
 * is safe because their URLs change on every rebuild. Everything else (APIs,
 * dynamic routes, asset streams) is passed straight through to the network and
 * never cached. `skipWaiting` + `clients.claim` make a redeployed worker take
 * over without waiting for all tabs to close.
 */

const RUNTIME_CACHE = "vault-runtime-v1";
const OFFLINE_URL = "/workspace";

self.addEventListener("install", (event) => {
  // Activate this worker as soon as it finishes installing.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any caches from older worker versions.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== RUNTIME_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Allow the page to tell a waiting worker to activate right away.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
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
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cache = await caches.open(RUNTIME_CACHE);
          const cached = (await cache.match(request)) || (await cache.match(OFFLINE_URL));
          if (cached) return cached;
          throw new Error("offline and no cached page available");
        }
      })(),
    );
    return;
  }

  // Fingerprinted, immutable assets: cache-first is safe (URL changes on build).
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Everything else (APIs, asset streams, dynamic data): straight to network so
  // it is always fresh.
});
