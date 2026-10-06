import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { createCalcCompletionSource } from "./completions";

const source = createCalcCompletionSource();

/**
 * Runs the source against a document where `‸` marks the cursor. Forces a full
 * markdown parse so the `syntaxTree`-based code exclusion is stable headless.
 */
function completeAt(
  withCursor: string,
  { explicit = false }: { explicit?: boolean } = {},
): CompletionResult | null {
  const pos = withCursor.indexOf("‸");

  if (pos < 0) {
    throw new Error("test document is missing a ‸ cursor marker");
  }

  const doc = withCursor.replace("‸", "");
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 5000);

  return source(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
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
 * Which options exist is decided by the grammar at the cursor: the source
 * tokenizes the statement to the left and offers only what the parser would
 * accept next. A menu that offered every name and all 160-odd ISO codes at every
 * cursor would mostly suggest expressions that do not parse.
 */
describe("only what the grammar accepts at the cursor", () => {
  const inBlock = (statement: string, options?: { explicit?: boolean }) =>
    completeAt(
      [":::calc", "rent = 1200 CAD", statement, ":::"].join("\n"),
      options,
    );

  describe("where an operand goes", () => {
    it.each([
      ["after `=`", "total = ‸"],
      ["after an operator", "total = rent + ‸"],
      ["after `(`", "total = (‸"],
      ["inside a call, after `,`", "total = sum(rent, ‸"],
      ["after a unary minus", "total = -‸"],
    ])("offers names and functions %s", (_where, statement) => {
      const result = inBlock(statement);
      expect(labels(result)).toEqual(expect.arrayContaining(["rent", "sum"]));
    });

    it("offers no currencies, even for an uppercase word", () => {
      // `5 * CAD` does not parse — a code needs an amount in front of it.
      expect(labels(inBlock("fee = 5 * CA‸"))).not.toContain("CAD");
      expect(labels(inBlock("total = ‸"))).not.toContain("CAD");
    });
  });

  describe("where a unit goes", () => {
    it("offers currencies alone after a bare amount", () => {
      const result = inBlock("fee = 1200 ‸");
      expect(labels(result)).toContain("CAD");
      expect(labels(result)).not.toContain("rent");
      expect(labels(result)).not.toContain("sum");
    });

    it("offers them for the word being typed right after the amount", () => {
      expect(labels(inBlock("fee = 1200 CA‸"))).toContain("CAD");
    });

    it("names each currency, so a code is recognisable before it is known", () => {
      expect(detailFor(inBlock("total = rent in ‸"), "CAD")).toBe(
        "Canadian Dollar",
      );
    });
  });

  describe("where a conversion target goes", () => {
    it("offers currencies alone after `in`", () => {
      const result = inBlock("total = rent in ‸");
      expect(labels(result)).toContain("USD");
      expect(labels(result)).not.toContain("rent");
      expect(labels(result)).not.toContain("sum");
    });

    it("offers currencies alone after `to`", () => {
      expect(labels(inBlock("total = rent to ‸"))).toContain("EUR");
    });
  });

  /**
   * After a finished operand only an operator or a conversion can follow, so a
   * name, function or currency there would never parse (`rent CAD`,
   * `1200 CAD rent`).
   */
  describe("where an operator goes", () => {
    it.each([
      ["a name", "total = rent ‸"],
      ["a name ending in a digit", "total = rent2 ‸"],
      ["an amount with its unit", "fee = 1200 CAD ‸"],
      ["a conversion target", "total = rent in USD ‸"],
      ["a closing parenthesis", "total = (rent) ‸"],
      ["a percentage", "rate = 20% ‸"],
    ])("stays shut after %s until a word is started", (_after, statement) => {
      expect(inBlock(statement)).toBeNull();
    });

    it("offers only `in` and `to` when asked for", () => {
      expect(labels(inBlock("total = rent ‸", { explicit: true }))).toEqual([
        "in",
        "to",
      ]);
      expect(labels(inBlock("fee = 1200 CAD ‸", { explicit: true }))).toEqual([
        "in",
        "to",
      ]);
    });

    it("offers the keyword for the word being typed", () => {
      const result = inBlock("total = rent i‸");
      expect(labels(result)).toContain("in");
      expect(labels(result)).not.toContain("rent");
      expect(labels(result)).not.toContain("CAD");
    });

    it("inserts the space a conversion target needs", () => {
      const result = inBlock("total = rent i‸");
      expect(result?.options.find((option) => option.label === "in")?.apply).toBe(
        "in ",
      );
    });

    it("applies inline as well as in a block", () => {
      const inline = [
        ":::calc",
        "rent = 1200 CAD",
        ":::",
        "",
        "Three months is :calc[rent ‸]",
      ].join("\n");

      expect(completeAt(inline)).toBeNull();
      expect(labels(completeAt(inline, { explicit: true }))).toEqual(["in", "to"]);
    });
  });

  it("stays shut after a character the tokenizer rejects", () => {
    // The statement is already broken there; no option would make it parse.
    expect(inBlock("total = rent $ ‸", { explicit: true })).toBeNull();
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
});

describe("re-filtering as the token grows", () => {
  /**
   * Which options exist depends only on the tokens left of the word, so the
   * list stays valid while the same word grows, whatever its case, and must be
   * re-queried once the word ends.
   */
  it("keeps the open menu alive while the word grows, and not past it", () => {
    const validFor = completeAt(
      [":::calc", "rent = 1200 CAD", "total = re‸", ":::"].join("\n"),
    )?.validFor as RegExp;

    expect(validFor.test("rent")).toBe(true);
    expect(validFor.test("RENT")).toBe(true);
    expect(validFor.test("rent ")).toBe(false);
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
