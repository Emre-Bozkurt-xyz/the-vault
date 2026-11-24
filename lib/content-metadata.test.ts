import { describe, expect, it } from "vitest";

import { parseDocumentMetadata } from "@/lib/content-metadata";

describe("frontmatter flow lists", () => {
  it("reads `[a, b]` lists for aliases and tags", () => {
    const parsed = parseDocumentMetadata('---\naliases: [Lisbon, "Lisboa, PT"]\ntags: [travel, Europe]\n---\nBody');
    expect(parsed.aliases).toEqual(["Lisbon", "Lisboa, PT"]);
    expect(parsed.tags).toEqual(["travel", "europe"]);
  });

  it("still reads block lists and plain values", () => {
    const parsed = parseDocumentMetadata("---\naliases:\n  - One\n  - Two\nsummary: Short\n---\n");
    expect(parsed.aliases).toEqual(["One", "Two"]);
    expect(parsed.summary).toBe("Short");
  });
});

describe("page icon and cover", () => {
  it("reads them from frontmatter", async () => {
    const { parseDocumentAppearance } = await import("@/lib/content-metadata");
    expect(parseDocumentAppearance("---\nicon: 🚀\ncover: asset:5E1C0A00-0000-4000-8000-00000000A0C1\n---\nx")).toEqual({
      icon: "🚀",
      coverAssetId: "5e1c0a00-0000-4000-8000-00000000a0c1",
    });
    expect(parseDocumentAppearance("---\ncover: not-an-asset\n---\n")).toEqual({ icon: null, coverAssetId: null });
    expect(parseDocumentAppearance("No frontmatter")).toEqual({ icon: null, coverAssetId: null });
  });

  it("sets, replaces and removes one field, keeping the rest", async () => {
    const { setFrontmatterField } = await import("@/lib/content-metadata");
    expect(setFrontmatterField("Hello", "icon", "🚀")).toBe("---\nicon: 🚀\n---\n\nHello");
    const withTags = "---\ntags:\n  - a\nicon: 🌱\n---\n\nBody";
    expect(setFrontmatterField(withTags, "icon", "🚀")).toBe("---\ntags:\n  - a\nicon: 🚀\n---\n\nBody");
    expect(setFrontmatterField(withTags, "icon", null)).toBe("---\ntags:\n  - a\n---\n\nBody");
    expect(setFrontmatterField("---\nicon: 🌱\n---\n\nBody", "icon", null)).toBe("Body");
    expect(setFrontmatterField("---\naliases:\n  - x\n---\nB", "aliases", null)).toBe("B");
  });
});
