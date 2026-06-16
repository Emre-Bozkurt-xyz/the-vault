"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Check,
  Copy,
  Eye,
  FileText,
  ImageIcon,
  Info,
  X,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PublicGalleryAsset = {
  id: string;
  kind: "image" | "pdf";
  displayName: string;
  description: string | null;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "public";
  createdAt: Date | string;
  ownerName: string | null;
  ownerUsername: string | null;
  url: string;
  markdown: string;
};

export function PublicAssetGallery({
  assets,
  children,
}: {
  assets: PublicGalleryAsset[];
  children?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const [copied, setCopied] = useState<"embed" | "id" | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const selected = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? null,
    [assets, selectedId],
  );

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        setCopied(null);
      }
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && panelRef.current?.contains(target)) {
        return;
      }

      setSelectedId(null);
      setCopied(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
    };
  }, [selectedId]);

  async function copyText(kind: "embed" | "id", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (assets.length === 0) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    );
  }

  return (
    <section className="relative">
      <div className="grid content-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={(event) => {
              setPanelStyle(getPanelStyle(event.currentTarget));
              setSelectedId(asset.id);
              setCopied(null);
            }}
            className={cn(
              "group overflow-hidden rounded-md border bg-card text-left text-card-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg",
              selected?.id === asset.id
                ? "border-primary/70 ring-1 ring-primary/35"
                : "border-border/70",
            )}
          >
            {asset.kind === "image" ? (
              <span className="block bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.altText ?? asset.displayName}
                  className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </span>
            ) : (
              <span className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-muted-foreground">
                <FileText className="size-10" />
              </span>
            )}
            <span className="block p-4">
              <span className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {asset.kind === "image" ? (
                  <ImageIcon className="size-3.5" />
                ) : (
                  <FileText className="size-3.5" />
                )}
                Public asset
              </span>
              <span className="mt-2 block truncate text-sm font-semibold">
                {asset.displayName}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                @{asset.ownerUsername ?? "unknown"} - {formatDate(asset.createdAt)}
              </span>
            </span>
          </button>
        ))}
        {children}
      </div>

      {selected ? (
        <aside
          ref={panelRef}
          className="fixed z-50 max-h-[min(34rem,calc(100svh-2rem))] w-[calc(100vw-2rem)] overflow-y-auto border border-border/70 bg-card/95 p-4 shadow-2xl shadow-black/45 backdrop-blur md:w-80"
          style={panelStyle ?? undefined}
        >
            <div className="grid gap-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Info className="size-3.5" />
                    Public asset
                  </p>
                  <h2 className="mt-2 break-words text-lg font-semibold">
                    {selected.displayName}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    @{selected.ownerUsername ?? "unknown"} - {selected.mimeType}
                  </p>
                </div>
                <button
                  type="button"
                  className="grid size-7 flex-none place-items-center border border-border/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Close asset details"
                  onClick={() => {
                    setSelectedId(null);
                    setCopied(null);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {selected.description ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  {selected.description}
                </p>
              ) : null}

              <dl className="grid gap-2 border-y border-border/70 py-3 text-xs">
                <InfoRow label="Kind" value={selected.kind} />
                <InfoRow label="Size" value={formatBytes(selected.sizeBytes)} />
                <InfoRow label="Uploaded" value={formatDate(selected.createdAt)} />
                <InfoRow
                  label="Owner"
                  value={selected.ownerName ?? selected.ownerUsername ?? "Unknown"}
                />
              </dl>

              <div className="grid gap-2 rounded-md border border-border/70 bg-background/55 p-3">
                <p className="break-all font-mono text-[0.72rem] text-foreground">
                  {selected.markdown}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyText("embed", selected.markdown)}
                  >
                    {copied === "embed" ? (
                      <Check data-icon="inline-start" />
                    ) : (
                      <Copy data-icon="inline-start" />
                    )}
                    Embed
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyText("id", selected.id)}
                  >
                    {copied === "id" ? (
                      <Check data-icon="inline-start" />
                    ) : (
                      <Copy data-icon="inline-start" />
                    )}
                    ID
                  </Button>
                </div>
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                >
                  <Eye data-icon="inline-start" />
                  Open asset
                </a>
              </div>
            </div>
        </aside>
      ) : null}
    </section>
  );
}

function getPanelStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const margin = 16;

  if (window.innerWidth < 768) {
    return {
      left: margin,
      right: margin,
      top: Math.min(Math.max(rect.top, margin), 96),
    };
  }

  const panelWidth = 320;
  const gap = 12;
  const fitsRight = rect.right + gap + panelWidth <= window.innerWidth - margin;
  const left = fitsRight
    ? rect.right + gap
    : Math.max(margin, rect.left - panelWidth - gap);
  const top = Math.min(
    Math.max(rect.top, margin),
    Math.max(margin, window.innerHeight - 544),
  );

  return { left, top };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-foreground">{value}</dd>
    </div>
  );
}

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
