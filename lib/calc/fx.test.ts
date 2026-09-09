import { describe, expect, it } from "vitest";

import { decimalToString } from "@/lib/calc/decimal";
import {
  createRateResolver,
  crossRate,
  describeConversion,
  fxDayKey,
  isFxDayKey,
  type FxRateTable,
} from "@/lib/calc/fx";
import { buildCalcDocument } from "@/lib/markdown/calc-document";

/** A trimmed ECB-shaped table: EUR base, real published magnitudes. */
const TABLE: FxRateTable = {
  base: "EUR",
  date: "2026-09-08",
  provider: "ECB",
  rates: {
    USD: "1.1614",
    CAD: "1.6033",
    JPY: "179.2",
  },
};

function rate(from: string, to: string): string | null {
  const found = crossRate(TABLE, from, to);
  return found === null ? null : decimalToString(found);
}

describe("crossRate", () => {
  it("returns exactly one for a currency against itself", () => {
    expect(rate("CAD", "CAD")).toBe("1");
    expect(rate("EUR", "EUR")).toBe("1");
  });

  it("reads a base-quoted rate directly", () => {
    expect(rate("EUR", "CAD")).toBe("1.6033");
  });

  it("inverts for a conversion back into the base", () => {
    const back = rate("CAD", "EUR");

    expect(back).not.toBeNull();
    // 1 / 1.6033 ≈ 0.62371…
    expect(back?.startsWith("0.6237")).toBe(true);
  });

  it("triangulates a cross rate through the base", () => {
    // CAD -> USD = 1.1614 / 1.6033 ≈ 0.72438…
    const cross = rate("CAD", "USD");

    expect(cross?.startsWith("0.7243")).toBe(true);
  });

  it("round-trips a cross rate back to roughly one", () => {
    const there = crossRate(TABLE, "CAD", "USD");
    const back = crossRate(TABLE, "USD", "CAD");

    expect(there && back).toBeTruthy();
    // Product of a rate and its inverse, within division's rounding.
    const product = Number(decimalToString(there!)) * Number(decimalToString(back!));
    expect(Math.abs(product - 1)).toBeLessThan(1e-15);
  });

  it("returns null for a currency the table does not carry", () => {
    expect(rate("CAD", "MGA")).toBeNull();
    expect(rate("MGA", "CAD")).toBeNull();
  });

  it("never consults the rates map for the base itself", () => {
    // A table listing its own base would otherwise double-count it.
    const selfListing: FxRateTable = {
      ...TABLE,
      rates: { ...TABLE.rates, EUR: "999" },
    };

    expect(decimalToString(crossRate(selfListing, "EUR", "CAD")!)).toBe("1.6033");
  });
});

describe("createRateResolver", () => {
  it("yields a resolver with no rates for a null table", () => {
    // Same-currency arithmetic still works; conversions report missing-rate.
    expect(createRateResolver(null).rate("CAD", "USD")).toBeNull();
  });

  it("drives a real conversion end to end", () => {
    const document = buildCalcDocument(
      [{ type: "markdown", markdown: ":calc[100 CAD in USD]" }],
      { fxTable: TABLE },
    );
    const result = document.results.get("0:0");

    expect(result?.state).toBe("converted");
    // 100 * 0.72438… ≈ 72.44
    expect(result?.value).toContain("72.44");
  });
});

describe("describeConversion", () => {
  it("names the rate, the provider, and the day", () => {
    const note = describeConversion(TABLE, { from: "CAD", to: "USD" });

    expect(note).toMatch(/^1 CAD = 0\.7243\d* USD · ECB · 2026-09-08$/);
  });

  it("flags a stale table so a reader can tell it apart", () => {
    const note = describeConversion(
      { ...TABLE, stale: true },
      { from: "CAD", to: "USD" },
    );

    expect(note).toContain("rate may be out of date");
  });

  it("returns nothing without a table or a usable pair", () => {
    expect(describeConversion(null, { from: "CAD", to: "USD" })).toBeNull();
    expect(describeConversion(TABLE, { from: "CAD", to: "MGA" })).toBeNull();
  });
});

