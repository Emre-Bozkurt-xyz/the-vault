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
import { JustifiedGrid, type JustifiedEntry } from "@/components/assets/JustifiedGrid";
import { RenditionImage } from "@/components/assets/RenditionImage";
import { assetExtensionBadge, assetTypeLabel } from "@/components/assets/asset-ui";
import { formatBytes } from "@/lib/format";
import { tileAspect, type MediaSort, type MediaView } from "@/lib/media-library";
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
  /** Touch screens: no dragging, so a long-press can select instead. */
  dragDisabled?: boolean;
};

// Square cells with the mosaic's hairline gaps (2px on phones, 4px wider).
const SQUARE_GRID = "grid grid-cols-3 gap-0.5 sm:gap-1 @lg:grid-cols-4 @2xl:grid-cols-5 @5xl:grid-cols-6 @7xl:grid-cols-8";

/**
 * Details columns after Name, shown as the container allows: a phone gets
 * Name, Size and sharing; Added, Type, Folder and Taken join as it widens.
 */
export const DETAILS_COLUMNS = {
  location: "hidden @2xl:table-cell",
  type: "hidden @xl:table-cell",
  size: "",
  taken: "hidden @3xl:table-cell",
  added: "hidden @lg:table-cell",
  sharing: "",
} as const;

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
      // One column that may shrink below its content, so a long name truncates
      // instead of widening the page.
      <div role="list" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
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
          <div key={folder.id} className="relative aspect-square min-w-0">
            <FolderCard folder={folder} handlers={folderHandlers} fill />
          </div>
        ))}
        {shown.map((asset) => (
          <div key={asset.id} className="relative aspect-square min-w-0">
            <PhotoCard asset={asset} {...handlers} />
          </div>
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
 * The "Masonry" view: a phone-gallery mosaic (`JustifiedGrid`). Folders come
 * first as square tiles, then files at their own shapes, in rows that fill
 * the width.
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
  const entries: JustifiedEntry[] = [
    ...folders.map((folder) => ({
      key: `folder:${folder.id}`,
      aspect: 1,
      node: <FolderCard folder={folder} handlers={folderHandlers} fill />,
    })),
    ...assets.map((asset) => ({
      key: asset.id,
      aspect: tileAspect({ width: asset.width, height: asset.height, pictured: isPictured(asset) }),
      node: <PhotoCard asset={asset} {...handlers} />,
    })),
  ];

  return <JustifiedGrid entries={entries} />;
}

/** Whether a file shows as its picture (a photo, or a video with a poster). */
function isPictured(asset: AssetLibraryItem) {
  return (asset.kind === "image" || asset.kind === "video") && asset.thumbUrl !== null;
}

/** Shared item wiring: click with modifiers, Enter opens, double-click opens, drag. */
function itemButtonProps(asset: AssetLibraryItem, handlers: MediaItemHandlers) {
  return {
    type: "button" as const,
    draggable: !handlers.dragDisabled,
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
 * A card in the photo views (mosaic and grid): the picture fills the box the
 * view gives it, edge to edge with barely rounded corners. Names fade in on
 * hover (or keyboard focus) unless names are switched on; files without a
 * picture always show theirs.
 */
function PhotoCard({ asset, ...handlers }: MediaItemHandlers & { asset: AssetLibraryItem }) {
  const selected = handlers.selectedIds.has(asset.id);
  const location = handlers.locationOf?.(asset);
  const visual = isPictured(asset);

  return (
    <div data-asset-card data-asset-id={asset.id} className="group relative size-full select-none">
      <button
        {...itemButtonProps(asset, handlers)}
        className="relative block size-full overflow-hidden rounded-[3px] bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_img]:pointer-events-none"
      >
        <Thumb asset={asset} className="size-full object-cover" />
        {asset.kind === "video" ? (
          <VideoBadge
            durationMs={asset.durationMs ?? null}
            className={visual && !handlers.showNames ? "transition-opacity group-hover:opacity-0" : undefined}
          />
        ) : null}
        {visual ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pb-1.5 pt-8 text-white transition-opacity",
              handlers.showNames ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100",
            )}
          >
            <span className="block truncate text-xs font-medium sm:text-sm">{asset.displayName}</span>
            {location ? <span className="block truncate text-[0.7rem] text-white/75">{location}</span> : null}
          </span>
        ) : (
          // A file without a picture keeps its name on the tile.
          <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-2 py-1 text-xs font-medium backdrop-blur">
            {asset.displayName}
          </span>
        )}
        {selected ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[3px] bg-primary/15 ring-[3px] ring-inset ring-primary"
          />
        ) : null}
      </button>
      <SelectCircle asset={asset} handlers={handlers} className="absolute left-1.5 top-1.5" />
      <ExposureBadges asset={asset} handlers={handlers} className="absolute right-1.5 top-1.5" />
    </div>
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
          "flex w-full min-w-0 items-center gap-3 rounded-md border px-2 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          selected
            ? "border-primary/60 bg-primary/10"
            : "border-transparent hover:border-border/70 hover:bg-muted/50",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded bg-muted">
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
      {/* Over the thumbnail, so the row needs no gutter for it. */}
      <SelectCircle asset={asset} handlers={handlers} className="absolute left-3.5 top-1/2 -translate-y-1/2" />
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
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="w-full py-2 pl-2 pr-3 font-medium">
              <SortHeader label="Name" active={sort === "name"} onClick={() => onSortChange("name")} />
            </th>
            {showLocation ? <th className={cn("py-2 pr-3 font-medium", DETAILS_COLUMNS.location)}>Folder</th> : null}
            <th className={cn("py-2 pr-3 font-medium", DETAILS_COLUMNS.type)}>Type</th>
            <th className="py-2 pr-3 text-right font-medium">
              <SortHeader label="Size" active={sort === "size"} direction="down" onClick={() => onSortChange("size")} />
            </th>
            <th className={cn("py-2 pr-3 font-medium", DETAILS_COLUMNS.taken)}>
              <SortHeader label="Taken" active={sort === "taken"} direction="up" onClick={() => onSortChange("taken")} />
            </th>
            <th className={cn("py-2 pr-3 font-medium", DETAILS_COLUMNS.added)}>
              <SortHeader
                label="Added"
                active={sort === "newest" || sort === "oldest"}
                direction={sort === "oldest" ? "up" : "down"}
                onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
              />
            </th>
            <th className="w-10 py-2 pr-2" aria-label="Sharing" />
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <FolderTableRow
              key={folder.id}
              folder={folder}
              handlers={folderHandlers}
              cells={(summary) => (
                <>
                  {showLocation ? <td className={DETAILS_COLUMNS.location} /> : null}
                  <td className={cn("whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground", DETAILS_COLUMNS.type)}>
                    Folder
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right text-xs text-muted-foreground">{summary}</td>
                  <td className={DETAILS_COLUMNS.taken} />
                  <td className={DETAILS_COLUMNS.added} />
                </>
              )}
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
      <td className="relative max-w-0 py-1.5 pl-2 pr-3">
        <button
          {...itemButtonProps(asset, handlers)}
          className="flex w-full min-w-0 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-muted">
            <Thumb asset={asset} className="size-full object-cover" />
          </span>
          <span className="truncate font-medium">{asset.displayName}</span>
        </button>
        {/* Over the thumbnail: no column of its own. */}
        <SelectCircle asset={asset} handlers={handlers} className="absolute left-4 top-1/2 -translate-y-1/2" />
      </td>
      {showLocation ? (
        <td className={cn("max-w-40 truncate py-1.5 pr-3 text-xs text-muted-foreground", DETAILS_COLUMNS.location)}>
          {handlers.locationOf?.(asset)}
        </td>
      ) : null}
      <td className={cn("whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground", DETAILS_COLUMNS.type)}>
        {assetTypeLabel(asset)}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-right text-xs tabular-nums text-muted-foreground">
        {formatBytes(asset.sizeBytes)}
      </td>
      <td
        suppressHydrationWarning
        className={cn("whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground", DETAILS_COLUMNS.taken)}
      >
        {asset.takenAt ? formatDay(asset.takenAt, true) : "—"}
      </td>
      <td
        suppressHydrationWarning
        className={cn("whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground", DETAILS_COLUMNS.added)}
      >
        {formatDay(asset.createdAt, false)}
      </td>
      <td className="py-1.5 pr-2">
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
