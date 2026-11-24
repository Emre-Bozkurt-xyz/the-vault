import { describe, expect, it } from "vitest";

import {
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_MOVE_ITEMS,
  checkFolderMove,
  childFolders,
  descendantFolderIds,
  folderDepth,
  folderPath,
  isIgnoredUploadFile,
  normalizeFolderName,
  parseMoveRequest,
  planFolderUpload,
  subtreeHeight,
  uniqueFolderName,
  type FolderNode,
} from "@/lib/asset-folders";

//   events
//   ├── lisbon
//   │   └── day-1
//   └── porto
//   archive
const tree: FolderNode[] = [
  { id: "events", parentId: null, name: "Events" },
  { id: "lisbon", parentId: "events", name: "Lisbon" },
  { id: "day1", parentId: "lisbon", name: "Day 1" },
  { id: "porto", parentId: "events", name: "Porto" },
  { id: "archive", parentId: null, name: "Archive" },
];

describe("normalizeFolderName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeFolderName("  Lisbon   2026 ")).toEqual({ ok: true, name: "Lisbon 2026" });
  });

  it("rejects empty, reserved, slashed, control and over-long names", () => {
    for (const bad of ["", "   ", ".", "..", "a/b", "a\\b", "tab\there", "nul\u0000", "x".repeat(MAX_FOLDER_NAME_LENGTH + 1), 42, null]) {
      expect(normalizeFolderName(bad).ok).toBe(false);
    }
    expect(normalizeFolderName("x".repeat(MAX_FOLDER_NAME_LENGTH)).ok).toBe(true);
  });
});

describe("uniqueFolderName", () => {
  it("keeps a free name and suffixes a taken one, case-insensitively", () => {
    expect(uniqueFolderName("DCIM", [])).toBe("DCIM");
    expect(uniqueFolderName("DCIM", ["dcim"])).toBe("DCIM (2)");
    expect(uniqueFolderName("DCIM", ["DCIM", "DCIM (2)"])).toBe("DCIM (3)");
  });

  it("keeps a suffixed long name within the limit", () => {
    const long = "x".repeat(MAX_FOLDER_NAME_LENGTH);
    const unique = uniqueFolderName(long, [long]);
    expect(unique.endsWith(" (2)")).toBe(true);
    expect(unique.length).toBeLessThanOrEqual(MAX_FOLDER_NAME_LENGTH);
  });
});

describe("tree walks", () => {
  it("builds root-first breadcrumbs and depths", () => {
    expect(folderPath(tree, "day1").map((folder) => folder.name)).toEqual(["Events", "Lisbon", "Day 1"]);
    expect(folderPath(tree, null)).toEqual([]);
    expect(folderDepth(tree, "day1")).toBe(3);
    expect(folderDepth(tree, null)).toBe(0);
  });

  it("survives cyclic or dangling data", () => {
    const broken: FolderNode[] = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
      { id: "orphan", parentId: "gone", name: "Orphan" },
    ];
    expect(folderPath(broken, "a").length).toBe(2);
    expect(folderPath(broken, "orphan").map((folder) => folder.id)).toEqual(["orphan"]);
    expect(subtreeHeight(broken, "a")).toBe(1);
    expect([...descendantFolderIds(broken, "a")]).toEqual(["b"]);
  });

  it("lists children in natural name order", () => {
    const numbered: FolderNode[] = [
      { id: "10", parentId: null, name: "Day 10" },
      { id: "2", parentId: null, name: "Day 2" },
      { id: "1", parentId: null, name: "day 1" },
    ];
    expect(childFolders(numbered, null).map((folder) => folder.name)).toEqual(["day 1", "Day 2", "Day 10"]);
  });

  it("finds descendants and subtree heights", () => {
    expect([...descendantFolderIds(tree, "events")].sort()).toEqual(["day1", "lisbon", "porto"]);
    expect(subtreeHeight(tree, "events")).toBe(2);
    expect(subtreeHeight(tree, "day1")).toBe(0);
  });
});

