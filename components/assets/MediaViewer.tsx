"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Film,
  Info,
  Loader2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { formatDay, formatDuration } from "@/components/assets/MediaItemViews";
import { assetTypeLabel, downloadAsset } from "@/components/assets/asset-ui";
import { formatBytes } from "@/lib/format";
import { stepIndex } from "@/lib/media-library";
import { cn } from "@/lib/utils";

/**
 * Full-screen viewer for the library (docs/26 §7). ←/→ (or swipe) step
 * through the current folder in the current order, with neighbours preloaded;
 * `i` toggles details, `d` downloads, `z` or double-click zooms to the
 * original at full size. Images show the display rendition; zoom is the one
 * place the original is fetched for viewing, because the user asked for it.
 */
export function MediaViewer({
  items,
  index,
  onIndexChange,
  onClose,
  locationOf,
  allowOriginals = true,
  onVideoReady,
}: {
  items: AssetLibraryItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  locationOf?: (asset: AssetLibraryItem) => string | null;
  /**
   * False on a share link without downloads: no Download, no Open original,
   * no zoom to the original (images stay at display size). Video still plays.
   */
  allowOriginals?: boolean;
  /** Called once a video has a frame to show (the library heals missing posters). */
  onVideoReady?: (asset: AssetLibraryItem, video: HTMLVideoElement) => void;
}) {
  const asset = items[index] ?? null;
  const [showInfo, setShowInfo] = useState(false);
  // Zoom belongs to one item: stepping to another starts fitted again.
  const [zoom, setZoom] = useState<{ id: string | null; on: boolean }>({ id: null, on: false });
  const zoomed = asset !== null && zoom.id === asset.id && zoom.on;
  const toggleZoom = () => {
    if (asset?.kind === "image" && allowOriginals) setZoom({ id: asset.id, on: !zoomed });
  };

  // Warm the cache for the photos either side.
  useEffect(() => {
    for (const neighbour of [items[index - 1], items[index + 1]]) {
      if (neighbour?.displayUrl) {
        const image = new Image();
        image.src = neighbour.displayUrl;
      }
    }
  }, [index, items]);

  if (!asset) return null;

  const go = (delta: number) => {
    const next = stepIndex(index, delta, items.length);
    if (next !== index && next !== -1) onIndexChange(next);
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Popup
          aria-label={`Viewing ${asset.displayName}`}
          // Opaque: photos are judged against black, not the page behind.
          className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const key = event.key;
            if (key === "ArrowLeft") go(-1);
            else if (key === "ArrowRight") go(1);
            else if (key === "Home") onIndexChange(0);
            else if (key === "End") onIndexChange(items.length - 1);
            else if (key === "i") setShowInfo((current) => !current);
            else if (key === "d" && allowOriginals) downloadAsset(asset);
            else if (key === "z") toggleZoom();
            else return;
            event.preventDefault();
          }}
        >
          <header className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-medium">
                {asset.displayName}
              </DialogPrimitive.Title>
              <p className="text-xs text-white/60">
                {index + 1} of {items.length} · {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)}
              </p>
            </div>
            <ViewerButton label="Details (i)" pressed={showInfo} onClick={() => setShowInfo((current) => !current)}>
              <Info className="size-4" />
            </ViewerButton>
            {allowOriginals ? (
              <ViewerButton label="Download (d)" onClick={() => downloadAsset(asset)}>
                <Download className="size-4" />
              </ViewerButton>
            ) : null}
            {asset.kind !== "file" && allowOriginals ? (
              <ViewerButton
                label="Open original in a new tab"
                onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="size-4" />
              </ViewerButton>
            ) : null}
            <DialogPrimitive.Close
              aria-label="Close (Esc)"
              title="Close (Esc)"
              className="grid size-9 place-items-center rounded-md text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          <div className="flex min-h-0 flex-1">
            <div className="relative flex min-w-0 flex-1 items-center justify-center">
              {/* Keyed so loading state resets per item and per zoom level. */}
              <Stage
                key={`${asset.id}:${zoomed}`}
                asset={asset}
                allowOriginals={allowOriginals}
                onVideoReady={onVideoReady}
                zoomed={zoomed}
                onToggleZoom={toggleZoom}
                onSwipe={go}
              />
              <NavButton side="left" disabled={index === 0} onClick={() => go(-1)} />
              <NavButton side="right" disabled={index === items.length - 1} onClick={() => go(1)} />
            </div>
            {showInfo ? <InfoPanel asset={asset} location={locationOf?.(asset) ?? null} /> : null}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Stage({
  asset,
  allowOriginals,
  onVideoReady,
  zoomed,
  onToggleZoom,
  onSwipe,
}: {
  asset: AssetLibraryItem;
  allowOriginals: boolean;
  onVideoReady?: (asset: AssetLibraryItem, video: HTMLVideoElement) => void;
  zoomed: boolean;
  onToggleZoom: () => void;
  onSwipe: (delta: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // A failed display rendition falls back to the original: in the viewer the
  // user has explicitly asked for this one image (when originals are allowed).
  const source =
    asset.kind !== "image"
      ? null
      : zoomed || failed || !asset.displayUrl
        ? allowOriginals
          ? asset.url
          : null
        : asset.displayUrl;

  if (asset.kind === "video" && !failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:px-16">
        {/* Streams from the content route with byte ranges; the poster is the display rendition. */}
        <video
          key={asset.id}
          src={asset.url}
          poster={asset.displayUrl ?? undefined}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onLoadedData={(event) => onVideoReady?.(asset, event.currentTarget)}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full bg-black"
        />
      </div>
    );
  }

  if (asset.kind !== "image" || !source) {
    const Icon = asset.kind === "pdf" ? FileText : asset.kind === "video" ? Film : FileIcon;
    return (
      <div className="grid max-w-sm place-items-center gap-4 rounded-xl border border-white/15 bg-white/5 px-8 py-10 text-center">
        <Icon className="size-12 text-white/70" />
        <div>
          <p className="break-words font-medium">{asset.displayName}</p>
          {asset.kind === "video" ? (
            <p className="mt-1 text-xs text-white/60">This browser can&apos;t play this video. Download it to watch.</p>
          ) : null}
          <p className="mt-1 text-xs text-white/60">
            {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)}
          </p>
        </div>
        <div className="flex gap-2">
          {asset.kind === "pdf" && allowOriginals ? (
            <button
              type="button"
              onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
              className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black transition hover:bg-white/90"
            >
              Open PDF
            </button>
          ) : null}
          {allowOriginals ? (
            <button
              type="button"
              onClick={() => downloadAsset(asset)}
              className="rounded-md border border-white/30 px-3 py-1.5 text-sm transition hover:bg-white/10"
            >
              Download
            </button>
          ) : (
            <p className="text-xs text-white/60">The owner hasn&apos;t allowed downloads.</p>
          )}
        </div>
      </div>
    );
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (zoomed && scroller.current) {
      pan.current = {
        x: event.clientX,
        y: event.clientY,
        left: scroller.current.scrollLeft,
        top: scroller.current.scrollTop,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      swipe.current = { x: event.clientX, y: event.clientY };
    }
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (pan.current && scroller.current) {
      scroller.current.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
      scroller.current.scrollTop = pan.current.top - (event.clientY - pan.current.y);
    }
  }

  function onPointerUp(event: ReactPointerEvent) {
    pan.current = null;
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A deliberate horizontal swipe, not a tap or a vertical scroll.
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
  }

  return (
    <>
      <div
        ref={scroller}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pan.current = null;
          swipe.current = null;
        }}
        onDoubleClick={allowOriginals ? onToggleZoom : undefined}
        className={cn(
          "absolute inset-0 touch-none select-none outline-none",
          zoomed ? "cursor-grab overflow-auto active:cursor-grabbing" : "flex items-center justify-center p-4 sm:px-16",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source}
          alt={asset.altText ?? asset.displayName}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (!failed && !zoomed) setFailed(true);
          }}
          className={cn(
            "transition-opacity duration-150",
            zoomed ? "max-w-none" : "max-h-full max-w-full object-contain",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
      {!loaded ? <Loader2 className="pointer-events-none absolute size-6 animate-spin text-white/60" /> : null}
      {allowOriginals ? (
      <button
        type="button"
        onClick={onToggleZoom}
        aria-label={zoomed ? "Fit to screen (z)" : "Zoom to full size (z)"}
        title={zoomed ? "Fit to screen (z)" : "Zoom to full size (z)"}
        className="absolute bottom-4 right-4 grid size-9 place-items-center rounded-md bg-black/50 text-white/85 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {zoomed ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />}
      </button>
      ) : null}
    </>
  );
}

