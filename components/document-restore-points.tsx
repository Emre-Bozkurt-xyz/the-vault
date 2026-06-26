"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import {
  consumePendingDocumentCommand,
  subscribeToDocumentCommand,
} from "@/lib/document-command-events";

/**
 * The "Restore points" disclosure in the document context panel. Server-rendered
 * version rows are passed as `children`; this client shell owns the open state so
 * the `/history` command palette action can expand it (and scroll it into view),
 * including right after the context panel is revealed.
 */
export function DocumentRestorePoints({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const reveal = () => {
      setOpen(true);
      requestAnimationFrame(() => {
        ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    };

    if (consumePendingDocumentCommand(["open-history"])) {
      reveal();
    }

    return subscribeToDocumentCommand((type) => {
      if (type === "open-history") {
        reveal();
      }
    });
  }, []);

  return (
    <details
      ref={ref}
      className="group mt-3 border border-border/70 bg-background/35"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
        <span>Restore points</span>
        <span className="ml-auto text-muted-foreground">{count}</span>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-2 border-t border-border/70 p-2">{children}</div>
    </details>
  );
}
