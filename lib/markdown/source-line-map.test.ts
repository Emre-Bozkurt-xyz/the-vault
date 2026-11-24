import { describe, expect, it } from "vitest";

import { mapRenderedLinesToSource } from "@/lib/markdown/source-line-map";

describe("mapRenderedLinesToSource", () => {
  it("is the identity when nothing was rewritten", () => {
    const lines = ["# A", "", "text", "", "## B"];
    expect(mapRenderedLinesToSource(lines, lines)).toEqual([0, 1, 2, 3, 4]);
  });

  it("follows per-line transforms", () => {
    const source = ["# A", "![[asset:x]]", "after"];
    const rendered = ["# A", "<img x>", "after"];
    const transform = (line: string) => (line === "![[asset:x]]" ? "<img x>" : line);
    expect(mapRenderedLinesToSource(source, rendered, transform)).toEqual([0, 1, 2]);
  });

  it("maps a run that collapsed to fewer lines, and keeps later lines aligned", () => {
    const source = ["# A", "", ":::assets", "![[asset:1]]", "![[asset:2]]", ":::", "", "## B", "end"];
    const rendered = ["# A", "", "<figure>", "<div>…</div>", "</figure>", "", "## B", "end"];
    const map = mapRenderedLinesToSource(source, rendered);
    expect(map.slice(2, 5)).toEqual([2, 2, 2]);
    expect(map[6]).toBe(7);
    expect(map[7]).toBe(8);
  });

  it("maps a run that grew, and a rewritten tail", () => {
    expect(mapRenderedLinesToSource(["a", "x", "b"], ["a", "1", "2", "3", "b"])).toEqual([0, 1, 1, 1, 2]);
    expect(mapRenderedLinesToSource(["a", "x"], ["a", "1", "2"])).toEqual([0, 1, 1]);
  });
});
