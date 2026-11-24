import { describe, expect, it } from "vitest";

import {
  EMPTY_SELECTION,
  applySelectionClick,
  parseMediaSort,
  parseMediaView,
  pruneSelection,
  selectAll,
  selectionMode,
  selectionSize,
  sortMediaAssets,
  stepIndex,
} from "@/lib/media-library";

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
