"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  File as FileIcon,
  FileText,
  Film,
  Globe2,
  ImageIcon,
  Link2,
  Play,
} from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import {
  FolderCard,
  FolderRow,
  FolderTableRow,
  SharedBadge,
  type FolderItemHandlers,
  type FolderTileData,
} from "@/components/assets/FolderTiles";
import { MasonryGrid, type MasonryEntry } from "@/components/assets/MasonryGrid";
import { RenditionImage } from "@/components/assets/RenditionImage";
import { assetExtensionBadge, assetTypeLabel } from "@/components/assets/asset-ui";
import { formatBytes } from "@/lib/format";
import { masonryColumnCount, type MediaSort, type MediaView } from "@/lib/media-library";
import { cn } from "@/lib/utils";

/**
 * The four ways the library lists a place (docs/26 §7): masonry (the default
 * look), a square grid for big dumps, a compact list, and a details table.
 * Folders always come first, in the same columns or rows as the files. All
 * share one contract with the page: click selects (with modifiers),
 * double-click/Enter opens, drag moves, right-click is the page's context
 * menu (items carry `data-asset-id` / `data-folder-id` for it). Files render
 * progressively, so a folder of thousands of photos doesn't build thousands
 * of cards up front.
 */

export const RENDER_STEP = 150;

export type MediaItemHandlers = {
  selectedIds: ReadonlySet<string>;
  /** True while selecting several: shows every card's tick circle. */
  selecting: boolean;
  onItemClick: (asset: AssetLibraryItem, event: MouseEvent) => void;
  /** The round checkbox: always a toggle, for touch and mouse alike. */
  onItemToggle: (asset: AssetLibraryItem) => void;
  onItemOpen: (asset: AssetLibraryItem) => void;
  onItemDragStart: (asset: AssetLibraryItem, event: DragEvent) => void;
  /** Where a file lives, shown while searching across folders. */
  locationOf?: (asset: AssetLibraryItem) => string | null;
  /** Files with a working share link (link badge). */
  sharedIds?: ReadonlySet<string>;
  /** Photo views: caption every card, or only on hover. */
  showNames: boolean;
};

// Only until the masonry has measured its width (server render, first paint
// of a hard load): plain CSS columns with the same counts.
const MASONRY_FALLBACK = "columns-2 gap-3 @2xl:columns-3 @5xl:columns-4 @7xl:columns-5";
const MASONRY_GAP = 12;
// The name and meta lines under a masonry card (px-3 py-2.5, two lines).
const MASONRY_CAPTION = 58;
const SQUARE_GRID = "grid grid-cols-3 gap-2 @lg:grid-cols-4 @2xl:grid-cols-5 @5xl:grid-cols-6 @7xl:grid-cols-8";

export function MediaItemView({
  view,
  assets,
  folders,
  folderHandlers,
  sort,
  onSortChange,
  ...handlers
}: MediaItemHandlers & {
  view: MediaView;
  assets: AssetLibraryItem[];
  folders: FolderTileData[];
  folderHandlers: FolderItemHandlers;
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
}) {
  // The parent keys this component by place/search/sort/view, so the count
  // starts over whenever the list itself changes.
  const [limit, setLimit] = useState(RENDER_STEP);
  const sentinel = useRef<HTMLDivElement>(null);
  const shown = assets.slice(0, limit);
  const more = assets.length > limit;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((current) => current + RENDER_STEP);
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, limit]);

  const body =
    view === "details" ? (
      <DetailsTable
        assets={shown}
        folders={folders}
        folderHandlers={folderHandlers}
        sort={sort}
        onSortChange={onSortChange}
        {...handlers}
      />
    ) : view === "list" ? (
      <div role="list" className="grid gap-1">
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} handlers={folderHandlers} />
        ))}
        {shown.map((asset) => (
          <ListRow key={asset.id} asset={asset} {...handlers} />
        ))}
      </div>
    ) : view === "grid" ? (
      <div className={cn("min-w-0", SQUARE_GRID)}>
        {folders.map((folder) => (
          <FolderCard key={folder.id} folder={folder} handlers={folderHandlers} />
        ))}
        {shown.map((asset) => (
          <PhotoCard key={asset.id} asset={asset} square {...handlers} />
        ))}
      </div>
    ) : (
      <Masonry assets={shown} folders={folders} folderHandlers={folderHandlers} handlers={handlers} />
    );

  return (
    <>
      {body}
      {more ? (
        <div ref={sentinel} className="py-6 text-center text-xs text-muted-foreground">
          Showing {shown.length.toLocaleString()} of {assets.length.toLocaleString()}…
        </div>
      ) : null}
    </>
  );
}

/**
 * Masonry with folders as ordinary items: one list (folders first, then
 * files) in shortest-column order (`MasonryGrid`), so a lone folder takes one
 * card's place in the first row rather than a row of its own.
 */
