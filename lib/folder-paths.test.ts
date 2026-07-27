import { describe, expect, it } from "vitest";

import { buildFolderPaths } from "@/lib/folder-paths";

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
