"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes Vault installable as a PWA.
 *
 * Registration is production-only so it never interferes with the dev server's
 * HMR. `updateViaCache: "none"` forces the browser to revalidate `sw.js` on
 * every check, and when a new worker installs we prompt it to activate and
 * reload once so users pick up deployments without a stale-content delay.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        const promoteWaiting = () => {
          // A new worker is ready; ask it to take over immediately.
          registration.waiting?.postMessage("SKIP_WAITING");
        };

        if (registration.waiting && navigator.serviceWorker.controller) {
          promoteWaiting();
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              promoteWaiting();
            }
          });
        });
      })
      .catch(() => {
        // Registration failures are non-fatal; the app works without the SW.
      });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
