"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  subscribeToWorkspaceToasts,
  type WorkspaceToastDetail,
} from "@/lib/workspace-toast";
import { cn } from "@/lib/utils";

/** Renders `showWorkspaceToast` messages at the bottom of the workspace. */
export function WorkspaceToast() {
  const [toast, setToast] = useState<(WorkspaceToastDetail & { id: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const counterRef = useRef(0);

  useEffect(
    () =>
      subscribeToWorkspaceToasts((detail) => {
        counterRef.current += 1;
        setBusy(false);
        setToast({ ...detail, id: counterRef.current });
      }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.durationMs ?? 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-16 left-1/2 z-[90] flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-border/80 bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg md:bottom-6",
        toast.tone === "error" && "border-destructive/60",
      )}
    >
      <span className={cn("min-w-0 flex-1", toast.tone === "error" && "text-destructive")}>
        {toast.message}
      </span>
      {toast.action ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const current = toast.id;
            await toast.action?.run();
            setToast((shown) => (shown?.id === current ? null : shown));
          }}
          className="shrink-0 rounded px-2 py-0.5 text-sm font-medium text-primary transition hover:bg-muted disabled:opacity-50"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setToast(null)}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
