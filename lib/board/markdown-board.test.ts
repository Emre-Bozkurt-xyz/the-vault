import { describe, expect, it } from "vitest";

import {
  addCard,
  addColumn,
  cardMarkdown,
  deleteColumn,
  duplicateCard,
  moveColumn,
  setColumnStatus,
  sortColumn,
  deleteCard,
  isBoardDocument,
  minimalChange,
  moveCard,
  parseBoard,
  renameColumn,
  setCardDetails,
  setCardField,
  setCardStatus,
  setCardTitle,
} from "@/lib/board/markdown-board";

const doc = [
  "---",
  "view: board",
  "---",
  "# Sprint",
  "",
  "Intro text stays.",
  "",
  "## Ideas",
  "- [ ] Sanity drain :priority[high]",
  "  Too punishing.",
  "  - [x] Collect notes",
  "  - [ ] Try a slower curve",
  "- [ ] Footprints fade",
  "",
  "## Doing",
  "- [/] Lantern shader :due[2026-11-27]",
  "",
  "## Done",
  "- [x] Footsteps",
  "",
].join("\n");

describe("markdown board", () => {
  it("knows a board document by its frontmatter", () => {
    expect(isBoardDocument(doc)).toBe(true);
    expect(isBoardDocument("# Just a doc\n\n## Heading\n- [ ] x")).toBe(false);
    expect(isBoardDocument("---\nview: \"board\"\n---\n")).toBe(true);
  });

  it("reads headings as columns and task lines as cards", () => {
    const board = parseBoard(doc);
    expect(board.columns.map((column) => column.heading)).toEqual(["Ideas", "Doing", "Done"]);
    const [sanity, footprints] = board.columns[0].cards;
    expect(sanity).toMatchObject({
      line: 8,
      end: 12,
      status: "open",
      title: "Sanity drain",
      priority: "high",
      notes: ["Too punishing."],
      subtasks: [
        { done: true, text: "Collect notes" },
        { done: false, text: "Try a slower curve" },
      ],
    });
    expect(footprints.title).toBe("Footprints fade");
    expect(board.columns[1].cards[0]).toMatchObject({ status: "in_progress", due: "2026-11-27" });
  });

  it("moves a card with its lines between columns and within one", () => {
    const moved = moveCard(doc, 8, 14, 1);
    const board = parseBoard(moved);
    expect(board.columns[0].cards.map((card) => card.title)).toEqual(["Footprints fade"]);
    expect(board.columns[1].cards.map((card) => card.title)).toEqual(["Lantern shader", "Sanity drain"]);
    expect(board.columns[1].cards[1].subtasks).toHaveLength(2);
    expect(moved).toContain("Intro text stays.");

    const reordered = parseBoard(moveCard(doc, 12, 7, 0));
    expect(reordered.columns[0].cards.map((card) => card.title)).toEqual(["Footprints fade", "Sanity drain"]);
    expect(moveCard(doc, 8, 7, 0)).toBe(doc);
  });

  it("changes status and fields on the card's line only", () => {
    expect(setCardStatus(doc, 12, "in_progress").split("\n")[12]).toBe("- [/] Footprints fade");
    expect(setCardField(doc, 8, "priority", "low").split("\n")[8]).toBe("- [ ] Sanity drain :priority[low]");
    expect(setCardField(doc, 8, "priority", null).split("\n")[8]).toBe("- [ ] Sanity drain");
    expect(setCardField(doc, 12, "due", "2026-12-01").split("\n")[12]).toBe("- [ ] Footprints fade :due[2026-12-01]");
    expect(setCardTitle(doc, 8, "Sanity curve").split("\n")[8]).toBe("- [ ] Sanity curve :priority[high]");
  });

  it("edits a card's details, adds and deletes cards and columns", () => {
    const detailed = setCardDetails(doc, 12, ["Fade over 30s."], [{ done: false, text: "Shader" }]);
    expect(parseBoard(detailed).columns[0].cards[1]).toMatchObject({ notes: ["Fade over 30s."], subtasks: [{ done: false, text: "Shader" }] });
    expect(parseBoard(addCard(doc, 14, "New idea")).columns[1].cards.map((card) => card.title)).toEqual(["Lantern shader", "New idea"]);
    expect(parseBoard(addCard(doc, 17, "Shipped")).columns[2].cards).toHaveLength(2);
    expect(parseBoard(deleteCard(doc, 8)).columns[0].cards.map((card) => card.title)).toEqual(["Footprints fade"]);
    expect(parseBoard(addColumn(doc, "Review")).columns.map((column) => column.heading)).toEqual(["Ideas", "Doing", "Done", "Review"]);
    expect(parseBoard(renameColumn(doc, 14, "In progress")).columns[1].heading).toBe("In progress");
  });

  it("reads tags and a cover image, and keeps the cover when details change", () => {
    const asset = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const withArt = ["---", "view: board", "---", "## Ideas", "- [ ] Whispers #audio #vfx-pass :priority[low]", `  ![[asset:${asset}|sketch]]`, "  Quiet ones.", "- [ ] Snow ![](https://x.y/a.png) #c-sharp but not a#b or #1", "  ![](https://x.y/cover.png)"].join("\n");
    const [whispers, snow] = parseBoard(withArt).columns[0].cards;
    expect(whispers).toMatchObject({ title: "Whispers #audio #vfx-pass", label: "Whispers", tags: ["audio", "vfx-pass"], cover: { assetId: asset }, notes: ["Quiet ones."] });
    expect(snow).toMatchObject({ tags: ["c-sharp"], cover: { url: "https://x.y/cover.png" }, notes: [] });
    const edited = setCardDetails(withArt, 4, ["Louder."], []);
    expect(edited.split("\n").slice(5, 7)).toEqual([`  ![[asset:${asset}|sketch]]`, "  Louder."]);
  });

  it("moves, deletes, sorts and fills columns, and copies cards", () => {
    const headings = (md: string) => parseBoard(md).columns.map((column) => column.heading);
    expect(headings(moveColumn(doc, 7, 1))).toEqual(["Doing", "Ideas", "Done"]);
    expect(moveColumn(doc, 7, 1)).toContain("Intro text stays.");
    expect(parseBoard(moveColumn(doc, 7, 1)).columns[1].cards[0].subtasks).toHaveLength(2);
    expect(headings(moveColumn(doc, 17, -1))).toEqual(["Ideas", "Done", "Doing"]);
    expect(moveColumn(doc, 7, -1)).toBe(doc);
    expect(moveColumn(moveColumn(doc, 7, 1), 7, 1)).toBe(doc);

    const deleted = deleteColumn(doc, 14);
    expect(headings(deleted)).toEqual(["Ideas", "Done"]);
    expect(deleted).not.toContain("Lantern");
    expect(deleted).not.toMatch(/\n\n\n/);

    const sorted = parseBoard(sortColumn(doc, 7, "priority")).columns[0].cards.map((card) => card.title);
    expect(sorted).toEqual(["Sanity drain", "Footprints fade"]);
    const byStatus = sortColumn(["## A", "- [x] Done one", "- [ ] Open one", "  note", "- [/] Doing one"].join("\n"), 0, "status");
    expect(byStatus.split("\n")).toEqual(["## A", "- [/] Doing one", "- [ ] Open one", "  note", "- [x] Done one"]);

    expect(parseBoard(setColumnStatus(doc, 7, "done")).columns[0].cards.every((card) => card.status === "done")).toBe(true);
    expect(parseBoard(duplicateCard(doc, 8)).columns[0].cards.map((card) => card.title)).toEqual(["Sanity drain", "Sanity drain", "Footprints fade"]);
    expect(cardMarkdown(doc, 8).split("\n")).toHaveLength(4);
  });

  it("finds the smallest edit", () => {
    expect(minimalChange("abcXdef", "abcYYdef")).toEqual({ from: 3, to: 4, insert: "YY" });
    expect(minimalChange("same", "same")).toBeNull();
  });
});
