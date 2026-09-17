import { describe, expect, it } from "vitest";

import {
  buildDocumentFolderPaths,
  buildFolderPaths,
  resolveFolderAncestry,
} from "@/lib/folder-paths";

describe("buildFolderPaths", () => {
  it("returns the bare name for a root folder", () => {
    const paths = buildFolderPaths([{ id: "a", name: "Work", parentId: null }]);

    expect(paths.get("a")).toBe("Work");
  });

  it("joins nested folders parent-first", () => {
    const paths = buildFolderPaths([
      { id: "a", name: "Work", parentId: null },
      { id: "b", name: "Specs", parentId: "a" },
      { id: "c", name: "2026", parentId: "b" },
    ]);

    expect(paths.get("c")).toBe("Work/Specs/2026");
  });

  it("stops at an ancestor the user cannot see", () => {
    // A shared folder whose parent was not shared: the walk yields the visible
    // suffix rather than inventing a path through a folder the user can't see.
    const paths = buildFolderPaths([
      { id: "child", name: "Handoff", parentId: "invisible-parent" },
    ]);

    expect(paths.get("child")).toBe("Handoff");
  });

  it("terminates on a parent cycle instead of looping", () => {
    const paths = buildFolderPaths([
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);

    expect(paths.get("a")).toBe("B/A");
    expect(paths.get("b")).toBe("A/B");
  });

  it("terminates on a self-referencing folder", () => {
    const paths = buildFolderPaths([{ id: "a", name: "Loop", parentId: "a" }]);

    expect(paths.get("a")).toBe("Loop");
  });

  it("returns an empty map for no folders", () => {
    expect(buildFolderPaths([]).size).toBe(0);
  });
});

describe("resolveFolderAncestry", () => {
  const tree = [
    { id: "a", name: "Work", parentId: null },
    { id: "b", name: "Specs", parentId: "a" },
    { id: "c", name: "2026", parentId: "b" },
  ];

  it("returns the chain root-first, ending at the folder itself", () => {
    expect(resolveFolderAncestry(tree, "c").map((folder) => folder.name)).toEqual(
      ["Work", "Specs", "2026"],
    );
  });

  it("returns nothing for a document at the vault root", () => {
    expect(resolveFolderAncestry(tree, null)).toEqual([]);
  });

  it("returns nothing for a folder the caller cannot see", () => {
    expect(resolveFolderAncestry(tree, "missing")).toEqual([]);
  });

  it("stops at an ancestor the caller cannot see", () => {
    expect(
      resolveFolderAncestry(
        [{ id: "child", name: "Handoff", parentId: "invisible" }],
        "child",
      ).map((folder) => folder.name),
    ).toEqual(["Handoff"]);
  });

  it("terminates on a parent cycle instead of looping", () => {
    expect(
      resolveFolderAncestry(
        [
          { id: "a", name: "A", parentId: "b" },
          { id: "b", name: "B", parentId: "a" },
        ],
        "a",
      ).map((folder) => folder.name),
    ).toEqual(["B", "A"]);
  });
});

describe("buildDocumentFolderPaths", () => {
  const folders = [
    { id: "a", name: "Work", parentId: null },
    { id: "b", name: "Specs", parentId: "a" },
  ];

  it("maps a document href to its folder path", () => {
    const paths = buildDocumentFolderPaths(folders, [
      { href: "/docs/1", folderId: "b" },
    ]);

    expect(paths.get("/docs/1")).toBe("Work/Specs");
  });

  it("keys by the query-free href so a share link still resolves", () => {
    const paths = buildDocumentFolderPaths(folders, [
      { href: "/docs/1?share=abc", folderId: "a" },
    ]);

    expect(paths.get("/docs/1")).toBe("Work");
  });

  it("omits root documents and documents in unseen folders", () => {
    const paths = buildDocumentFolderPaths(folders, [
      { href: "/docs/1", folderId: null },
      { href: "/docs/2", folderId: "invisible" },
    ]);

    expect(paths.size).toBe(0);
  });
});
