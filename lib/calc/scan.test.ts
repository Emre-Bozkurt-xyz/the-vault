import { describe, expect, it } from "vitest";

import { scanCalcBlocks, scanInlineCalc } from "@/lib/calc/scan";
import { collectInlineCalcOccurrences } from "@/lib/markdown/calc-directive";

describe("scanInlineCalc", () => {
  it("finds occurrences with their source ranges", () => {
    const text = "Total :calc[1 + 1] here.";
    const [match] = scanInlineCalc(text);

    expect(match.expression).toBe("1 + 1");
    expect(text.slice(match.from, match.to)).toBe(":calc[1 + 1]");
  });

  it("captures the attribute group when present", () => {
    const [match] = scanInlineCalc(":calc[a]{show=expr dp=2}");

    expect(match.attributes).toBe("show=expr dp=2");
  });

  it("leaves attributes null when the group is absent", () => {
    expect(scanInlineCalc(":calc[a]")[0].attributes).toBeNull();
  });

  it("keeps operators that markdown would have eaten", () => {
    expect(scanInlineCalc(":calc[a * b * c]")[0].expression).toBe("a * b * c");
    expect(scanInlineCalc(":calc[x_1 + y_2]")[0].expression).toBe("x_1 + y_2");
  });

  it("honours the exclusion callback", () => {
    const text = "code :calc[1] and live :calc[2]";
    const first = text.indexOf(":calc[1]");

    const matches = scanInlineCalc(
      text,
      (from) => from === first,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe("2");
  });

  it("skips an escaped directive", () => {
    expect(scanInlineCalc("\\:calc[1 + 1]")).toEqual([]);
  });

  it("does not run past a newline inside the brackets", () => {
    expect(scanInlineCalc(":calc[1 +\n1]")).toEqual([]);
  });
});

/**
 * The two locators must agree. Live mode uses the regex scanner and read mode
 * uses the remark collector; if they disagreed, a value would render one way in
 * the editor and another on the published page.
 */
describe("scanner and remark collector agree", () => {
  const corpus = [
    "Plain prose with no calc at all.",
    "One :calc[1 + 1] value.",
    "Two :calc[a = 2 CAD] and :calc[a * 3] values.",
    "Attributes :calc[a]{show=expr} and :calc[b]{dp=2 as=USD}.",
    "Operators :calc[a * b * c] and :calc[x_1 + y_2].",
    "# Heading :calc[h]\n\n- list :calc[l]\n\n> quote :calc[q]",
    "Inside **bold :calc[b]** and _em :calc[e]_.",
    "Table | :calc[t] |\n|---|\n| x |",
    "Empty brackets :calc[] here.",
    "Conversion :calc[100 CAD in USD] here.",
    "Adjacent :calc[a]:calc[b] with no gap.",
    "Punctuation :calc[a], then :calc[b].",
  ];

  for (const source of corpus) {
    it(`agrees on: ${source.slice(0, 44).replace(/\n/g, "\\n")}`, () => {
      const scanned = scanInlineCalc(source).map((m) => m.expression);
      const collected = collectInlineCalcOccurrences(source).map(
        (o) => o.expression ?? "",
      );

      expect(scanned).toEqual(collected);
    });
  }

  it("agrees that inline code is not a directive", () => {
    const source = "Write `:calc[1 + 1]` to compute.";
    // The scanner needs its exclusions supplied; the collector knows natively.
    const start = source.indexOf("`");
    const end = source.lastIndexOf("`");

    expect(
      scanInlineCalc(source, (from) => from > start && from < end).map(
        (m) => m.expression,
      ),
    ).toEqual([]);
    expect(collectInlineCalcOccurrences(source)).toEqual([]);
  });
});

describe("scanCalcBlocks", () => {
  it("finds a block with its statements and 1-based line numbers", () => {
    const text = "Intro.\n:::calc\nrent = 1200 CAD\ndomains = 42 USD\n:::\nOutro.";
    const [block] = scanCalcBlocks(text);

    expect(block.lines).toEqual(["rent = 1200 CAD", "domains = 42 USD"]);
    expect(block.startLine).toBe(2);
    expect(block.endLine).toBe(5);
    expect(text.slice(block.from, block.to)).toBe(
      ":::calc\nrent = 1200 CAD\ndomains = 42 USD\n:::",
    );
  });

  it("reads block attributes", () => {
    expect(scanCalcBlocks(":::calc{collapsed}\na\n:::")[0].attributes).toBe(
      "collapsed",
    );
  });

  it("ignores a block inside fenced code", () => {
    expect(
      scanCalcBlocks("```md\n:::calc\nrent = 1 CAD\n:::\n```"),
    ).toEqual([]);
  });

  it("runs an unterminated block to the end rather than dropping it", () => {
    const [block] = scanCalcBlocks(":::calc\nrent = 1 CAD");

    expect(block.lines).toEqual(["rent = 1 CAD"]);
    expect(block.closed).toBe(false);
  });

  // Live mode decorates the statement lines in place instead of replacing the
  // block, so every statement has to carry the range it occupies — without it
  // there is nothing to hang a per-line value widget on, and a click inside the
  // block has no source position to land on.
  it("locates each statement in the document", () => {
    const text = "Intro.\n:::calc\nrent = 1200 CAD\n\ndomains = 42 USD\n:::";
    const [block] = scanCalcBlocks(text);

    expect(block.closed).toBe(true);
    expect(
      block.statements.map(({ line, source }) => [line, source]),
    ).toEqual([
      [3, "rent = 1200 CAD"],
      [5, "domains = 42 USD"],
    ]);

    for (const statement of block.statements) {
      expect(text.slice(statement.from, statement.to)).toBe(statement.source);
    }
  });

  it("keeps `lines` in step with `statements`", () => {
    const [block] = scanCalcBlocks(":::calc\na = 1\n\n  b = 2  \n:::");

    expect(block.lines).toEqual(block.statements.map((s) => s.source));
    expect(block.lines).toEqual(["a = 1", "b = 2"]);
  });

  // The source is trimmed for evaluation but the range spans the whole line,
  // which is where Live mode appends the computed value.
  it("trims a statement's source but spans its whole line", () => {
    const text = ":::calc\n   rent = 1 CAD   \n:::";
    const [statement] = scanCalcBlocks(text)[0].statements;

    expect(statement.source).toBe("rent = 1 CAD");
    expect(text.slice(statement.from, statement.to)).toBe("   rent = 1 CAD   ");
  });

  it("finds several blocks in order", () => {
    const blocks = scanCalcBlocks(":::calc\na = 1\n:::\n\ntext\n\n:::calc\nb = 2\n:::");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].lines).toEqual(["a = 1"]);
    expect(blocks[1].lines).toEqual(["b = 2"]);
  });
});
