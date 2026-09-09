import { describe, expect, it } from "vitest";

import { decimalFromString } from "@/lib/calc/decimal";
import type { RateResolver } from "@/lib/calc/types";
import { EMPTY_PRESENTATION } from "@/lib/markdown/calc-directive";
import {
  buildCalcDocument,
  calcKey,
  type CalcPiece,
  type ResolvedCalc,
} from "@/lib/markdown/calc-document";

const RATES: RateResolver = {
  rate: (from, to) =>
    from === "CAD" && to === "USD" ? decimalFromString("0.73") : null,
};

function markdown(source: string): CalcPiece {
  return { type: "markdown", markdown: source };
}

function block(
  expressions: string[],
  presentation = EMPTY_PRESENTATION,
): CalcPiece {
  return {
    type: "calc-block",
    lines: expressions.map((expression) => ({ expression })),
    presentation,
    collapsed: false,
  };
}

function at(
  document: ReturnType<typeof buildCalcDocument>,
  pieceIndex: number,
  index: number,
): ResolvedCalc {
  const found = document.results.get(calcKey(pieceIndex, index));

  if (!found) {
    throw new Error(`no result at ${pieceIndex}:${index}`);
  }

  return found;
}

describe("context-sensitive defaults", () => {
  it("shows a binding inline as the value alone, and still binds it", () => {
    // "Hosting is CA$1,200.00 per month" — not "rent = CA$1,200.00 per month".
    const document = buildCalcDocument([
      markdown("Hosting is :calc[rent = 1200 CAD] per month."),
      markdown("Tripled: :calc[rent * 3]."),
    ]);

    expect(at(document, 0, 0).label).toBeNull();
    expect(at(document, 0, 0).value).toContain("1,200.00");
    expect(at(document, 1, 0).value).toContain("3,600.00");
  });

  it("names a binding inside a block", () => {
    const document = buildCalcDocument([block(["rent = 1200 CAD"])]);

    expect(at(document, 0, 0).label).toBe("rent");
    expect(at(document, 0, 0).value).toContain("1,200.00");
  });

  it("shows the working for a bare expression inside a block", () => {
    const document = buildCalcDocument([
      block(["rent = 1200 CAD", "rent * 3"]),
    ]);

    expect(at(document, 0, 1).label).toBe("rent * 3");
  });
});

describe("show overrides", () => {
  it("names a binding inline when asked", () => {
    const document = buildCalcDocument([
      markdown(":calc[rent = 1200 CAD]{show=name}"),
    ]);

    expect(at(document, 0, 0).label).toBe("rent");
  });

  it("shows the working inline when asked", () => {
    const document = buildCalcDocument([
      markdown(":calc[a = 2 CAD] :calc[a * 3]{show=expr}"),
    ]);

    expect(at(document, 0, 1).label).toBe("a * 3");
  });

  it("falls back to the working when show=name has no name", () => {
    // Otherwise this would render a stray leading `=`.
    const document = buildCalcDocument([markdown(":calc[1 + 1]{show=name}")]);

    expect(at(document, 0, 0).label).toBe("1 + 1");
  });

  it("hides the name in a block when asked", () => {
    const document = buildCalcDocument([
      block(["rent = 1200 CAD"], { show: "value", dp: null, as: null }),
    ]);

    expect(at(document, 0, 0).label).toBeNull();
  });
});

describe("dp is display-only", () => {
  it("rounds the rendering", () => {
    const document = buildCalcDocument([
      markdown(":calc[1200.567 USD]{dp=1}"),
    ]);

    expect(at(document, 0, 0).value).toContain("1,200.6");
  });

  it("does not round the bound value that downstream totals read", () => {
    // The invariant: if `{dp=0}` had bound 1, the total below would be 3, and
    // the error would be invisible at the point it was introduced.
    const document = buildCalcDocument([
      markdown(":calc[a = 1.4]{dp=0}"),
      markdown(":calc[a * 3]"),
    ]);

    expect(at(document, 0, 0).value).toBe("1");
    expect(at(document, 1, 0).value).toBe("4.2");
  });
});

describe("document ordering", () => {
  it("binds across pieces top to bottom", () => {
    const document = buildCalcDocument([
      block(["rent = 1200 CAD", "domains = 42 CAD"]),
      markdown("Total :calc[rent * 3 + domains]."),
    ]);

    expect(at(document, 1, 0).value).toContain("3,642.00");
    expect(document.bindings).toEqual(["rent", "domains"]);
  });

  it("reports a forward reference as an error rather than a wrong number", () => {
    const document = buildCalcDocument([
      markdown("Total :calc[rent * 3]."),
      block(["rent = 1200 CAD"]),
    ]);

    expect(at(document, 0, 0).state).toBe("error");
    expect(at(document, 0, 0).message).toContain("not defined");
  });

  it("isolates one broken value from the rest of the document", () => {
    const document = buildCalcDocument([
      markdown(":calc[a = 2 CAD] :calc[a + ] :calc[a * 2]"),
    ]);

    expect(at(document, 0, 0).state).toBe("ok");
    expect(at(document, 0, 1).state).toBe("error");
    expect(at(document, 0, 2).state).toBe("ok");
  });
});

describe("errors", () => {
  it("keeps the source expression as the chip body", () => {
    const document = buildCalcDocument([markdown(":calc[2 CAD * 3 CAD]")]);

    expect(at(document, 0, 0).state).toBe("error");
    expect(at(document, 0, 0).expression).toBe("2 CAD * 3 CAD");
    expect(at(document, 0, 0).message).toContain("squared currency");
  });

  it("reports a :calc with no bracket group instead of dropping it", () => {
    const document = buildCalcDocument([markdown("Bare :calc{as=USD} here")]);

    expect(at(document, 0, 0).state).toBe("error");
  });

  it("reports a missing rate without rates configured", () => {
    // Slice-2 behaviour: conversion is not wired up yet and says so plainly.
    const document = buildCalcDocument([markdown(":calc[100 CAD in USD]")]);

    expect(at(document, 0, 0).state).toBe("error");
    expect(at(document, 0, 0).message).toContain("No exchange rate");
  });

  it("converts once rates are supplied, and marks the value converted", () => {
    const document = buildCalcDocument(
      [markdown(":calc[100 CAD in USD]")],
      { rates: RATES },
    );

    expect(at(document, 0, 0).state).toBe("converted");
    expect(at(document, 0, 0).value).toContain("73.00");
  });
});

describe("empty input", () => {
  it("produces no results for markdown with no calc", () => {
    const document = buildCalcDocument([markdown("Just prose.")]);

    expect(document.results.size).toBe(0);
    expect(document.bindings).toEqual([]);
  });
});
