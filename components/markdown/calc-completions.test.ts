import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { createCalcCompletionSource } from "./calc-completions";

const source = createCalcCompletionSource();

/**
 * Runs the source against a document where `‸` marks the cursor. Forces a full
 * markdown parse so the `syntaxTree`-based code exclusion is stable headless.
 */
function completeAt(withCursor: string): CompletionResult | null {
  const pos = withCursor.indexOf("‸");

  if (pos < 0) {
    throw new Error("test document is missing a ‸ cursor marker");
  }

  const doc = withCursor.replace("‸", "");
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 5000);

  return source(new CompletionContext(state, pos, false)) as CompletionResult | null;
}

const labels = (result: CompletionResult | null) =>
  (result?.options ?? []).map((option) => option.label);

const detailFor = (result: CompletionResult | null, label: string) =>
  result?.options.find((option) => option.label === label)?.detail;

const typesIn = (result: CompletionResult | null) =>
  new Set((result?.options ?? []).map((option) => option.type));

describe("where the calc operand menu opens", () => {
  it("opens inside an inline `:calc[…]`", () => {
    expect(completeAt("Total: :calc[re‸]")).not.toBeNull();
  });

  it("opens inside an unclosed inline `:calc[`", () => {
    // The source is revealed the moment the cursor enters it, so a half-typed
    // occurrence is the normal case rather than an edge case.
    expect(completeAt("Total: :calc[re‸")).not.toBeNull();
  });

  it("opens on a statement line inside a `:::calc` block", () => {
    expect(completeAt(":::calc\nrent = 1200 CAD\ntotal = re‸\n:::")).not.toBeNull();
  });

  it("stays shut on the block's own fences", () => {
    expect(completeAt(":::calc‸\nrent = 1200 CAD\n:::")).toBeNull();
    expect(completeAt(":::calc\nrent = 1200 CAD\n:::‸")).toBeNull();
  });

  it("stays shut in ordinary prose", () => {
    expect(completeAt("the rent is re‸")).toBeNull();
  });

  it("stays shut past the closing bracket", () => {
    expect(completeAt("Total: :calc[rent] re‸")).toBeNull();
  });

  it("stays shut inside inline code, where the syntax is quoted not meant", () => {
    expect(completeAt("Write `:calc[re‸]` to compute it")).toBeNull();
  });

  it("stays shut inside a fenced code block", () => {
    expect(completeAt("```md\n:::calc\nrent = re‸\n:::\n```")).toBeNull();
  });
});

describe("names in scope", () => {
  const doc = [
    ":::calc",
    "rent = 1200 CAD",
    "domains = 42 CAD",
    "total = ‸",
    ":::",
  ].join("\n");

  it("offers names bound above the statement being edited", () => {
    expect(labels(completeAt(doc))).toEqual(
      expect.arrayContaining(["rent", "domains"]),
    );
  });

  it("shows what each name is worth as the hint", () => {
    expect(detailFor(completeAt(doc), "rent")).toBe("CA$1,200.00");
  });

  /**
   * Names bind top to bottom (`lib/calc/evaluate.ts`), so a name defined below
   * is not in scope — offering it would suggest an expression that renders as
   * `unknown-name` the instant it is accepted.
   */
  it("does not offer a name bound below the cursor", () => {
    const withLater = [
      ":::calc",
      "rent = 1200 CAD",
      "total = ‸",
      "tax = 90 CAD",
      ":::",
    ].join("\n");

    expect(labels(completeAt(withLater))).toContain("rent");
    expect(labels(completeAt(withLater))).not.toContain("tax");
  });

  it("does not offer the name being defined on the current line", () => {
    // Every statement in a block shares the block's own offset, so scope has to
    // be judged per statement or a block would be all-or-nothing.
    const selfReference = [":::calc", "rent = 1200 CAD", "rent2 = re‸", ":::"].join(
      "\n",
    );

    expect(labels(completeAt(selfReference))).not.toContain("rent2");
  });

  /** A binding whose expression fails never binds, so the menu must not offer it. */
  it("does not offer a name whose own expression failed", () => {
    const broken = [
      ":::calc",
      "rent = 1200 CAD",
      "broken = 1 CAD + 1",
      "total = ‸",
      ":::",
    ].join("\n");

    expect(labels(completeAt(broken))).toContain("rent");
    expect(labels(completeAt(broken))).not.toContain("broken");
  });

  it("sees names bound by a block above an inline occurrence", () => {
    const mixed = [
      ":::calc",
      "rent = 1200 CAD",
      ":::",
      "",
      "Three months is :calc[re‸]",
    ].join("\n");

    expect(labels(completeAt(mixed))).toContain("rent");
  });

  it("ranks names above currencies and functions", () => {
    const result = completeAt(doc);
    const rent = result?.options.find((option) => option.label === "rent");
    const sum = result?.options.find((option) => option.label === "sum");

    expect(rent?.boost).toBeGreaterThan(sum?.boost ?? 0);
  });
});

