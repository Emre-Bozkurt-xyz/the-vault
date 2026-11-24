import { describe, expect, it } from "vitest";

import {
  EMPTY_SELECTION,
  applySelectionClick,
  folderPreviewThumbs,
  isPhotoView,
  justifiedGap,
  justifiedMaxPerRow,
  justifiedTargetHeight,
  justifyRows,
  parseLibraryPlace,
  parseMediaLibraryPrefs,
  resolveContextTarget,
  parseMediaSort,
  parseMediaView,
  pruneSelection,
  selectAll,
  selectionMode,
  selectionSize,
  sortMediaAssets,
  stepIndex,
  tileAspect,
} from "@/lib/media-library";

describe("justified rows", () => {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  it("fills each row's width exactly, at a shared height", () => {
    const aspects = [4 / 3, 4 / 3, 0.75, 0.46, 0.46, 4 / 3, 4 / 3, 4 / 3];
    const rows = justifyRows(aspects, 390, 195, 2);
    for (const row of rows.filter((candidate) => candidate.justified)) {
      const slice = aspects.slice(row.start, row.end);
      const width = sum(slice.map((aspect) => aspect * row.height)) + 2 * (slice.length - 1);
      expect(width).toBeCloseTo(390, 6);
    }
    // Every item placed once, in order.
    expect(rows.map((row) => [row.start, row.end]).flat()[0]).toBe(0);
    expect(rows.at(-1)!.end).toBe(aspects.length);
    rows.slice(1).forEach((row, index) => expect(row.start).toBe(rows[index].end));
  });

  it("puts more tiles in a row when they are narrow, like a phone gallery", () => {
    const phone = (aspects: number[]) =>
      justifyRows(aspects, 390, justifiedTargetHeight(390), 2, justifiedMaxPerRow(390));
    // Three phone screenshots share a tall row; two landscape photos share a short one.
    const screenshots = phone([0.46, 0.46, 0.46, 0.46, 0.46, 0.46]);
    expect(screenshots[0]).toMatchObject({ start: 0, end: 3 });
    expect(screenshots[0].height).toBeGreaterThan(250);
    expect(phone([1.5, 1.5, 1.5, 1.5])[0]).toMatchObject({ start: 0, end: 2 });
    expect(phone([4 / 3, 4 / 3, 4 / 3, 4 / 3])[0]).toMatchObject({ start: 0, end: 2 });
    // A portrait and two screenshots, like the reference.
    expect(phone([0.75, 0.46, 0.46, 1.33, 1.33])[0]).toMatchObject({ start: 0, end: 3 });
    // A panorama gets a row to itself.
    expect(phone([3, 1, 1])[0]).toMatchObject({ start: 0, end: 1 });
  });

  it("leaves a short last row at the target height instead of blowing it up", () => {
    const rows = justifyRows([1.5, 1.5, 1], 390, 190, 2);
    expect(rows.at(-1)).toMatchObject({ start: 2, end: 3, height: 190, justified: false });
    // A last row that nearly fills is stretched to fit.
    const near = justifyRows([1, 1], 420, 195, 2);
    expect(near.at(-1)!.justified).toBe(true);
  });

  it("only changes the last row when items are appended", () => {
    const aspects = [1.5, 0.75, 0.75, 1.33, 0.46, 0.46, 1.5, 1];
    const first = justifyRows(aspects.slice(0, 6), 800, 260, 4);
    const more = justifyRows(aspects, 800, 260, 4);
    expect(more.slice(0, first.length - 1)).toEqual(first.slice(0, -1));
  });

  it("handles nothing to lay out", () => {
    expect(justifyRows([], 390, 195, 2)).toEqual([]);
    expect(justifyRows([1], 0, 195, 2)).toEqual([]);
  });

  it("keeps tile shapes within bounds and scales row height with the screen", () => {
    expect(tileAspect({ width: 4000, height: 3000, pictured: true })).toBeCloseTo(4 / 3);
    expect(tileAspect({ width: 9000, height: 1000, pictured: true })).toBe(3);
    expect(tileAspect({ width: 100, height: 1000, pictured: true })).toBe(0.4);
    expect(tileAspect({ width: 4000, height: 3000, pictured: false })).toBe(1);
    expect(tileAspect({ width: null, height: null, pictured: true })).toBe(1);
    expect(justifiedTargetHeight(390)).toBeCloseTo(191.1);
    expect(justifiedTargetHeight(1400)).toBe(220);
    expect(justifiedTargetHeight(200)).toBe(140);
    expect([justifiedGap(390), justifiedGap(1200)]).toEqual([2, 4]);
    expect([justifiedMaxPerRow(390), justifiedMaxPerRow(1100)]).toEqual([3, 5]);
  });

  it("caps a row at the most tiles allowed", () => {
    const rows = justifyRows([0.46, 0.46, 0.46, 0.46, 0.46], 390, 191, 2, 3);
    expect(rows.map((row) => row.end - row.start)).toEqual([3, 2]);
  });
});

