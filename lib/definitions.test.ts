import { describe, expect, it } from "vitest";

import {
  definitionPreview,
  definitionTagSlug,
  reservedTagCategory,
} from "@/lib/definitions";

describe("definitionTagSlug", () => {
  it("is a bare slug the tag normalizer would not alter", () => {
    expect(definitionTagSlug).toBe("definition");
  });
});

describe("reservedTagCategory", () => {
  it("claims the definition slug for the app", () => {
    expect(reservedTagCategory(definitionTagSlug)).toBe("system");
  });

  it("leaves ordinary user vocabulary alone", () => {
    expect(reservedTagCategory("definitions")).toBeUndefined();
    expect(reservedTagCategory("work")).toBeUndefined();
    expect(reservedTagCategory("")).toBeUndefined();
  });
});

describe("definitionPreview", () => {
  it("prefers the authored summary over the body", () => {
    const markdown = [
      "---",
      "tags: definition",
      "summary: A retry produces the same result as one call.",
      "---",
      "",
      "Longer prose that should not be used.",
    ].join("\n");

    expect(definitionPreview(markdown)).toBe(
      "A retry produces the same result as one call.",
    );
  });

  it("falls back to the first body paragraph", () => {
    const markdown = ["---", "tags: definition", "---", "", "An operation that can be repeated safely."].join(
      "\n",
    );

    expect(definitionPreview(markdown)).toBe(
      "An operation that can be repeated safely.",
    );
  });

  it("keeps a soft-wrapped paragraph together and stops at the blank line", () => {
    const markdown = "First line\nsecond line\n\nA second paragraph.\n";

    expect(definitionPreview(markdown)).toBe("First line\nsecond line");
  });

  it("skips a leading heading", () => {
    expect(definitionPreview("# Idempotence\n\nThe property itself.\n")).toBe(
      "The property itself.",
    );
  });

  it("skips a heading that is not followed by a blank line", () => {
    expect(definitionPreview("## Term\nThe property itself.\n")).toBe(
      "The property itself.",
    );
  });

  it("never opens inside a code fence", () => {
    const markdown = [
      "```ts",
      "const x = 1;",
      "",
      "const y = 2;",
      "```",
      "",
      "The prose after the fence.",
    ].join("\n");

    expect(definitionPreview(markdown)).toBe("The prose after the fence.");
  });

  it("skips a directive block", () => {
    const markdown = [":::calc", "rent = 1200 CAD", ":::", "", "The prose after the block."].join(
      "\n",
    );

    expect(definitionPreview(markdown)).toBe("The prose after the block.");
  });

  it("skips region markers, callouts and thematic breaks", () => {
    const markdown = [
      "<!-- vault-region id=intro title=Intro -->",
      "",
      "> [!note] An aside",
      "> not the definition",
      "",
      "---",
      "",
      "The actual definition.",
    ].join("\n");

    expect(definitionPreview(markdown)).toBe("The actual definition.");
  });

  it("skips a standalone transclusion so a card never nests a document", () => {
    expect(definitionPreview("![[Other document]]\n\nThe definition.\n")).toBe(
      "The definition.",
    );
  });

  it("keeps a leading list intact", () => {
    const markdown = "- first\n- second\n\nlater prose\n";

    expect(definitionPreview(markdown)).toBe("- first\n- second");
  });

  it("truncates a long paragraph on a word boundary", () => {
    const preview = definitionPreview(`${"word ".repeat(200)}end`);

    expect(preview).toBeDefined();
    expect(preview!.length).toBeLessThanOrEqual(601);
    expect(preview!.endsWith("…")).toBe(true);
    expect(preview).not.toMatch(/\s…$/);
  });

  it("does not truncate a summary, which is already capped at 500", () => {
    const summary = "s".repeat(400);
    const preview = definitionPreview(`---\nsummary: ${summary}\n---\n\nbody\n`);

    expect(preview).toBe(summary);
  });

  it("returns undefined for an empty document and for one with no prose", () => {
    expect(definitionPreview("")).toBeUndefined();
    expect(definitionPreview("---\ntags: definition\n---\n")).toBeUndefined();
    expect(definitionPreview("# Only a heading\n")).toBeUndefined();
  });

  it("does not run past an unterminated fence", () => {
    expect(definitionPreview("```\nnever closed\n")).toBeUndefined();
  });
});
