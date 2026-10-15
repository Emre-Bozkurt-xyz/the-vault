"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SettingsModal } from "@/components/settings/SettingsModal";
import type { SettingsData } from "@/components/settings/settings-data";
import { loadWorkspaceSettingsDataAction } from "@/server/settings-pages-actions";

export const openSettingsEventName = "vault:open-settings";

export type OpenSettingsEventDetail = {
  /** A page id — a core page ("editor") or an extension page ("extension:vault.calc"). */
  page?: string;
};

/**
 * The workspace's settings modal: closed until something dispatches
 * `openWorkspaceSettings`, then shown on the requested page.
 *
 * Nothing settings-specific loads with the layout: on open, the data comes
 * from a server action while the section components (the snippet editor among
 * them) load as their own chunk (`settings-pages-view`). The data is kept while
 * the layout's `revision` is unchanged and refetched when it changes —
 * immediately if the modal is open, otherwise on the next open.
 */
export function SettingsModalController({ revision }: { revision: string }) {
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState("account");
  const [loaded, setLoaded] = useState<{
    revision: string;
    data: SettingsData;
    view: typeof import("@/components/settings/settings-pages-view");
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const requestedRevisionRef = useRef<string | null>(null);

  useEffect(() => {
    function onOpenSettings(event: Event) {
      const detail = (event as CustomEvent<OpenSettingsEventDetail>).detail;

      // Unknown or absent ids land on Account; the modal itself also falls back
      // to its first page, so a stale id can never open an empty modal.
      setPageId(detail?.page ?? "account");
      setOpen(true);
    }

    window.addEventListener(openSettingsEventName, onOpenSettings);

    return () => {
      window.removeEventListener(openSettingsEventName, onOpenSettings);
    };
  }, []);

  useEffect(() => {
    if (
      !open ||
      loaded?.revision === revision ||
      requestedRevisionRef.current === revision
    ) {
      return;
    }

    requestedRevisionRef.current = revision;
    Promise.all([
      loadWorkspaceSettingsDataAction(),
      import("@/components/settings/settings-pages-view"),
    ]).then(
      ([data, view]) => {
        setFailed(false);
        setLoaded({ revision, data, view });
      },
      () => {
        // Allow the next open (or revision) to try again.
        requestedRevisionRef.current = null;
        setFailed(true);
      },
    );
  }, [open, revision, loaded?.revision]);

  const pages = useMemo(
    () => (loaded ? loaded.view.buildSettingsPagesFromData(loaded.data) : []),
    [loaded],
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);

    if (!nextOpen) {
      setFailed(false);
    }
  }

  return (
    <SettingsModal
      pages={pages}
      status={loaded ? "ready" : failed ? "failed" : "loading"}
      activePageId={pageId}
      onActivePageChange={setPageId}
      open={open}
      onOpenChange={handleOpenChange}
    />
  );
}

export function openWorkspaceSettings(page?: string) {
  window.dispatchEvent(
    new CustomEvent<OpenSettingsEventDetail>(openSettingsEventName, {
      detail: { page },
    }),
  );
}