function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous (←)" : "Next (→)"}
      className={cn(
        "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white/85 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-6" />
    </button>
  );
}

function ViewerButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "grid size-9 place-items-center rounded-md text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        pressed && "bg-white/15 text-white",
      )}
    >
      {children}
    </button>
  );
}

function InfoPanel({ asset, location }: { asset: AssetLibraryItem; location: string | null }) {
  const rows: [string, string][] = [
    ["Type", assetTypeLabel(asset)],
    ["Size", formatBytes(asset.sizeBytes)],
  ];
  if (asset.width && asset.height) rows.push(["Dimensions", `${asset.width} × ${asset.height}`]);
  if (asset.durationMs) rows.push(["Length", formatDuration(asset.durationMs)]);
  if (asset.takenAt) rows.push(["Taken", formatDay(asset.takenAt, true)]);
  rows.push(["Added", formatDay(asset.createdAt, false)]);
  if (location) rows.push(["Folder", location]);
  rows.push(["Visibility", asset.visibility === "public" ? "Public" : "Private"]);

  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-white/10 bg-black/40 p-4 sm:block">
      <h2 className="break-words text-sm font-semibold">{asset.displayName}</h2>
      {asset.description ? <p className="mt-2 text-xs leading-relaxed text-white/70">{asset.description}</p> : null}
      <dl className="mt-4 grid gap-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[5.5rem_1fr] gap-2">
            <dt className="text-white/50">{label}</dt>
            <dd className="break-words text-white/85">{value}</dd>
          </div>
        ))}
      </dl>
      {asset.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {asset.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-white/20 px-2 py-0.5 text-[0.7rem] text-white/75">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
