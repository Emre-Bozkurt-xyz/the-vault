"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Check, File as FileIcon, FileText, Globe2, ImageIcon, Lock } from "lucide-react";

import type { AssetLibraryItem } from "@/components/assets/AssetLibraryClient";
import { RenditionImage } from "@/components/assets/RenditionImage";
import { assetExtensionBadge, assetTypeLabel } from "@/components/assets/asset-ui";
import { WithContextMenu, type ContextMenuController } from "@/components/ui/use-context-menu";
import { formatBytes } from "@/lib/format";
import type { MediaSort, MediaView } from "@/lib/media-library";
import { cn } from "@/lib/utils";

/**
 * The four ways the library lists files (docs/26 §7): masonry (the default
 * look), a square grid for big dumps, a compact list, and a details table.
 * All share one contract with the page — click selects (with modifiers),
 * double-click/Enter opens the viewer, drag moves — and render progressively,
 * so a folder of thousands of photos doesn't build thousands of cards up
 * front.
 */

export const RENDER_STEP = 150;

export type MediaItemHandlers = {
  selectedIds: ReadonlySet<string>;
  /** True while anything is selected: shows every card's select circle. */
  selecting: boolean;
  onItemClick: (asset: AssetLibraryItem, event: MouseEvent) => void;
  /** The round checkbox: always a toggle, for touch and mouse alike. */
  onItemToggle: (asset: AssetLibraryItem) => void;
  onItemOpen: (asset: AssetLibraryItem) => void;
  onItemDragStart: (asset: AssetLibraryItem, event: DragEvent) => void;
  renderActions: (asset: AssetLibraryItem, menu: ContextMenuController, className: string) => ReactNode;
  /** Where a file lives, shown while searching across folders. */
  locationOf?: (asset: AssetLibraryItem) => string | null;
};

export function MediaItemView({
  view,
  assets,
  sort,
  onSortChange,
  ...handlers
}: MediaItemHandlers & {
  view: MediaView;
  assets: AssetLibraryItem[];
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
}) {
  // The parent keys this component by folder/search/sort/view, so the count
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
      <DetailsTable assets={shown} sort={sort} onSortChange={onSortChange} {...handlers} />
    ) : view === "list" ? (
      <div role="list" className="grid gap-1">
        {shown.map((asset) => (
          <ListRow key={asset.id} asset={asset} {...handlers} />
        ))}
      </div>
    ) : (
      <div
        className={cn(
          "min-w-0",
          view === "grid"
            ? "grid grid-cols-2 gap-3 @md:grid-cols-3 @2xl:grid-cols-4 @5xl:grid-cols-6 @7xl:grid-cols-8"
            : "columns-1 gap-4 @sm:columns-2 @2xl:columns-3 @5xl:columns-4 @7xl:columns-5",
        )}
      >
        {shown.map((asset) => (
          <Card key={asset.id} asset={asset} square={view === "grid"} {...handlers} />
        ))}
      </div>
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

/** Shared item wiring: click with modifiers, Enter opens, double-click opens, drag. */
function itemButtonProps(asset: AssetLibraryItem, handlers: MediaItemHandlers) {
  return {
    type: "button" as const,
    draggable: true,
    "aria-pressed": handlers.selectedIds.has(asset.id),
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

const actionsClass =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100";

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
              handlers.selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            ),
        className,
      )}
    >
      <Check className="size-3.5" />
    </button>
  );
}

