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
  Play,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { formatDay, formatDuration } from "@/components/assets/MediaItemViews";
import { assetTypeLabel, downloadAsset } from "@/components/assets/asset-ui";
import { useCloseOnBack } from "@/components/ui/use-close-on-back";
import { useMediaQuery } from "@/components/workspace/panel-visibility";
import { formatBytes } from "@/lib/format";
import { stepIndex } from "@/lib/media-library";
import { cn } from "@/lib/utils";

/**
 * Full-screen viewer for the library (docs/26 §7). ←/→ (or swipe) step
 * through the current folder in the current order, with neighbours preloaded;
 * `i` toggles details, `d` downloads, `z` or double-click zooms to the
 * original at full size. Images show the display rendition; zoom is the one
 * place the original is fetched for viewing, because the user asked for it.
 * A filmstrip of thumbnails runs along the bottom; the current item stands
 * out by size and brightness, and a click jumps to any other.
 */
export function MediaViewer({
  items,
  index,
  onIndexChange,
  onClose,
  locationOf,
  allowOriginals = true,
  onVideoReady,
  onVideoUnplayable,
  closeOnBack = false,
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
  /** Called when this browser can't play a video (the library asks the server for a poster). */
  onVideoUnplayable?: (asset: AssetLibraryItem) => void;
  /**
   * Back closes the viewer. Off for the library, whose viewer is already a
   * history entry (`?open=`); on for pages without one (the share page).
   */
  closeOnBack?: boolean;
}) {
  const asset = items[index] ?? null;
  const [showInfo, setShowInfo] = useState(false);
  const phone = useMediaQuery("(max-width: 639px)", false);
  useCloseOnBack(onClose, closeOnBack);
  // On a phone the details are a sheet over the photo: Back closes it first.
  useCloseOnBack(() => setShowInfo(false), showInfo && phone);
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

          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {/* Keyed so loading state resets per item and per zoom level. */}
                <Stage
                  key={`${asset.id}:${zoomed}`}
                  asset={asset}
                  allowOriginals={allowOriginals}
                  onVideoReady={onVideoReady}
                  onVideoUnplayable={onVideoUnplayable}
                  zoomed={zoomed}
                  onToggleZoom={toggleZoom}
                  onSwipe={go}
                  onDismiss={onClose}
                />
                <NavButton side="left" disabled={index === 0} onClick={() => go(-1)} />
                <NavButton side="right" disabled={index === items.length - 1} onClick={() => go(1)} />
              </div>
              {items.length > 1 && !zoomed ? (
                <Filmstrip items={items} index={index} onSelect={onIndexChange} />
              ) : null}
            </div>
            {showInfo ? (
              <InfoPanel asset={asset} location={locationOf?.(asset) ?? null} onClose={() => setShowInfo(false)} />
            ) : null}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Height of a video's control strip: touches there scrub, never swipe. */
const VIDEO_CONTROLS_PX = 64;

/**
 * Swipe gestures on the stage: sideways steps to the previous/next item, down
 * closes the viewer (the item follows the finger and fades, then springs back
 * if released early). Works the same on photos, videos and the icon card.
 */
function useStageGestures(onSwipe: (delta: number) => void, onDismiss: () => void) {
  const start = useRef<{ x: number; y: number; element: HTMLElement } | null>(null);

  const settle = (element: HTMLElement) => {
    element.style.transition = "transform 150ms ease-out, opacity 150ms ease-out";
    element.style.transform = "";
    element.style.opacity = "";
    window.setTimeout(() => (element.style.transition = ""), 160);
  };

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "VIDEO" && event.clientY > target.getBoundingClientRect().bottom - VIDEO_CONTROLS_PX) {
        return;
      }
      start.current = { x: event.clientX, y: event.clientY, element: event.currentTarget };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const origin = start.current;
      if (!origin || event.pointerType === "mouse") return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (dy > 0 && dy > Math.abs(dx)) {
        origin.element.style.transition = "none";
        origin.element.style.transform = `translateY(${dy}px)`;
        origin.element.style.opacity = String(Math.max(0.35, 1 - dy / 500));
      }
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const origin = start.current;
      start.current = null;
      if (!origin) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (dy > 100 && dy > Math.abs(dx) * 1.2) {
        onDismiss();
        return;
      }
      settle(origin.element);
      // A deliberate horizontal swipe, not a tap or a drag down.
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel() {
      const origin = start.current;
      start.current = null;
      if (origin) settle(origin.element);
    },
  };
}

