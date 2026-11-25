import { describe, expect, it } from "vitest";

import { blockAnchorId, findBlock, moveBlock, turnInto } from "@/lib/markdown/blocks";

const lines = [
  "---", // 0
  "tags: [x]",
  "---",
  "# Title", // 3
  "",
  "First paragraph", // 5
  "continues here.",
  "",
  "- Item one", // 8
  "  - nested",
  "  more of one",
  "- Item two", // 11
  "",
  "```js", // 13
  "",
  "code();",
  "```",
  "",
  "> quote", // 18
  "> still quote",
  "",
  "| a | b |", // 21
  "| - | - |",
];

describe("findBlock", () => {
  it("finds each kind of block", () => {
    expect(findBlock(lines, 3)).toEqual({ start: 3, end: 4, kind: "heading" });
    expect(findBlock(lines, 6)).toEqual({ start: 5, end: 7, kind: "paragraph" });
    expect(findBlock(lines, 8)).toEqual({ start: 8, end: 11, kind: "list" });
    expect(findBlock(lines, 10)).toEqual({ start: 8, end: 11, kind: "list" });
    expect(findBlock(lines, 9)).toEqual({ start: 9, end: 10, kind: "list" });
    expect(findBlock(lines, 11)).toEqual({ start: 11, end: 12, kind: "list" });
    expect(findBlock(lines, 14)).toEqual({ start: 13, end: 17, kind: "code" });
    expect(findBlock(lines, 19)).toEqual({ start: 18, end: 20, kind: "quote" });
    expect(findBlock(lines, 22)).toEqual({ start: 21, end: 23, kind: "table" });
  });

  it("has no block on blank lines or in frontmatter", () => {
    expect(findBlock(lines, 4)).toBeNull();
    expect(findBlock(lines, 1)).toBeNull();
  });
});

describe("turnInto", () => {
  it("rewrites the first line's prefix", () => {
    expect(turnInto(["- [ ] Buy milk"], "h2")).toEqual(["## Buy milk"]);
    expect(turnInto(["## Plans"], "todo")).toEqual(["- [ ] Plans"]);
    expect(turnInto(["1. Step"], "bullet")).toEqual(["- Step"]);
    expect(turnInto(["- Item", "  child"], "text")).toEqual(["Item", "  child"]);
  });

  it("wraps and unwraps quotes and callouts", () => {
    expect(turnInto(["Line one", "line two"], "quote")).toEqual(["> Line one", "> line two"]);
    expect(turnInto(["> [!note] Heads up", "> body"], "text")).toEqual(["Heads up", "body"]);
    expect(turnInto(["Heads up", "body"], "callout")).toEqual(["> [!note] Heads up", "> body"]);
  });
});

describe("moveBlock", () => {
  it("moves a block up or down, and leaves it when dropped on itself", () => {
    const list = ["a", "b1", "b2", "c"];
    expect(moveBlock(list, { start: 1, end: 3, kind: "paragraph" }, 0)).toEqual(["b1", "b2", "a", "c"]);
    expect(moveBlock(list, { start: 1, end: 3, kind: "paragraph" }, 4)).toEqual(["a", "c", "b1", "b2"]);
    expect(moveBlock(list, { start: 1, end: 3, kind: "paragraph" }, 2)).toEqual(list);
  });
});

describe("blockAnchorId", () => {
  it("reads a trailing ^anchor", () => {
    expect(blockAnchorId(["Some text ^ab12c"])).toBe("ab12c");
    expect(blockAnchorId(["No anchor"])).toBeNull();
  });
});

describe("moveBlockWithSpacing", () => {
  it("keeps paragraphs apart and closes the gap left behind", async () => {
    const { moveBlockWithSpacing } = await import("@/lib/markdown/blocks");
    const doc = ["One", "", "Two", "", "Three"];
    expect(moveBlockWithSpacing(doc, { start: 4, end: 5, kind: "paragraph" }, 0)).toEqual(["Three", "", "One", "", "Two", ""]);
    expect(moveBlockWithSpacing(doc, { start: 0, end: 1, kind: "paragraph" }, 5)).toEqual(["Two", "", "Three", "", "One"]);
  });

  it("moves list items without blank lines", async () => {
    const { moveBlockWithSpacing } = await import("@/lib/markdown/blocks");
    expect(moveBlockWithSpacing(["- a", "- b", "- c"], { start: 2, end: 3, kind: "list" }, 0)).toEqual(["- c", "- a", "- b"]);
  });
});
