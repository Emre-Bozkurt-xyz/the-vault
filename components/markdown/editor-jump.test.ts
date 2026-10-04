import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { resolveJumpLine } from "@/components/markdown/editor-jump";

const doc = Text.of(["# Title", "- [ ] first", "- [ ] second", "- [ ] dup", "- [ ] dup"]);

describe("resolveJumpLine", () => {
  it("uses the recorded line when it still holds the recorded text", () => {
    expect(resolveJumpLine(doc, { documentId: "d", line: 2, text: "- [ ] second" })).toBe(3);
  });

  it("follows a line that moved", () => {
    expect(resolveJumpLine(doc, { documentId: "d", line: 0, text: "- [ ] second" })).toBe(3);
  });

  it("falls back to the recorded line when the text is gone or ambiguous", () => {
    expect(resolveJumpLine(doc, { documentId: "d", line: 1, text: "- [ ] edited" })).toBe(2);
    expect(resolveJumpLine(doc, { documentId: "d", line: 0, text: "- [ ] dup" })).toBe(1);
  });

  it("clamps a recorded line past the end of a shortened document", () => {
    expect(resolveJumpLine(doc, { documentId: "d", line: 40 })).toBe(5);
  });
});
