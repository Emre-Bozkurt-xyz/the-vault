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
