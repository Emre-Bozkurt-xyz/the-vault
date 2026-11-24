"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { UploadProgressList } from "@/components/assets/UploadProgressList";
import { isUploadActive, type UploadItem } from "@/components/assets/useAssetUploads";
import { cn } from "@/lib/utils";

/**
 * Uploads in a corner tray, like Drive's: progress never pushes the gallery
 * around mid-upload. Collapsible; clearable once nothing is running.
 */
export function UploadTray({
  items,
  onCancel,
  onDismiss,
}: {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const active = items.filter(isUploadActive).length;
  const failed = items.filter((item) => item.status === "error").length;
  const title =
    active > 0
      ? `Uploading ${active} ${active === 1 ? "file" : "files"}`
      : failed > 0
        ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed`
        : `${items.length} ${items.length === 1 ? "upload" : "uploads"} complete`;

  return (
    <section
      aria-label="Uploads"
      // Phones: above the floating New button and the nav bar.
      className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] right-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-xl sm:bottom-20 md:bottom-4"
    >
      <header className="flex h-10 items-center gap-1 border-b border-border/70 pl-3.5 pr-1.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show uploads" : "Hide uploads"}
          className="grid size-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
        {active === 0 ? (
          <button
            type="button"
            onClick={() => items.forEach((item) => onDismiss(item.id))}
            aria-label="Clear uploads"
            className="grid size-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>
      {collapsed ? null : (
        <div className="max-h-72 overflow-y-auto p-2">
          <UploadProgressList items={items} onCancel={onCancel} onDismiss={onDismiss} />
        </div>
      )}
    </section>
  );
}