describe("state and provenance in the render model", () => {
  const piece = (markdown: string) =>
    ({ type: "markdown", markdown }) as const;

  it("leaves an unconverted value plain, with no provenance", () => {
    const document = buildCalcDocument([piece(":calc[100 CAD]")], {
      fxTable: TABLE,
    });

    expect(document.results.get("0:0")?.state).toBe("ok");
    expect(document.results.get("0:0")?.provenance).toBeNull();
  });

  it("marks a value converted and attaches its provenance", () => {
    const document = buildCalcDocument([piece(":calc[100 CAD in USD]")], {
      fxTable: TABLE,
    });

    expect(document.results.get("0:0")?.provenance).toContain("1 CAD =");
  });

  it("cites the rate that produced the displayed currency, not the first hop", () => {
    // A USD figure must not be annotated with the EUR->CAD rate from an earlier
    // step of the same expression.
    const document = buildCalcDocument(
      [piece(":calc[a = 1200 CAD] :calc[a + 300 EUR]{as=USD}")],
      { fxTable: TABLE },
    );
    const result = document.results.get("0:1");

    expect(result?.value).toContain("$");
    expect(result?.provenance).toContain("1 CAD = 0.724381 USD");
    expect(result?.provenance).not.toContain("EUR");
  });

  it("cites the inbound leg of a round trip, not the outbound one", () => {
    const document = buildCalcDocument(
      [piece(":calc[r = 1200 CAD] :calc[(r in USD) in CAD]")],
      { fxTable: TABLE },
    );

    expect(document.results.get("0:1")?.provenance).toContain("1 USD =");
  });

  it("marks a value stale when the table could not be confirmed", () => {
    const document = buildCalcDocument([piece(":calc[100 CAD in USD]")], {
      fxTable: { ...TABLE, stale: true },
    });

    expect(document.results.get("0:0")?.state).toBe("stale");
  });

  it("converts a cross-currency sum and records it", () => {
    const document = buildCalcDocument([piece(":calc[100 CAD + 100 USD]")], {
      fxTable: TABLE,
    });
    const result = document.results.get("0:0");

    expect(result?.state).toBe("converted");
    // Left operand decides: reported in CAD.
    expect(result?.value).toContain("CA$");
  });
});

describe("{as=…} display conversion", () => {
  it("re-denominates the display and marks it converted", () => {
    const document = buildCalcDocument(
      [{ type: "markdown", markdown: ":calc[100 CAD]{as=USD}" }],
      { fxTable: TABLE },
    );
    const result = document.results.get("0:0");

    expect(result?.state).toBe("converted");
    expect(result?.value).toContain("72.44");
  });

  it("shows the native currency when no rate exists, rather than erroring", () => {
    // A display hint must never invalidate a sound number.
    const document = buildCalcDocument(
      [{ type: "markdown", markdown: ":calc[100 CAD]{as=MGA}" }],
      { fxTable: TABLE },
    );
    const result = document.results.get("0:0");

    expect(result?.state).toBe("ok");
    expect(result?.value).toContain("100.00");
  });

  it("does not change the bound value that downstream totals read", () => {
    const document = buildCalcDocument(
      [
        { type: "markdown", markdown: ":calc[a = 100 CAD]{as=USD}" },
        { type: "markdown", markdown: ":calc[a * 2]" },
      ],
      { fxTable: TABLE },
    );

    expect(document.results.get("0:0")?.value).toContain("72.44");
    // Still 200 CAD, not 144.88 USD — display never mutates the binding.
    expect(document.results.get("1:0")?.value).toContain("CA$200.00");
  });
});

describe("day keys", () => {
  it("formats a date as a UTC day key", () => {
    expect(fxDayKey(new Date("2026-09-08T23:30:00Z"))).toBe("2026-09-08");
  });

  it("accepts a real day and rejects a malformed one", () => {
    expect(isFxDayKey("2026-09-08")).toBe(true);
    expect(isFxDayKey("2026-13-99")).toBe(false);
    expect(isFxDayKey("08-09-2026")).toBe(false);
  });
});
