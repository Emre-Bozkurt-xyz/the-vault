import { describe, expect, it } from "vitest";

import type { FxRateTable } from "@/lib/calc/fx";
import { parseCalcSettings } from "@/lib/calc/settings";
import { buildCalcDocument } from "@/lib/markdown/calc-document";

const TABLE: FxRateTable = {
  base: "EUR",
  date: "2026-09-08",
  provider: "ECB",
  rates: { USD: "1.1614", CAD: "1.6033" },
};

function frontmatter(body: string): string {
  return `---\n${body}\n---\n\n# Doc\n`;
}

describe("parseCalcSettings", () => {
  it("reads both keys", () => {
    expect(
      parseCalcSettings(
        frontmatter("calc_currency: USD\ncalc_rate_date: 2026-09-08"),
      ),
    ).toEqual({ displayCurrency: "USD", rateDate: "2026-09-08" });
  });

  it("defaults to nothing without frontmatter", () => {
    expect(parseCalcSettings("# Just a doc")).toEqual({
      displayCurrency: null,
      rateDate: null,
    });
  });

  it("normalizes a lowercase currency and strips quotes", () => {
    expect(
      parseCalcSettings(frontmatter('calc_currency: "usd"')).displayCurrency,
    ).toBe("USD");
  });

  it("ignores an unknown currency rather than failing the document", () => {
    expect(
      parseCalcSettings(frontmatter("calc_currency: dollars")).displayCurrency,
    ).toBeNull();
  });

  it("ignores a malformed or impossible date", () => {
    expect(
      parseCalcSettings(frontmatter("calc_rate_date: 2026-13-99")).rateDate,
    ).toBeNull();
    expect(
      parseCalcSettings(frontmatter("calc_rate_date: last tuesday")).rateDate,
    ).toBeNull();
  });

  it("leaves other frontmatter keys alone", () => {
    const settings = parseCalcSettings(
      frontmatter("tags: finance\ncalc_currency: CAD\nsummary: Q1"),
    );

    expect(settings.displayCurrency).toBe("CAD");
  });

  it("only reads the leading frontmatter block", () => {
    // A `---` divider later in the body must not be mistaken for frontmatter.
    const markdown = "# Doc\n\n---\n\ncalc_currency: USD\n\n---\n";

    expect(parseCalcSettings(markdown).displayCurrency).toBeNull();
  });
});

describe("calc_currency as the document default", () => {
  const piece = (markdown: string) =>
    ({ type: "markdown", markdown }) as const;

  it("re-denominates every value", () => {
    const document = buildCalcDocument([piece(":calc[100 CAD]")], {
      fxTable: TABLE,
      displayCurrency: "USD",
    });
    const result = document.results.get("0:0");

    expect(result?.state).toBe("converted");
    expect(result?.value).toContain("72.44");
  });

  it("loses to a per-value {as=…}", () => {
    // One stubborn figure can stay in its own currency.
    const document = buildCalcDocument([piece(":calc[100 CAD]{as=CAD}")], {
      fxTable: TABLE,
      displayCurrency: "USD",
    });

    expect(document.results.get("0:0")?.value).toContain("CA$100.00");
  });

  it("leaves a value already in the target alone", () => {
    const document = buildCalcDocument([piece(":calc[100 USD]")], {
      fxTable: TABLE,
      displayCurrency: "USD",
    });

    expect(document.results.get("0:0")?.state).toBe("ok");
    expect(document.results.get("0:0")?.value).toContain("100.00");
  });

  it("shows the native currency when no rate reaches the target", () => {
    const document = buildCalcDocument([piece(":calc[100 CAD]")], {
      fxTable: TABLE,
      displayCurrency: "MGA",
    });

    expect(document.results.get("0:0")?.value).toContain("CA$100.00");
  });

  it("does not change the bound values downstream totals read", () => {
    const document = buildCalcDocument(
      [piece(":calc[a = 100 CAD] :calc[a * 2]")],
      { fxTable: TABLE, displayCurrency: "USD" },
    );

    // Both display in USD, but the binding stayed 100 CAD, so the total is
    // 200 CAD converted — not 72.44 * 2.
    expect(document.results.get("0:1")?.value).toContain("144.88");
  });

  it("leaves dimensionless values untouched", () => {
    const document = buildCalcDocument([piece(":calc[2 + 3]")], {
      fxTable: TABLE,
      displayCurrency: "USD",
    });

    expect(document.results.get("0:0")?.value).toBe("5");
    expect(document.results.get("0:0")?.state).toBe("ok");
  });
});
