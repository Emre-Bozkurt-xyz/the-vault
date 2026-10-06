import { describe, expect, it } from "vitest";

import { parseCalcPresentation } from "./directive";
import { collectCalcBlocks, collectInlineCalc } from "./testing";

/**
 * Calc's reading of the host's occurrences (`docs/23_EXTENSION_SDK_PLAN.md`
 * §6): the expression and presentation of each `:calc[…]`, and the statements
 * of each `:::calc` block. The rendering half (the element, sanitisation,
 * restoring unclaimed directives) is core's, tested in
 * `lib/markdown/directives.test.ts`.
 */
function expressions(markdown: string): Array<string | null> {
  return collectInlineCalc(markdown).map((occurrence) => occurrence.expression);
}

describe("the raw-source invariant", () => {
  it("keeps asterisks that the Markdown parser would have made into emphasis", () => {
    // The whole reason expressions are sliced from source: `a * b * c` has two
    // asterisks that pair into <em>, which would corrupt the expression.
    expect(expressions("Total :calc[a * b * c] today")).toEqual(["a * b * c"]);
  });

  it("keeps underscores in identifiers", () => {
    expect(expressions(":calc[tax_rate * base_cost]")).toEqual([
      "tax_rate * base_cost",
    ]);
  });

  it("keeps a lone underscore-wrapped run intact", () => {
    expect(expressions(":calc[_a_ + _b_]")).toEqual(["_a_ + _b_"]);
  });

  it("preserves backticks rather than making inline code of them", () => {
    expect(expressions(":calc[a + 1]")).toEqual(["a + 1"]);
  });
});

describe("inline occurrences", () => {
  it("returns occurrences in document order", () => {
    const markdown = [
      "Rent is :calc[rent = 1200 CAD] monthly.",
      "",
      "Domains :calc[domains = 42 USD], total :calc[rent * 3 + domains].",
    ].join("\n");

    expect(expressions(markdown)).toEqual([
      "rent = 1200 CAD",
      "domains = 42 USD",
      "rent * 3 + domains",
    ]);
  });

  it("ignores a :calc inside inline code, which is how you write about it", () => {
    expect(expressions("Write `:calc[1 + 1]` to compute.")).toEqual([]);
  });

  it("ignores a :calc inside a fenced code block", () => {
    const markdown = ["```md", ":calc[1 + 1]", "```"].join("\n");

    expect(expressions(markdown)).toEqual([]);
  });

  it("reports a :calc with no bracket group as null rather than dropping it", () => {
    expect(expressions("Bare :calc{as=USD} here")).toEqual([null]);
  });

  it("reads presentation attributes alongside the expression", () => {
    const [occurrence] = collectInlineCalc(
      ":calc[rent * 3]{show=expr dp=0 as=usd}",
    );

    expect(occurrence.expression).toBe("rent * 3");
    expect(occurrence.presentation).toEqual({ show: "expr", dp: 0, as: "USD" });
  });

  it("finds occurrences inside list items and headings", () => {
    const markdown = ["# Total :calc[a]", "", "- item :calc[b]"].join("\n");

    expect(expressions(markdown)).toEqual(["a", "b"]);
  });
});

describe("parseCalcPresentation", () => {
  it("defaults everything to null when absent", () => {
    expect(parseCalcPresentation(null)).toEqual({
      show: null,
      dp: null,
      as: null,
    });
  });

  it("ignores an unknown show mode instead of erroring", () => {
    // A typo in a display hint must never turn a correct figure into an error.
    expect(parseCalcPresentation({ show: "sideways" }).show).toBeNull();
  });

  it("ignores a non-numeric or out-of-range dp", () => {
    expect(parseCalcPresentation({ dp: "two" }).dp).toBeNull();
    expect(parseCalcPresentation({ dp: "99" }).dp).toBeNull();
    expect(parseCalcPresentation({ dp: "0" }).dp).toBe(0);
  });

  it("normalizes a currency code to uppercase", () => {
    expect(parseCalcPresentation({ as: "usd" }).as).toBe("USD");
    expect(parseCalcPresentation({ as: "dollars" }).as).toBeNull();
  });
});

describe(":::calc blocks", () => {
  it("reads a block's statements out of the surrounding markdown", () => {
    const markdown = [
      "Intro.",
      ":::calc",
      "rent = 1200 CAD",
      "domains = 42 USD",
      ":::",
      "Outro.",
    ].join("\n");

    expect(collectCalcBlocks(markdown).map((block) => block.lines)).toEqual([
      ["rent = 1200 CAD", "domains = 42 USD"],
    ]);
  });

  it("leaves a block inside a fenced code block as code", () => {
    // The docs need to show the syntax without evaluating it.
    const markdown = ["```md", ":::calc", "rent = 1 CAD", ":::", "```"].join("\n");

    expect(collectCalcBlocks(markdown)).toEqual([]);
  });

  it("reads block attributes and the collapsed flag", () => {
    const [block] = collectCalcBlocks(":::calc{show=expr collapsed}\na\n:::");

    expect(block.collapsed).toBe(true);
    expect(block.presentation.show).toBe("expr");
  });

  it("defaults collapsed to false without the flag", () => {
    expect(collectCalcBlocks(":::calc\na\n:::")[0].collapsed).toBe(false);
  });

  it("keeps an unterminated block's declarations rather than discarding them", () => {
    expect(collectCalcBlocks(":::calc\nrent = 1 CAD")[0].lines).toEqual(["rent = 1 CAD"]);
  });

  // `insertBlock` (the toolbar button and `/calcblock`) does not force a blank
  // line before what it inserts, so a block frequently ends up butted straight
  // against the paragraph above it. The host locates blocks line by line, in
  // Read and Live mode alike, so neither treats it as a lazy continuation.
  it("recognizes a block butted straight against the paragraph above", () => {
    expect(collectCalcBlocks("Tail paragraph.\n:::calc\na = 1 CAD\n:::")).toHaveLength(1);
  });

  it("drops blank lines inside a block", () => {
    expect(collectCalcBlocks(":::calc\na = 1\n\nb = 2\n:::")[0].lines).toHaveLength(2);
  });

  it("finds no block in prose", () => {
    expect(collectCalcBlocks("Just prose with :calc[1 + 1].")).toEqual([]);
  });
});
