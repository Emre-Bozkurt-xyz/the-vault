import { describe, expect, it } from "vitest";

import { decimalFromString } from "@/lib/calc/decimal";
import type { FxRateTable } from "@/lib/calc/fx";
import {
  calcValueMarkup,
  resolveCalcOccurrences,
  type CalcOccurrence,
} from "@/lib/calc/resolve";
import { EMPTY_PRESENTATION } from "@/lib/markdown/calc-directive";
import { buildCalcDocument } from "@/lib/markdown/calc-document";

const TABLE: FxRateTable = {
  base: "EUR",
  date: "2026-09-08",
  provider: "ECB",
  rates: { USD: "1.1614", CAD: "1.6033" },
};

function inline(key: string, expression: string): CalcOccurrence {
  return {
    key,
    expression,
    presentation: EMPTY_PRESENTATION,
    context: "inline",
  };
}

/**
 * The property that keeps Live mode and Read mode honest: both build occurrence
 * lists their own way, then hand them to this one resolver.
 */
describe("resolveCalcOccurrences matches buildCalcDocument", () => {
  it("produces the same values for the same expressions in the same order", () => {
    const source = "Rent :calc[rent = 1200 CAD] then :calc[rent * 3].";

    const fromPieces = buildCalcDocument([
      { type: "markdown", markdown: source },
    ]);
    const fromOccurrences = resolveCalcOccurrences([
      inline("a", "rent = 1200 CAD"),
      inline("b", "rent * 3"),
    ]);

    expect(fromOccurrences.results.get("a")?.value).toBe(
      fromPieces.results.get("0:0")?.value,
    );
    expect(fromOccurrences.results.get("b")?.value).toBe(
      fromPieces.results.get("0:1")?.value,
    );
    expect(fromOccurrences.bindings).toEqual(fromPieces.bindings);
  });

  it("binds in the order supplied, so a forward reference still fails", () => {
    const document = resolveCalcOccurrences([
      inline("a", "total * 2"),
      inline("b", "total = 10 CAD"),
    ]);

    expect(document.results.get("a")?.state).toBe("error");
    expect(document.results.get("b")?.state).toBe("ok");
  });

  it("carries conversion state and provenance through", () => {
    const document = resolveCalcOccurrences(
      [inline("a", "100 CAD in USD")],
      { fxTable: TABLE },
    );

    expect(document.results.get("a")?.state).toBe("converted");
    expect(document.results.get("a")?.provenance).toContain("1 CAD =");
  });

  it("accepts an explicit resolver as well as a table", () => {
    const document = resolveCalcOccurrences([inline("a", "100 CAD in USD")], {
      rates: {
        rate: (from, to) =>
          from === "CAD" && to === "USD" ? decimalFromString("0.5") : null,
      },
    });

    expect(document.results.get("a")?.value).toContain("50.00");
  });
});

describe("calcValueMarkup", () => {
  function markupOf(occurrence: CalcOccurrence, fxTable?: FxRateTable) {
    const document = resolveCalcOccurrences([occurrence], { fxTable });
    return calcValueMarkup(document.results.get(occurrence.key)!);
  }

  it("renders a bare value as a single value part", () => {
    const markup = markupOf(inline("a", "1200 CAD"));

    expect(markup.rootClassName).toBe("vault-calc");
    expect(markup.state).toBe("ok");
    expect(markup.parts.map((part) => part.className)).toEqual([
      "vault-calc-value",
    ]);
  });

  it("renders a labelled value as name, separator, value", () => {
    const markup = markupOf({
      ...inline("a", "rent = 1200 CAD"),
      context: "block",
    });

    expect(markup.parts.map((part) => part.className)).toEqual([
      "vault-calc-name",
      "vault-calc-op",
      "vault-calc-value",
    ]);
    expect(markup.parts[0].text).toBe("rent");
    expect(markup.parts[1].decorative).toBe(true);
  });

  it("marks the expression label with the expr class", () => {
    const markup = markupOf({ ...inline("a", "1 + 1"), context: "block" });

    expect(markup.parts[0].className).toBe("vault-calc-expr");
  });

  it("renders an error as the source expression with its reason as the title", () => {
    const markup = markupOf(inline("a", "2 CAD * 3 CAD"));

    expect(markup.rootClassName).toContain("vault-calc-error");
    expect(markup.state).toBe("error");
    expect(markup.parts).toEqual([
      { className: "vault-calc-expr", text: "2 CAD * 3 CAD" },
    ]);
    expect(markup.title).toContain("squared currency");
  });

  it("puts provenance in the title of a converted value", () => {
    const markup = markupOf(inline("a", "100 CAD in USD"), TABLE);

    expect(markup.title).toContain("100 CAD in USD");
    expect(markup.title).toContain("· ECB · 2026-09-08");
  });

  it("uses the bare expression as the title when nothing converted", () => {
    expect(markupOf(inline("a", "1 + 1")).title).toBe("1 + 1");
  });
});