function Card({
  asset,
  square,
  ...handlers
}: MediaItemHandlers & { asset: AssetLibraryItem; square: boolean }) {
  const selected = handlers.selectedIds.has(asset.id);
  const location = handlers.locationOf?.(asset);

  return (
    <WithContextMenu>
      {(menu) => (
        <div
          data-asset-card
          onContextMenu={menu.onContextMenu}
          className={cn("group relative break-inside-avoid", square ? "" : "mb-4")}
        >
          <button
            {...itemButtonProps(asset, handlers)}
            className={cn(
              "block w-full overflow-hidden rounded-md border bg-card text-left shadow-sm transition hover:border-primary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              selected ? "border-primary ring-2 ring-primary/45" : "border-border/70",
            )}
          >
            {square ? (
              <span className="block aspect-square bg-muted">
                <Thumb asset={asset} className="size-full object-cover" />
              </span>
            ) : (
              <MasonryThumb asset={asset} />
            )}
            <span className={cn("flex items-center gap-2", square ? "px-2 py-1.5" : "px-3 py-2.5")}>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate font-medium", square ? "text-xs" : "text-sm")}>
                  {asset.displayName}
                </span>
                {square ? null : (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {assetTypeLabel(asset)} · {formatBytes(asset.sizeBytes)}
                    {location ? ` · ${location}` : ""}
                  </span>
                )}
              </span>
              {square ? null : <VisibilityIcon visibility={asset.visibility} />}
            </span>
          </button>
          <SelectCircle asset={asset} handlers={handlers} className="absolute left-2 top-2" />
          {handlers.renderActions(asset, menu, cn("absolute right-2 top-2", actionsClass))}
        </div>
      )}
    </WithContextMenu>
  );
}

function MasonryThumb({ asset }: { asset: AssetLibraryItem }) {
  const tile = <FileTile asset={asset} className="aspect-[4/3]" />;
  if (asset.kind !== "image") return tile;
  return (
    <span className="block bg-muted">
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
  if (asset.kind !== "image") return tile;
  return (
    <RenditionImage
      src={asset.thumbUrl}
      alt={asset.altText ?? asset.displayName}
      className={className}
      fallback={tile}
    />
  );
}

function ListRow({ asset, ...handlers }: MediaItemHandlers & { asset: AssetLibraryItem }) {
  const selected = handlers.selectedIds.has(asset.id);
  const location = handlers.locationOf?.(asset);

  return (
    <WithContextMenu>
      {(menu) => (
        <div
          role="listitem"
          data-asset-card
          onContextMenu={menu.onContextMenu}
          className="group relative"
        >
          <button
            {...itemButtonProps(asset, handlers)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border px-2 py-1.5 pl-10 pr-12 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              selected
                ? "border-primary/60 bg-primary/10"
                : "border-transparent hover:border-border/70 hover:bg-muted/50",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted">
              <Thumb asset={asset} className="size-full object-cover" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{asset.displayName}</span>
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
          {handlers.renderActions(asset, menu, cn("absolute right-1.5 top-1/2 -translate-y-1/2", actionsClass))}
        </div>
      )}
    </WithContextMenu>
  );
}

function DetailsTable({
  assets,
  sort,
  onSortChange,
  ...handlers
}: MediaItemHandlers & {
  assets: AssetLibraryItem[];
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
            <th className="w-10 py-2 pr-2" aria-label="Visibility" />
            <th className="w-12 py-2 pr-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
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
    <WithContextMenu>
      {(menu) => (
        <tr
          data-asset-card
          onContextMenu={menu.onContextMenu}
          className={cn(
            "group border-b border-border/50 last:border-b-0",
            selected ? "bg-primary/10" : "hover:bg-muted/40",
          )}
        >
          <td className="px-2 py-1.5">
            <SelectCircle asset={asset} handlers={handlers} className="border-border bg-background/80" />
          </td>
          <td className="max-w-0 py-1.5 pr-3">
            <button {...itemButtonProps(asset, handlers)} className="flex w-full min-w-0 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
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
          <td className="py-1.5 pr-2">
            <VisibilityIcon visibility={asset.visibility} />
          </td>
          <td className="relative py-1.5 pr-2">
            {handlers.renderActions(asset, menu, cn("relative", actionsClass))}
          </td>
        </tr>
      )}
    </WithContextMenu>
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
  const Icon = asset.kind === "image" ? ImageIcon : asset.kind === "pdf" ? FileText : FileIcon;
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

function VisibilityIcon({ visibility }: { visibility: "private" | "public" }) {
  const Icon = visibility === "public" ? Globe2 : Lock;
  const label = visibility === "public" ? "Public" : "Private";
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border",
        visibility === "public"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground",
      )}
      title={label}
    >
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
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