/**
 * Which options exist is decided by position, using the calc grammar's own rule
 * that an uppercase token is money and a lowercase one is an identifier. A menu
 * that offered all 160-odd ISO codes at every cursor would be noise, and most of
 * those options would not parse where they were offered.
 */
describe("currencies are offered only where one can go", () => {
  const inBlock = (statement: string) =>
    completeAt([":::calc", "rent = 1200 CAD", statement, ":::"].join("\n"));

  it("offers currencies alone after `in`", () => {
    const result = inBlock("total = rent in ‸");
    expect(labels(result)).toContain("USD");
    // The parser requires a code here; a name would not parse.
    expect(labels(result)).not.toContain("rent");
  });

  it("offers currencies alone after `to`", () => {
    expect(labels(inBlock("total = rent to ‸"))).toContain("EUR");
  });

  it("offers currencies alone after a bare amount", () => {
    const result = inBlock("fee = 1200 ‸");
    expect(labels(result)).toContain("CAD");
    expect(labels(result)).not.toContain("rent");
  });

  it("does not read a trailing digit in an identifier as an amount", () => {
    // `rent2 ` is a name, not `1200 ` — the boundary matters or every name
    // ending in a digit would flip the menu to currencies.
    const result = inBlock("total = rent2 ‸");
    expect(labels(result)).not.toContain("CAD");
  });

  it("withholds currencies from a lowercase token, which means a variable", () => {
    const result = inBlock("total = re‸");
    expect(labels(result)).toContain("rent");
    expect(labels(result)).not.toContain("CAD");
  });

  it("offers currencies once the token is uppercase", () => {
    expect(labels(inBlock("fee = 5 * CA‸"))).toContain("CAD");
  });

  it("names each currency, so a code is recognisable before it is known", () => {
    expect(detailFor(inBlock("total = rent in ‸"), "CAD")).toBe(
      "Canadian Dollar",
    );
  });
});

describe("functions", () => {
  const result = () =>
    completeAt([":::calc", "rent = 1200 CAD", "total = su‸", ":::"].join("\n"));

  it("offers the built-ins with their signatures", () => {
    expect(labels(result())).toEqual(expect.arrayContaining(["sum", "round"]));
    expect(detailFor(result(), "round")).toBe("round(x, places?)");
  });

  it("opens the call when accepted", () => {
    expect(
      result()?.options.find((option) => option.label === "sum")?.apply,
    ).toBe("sum(");
  });

  it("does not offer functions where only a currency can go", () => {
    expect(
      labels(completeAt([":::calc", "fee = 1 CAD in ‸", ":::"].join("\n"))),
    ).not.toContain("sum");
  });
});

describe("re-filtering as the token grows", () => {
  const inBlock = (statement: string) =>
    completeAt([":::calc", "rent = 1200 CAD", statement, ":::"].join("\n"));

  it("keeps the open menu alive while the token stays the same kind", () => {
    const validFor = inBlock("total = re‸")?.validFor as (t: string) => boolean;
    expect(validFor("rent")).toBe(true);
    expect(validFor("rent ")).toBe(false);
  });

  /**
   * The case boundary changes which options *exist*, not just which match: an
   * empty token carries no currencies, so `C` has to re-query rather than filter
   * a list that never had CAD in it.
   */
  it("re-queries when the token crosses into uppercase", () => {
    const validFor = inBlock("total = ‸")?.validFor as (t: string) => boolean;
    expect(validFor("re")).toBe(true);
    expect(validFor("CA")).toBe(false);
  });

  it("does not re-query on case when only currencies were ever offered", () => {
    const validFor = inBlock("total = rent in ‸")?.validFor as (
      t: string,
    ) => boolean;
    expect(validFor("CA")).toBe(true);
    expect(validFor("ca")).toBe(true);
  });
});

describe("tooltip glyphs", () => {
  it("gives every option an icon type", () => {
    const result = completeAt(
      [":::calc", "rent = 1200 CAD", "total = re‸", ":::"].join("\n"),
    );

    expect(result?.options.every((option) => typeof option.type === "string")).toBe(
      true,
    );
    expect(typesIn(result)).toContain("vault-calc-name");
    expect(typesIn(result)).toContain("vault-calc-function");
  });
});