describe("checkFolderMove", () => {
  it("allows ordinary moves", () => {
    expect(checkFolderMove(tree, "porto", "archive")).toEqual({ ok: true });
    expect(checkFolderMove(tree, "day1", null)).toEqual({ ok: true });
  });

  it("refuses moving into itself or below itself", () => {
    expect(checkFolderMove(tree, "events", "events")).toEqual({ ok: false, reason: "into-itself" });
    expect(checkFolderMove(tree, "events", "day1")).toEqual({ ok: false, reason: "into-itself" });
  });

  it("refuses a no-op and a sibling name clash", () => {
    expect(checkFolderMove(tree, "lisbon", "events")).toEqual({ ok: false, reason: "same-place" });
    const clashing = [...tree, { id: "lisbon2", parentId: "archive", name: "LISBON" }];
    expect(checkFolderMove(clashing, "lisbon", "archive")).toEqual({ ok: false, reason: "name-taken" });
  });

  it("refuses moves that would exceed the depth limit", () => {
    const chain: FolderNode[] = Array.from({ length: MAX_FOLDER_DEPTH }, (_, index) => ({
      id: `c${index}`,
      parentId: index === 0 ? null : `c${index - 1}`,
      name: `C${index}`,
    }));
    const deepest = `c${MAX_FOLDER_DEPTH - 1}`;
    const withLeaf = [...chain, { id: "leaf", parentId: null, name: "Leaf" }];
    expect(checkFolderMove(withLeaf, "leaf", deepest)).toEqual({ ok: false, reason: "too-deep" });
    expect(checkFolderMove(withLeaf, "leaf", `c${MAX_FOLDER_DEPTH - 2}`)).toEqual({ ok: true });
  });
});

describe("planFolderUpload", () => {
  it("creates parents before children and maps each file to its directory", () => {
    const plan = planFolderUpload([
      "DCIM/100CANON/IMG_0001.JPG",
      "DCIM/100CANON/IMG_0002.JPG",
      "DCIM/101CANON/MVI_0003.MP4",
      "DCIM/readme.txt",
    ]);
    expect(plan.directories).toEqual(["DCIM", "DCIM/100CANON", "DCIM/101CANON"]);
    expect(plan.files).toEqual([
      { path: "DCIM/100CANON/IMG_0001.JPG", directory: "DCIM/100CANON" },
      { path: "DCIM/100CANON/IMG_0002.JPG", directory: "DCIM/100CANON" },
      { path: "DCIM/101CANON/MVI_0003.MP4", directory: "DCIM/101CANON" },
      { path: "DCIM/readme.txt", directory: "DCIM" },
    ]);
  });

  it("skips OS junk and keeps loose files at the drop target", () => {
    const plan = planFolderUpload(["photo.jpg", "DCIM/.DS_Store", "DCIM/._IMG_1.JPG", "DCIM/Thumbs.db"]);
    expect(plan.files).toEqual([{ path: "photo.jpg", directory: "" }]);
    expect(plan.directories).toEqual([]);
    expect(isIgnoredUploadFile("IMG_1.JPG")).toBe(false);
  });

  it("sanitises unusable directory names instead of failing the drop", () => {
    const plan = planFolderUpload([`${"x".repeat(300)}/a.jpg`, "../b.jpg"]);
    expect(plan.directories[0].length).toBeLessThanOrEqual(MAX_FOLDER_NAME_LENGTH);
    expect(plan.files[1]).toEqual({ path: "../b.jpg", directory: "Folder" });
  });
});

describe("parseMoveRequest", () => {
  const a = "0b6f2a5e-2f0c-4a8e-9a43-1d2f3c4b5a69";
  const f = "1c7f3b6f-3f1d-4b9f-8b54-2e3f4d5c6b7a";

  it("accepts asset-only, folder-only and mixed moves, to a folder or the root", () => {
    // The bug a browser test caught: an empty `folderIds` alongside assets was a 400.
    expect(parseMoveRequest({ assetIds: [a], folderIds: [], targetFolderId: f })).toEqual({
      assetIds: [a],
      folderIds: [],
      targetFolderId: f,
    });
    expect(parseMoveRequest({ folderIds: [f], targetFolderId: null })).toEqual({
      assetIds: [],
      folderIds: [f],
      targetFolderId: null,
    });
    expect(parseMoveRequest({ assetIds: [a, a.toUpperCase()], folderIds: [f], targetFolderId: null })?.assetIds).toEqual([a]);
  });

  it("rejects empty, malformed and oversized requests", () => {
    for (const bad of [
      null,
      "x",
      { assetIds: [], folderIds: [], targetFolderId: null },
      { assetIds: [a] },
      { assetIds: [a], targetFolderId: "root" },
      { assetIds: ["nope"], targetFolderId: null },
      { assetIds: a, targetFolderId: null },
      {
        assetIds: Array.from({ length: MAX_MOVE_ITEMS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
        targetFolderId: null,
      },
    ]) {
      expect(parseMoveRequest(bad)).toBeNull();
    }
  });
});
