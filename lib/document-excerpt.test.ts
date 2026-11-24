import { describe, expect, it } from "vitest";

import { documentExcerpt } from "@/lib/wiki-links";

const doc = ["---", "tags: [x]", "---", "# Trip Notes", "", "Packed light.", "", "## Day 1", "Walked the harbour.", "", "## Day 2", "Rain."].join("\n");

describe("documentExcerpt", () => {
  it("opens the document without its frontmatter or title", () => {
    expect(documentExcerpt(doc, "/docs/1")).toMatch(/^Packed light\./);
    expect(documentExcerpt(doc, "/docs/1")).not.toContain("tags:");
  });

  it("shows the linked section", () => {
    const excerpt = documentExcerpt(doc, "/docs/1#day-1") ?? "";
    expect(excerpt).toContain("Walked the harbour.");
    expect(excerpt).not.toContain("Rain.");
  });

  it("caps length and closes an open fence", () => {
    const long = ["# T", "```js", ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join("\n");
    const excerpt = documentExcerpt(long, null) ?? "";
    expect(excerpt.endsWith("```")).toBe(true);
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(26);
    expect(documentExcerpt("x".repeat(5000), null)?.length).toBeLessThanOrEqual(5000);
  });

  it("is null without text", () => {
    expect(documentExcerpt(null, "/docs/1")).toBeNull();
    expect(documentExcerpt("# Only a title", null)).toBeNull();
  });
});
