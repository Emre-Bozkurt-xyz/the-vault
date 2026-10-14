"use client";

import { AlertCircle, CheckCircle2, Loader2, Upload, X } from "lucide-react";

import {
  isUploadActive,
  type UploadItem,
} from "@/components/assets/useAssetUploads";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Live upload rows: progress bar, bytes, speed, time left, cancel/dismiss. */
export function UploadProgressList({
  items,
  onCancel,
  onDismiss,
  className,
}: {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ul className={cn("grid gap-2", className)} aria-label="Uploads">
      {items.map((item) => (
        <UploadRow key={item.id} item={item} onCancel={onCancel} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}

function UploadRow({
  item,
  onCancel,
  onDismiss,
}: {
  item: UploadItem;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const active = isUploadActive(item);
  const ratio = item.totalBytes > 0 ? item.loadedBytes / item.totalBytes : 0;
  const percent = item.status === "done" ? 100 : Math.floor(ratio * 100);
  const indeterminate = item.status === "starting" || item.status === "finishing";

  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-md border border-border/70 bg-card/80 px-3 py-2 text-card-foreground">
      <div className="flex items-center gap-2">
        <StatusIcon status={item.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>
          {item.name}
        </span>
        {active && item.status !== "finishing" ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {percent}%
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => (active ? onCancel(item.id) : onDismiss(item.id))}
          disabled={item.status === "finishing"}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
          aria-label={active ? `Cancel upload of ${item.name}` : `Dismiss ${item.name}`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {active ? (
        <div
          role="progressbar"
          aria-label={`Uploading ${item.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : percent}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
              indeterminate && "animate-pulse",
            )}
            style={{ width: `${indeterminate && item.status === "starting" ? 100 : percent}%` }}
          />
        </div>
      ) : null}

      <p
        className={cn(
          "truncate text-xs tabular-nums",
          item.status === "error" ? "text-destructive" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {describe(item)}
      </p>
    </li>
  );
}

function StatusIcon({ status }: { status: UploadItem["status"] }) {
  if (status === "done") return <CheckCircle2 className="size-4 shrink-0 text-primary" />;
  if (status === "error") return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  if (status === "cancelled") return <X className="size-4 shrink-0 text-muted-foreground" />;
  if (status === "queued") return <Upload className="size-4 shrink-0 text-muted-foreground" />;
  return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
}

function describe(item: UploadItem) {
  switch (item.status) {
    case "queued":
      return `Waiting · ${formatBytes(item.totalBytes)}`;
    case "starting":
      return `Preparing · ${formatBytes(item.totalBytes)}`;
    case "finishing":
      return "Checking and saving…";
    case "done":
      return `Uploaded · ${formatBytes(item.totalBytes)}`;
    case "cancelled":
      return "Cancelled";
    case "error":
      return item.error ?? "Upload failed.";
    case "uploading": {
      const parts = [`${formatBytes(item.loadedBytes)} of ${formatBytes(item.totalBytes)}`];

      if (item.bytesPerSecond && item.bytesPerSecond > 0) {
        parts.push(`${formatBytes(item.bytesPerSecond)}/s`);
        const remaining = (item.totalBytes - item.loadedBytes) / item.bytesPerSecond;
        parts.push(`${formatDuration(remaining)} left`);
      }

      return parts.join(" · ");
    }
  }
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
