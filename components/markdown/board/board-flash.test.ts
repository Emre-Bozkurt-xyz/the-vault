import { describe, expect, it } from "vitest";

import { changedLines } from "@/components/markdown/board/board-flash";

describe("changedLines", () => {
  it("flags only the lines a board edit wrote", () => {
    expect(changedLines(["## A", "- [ ] One", "- [ ] Two"], ["## A", "- [x] One", "- [ ] Two"])).toEqual([1]);
  });

  it("flags a moved card's lines, not the lines it passed", () => {
    const before = ["- [ ] Move me", "  note", "## B", "- [ ] Stay", "## C"];
    const after = ["## B", "- [ ] Stay", "## C", "- [ ] Move me", "  note"];
    expect(changedLines(before, after)).toEqual([3, 4]);
  });

  it("ignores blank lines", () => {
    expect(changedLines(["## A"], ["## A", "", "## New"])).toEqual([2]);
  });
});
