"use client";

import { useEffect, useState } from "react";

import { SettingsModal } from "@/components/settings/SettingsModal";
import type { SettingsPage } from "@/components/settings/settings-pages";

export const openSettingsEventName = "vault:open-settings";

export type OpenSettingsEventDetail = {
  /** A page id — a core page ("editor") or an extension page ("extension:vault.calc"). */
  page?: string;
};

/**
 * The workspace's settings modal: closed until something dispatches
 * `openWorkspaceSettings`, then shown on the requested page.
 */
export function SettingsModalController({ pages }: { pages: SettingsPage[] }) {
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState("account");

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

  return (
    <SettingsModal
      pages={pages}
      activePageId={pageId}
      onActivePageChange={setPageId}
      open={open}
      onOpenChange={setOpen}
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