function Masonry({
  assets,
  folders,
  folderHandlers,
  handlers,
}: {
  assets: AssetLibraryItem[];
  folders: FolderTileData[];
  folderHandlers: FolderItemHandlers;
  handlers: MediaItemHandlers;
}) {
  const entries: MasonryEntry[] = [
    ...folders.map((folder) => ({
      key: `folder:${folder.id}`,
      estimate: (columnWidth: number) => columnWidth,
      node: (
        <div className="mb-3">
          <FolderCard folder={folder} handlers={folderHandlers} />
        </div>
      ),
    })),
    ...assets.map((asset) => ({
      key: asset.id,
      estimate: (columnWidth: number) => masonryCardHeight(asset, columnWidth, handlers.showNames),
      node: <PhotoCard asset={asset} square={false} {...handlers} />,
    })),
  ];

  return (
    <MasonryGrid
      entries={entries}
      columnsFor={masonryColumnCount}
      gap={MASONRY_GAP}
      fallbackClassName={MASONRY_FALLBACK}
    />
  );
}

/** A masonry card's height in px, as `PhotoCard`/`MasonryThumb` will draw it. */
function masonryCardHeight(asset: AssetLibraryItem, columnWidth: number, showNames: boolean) {
  const visual = (asset.kind === "image" || asset.kind === "video") && asset.thumbUrl !== null;
  const ratio =
    visual && asset.width && asset.height && asset.width > 0 && asset.height > 0
      ? asset.height / asset.width
      : 3 / 4;
  const caption = showNames || !visual ? MASONRY_CAPTION : 0;
  return columnWidth * ratio + caption;
}

/** Shared item wiring: click with modifiers, Enter opens, double-click opens, drag. */
function itemButtonProps(asset: AssetLibraryItem, handlers: MediaItemHandlers) {
  return {
    type: "button" as const,
    draggable: true,
    "aria-pressed": handlers.selectedIds.has(asset.id),
    "aria-label": asset.displayName,
    onDragStart: (event: DragEvent) => handlers.onItemDragStart(asset, event),
    onClick: (event: MouseEvent) => handlers.onItemClick(asset, event),
    onDoubleClick: () => handlers.onItemOpen(asset),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        handlers.onItemOpen(asset);
      }
    },
  };
}

function SelectCircle({
  asset,
  handlers,
  className,
}: {
  asset: AssetLibraryItem;
  handlers: MediaItemHandlers;
  className?: string;
}) {
  const selected = handlers.selectedIds.has(asset.id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? `Deselect ${asset.displayName}` : `Select ${asset.displayName}`}
      onClick={(event) => {
        event.stopPropagation();
        handlers.onItemToggle(asset);
      }}
      className={cn(
        "grid size-6 place-items-center rounded-full border shadow-sm backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected
          ? "border-primary bg-primary text-primary-foreground opacity-100"
          : cn(
              "border-white/80 bg-black/25 text-transparent hover:bg-black/40",
              handlers.selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            ),
        className,
      )}
    >
      <Check className="size-3.5" />
    </button>
  );
}

/** Link and public-gallery marks: only what is visible outside Vault gets one. */
function ExposureBadges({
  asset,
  handlers,
  className,
}: {
  asset: AssetLibraryItem;
  handlers: MediaItemHandlers;
  className?: string;
}) {
  const linked = handlers.sharedIds?.has(asset.id) ?? false;
  const listed = asset.visibility === "public";
  if (!linked && !listed) return null;
  return (
    <span className={cn("flex gap-1", className)}>
      {linked ? <SharedBadge /> : null}
      {listed ? <SharedBadge icon={Globe2} label="Public in gallery" /> : null}
    </span>
  );
}

/**
 * A card in the photo views. Photos and posters fill it edge to edge, with
 * the name fading in on hover unless names are switched on; files without a
 * picture always show theirs.
 */
