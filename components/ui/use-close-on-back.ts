"use client";

import { useEffect, useRef } from "react";

/**
 * Back closes the overlay on top (a dialog, a sheet, the media viewer, phone
 * selection mode) instead of leaving the page, as on Android. While `enabled`,
 * one history entry (same URL) stands for the overlay; Back pops it and calls
 * `onBack`. Closing the overlay any other way takes the entry back off, so
 * history never fills with dead entries. Overlays stack: each Back closes the
 * topmost one.
 *
 * Following a link out of the overlay (a document in a list, say) leaves the
 * entry alone: taking it off with `history.back()` would cancel the
 * navigation that is still in flight.
 *
 * Our own clean-up `history.back()` also fires popstate; a module-level flag
 * marks that event so no overlay mistakes it for the user's Back, and a new
 * overlay waits for it to land before adding its entry (otherwise the
 * pending back would pop the new one).
 */

let backInFlight = false;
let lastPopWasOurs = false;
const waiting: (() => void)[] = [];
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Registered before any overlay's listener, so it runs first.
  window.addEventListener("popstate", () => {
    lastPopWasOurs = backInFlight;
    backInFlight = false;
    if (!lastPopWasOurs) return;
    for (const run of waiting.splice(0)) run();
  });
}

function whenHistorySettled(run: () => void) {
  if (backInFlight) waiting.push(run);
  else run();
}

export function useCloseOnBack(onBack: () => void, enabled = true) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    install();
    const token = `${Date.now()}-${Math.random()}`;
    let pushed = false;
    let cancelled = false;
    let closedByBack = false;
    let navigating = false;

    // A plain click on a same-site link to another page: this tab is leaving.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname + url.search !== window.location.pathname + window.location.search) {
        navigating = true;
      }
    };
    document.addEventListener("click", onClick, true);

    // Deferred a tick, so React's development double-mount (mount, unmount,
    // mount) never leaves a stray entry behind.
    const timer = window.setTimeout(() => {
      whenHistorySettled(() => {
        if (cancelled) return;
        window.history.pushState({ ...(window.history.state ?? {}), vaultOverlay: token }, "", window.location.href);
        pushed = true;
      });
    }, 0);

    const onPopState = () => {
      if (!pushed || lastPopWasOurs) return;
      // Still on (or above) our entry: Back closed something on top of us.
      if ((window.history.state as { vaultOverlay?: string } | null)?.vaultOverlay === token) return;
      closedByBack = true;
      onBackRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClick, true);
      // Closed some other way while our entry is still current: take it off.
      // (If the page is navigating away, or already has, leave it.)
      if (
        pushed &&
        !closedByBack &&
        !navigating &&
        (window.history.state as { vaultOverlay?: string } | null)?.vaultOverlay === token
      ) {
        backInFlight = true;
        window.history.back();
      }
    };
  }, [enabled]);
}