describe("parsers", () => {
  it("falls back to masonry and newest", () => {
    expect(parseMediaView("details")).toBe("details");
    expect(parseMediaView("carousel")).toBe("masonry");
    expect(parseMediaView(undefined)).toBe("masonry");
    expect(parseMediaSort("taken")).toBe("taken");
    expect(parseMediaSort("random")).toBe("newest");
  });
});

describe("sortMediaAssets", () => {
  const items = [
    { id: "b", displayName: "IMG_10.jpg", sizeBytes: 300, createdAt: "2026-11-02T00:00:00Z", takenAt: "2026-10-01T10:00:00Z" },
    { id: "a", displayName: "IMG_9.jpg", sizeBytes: 100, createdAt: "2026-11-01T00:00:00Z", takenAt: "2026-10-01T09:00:00Z" },
    { id: "c", displayName: "img_2.jpg", sizeBytes: 200, createdAt: "2026-11-03T00:00:00Z", takenAt: null },
    { id: "d", displayName: "IMG_9.jpg", sizeBytes: 100, createdAt: "2026-11-01T00:00:00Z", takenAt: "2026-10-01T09:00:00Z" },
  ];
  const ids = (sort: Parameters<typeof sortMediaAssets>[1]) => sortMediaAssets(items, sort).map((item) => item.id);

  it("sorts by upload time either way, ties broken by id", () => {
    expect(ids("newest")).toEqual(["c", "b", "a", "d"]);
    expect(ids("oldest")).toEqual(["a", "d", "b", "c"]);
  });

  it("orders by date taken, oldest first, falling back to the upload time", () => {
    expect(ids("taken")).toEqual(["a", "d", "b", "c"]);
  });

  it("sorts names naturally and case-insensitively", () => {
    expect(ids("name")).toEqual(["c", "a", "d", "b"]);
  });

  it("sorts by size, largest first, without mutating the input", () => {
    expect(ids("size")).toEqual(["b", "c", "a", "d"]);
    expect(items[0].id).toBe("b");
  });
});