function PhotoCard({
  asset,
  square,
  ...handlers
}: MediaItemHandlers & { asset: AssetLibraryItem; square: boolean }) {
  const selected = handlers.selectedIds.has(asset.id);
  const location = handlers.locationOf?.(asset);
  const visual = (asset.kind === "image" || asset.kind === "video") && asset.thumbUrl !== null;
  const hoverCaption = !handlers.showNames && visual;
  const meta = `${assetTypeLabel(asset)} · ${formatBytes(asset.sizeBytes)}${location ? ` · ${location}` : ""}`;

  return (
    <div
      data-asset-card
      data-asset-id={asset.id}
      className={cn("group relative break-inside-avoid", square ? "" : "mb-3")}
    >
      <button
        {...itemButtonProps(asset, handlers)}
        className={cn(
          "relative block w-full overflow-hidden rounded-md text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          handlers.showNames ? "border bg-card shadow-sm hover:shadow-md" : "bg-muted",
          selected
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : handlers.showNames
              ? "border-border/70 hover:border-primary/50"
              : "",
        )}
      >
        {square ? (
          <span className="relative block aspect-square bg-muted">
            <Thumb asset={asset} className="size-full object-cover" />
          </span>
        ) : (
          <MasonryThumb asset={asset} />
        )}
        {asset.kind === "video" ? (
          <VideoBadge
            durationMs={asset.durationMs ?? null}
            className={hoverCaption ? "transition-opacity group-hover:opacity-0" : undefined}
          />
        ) : null}

        {hoverCaption ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pb-2 pt-10 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <span className="block truncate text-sm font-medium">{asset.displayName}</span>
            {square ? null : <span className="block truncate text-xs text-white/75">{meta}</span>}
          </span>
        ) : square && !handlers.showNames ? (
          // A file in the square grid keeps its name inside the square.
          <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-2 py-1 text-xs font-medium backdrop-blur">
            {asset.displayName}
          </span>
        ) : (
          <span className={cn("block", square ? "px-2 py-1.5" : "px-3 py-2.5")}>
            <span className={cn("block truncate font-medium", square ? "text-xs" : "text-sm")}>
              {asset.displayName}
            </span>
            {square ? null : (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>
            )}
          </span>
        )}
        {selected ? <span aria-hidden className="pointer-events-none absolute inset-0 bg-primary/12" /> : null}
      </button>
      <SelectCircle asset={asset} handlers={handlers} className="absolute left-2 top-2" />
      <ExposureBadges asset={asset} handlers={handlers} className="absolute right-2 top-2" />
    </div>
  );
}

function MasonryThumb({ asset }: { asset: AssetLibraryItem }) {
  const tile = <FileTile asset={asset} className="aspect-[4/3]" />;
  if (asset.kind !== "image" && asset.kind !== "video") return tile;
  return (
    <span className="relative block bg-muted">
      <RenditionImage
        src={asset.thumbUrl}
        alt={asset.altText ?? asset.displayName}
        width={asset.width}
        height={asset.height}
        className="h-auto w-full object-cover"
        fallback={tile}
      />
    </span>
  );
}

/** A thumbnail that fills its box (grid, list, details). */
function Thumb({ asset, className }: { asset: AssetLibraryItem; className: string }) {
  const tile = <FileTile asset={asset} className="size-full" compact />;
  if (asset.kind !== "image" && asset.kind !== "video") return tile;
  return (
    <RenditionImage
      src={asset.thumbUrl}
      alt={asset.altText ?? asset.displayName}
      className={className}
      fallback={tile}
    />
  );
}

function ExposureIcons({ asset, handlers }: { asset: AssetLibraryItem; handlers: MediaItemHandlers }) {
  return (
    <span className="flex w-10 shrink-0 justify-end gap-1.5 text-primary">
      {handlers.sharedIds?.has(asset.id) ? <Link2 className="size-3.5" aria-label="Shared by link" /> : null}
      {asset.visibility === "public" ? <Globe2 className="size-3.5" aria-label="Public in gallery" /> : null}
    </span>
  );
}

function ListRow({ asset, ...handlers }: MediaItemHandlers & { asset: AssetLibraryItem }) {
  const selected = handlers.selectedIds.has(asset.id);
  const location = handlers.locationOf?.(asset);

  return (
    <div role="listitem" data-asset-card data-asset-id={asset.id} className="group relative">
      <button
        {...itemButtonProps(asset, handlers)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md border px-2 py-1.5 pl-10 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          selected
            ? "border-primary/60 bg-primary/10"
            : "border-transparent hover:border-border/70 hover:bg-muted/50",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted">
          <Thumb asset={asset} className="size-full object-cover" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{asset.displayName}</span>
        <ExposureIcons asset={asset} handlers={handlers} />
        {location ? (
          <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground @2xl:block">
            {location}
          </span>
        ) : null}
        <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground @xl:block">
          {assetTypeLabel(asset)}
        </span>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatBytes(asset.sizeBytes)}
        </span>
        <span suppressHydrationWarning className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground @3xl:block">
          {formatDay(asset.takenAt ?? asset.createdAt, Boolean(asset.takenAt))}
        </span>
      </button>
      <SelectCircle
        asset={asset}
        handlers={handlers}
        className="absolute left-2 top-1/2 -translate-y-1/2 border-border bg-background/80"
      />
    </div>
  );
}