function Stage({
  asset,
  allowOriginals,
  onVideoReady,
  onVideoUnplayable,
  zoomed,
  onToggleZoom,
  onSwipe,
  onDismiss,
}: {
  asset: AssetLibraryItem;
  allowOriginals: boolean;
  onVideoReady?: (asset: AssetLibraryItem, video: HTMLVideoElement) => void;
  onVideoUnplayable?: (asset: AssetLibraryItem) => void;
  zoomed: boolean;
  onToggleZoom: () => void;
  onSwipe: (delta: number) => void;
  onDismiss: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const gestures = useStageGestures(onSwipe, onDismiss);
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
      <div {...gestures} className="absolute inset-0 flex touch-none items-center justify-center p-4 sm:px-16">
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
          onError={() => {
            setFailed(true);
            onVideoUnplayable?.(asset);
          }}
          className="max-h-full max-w-full bg-black"
        />
      </div>
    );
  }

  if (asset.kind !== "image" || !source) {
    const Icon = asset.kind === "pdf" ? FileText : asset.kind === "video" ? Film : FileIcon;
    return (
      <div {...gestures} className="absolute inset-0 flex touch-none items-center justify-center p-4">
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
      </div>
    );
  }

  // Zoomed in, a drag pans the original; fitted, it's a swipe.
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoomed && scroller.current) {
      pan.current = {
        x: event.clientX,
        y: event.clientY,
        left: scroller.current.scrollLeft,
        top: scroller.current.scrollTop,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      gestures.onPointerDown(event);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current && scroller.current) {
      scroller.current.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
      scroller.current.scrollTop = pan.current.top - (event.clientY - pan.current.y);
    } else {
      gestures.onPointerMove(event);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current) {
      pan.current = null;
      return;
    }
    gestures.onPointerUp(event);
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
          gestures.onPointerCancel();
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

/** How many thumbnails either side of the current one the strip renders. */
const FILMSTRIP_REACH = 60;

/**
 * Thumbnails of the whole list along the bottom. The current one is larger
 * and at full brightness; the rest sit back, smaller and dimmed, until
 * hovered. Only a window around the current item is rendered, so a folder of
 * thousands doesn't build thousands of buttons; the current item is kept
 * centred as you step.
 */
function Filmstrip({
  items,
  index,
  onSelect,
}: {
  items: AssetLibraryItem[];
  index: number;
  onSelect: (index: number) => void;
}) {
  const current = useRef<HTMLButtonElement>(null);
  const start = Math.max(0, index - FILMSTRIP_REACH);
  const end = Math.min(items.length, index + FILMSTRIP_REACH + 1);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    current.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [index]);

  return (
    <nav aria-label="All items" className="shrink-0 border-t border-white/10 bg-black/60">
      <div className="flex h-[4.5rem] items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:h-20 [&::-webkit-scrollbar]:hidden">
        {/* Spacers let the first and last items reach the centre too. */}
        <span aria-hidden className="w-[40vw] shrink-0" />
        {items.slice(start, end).map((item, offset) => {
          const position = start + offset;
          const active = position === index;
          return (
            <button
              key={item.id}
              ref={active ? current : undefined}
              type="button"
              onClick={() => onSelect(position)}
              aria-label={`${item.displayName} (${position + 1} of ${items.length})`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "relative shrink-0 overflow-hidden rounded bg-white/10 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                active
                  ? "size-14 opacity-100 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] sm:size-16"
                  : "size-10 opacity-45 saturate-50 hover:opacity-90 hover:saturate-100 sm:size-12",
              )}
            >
              <FilmstripThumb item={item} />
            </button>
          );
        })}
        <span aria-hidden className="w-[40vw] shrink-0" />
      </div>
    </nav>
  );
}

function FilmstripThumb({ item }: { item: AssetLibraryItem }) {
  const [broken, setBroken] = useState(false);
  if (item.thumbUrl && !broken) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
        {item.kind === "video" ? (
          <Play aria-hidden className="absolute bottom-1 left-1 size-3 fill-white text-white drop-shadow" />
        ) : null}
      </>
    );
  }
  const Icon = item.kind === "pdf" ? FileText : item.kind === "video" ? Film : FileIcon;
  return (
    <span className="grid size-full place-items-center text-white/70">
      <Icon className="size-4" />
    </span>
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

/**
 * The item's details: a side panel on wider screens, a sheet over the bottom
 * of the photo on a phone (with its own close, since `i` needs a keyboard).
 */
function InfoPanel({
  asset,
  location,
  onClose,
}: {
  asset: AssetLibraryItem;
  location: string | null;
  onClose: () => void;
}) {
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
    <aside
      aria-label="Details"
      className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-2xl border-t border-white/15 bg-neutral-950/95 p-4 pb-6 shadow-2xl backdrop-blur sm:static sm:z-auto sm:max-h-none sm:w-72 sm:shrink-0 sm:rounded-none sm:border-l sm:border-t-0 sm:bg-black/40 sm:pb-4 sm:shadow-none sm:backdrop-blur-none"
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 break-words text-sm font-semibold">{asset.displayName}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:hidden"
        >
          <X className="size-4" />
        </button>
      </div>
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