describe("selection", () => {
  const order = ["1", "2", "3", "4", "5"];
  const click = (selection: typeof EMPTY_SELECTION, id: string, mode: "replace" | "toggle" | "range") =>
    applySelectionClick(selection, { kind: "asset", id, mode, order });

  it("replaces on a plain click, and clears folders", () => {
    const withFolder = { ...EMPTY_SELECTION, folderIds: ["f"] };
    expect(click(withFolder, "2", "replace")).toEqual({ assetIds: ["2"], folderIds: [], anchor: "2" });
  });

  it("toggles with Ctrl/Cmd, keeping other kinds", () => {
    let selection = applySelectionClick(EMPTY_SELECTION, { kind: "folder", id: "f", mode: "replace", order: ["f"] });
    selection = click(selection, "2", "toggle");
    selection = click(selection, "4", "toggle");
    expect(selection).toEqual({ assetIds: ["2", "4"], folderIds: ["f"], anchor: "4" });
    selection = click(selection, "2", "toggle");
    expect(selection.assetIds).toEqual(["4"]);
  });

  it("selects a range from the anchor with Shift, in either direction, and re-ranges", () => {
    let selection = click(EMPTY_SELECTION, "2", "replace");
    selection = click(selection, "4", "range");
    expect(selection.assetIds.sort()).toEqual(["2", "3", "4"]);
    expect(selection.anchor).toBe("2");
    selection = click(selection, "1", "range");
    expect(selection.assetIds.sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("treats a range with no usable anchor as a plain click", () => {
    expect(click(EMPTY_SELECTION, "3", "range")).toEqual({ assetIds: ["3"], folderIds: [], anchor: "3" });
  });

  it("selects all, prunes what left the screen, and counts", () => {
    const all = selectAll(["1", "2"], ["f"]);
    expect(selectionSize(all)).toBe(3);
    const pruned = pruneSelection(all, new Set(["2"]), new Set());
    expect(pruned).toEqual({ assetIds: ["2"], folderIds: [], anchor: null });
    // Nothing removed: same object, so React sees no change.
    expect(pruneSelection(all, new Set(["1", "2"]), new Set(["f"]))).toBe(all);
  });

  it("maps modifier keys", () => {
    expect(selectionMode({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe("range");
    expect(selectionMode({ shiftKey: false, metaKey: false, ctrlKey: true })).toBe("toggle");
    expect(selectionMode({ shiftKey: false, metaKey: false, ctrlKey: false })).toBe("replace");
  });
});

describe("stepIndex", () => {
  it("clamps without wrapping", () => {
    expect(stepIndex(0, -1, 5)).toBe(0);
    expect(stepIndex(4, 1, 5)).toBe(4);
    expect(stepIndex(2, 1, 5)).toBe(3);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});

describe("parseMediaLibraryPrefs", () => {
  it("reads the saved view and caption choice, defaulting to masonry without names", () => {
    expect(parseMediaLibraryPrefs({ view: "grid", showNames: true })).toEqual({ view: "grid", showNames: true });
    expect(parseMediaLibraryPrefs({ view: "list" })).toEqual({ view: "list", showNames: false });
    expect(parseMediaLibraryPrefs(null)).toEqual({ view: "masonry", showNames: false });
    expect(parseMediaLibraryPrefs({ view: "carousel", showNames: "yes" })).toEqual({ view: "masonry", showNames: false });
  });

  it("knows which views are photo-first", () => {
    expect(isPhotoView("masonry")).toBe(true);
    expect(isPhotoView("grid")).toBe(true);
    expect(isPhotoView("list")).toBe(false);
    expect(isPhotoView("details")).toBe(false);
  });
});

describe("parseLibraryPlace", () => {
  it("only knows the shared place; anything else is the file tree", () => {
    expect(parseLibraryPlace("shared")).toBe("shared");
    expect(parseLibraryPlace("bin")).toBe("files");
    expect(parseLibraryPlace(null)).toBe("files");
  });
});

describe("resolveContextTarget", () => {
  const several = { assetIds: ["a", "b"], folderIds: ["f"], anchor: "a" };

  it("acts on the place for empty space, keeping the selection", () => {
    expect(resolveContextTarget(several, null)).toEqual({ target: { kind: "background" }, selection: several });
  });

  it("acts on the whole selection when the item is part of it", () => {
    for (const clicked of [{ kind: "asset", id: "b" }, { kind: "folder", id: "f" }] as const) {
      const { target, selection } = resolveContextTarget(several, clicked);
      expect(target).toEqual({ kind: "selection", assetIds: ["a", "b"], folderIds: ["f"] });
      expect(selection).toBe(several);
    }
  });

  it("selects an item outside the selection on its own", () => {
    expect(resolveContextTarget(several, { kind: "asset", id: "z" })).toEqual({
      target: { kind: "asset", id: "z" },
      selection: { assetIds: ["z"], folderIds: [], anchor: "z" },
    });
    expect(resolveContextTarget(EMPTY_SELECTION, { kind: "folder", id: "g" })).toEqual({
      target: { kind: "folder", id: "g" },
      selection: { assetIds: [], folderIds: ["g"], anchor: "g" },
    });
  });

  it("leaves a lone selected item's selection untouched", () => {
    const lone = { assetIds: ["a"], folderIds: [], anchor: "a" };
    expect(resolveContextTarget(lone, { kind: "asset", id: "a" }).selection).toBe(lone);
  });
});

describe("folderPreviewThumbs", () => {
  const item = (id: string, folderId: string | null, thumbUrl: string | null, createdAt: string) => ({
    id,
    folderId,
    thumbUrl,
    createdAt,
  });

  it("takes the newest thumbnails directly inside each folder, up to the count", () => {
    const previews = folderPreviewThumbs(
      [
        item("1", "f", "t1", "2026-01-01"),
        item("2", "f", "t2", "2026-01-03"),
        item("3", "f", null, "2026-01-04"),
        item("4", "f", "t4", "2026-01-02"),
        item("5", "g", "t5", "2026-01-01"),
        item("6", null, "t6", "2026-01-05"),
      ],
      2,
    );
    expect(previews.get("f")).toEqual(["t2", "t4"]);
    expect(previews.get("g")).toEqual(["t5"]);
    expect(previews.has("h")).toBe(false);
  });
});
