import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import {
  calcRemarkPlugins,
  collectInlineCalcOccurrences,
  parseAttributeString,
  parseCalcPresentation,
  remarkCalc,
  splitCalcBlockSegments,
} from "@/lib/markdown/calc-directive";

type TreeNode = {
  type: string;
  value?: string;
  data?: { hName?: string; hProperties?: Record<string, string> };
  children?: TreeNode[];
};

/** Runs the render plugin and returns the transformed mdast tree. */
function transform(markdown: string, keyPrefix = "0"): TreeNode {
  const processor = unified()
    .use(remarkParse)
    .use(calcRemarkPlugins)
    .use(remarkCalc, { keyPrefix });

  return processor.runSync(processor.parse(markdown), markdown) as TreeNode;
}

function collect(node: TreeNode, matches: (node: TreeNode) => boolean): TreeNode[] {
  const found = matches(node) ? [node] : [];

  for (const child of node.children ?? []) {
    found.push(...collect(child, matches));
  }

  return found;
}

function calcElements(tree: TreeNode): TreeNode[] {
  return collect(tree, (node) => node.data?.hName === "vault-calc");
}

function expressions(markdown: string): Array<string | null> {
  return collectInlineCalcOccurrences(markdown).map(
    (occurrence) => occurrence.expression,
  );
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

describe("collectInlineCalcOccurrences", () => {
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
    const [occurrence] = collectInlineCalcOccurrences(
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

describe("parseAttributeString", () => {
  it("reads space-separated pairs", () => {
    expect(parseAttributeString("show=expr dp=2")).toEqual({
      show: "expr",
      dp: "2",
    });
  });

  it("reads a valueless flag as an empty string", () => {
    expect(parseAttributeString("collapsed")).toEqual({ collapsed: "" });
  });

  it("reads quoted values", () => {
    expect(parseAttributeString('as="USD"')).toEqual({ as: "USD" });
  });

  it("swallows a comma into the value, which is why commas are not separators", () => {
    // Documents the gotcha: `{dp=2, as=USD}` does not do what it looks like.
    expect(parseAttributeString("dp=2, as=USD").dp).toBe("2,");
  });
});

describe("remarkCalc", () => {
  it("emits a keyed vault-calc element per occurrence, in order", () => {
    const tree = transform("A :calc[1 + 1] and B :calc[2 + 2].");
    const keys = calcElements(tree).map(
      (node) => node.data?.hProperties?.["data-calc-key"],
    );

    expect(keys).toEqual(["0:0", "0:1"]);
  });

  it("scopes keys to the segment prefix", () => {
    const tree = transform(":calc[1]", "7");

    expect(calcElements(tree)[0].data?.hProperties?.["data-calc-key"]).toBe(
      "7:0",
    );
  });

  it("assigns keys in the same order the collector reads expressions", () => {
    // The two passes must agree or a rendered value shows another's result.
    const markdown = "# H :calc[a]\n\n- item :calc[b]\n\n> quote :calc[c]";
    const keys = calcElements(transform(markdown)).map(
      (node) => node.data?.hProperties?.["data-calc-key"],
    );

    expect(keys).toEqual(["0:0", "0:1", "0:2"]);
    expect(collectInlineCalcOccurrences(markdown).map((o) => o.expression)).toEqual(
      ["a", "b", "c"],
    );
  });

  it("discards the parsed children so emphasis cannot reach the DOM", () => {
    const [node] = calcElements(transform(":calc[a * b * c]"));

    expect(node.children).toEqual([]);
  });

  it("restores an unhandled inline directive to its literal source", () => {
    // Adding remark-directive must not silently delete text that merely looks
    // like a directive.
    const tree = transform("See :foo[bar] here.");
    const text = collect(tree, (node) => node.type === "text")
      .map((node) => node.value)
      .join("");

    expect(text).toContain(":foo[bar]");
    expect(calcElements(tree)).toHaveLength(0);
  });

  it("restores an unhandled container directive to its literal source", () => {
    const tree = transform(":::calendar{id=abc}\n:::");
    const text = collect(tree, (node) => node.type === "text")
      .map((node) => node.value)
      .join("");

    expect(text).toContain(":::calendar{id=abc}");
  });
});

describe("splitCalcBlockSegments", () => {
  it("splits a block out of the surrounding markdown", () => {
    const markdown = [
      "Intro.",
      ":::calc",
      "rent = 1200 CAD",
      "domains = 42 USD",
      ":::",
      "Outro.",
    ].join("\n");

    const segments = splitCalcBlockSegments(markdown);

    expect(segments.map((segment) => segment.type)).toEqual([
      "markdown",
      "calc-block",
      "markdown",
    ]);

    const block = segments[1];

    expect(block.type === "calc-block" && block.lines).toEqual([
      { expression: "rent = 1200 CAD" },
      { expression: "domains = 42 USD" },
    ]);
  });

  it("leaves a block inside a fenced code block as code", () => {
    // splitCalendarSegments does not do this; the docs need to show the syntax.
    const markdown = ["```md", ":::calc", "rent = 1 CAD", ":::", "```"].join(
      "\n",
    );

    const segments = splitCalcBlockSegments(markdown);

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("markdown");
  });

  it("reads block attributes and the collapsed flag", () => {
    const segments = splitCalcBlockSegments(":::calc{show=expr collapsed}\na\n:::");
    const block = segments[0];

    expect(block.type === "calc-block" && block.collapsed).toBe(true);
    expect(block.type === "calc-block" && block.presentation.show).toBe("expr");
  });

  it("defaults collapsed to false without the flag", () => {
    const segments = splitCalcBlockSegments(":::calc\na\n:::");
    const block = segments[0];

    expect(block.type === "calc-block" && block.collapsed).toBe(false);
  });

  it("keeps an unterminated block's declarations rather than discarding them", () => {
    const segments = splitCalcBlockSegments(":::calc\nrent = 1 CAD");
    const block = segments[0];

    expect(block.type === "calc-block" && block.lines).toEqual([
      { expression: "rent = 1 CAD" },
    ]);
  });

  it("drops blank lines inside a block", () => {
    const segments = splitCalcBlockSegments(":::calc\na = 1\n\nb = 2\n:::");
    const block = segments[0];

    expect(block.type === "calc-block" && block.lines).toHaveLength(2);
  });

  it("returns a single markdown segment when there is no block", () => {
    const segments = splitCalcBlockSegments("Just prose with :calc[1 + 1].");

    expect(segments).toEqual([
      { type: "markdown", markdown: "Just prose with :calc[1 + 1]." },
    ]);
  });
});