function DetailsTable({
  assets,
  folders,
  folderHandlers,
  sort,
  onSortChange,
  ...handlers
}: MediaItemHandlers & {
  assets: AssetLibraryItem[];
  folders: FolderTileData[];
  folderHandlers: FolderItemHandlers;
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
}) {
  const showLocation = Boolean(handlers.locationOf);

  return (
    <div className="overflow-x-auto rounded-md border border-border/70">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="w-10 px-2 py-2" aria-label="Selection" />
            <th className="py-2 pr-3 font-medium">
              <SortHeader label="Name" active={sort === "name"} onClick={() => onSortChange("name")} />
            </th>
            {showLocation ? <th className="py-2 pr-3 font-medium">Folder</th> : null}
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 text-right font-medium">
              <SortHeader label="Size" active={sort === "size"} direction="down" onClick={() => onSortChange("size")} />
            </th>
            <th className="py-2 pr-3 font-medium">
              <SortHeader label="Taken" active={sort === "taken"} direction="up" onClick={() => onSortChange("taken")} />
            </th>
            <th className="py-2 pr-3 font-medium">
              <SortHeader
                label="Added"
                active={sort === "newest" || sort === "oldest"}
                direction={sort === "oldest" ? "up" : "down"}
                onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
              />
            </th>
            <th className="w-14 py-2 pr-3" aria-label="Sharing" />
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <FolderTableRow
              key={folder.id}
              folder={folder}
              handlers={folderHandlers}
              columns={showLocation ? 6 : 5}
            />
          ))}
          {assets.map((asset) => (
            <DetailsRow key={asset.id} asset={asset} showLocation={showLocation} {...handlers} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailsRow({
  asset,
  showLocation,
  ...handlers
}: MediaItemHandlers & { asset: AssetLibraryItem; showLocation: boolean }) {
  const selected = handlers.selectedIds.has(asset.id);

  return (
    <tr
      data-asset-card
      data-asset-id={asset.id}
      className={cn(
        "group border-b border-border/50 last:border-b-0",
        selected ? "bg-primary/10" : "hover:bg-muted/40",
      )}
    >
      <td className="px-2 py-1.5">
        <SelectCircle asset={asset} handlers={handlers} className="border-border bg-background/80" />
      </td>
      <td className="max-w-0 py-1.5 pr-3">
        <button
          {...itemButtonProps(asset, handlers)}
          className="flex w-full min-w-0 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-muted">
            <Thumb asset={asset} className="size-full object-cover" />
          </span>
          <span className="truncate font-medium">{asset.displayName}</span>
        </button>
      </td>
      {showLocation ? (
        <td className="max-w-40 truncate py-1.5 pr-3 text-xs text-muted-foreground">
          {handlers.locationOf?.(asset)}
        </td>
      ) : null}
      <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">{assetTypeLabel(asset)}</td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-right text-xs tabular-nums text-muted-foreground">
        {formatBytes(asset.sizeBytes)}
      </td>
      <td suppressHydrationWarning className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">
        {asset.takenAt ? formatDay(asset.takenAt, true) : "—"}
      </td>
      <td suppressHydrationWarning className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">
        {formatDay(asset.createdAt, false)}
      </td>
      <td className="py-1.5 pr-3">
        <ExposureIcons asset={asset} handlers={handlers} />
      </td>
    </tr>
  );
}

function SortHeader({
  label,
  active,
  direction = "up",
  onClick,
}: {
  label: string;
  active: boolean;
  direction?: "up" | "down";
  onClick: () => void;
}) {
  const Arrow = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
    >
      {label}
      {active ? <Arrow className="size-3" aria-hidden /> : null}
    </button>
  );
}

function FileTile({
  asset,
  className,
  compact = false,
}: {
  asset: Pick<AssetLibraryItem, "kind" | "displayName" | "mimeType">;
  className?: string;
  compact?: boolean;
}) {
  const Icon =
    asset.kind === "image"
      ? ImageIcon
      : asset.kind === "pdf"
        ? FileText
        : asset.kind === "video"
          ? Film
          : FileIcon;
  return (
    <span
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <Icon className={compact ? "size-4" : "size-9"} />
      {compact ? null : (
        <span className="rounded border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tracking-wider">
          {assetExtensionBadge(asset)}
        </span>
      )}
    </span>
  );
}

/** Play mark and running time over a video's poster. */
function VideoBadge({ durationMs, className }: { durationMs: number | null; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-2 right-2 z-[1] inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[0.7rem] font-medium text-white tabular-nums",
        className,
      )}
    >
      <Play className="size-3 fill-current" aria-hidden />
      {durationMs ? formatDuration(durationMs) : "Video"}
    </span>
  );
}

/** 0:42, 3:07, 1:02:09. */
export function formatDuration(durationMs: number) {
  const total = Math.round(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * A short date. "Taken" times are the camera's wall clock stored as UTC
 * (`lib/exif-date.ts`), so they're formatted in UTC to show what the camera said.
 */
export function formatDay(value: Date | string, cameraClock: boolean) {
  return (value instanceof Date ? value : new Date(value)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(cameraClock ? { timeZone: "UTC" } : {}),
  });
}
