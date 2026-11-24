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
