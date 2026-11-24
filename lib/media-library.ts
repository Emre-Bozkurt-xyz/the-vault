/**
 * Pure rules behind the media library's browsing UI (docs/26 §7): view
 * formats, sort orders, and file-manager selection. Client-safe and
 * unit-tested; the components only wire events to these.
 */

export const MEDIA_VIEWS = ["masonry", "grid", "list", "details"] as const;
export type MediaView = (typeof MEDIA_VIEWS)[number];
export const DEFAULT_MEDIA_VIEW: MediaView = "masonry";

export function parseMediaView(value: unknown): MediaView {
  return MEDIA_VIEWS.includes(value as MediaView) ? (value as MediaView) : DEFAULT_MEDIA_VIEW;
}

export const MEDIA_SORTS = ["newest", "oldest", "taken", "name", "size"] as const;
export type MediaSort = (typeof MEDIA_SORTS)[number];

export function parseMediaSort(value: unknown): MediaSort {
  return MEDIA_SORTS.includes(value as MediaSort) ? (value as MediaSort) : "newest";
}

type Sortable = {
  id: string;
  displayName: string;
  sizeBytes: number;
  createdAt: Date | string;
  takenAt?: Date | string | null;
};

function time(value: Date | string | null | undefined) {
  if (!value) return null;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Sorts a copy. Every order ends in the id, so equal keys never reshuffle
 * between renders. "Date taken" is oldest first (an event in the order it
 * happened), falling back to the upload time for files without one.
 */
export function sortMediaAssets<T extends Sortable>(assets: readonly T[], sort: MediaSort): T[] {
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const compare: Record<MediaSort, (a: T, b: T) => number> = {
    newest: (a, b) => (time(b.createdAt) ?? 0) - (time(a.createdAt) ?? 0),
    oldest: (a, b) => (time(a.createdAt) ?? 0) - (time(b.createdAt) ?? 0),
    taken: (a, b) =>
      (time(a.takenAt) ?? time(a.createdAt) ?? 0) - (time(b.takenAt) ?? time(b.createdAt) ?? 0),
    name: (a, b) => nameCollator.compare(a.displayName, b.displayName),
    size: (a, b) => b.sizeBytes - a.sizeBytes,
  };

  return [...assets].sort((a, b) => compare[sort](a, b) || byId(a, b));
}

/**
 * A selection of library items: assets and folders, in the order they were
 * added, plus the anchor a Shift-click ranges from.
 */
export type MediaSelection = {
  assetIds: string[];
  folderIds: string[];
  anchor: string | null;
};

export const EMPTY_SELECTION: MediaSelection = { assetIds: [], folderIds: [], anchor: null };

export type SelectionClick = {
  kind: "asset" | "folder";
  id: string;
  /** Plain click replaces; toggle is Ctrl/Cmd; range is Shift. */
  mode: "replace" | "toggle" | "range";
  /** Items of this kind in display order, for ranges. */
  order: readonly string[];
};

/**
 * File-manager selection. Plain click selects only that item; Ctrl/Cmd adds
 * or removes it; Shift selects everything between the anchor and it (kept
 * within one kind, since folders and files are separate lists on screen).
 */
export function applySelectionClick(
  selection: MediaSelection,
  click: SelectionClick,
): MediaSelection {
  const key = click.kind === "asset" ? "assetIds" : "folderIds";
  const other = click.kind === "asset" ? "folderIds" : "assetIds";

  if (click.mode === "replace") {
    return { ...EMPTY_SELECTION, [key]: [click.id], anchor: click.id };
  }

  if (click.mode === "toggle") {
    const current = selection[key];
    const next = current.includes(click.id)
      ? current.filter((id) => id !== click.id)
      : [...current, click.id];
    return { ...selection, [key]: next, anchor: click.id };
  }

  const anchorIndex = selection.anchor ? click.order.indexOf(selection.anchor) : -1;
  const targetIndex = click.order.indexOf(click.id);
  if (anchorIndex === -1 || targetIndex === -1) {
    return { ...EMPTY_SELECTION, [key]: [click.id], anchor: click.id };
  }

  const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  const range = click.order.slice(from, to + 1);
  const merged = [...selection[key].filter((id) => !range.includes(id)), ...range];
  // A range keeps the anchor where it was, so the next Shift-click re-ranges from it.
  return { ...selection, [key]: merged, [other]: selection[other], anchor: selection.anchor };
}

export function selectAll(assetIds: readonly string[], folderIds: readonly string[]): MediaSelection {
  return { assetIds: [...assetIds], folderIds: [...folderIds], anchor: assetIds[0] ?? folderIds[0] ?? null };
}

/** Drops ids that are no longer on screen (moved, binned, filtered away). */
export function pruneSelection(
  selection: MediaSelection,
  visibleAssetIds: ReadonlySet<string>,
  visibleFolderIds: ReadonlySet<string>,
): MediaSelection {
  const assetIds = selection.assetIds.filter((id) => visibleAssetIds.has(id));
  const folderIds = selection.folderIds.filter((id) => visibleFolderIds.has(id));
  if (assetIds.length === selection.assetIds.length && folderIds.length === selection.folderIds.length) {
    return selection;
  }
  const anchorVisible =
    selection.anchor !== null &&
    (visibleAssetIds.has(selection.anchor) || visibleFolderIds.has(selection.anchor));
  return { assetIds, folderIds, anchor: anchorVisible ? selection.anchor : null };
}

export function selectionSize(selection: MediaSelection) {
  return selection.assetIds.length + selection.folderIds.length;
}

/** How a pointer event's modifiers map to a selection mode. */
export function selectionMode(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): SelectionClick["mode"] {
  if (event.shiftKey) return "range";
  if (event.metaKey || event.ctrlKey) return "toggle";
  return "replace";
}

/** Next index in the viewer: clamped, no wrap-around (like a photo viewer). */
export function stepIndex(index: number, delta: number, length: number) {
  if (length === 0) return -1;
  return Math.min(length - 1, Math.max(0, index + delta));
}

// ── Library preferences ────────────────────────────────────────────────────

/**
 * Saved per user (`files-assets/media-library`): the view format, and whether
 * photo views (masonry, grid) caption every card or only on hover.
 */
export type MediaLibraryPrefs = { view: MediaView; showNames: boolean };

export function parseMediaLibraryPrefs(value: unknown): MediaLibraryPrefs {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { view: parseMediaView(record.view), showNames: record.showNames === true };
}

/** Views that show photos edge to edge, where names can hide until hover. */
export function isPhotoView(view: MediaView) {
  return view === "masonry" || view === "grid";
}

// ── Justified rows (the "Masonry" view) ──────────────────────────────────

/**
 * Narrowest and widest shape a tile may take. Phone screenshots (≈0.46) and
 * ordinary panoramas show whole; anything more extreme is cropped to this so
 * one image can't squash its row to a sliver.
 */
const MIN_TILE_ASPECT = 0.4;
const MAX_TILE_ASPECT = 3;

/** A tile's width ÷ height from stored dimensions; files without a picture are square. */
export function tileAspect(item: { width?: number | null; height?: number | null; pictured: boolean }) {
  if (!item.pictured || !item.width || !item.height || item.width <= 0 || item.height <= 0) return 1;
  return Math.min(MAX_TILE_ASPECT, Math.max(MIN_TILE_ASPECT, item.width / item.height));
}

/**
 * The row height the layout aims for at a container width: about half the
 * width on a phone (one to three tiles a row, depending on their shapes),
 * capped so wide screens get more tiles per row rather than giant ones.
 */
export function justifiedTargetHeight(widthPx: number) {
  return Math.min(220, Math.max(140, widthPx * 0.49));
}

/**
 * Most tiles one row may hold: three on a phone, so a run of screenshots
 * shows three tall tiles rather than four thin ones; more on wide screens.
 */
export function justifiedMaxPerRow(widthPx: number) {
  return Math.max(3, Math.round(widthPx / 220));
}

/** Gap between tiles: hairline on phones, a little more on wide screens. */
export function justifiedGap(widthPx: number) {
  return widthPx < 640 ? 2 : 4;
}

export type JustifiedRow = {
  /** Items `start` (inclusive) to `end` (exclusive), in list order. */
  start: number;
  end: number;
  height: number;
  /** False for a last row left short at the target height instead of stretched. */
  justified: boolean;
};

/**
 * Packs items into rows, like a phone gallery's mosaic: every tile keeps its
 * shape, all tiles in a row share one height, and each row fills the width
 * exactly, so a row holds however many tiles its shapes allow (up to
 * `maxPerRow`: narrow tiles then make a taller row instead of a crowded one).
 * Rows close at whichever break, with or without the next tile, lands nearer
 * the target height. A last row that would be much taller than the target
 * stays at the target, left-aligned. Appending items only changes the last row.
 */
export function justifyRows(
  aspects: readonly number[],
  widthPx: number,
  targetHeight: number,
  gap: number,
  maxPerRow = Number.POSITIVE_INFINITY,
): JustifiedRow[] {
  const rows: JustifiedRow[] = [];
  if (widthPx <= 0 || targetHeight <= 0) return rows;
  const limit = Math.max(1, maxPerRow);
  const distance = (height: number) => Math.abs(height - targetHeight);

  let start = 0;
  while (start < aspects.length) {
    let sum = 0;
    let previous: { end: number; height: number } | null = null;
    let closed = false;

    for (let index = start; index < aspects.length; index += 1) {
      sum += Math.max(aspects[index], 0.01);
      const count = index - start + 1;
      const height = (widthPx - gap * (count - 1)) / sum;
      if (height <= targetHeight) {
        const keep = previous && distance(previous.height) < distance(height) ? previous : { end: index + 1, height };
        rows.push({ start, end: keep.end, height: keep.height, justified: true });
        start = keep.end;
        closed = true;
        break;
      }
      if (count === limit && index < aspects.length - 1) {
        // Full: a taller row of narrow tiles.
        rows.push({ start, end: index + 1, height, justified: true });
        start = index + 1;
        closed = true;
        break;
      }
      previous = { end: index + 1, height };
    }

    if (!closed) {
      // The rest doesn't fill a row: stretch it only if that stays close.
      const height = previous!.height;
      const justified = height <= targetHeight * 1.25;
      rows.push({ start, end: aspects.length, height: justified ? height : targetHeight, justified });
      break;
    }
  }
  return rows;
}

// ── Places ─────────────────────────────────────────────────────────────────

/**
 * Where the library is looking (`/assets?view=`): the folder tree, or every
 * item that is visible outside Vault (a working share link, or listed in the
 * public gallery). The Bin is its own page.
 */
export type LibraryPlace = "files" | "shared";

export function parseLibraryPlace(value: unknown): LibraryPlace {
  return value === "shared" ? "shared" : "files";
}

// ── Context menu ───────────────────────────────────────────────────────────

export type ContextTarget =
  | { kind: "background" }
  | { kind: "asset"; id: string }
  | { kind: "folder"; id: string }
  | { kind: "selection"; assetIds: string[]; folderIds: string[] };

/**
 * What a right-click acts on, like a file manager: empty space is the place
 * itself (the selection stays); an item inside a multi-selection is the whole
 * selection; any other item becomes the selection on its own, so the menu
 * and the highlight always agree.
 */
export function resolveContextTarget(
  selection: MediaSelection,
  clicked: { kind: "asset" | "folder"; id: string } | null,
): { target: ContextTarget; selection: MediaSelection } {
  if (!clicked) return { target: { kind: "background" }, selection };

  const inSelection =
    clicked.kind === "asset"
      ? selection.assetIds.includes(clicked.id)
      : selection.folderIds.includes(clicked.id);
  if (inSelection && selectionSize(selection) > 1) {
    return {
      target: { kind: "selection", assetIds: selection.assetIds, folderIds: selection.folderIds },
      selection,
    };
  }

  const key = clicked.kind === "asset" ? "assetIds" : "folderIds";
  const alreadyAlone = inSelection && selectionSize(selection) === 1;
  return {
    target: { kind: clicked.kind, id: clicked.id },
    selection: alreadyAlone ? selection : { ...EMPTY_SELECTION, [key]: [clicked.id], anchor: clicked.id },
  };
}

/**
 * Up to `count` thumbnails per folder, for folder cards: the newest photos
 * and videos directly inside each folder that have one. One pass over the
 * library, so a page of folders costs the same as one.
 */
export function folderPreviewThumbs<
  T extends { id: string; folderId: string | null; thumbUrl: string | null; createdAt: Date | string },
>(assets: readonly T[], count = 4): Map<string, string[]> {
  const newestFirst = [...assets].sort(
    (a, b) => (time(b.createdAt) ?? 0) - (time(a.createdAt) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const previews = new Map<string, string[]>();
  for (const asset of newestFirst) {
    if (!asset.folderId || !asset.thumbUrl) continue;
    const list = previews.get(asset.folderId) ?? [];
    if (list.length >= count) continue;
    list.push(asset.thumbUrl);
    previews.set(asset.folderId, list);
  }
  return previews;
}
