import { describe, expect, it } from "vitest";

import { isOverlayAnchor, resolveAnchorLine } from "@/lib/extension-api/anchors";

describe("resolveAnchorLine", () => {
  const lines = ["# Title", "", "First paragraph.", "", "- Stickers: like this one", "", "## End"];

  it("keeps the recorded line while it still holds the text", () => {
    expect(resolveAnchorLine(lines, { line: 5, text: "- Stickers: like this one" })).toBe(5);
  });

  it("follows the text when lines were added or removed above it", () => {
    const moved = ["New intro.", "", ...lines];
    expect(resolveAnchorLine(moved, { line: 5, text: "- Stickers: like this one" })).toBe(7);
    expect(resolveAnchorLine(lines.slice(2), { line: 5, text: "- Stickers: like this one" })).toBe(3);
  });

  it("stays put when the text was edited, is ambiguous, or is blank", () => {
    expect(resolveAnchorLine(lines, { line: 5, text: "- Stickers: old wording" })).toBe(5);
    expect(resolveAnchorLine(["a", "x", "x"], { line: 1, text: "x" })).toBe(1);
    expect(resolveAnchorLine(lines, { line: 2, text: "" })).toBe(2);
  });

  it("clamps into the document", () => {
    expect(resolveAnchorLine(lines, { line: 99, text: "gone" })).toBe(7);
    expect(resolveAnchorLine(lines, { line: 0, text: "gone" })).toBe(1);
    expect(resolveAnchorLine([], { line: 3, text: "gone" })).toBe(1);
  });

  it("recognises a well-formed anchor", () => {
    expect(isOverlayAnchor({ line: 3, text: "x", dy: -12 })).toBe(true);
    expect(isOverlayAnchor({ line: 3, text: "x" })).toBe(false);
    expect(isOverlayAnchor(null)).toBe(false);
  });
});

describe("long lines", () => {
  it("match on their start", () => {
    const long = "x".repeat(500);
    expect(resolveAnchorLine(["a", "b", long], { line: 1, text: long.slice(0, 160) })).toBe(3);
  });
});

describe("overlayAnchorSchema", () => {
  it("accepts an anchor with or without a horizontal share", async () => {
    const { overlayAnchorSchema } = await import("@/lib/extension-api/anchors");
    expect(overlayAnchorSchema.safeParse({ line: 3, text: "x", dy: 2 }).success).toBe(true);
    expect(overlayAnchorSchema.parse({ line: 3, text: "x", dy: 2, x: 0.84 }).x).toBe(0.84);
    expect(overlayAnchorSchema.safeParse({ line: 0, text: "x", dy: 2 }).success).toBe(false);
  });
});
