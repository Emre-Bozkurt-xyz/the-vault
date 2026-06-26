"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches server data when the workspace is restored from the back/forward
 * cache (bfcache), so a restored page never shows stale data (e.g. an edit made
 * elsewhere). Uses a soft `router.refresh()` rather than a full reload — the
 * saved layout is now rendered server-side from cookies, so there is no longer a
 * flash to mask with a hard reload.
 */
export function WorkspaceHistoryRestore() {
  const router = useRouter();

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        router.refresh();
      }
    }

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  return null;
}
