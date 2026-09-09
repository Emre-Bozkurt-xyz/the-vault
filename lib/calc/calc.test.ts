import { describe, expect, it } from "vitest";

import { decimalFromString, decimalToString } from "@/lib/calc/decimal";
import { formatMoney, isCurrencyCode } from "@/lib/calc/currency";
import { evaluateDocument, evaluateExpression } from "@/lib/calc/evaluate";
import { parse } from "@/lib/calc/parser";
import { tokenize } from "@/lib/calc/tokenizer";
import type { CalcErrorCode, CalcValue, RateResolver } from "@/lib/calc/types";

const EMPTY_SCOPE = new Map<string, CalcValue>();

/** A fixed rate table, so evaluation tests never depend on a live provider. */
const RATES: RateResolver = {
  rate: (from, to) => {
    const table: Record<string, string> = {
      "CAD>USD": "0.73",
      "USD>CAD": "1.3699",
      "EUR>USD": "1.08",
    };

    const found = table[`${from}>${to}`];
    return found ? decimalFromString(found) : null;
  },
};

/** Evaluates and returns the printed amount, failing loudly on an error. */
function value(source: string, rates?: RateResolver): string {
  const result = evaluateExpression(source, EMPTY_SCOPE, { rates });

  if (!result.ok) {
    throw new Error(`${source} -> ${result.error.code}: ${result.error.message}`);
  }

  return decimalToString(result.value.amount);
}

/** Evaluates and returns `amount currency`, or `amount` when dimensionless. */
function valueWithUnit(source: string, rates?: RateResolver): string {
  const result = evaluateExpression(source, EMPTY_SCOPE, { rates });

  if (!result.ok) {
    throw new Error(`${source} -> ${result.error.code}: ${result.error.message}`);
  }

  return [decimalToString(result.value.amount), result.value.currency]
    .filter(Boolean)
    .join(" ");
}

/** Asserts the expression fails, returning the error code for comparison. */
function errorCode(source: string, rates?: RateResolver): CalcErrorCode {
  const result = evaluateExpression(source, EMPTY_SCOPE, { rates });

  if (result.ok) {
    throw new Error(`${source} unexpectedly succeeded`);
  }

  return result.error.code;
}

describe("tokenizer currency/identifier disambiguation", () => {
  it("reads an uppercase ISO code as a currency and anything else as a name", () => {
    const tokens = tokenize("100 CAD + cad + VAT");

    expect(tokens.ok).toBe(true);

    if (!tokens.ok) return;

    const kinds = tokens.value
      .filter((token) => token.kind !== "end")
      .map((token) => `${token.kind}:${token.text}`);

    expect(kinds).toEqual([
      "number:100",
      "currency:CAD",
      "operator:+",
      "identifier:cad",
      "operator:+",
      "identifier:VAT",
    ]);
  });

  it("treats a three-letter uppercase non-code as an ordinary name", () => {
    expect(isCurrencyCode("VAT")).toBe(false);
    expect(isCurrencyCode("CAD")).toBe(true);
  });

  it("rejects a stray character rather than silently skipping it", () => {
    const tokens = tokenize("100 CAD & 5");

    expect(tokens.ok).toBe(false);
  });
});

describe("parser", () => {
  it("reads a binding and a bare expression", () => {
    const binding = parse("rent = 1200 CAD");
    const bare = parse("rent * 3");

    expect(binding.ok && binding.value.name).toBe("rent");
    expect(bare.ok && bare.value.name).toBeNull();
  });

  it("refuses to bind a currency code as a name", () => {
    const result = parse("CHF = 5");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("reserved-name");
  });

  it("applies `in` to the whole expression, not just the last term", () => {
    // `100 CAD + 100 CAD in USD` must convert the 200, not the trailing 100.
    expect(valueWithUnit("100 CAD + 100 CAD in USD", RATES)).toBe("146 USD");
  });

  it("reports an unclosed parenthesis", () => {
    const result = parse("(1 + 2");

    expect(!result.ok && result.error.code).toBe("syntax");
  });
});

describe("arithmetic and precedence", () => {
  it("honours multiplication over addition", () => {
    expect(value("2 + 3 * 4")).toBe("14");
    expect(value("(2 + 3) * 4")).toBe("20");
  });

  it("binds unary minus looser than exponentiation", () => {
    expect(value("-2^2")).toBe("-4");
  });

  it("associates exponentiation to the right", () => {
    expect(value("2^3^2")).toBe("512");
  });

  it("supports a negative exponent as a reciprocal", () => {
    expect(value("2^-1")).toBe("0.5");
  });
});

describe("unit algebra", () => {
  it("adds and subtracts within one currency", () => {
    expect(valueWithUnit("1200 CAD + 42 CAD")).toBe("1242 CAD");
  });

  it("scales money by a plain number", () => {
    expect(valueWithUnit("1200 CAD * 3")).toBe("3600 CAD");
    expect(valueWithUnit("3 * 1200 CAD")).toBe("3600 CAD");
    expect(valueWithUnit("1200 CAD / 4")).toBe("300 CAD");
  });

  it("makes money over money a dimensionless ratio", () => {
    expect(valueWithUnit("100 CAD / 50 CAD")).toBe("2");
  });

  it("refuses to add money to a plain number", () => {
    expect(errorCode("1200 CAD + 3")).toBe("unit-mismatch");
  });

  it("refuses a squared currency", () => {
    expect(errorCode("2 CAD * 3 CAD")).toBe("unit-mismatch");
  });

  it("refuses a plain number divided by money", () => {
    expect(errorCode("3 / 2 CAD")).toBe("unit-mismatch");
  });

  it("refuses to exponentiate money", () => {
    expect(errorCode("2 CAD ^ 2")).toBe("unit-mismatch");
  });
});

describe("percent", () => {
  it("reads a percentage as a dimensionless hundredth", () => {
    expect(valueWithUnit("20%")).toBe("0.2");
  });

  it("scales money by a percentage", () => {
    expect(valueWithUnit("100 CAD * 20%")).toBe("20 CAD");
  });

  it("refuses contextual percent addition, which is ambiguous", () => {
    // `100 CAD + 20%` reads as either 120 CAD or a unit error depending on the
    // tool. We make it an error and require `* 1.2`, so it can never be silently
    // wrong in a report.
    expect(errorCode("100 CAD + 20%")).toBe("unit-mismatch");
  });
});

describe("currency conversion", () => {
  it("converts with an available rate", () => {
    expect(valueWithUnit("100 CAD in USD", RATES)).toBe("73 USD");
  });

  it("accepts `to` as a synonym for `in`", () => {
    expect(valueWithUnit("100 CAD to USD", RATES)).toBe("73 USD");
  });

  it("converts the right operand into the left when adding across currencies", () => {
    // Reading order decides the reported currency: `rent + fee` reports in rent's.
    expect(valueWithUnit("100 CAD + 100 USD", RATES)).toBe("236.99 CAD");
  });

  it("reports a missing rate on that value instead of throwing", () => {
    expect(errorCode("100 MGA in USD", RATES)).toBe("missing-rate");
  });

  it("still evaluates same-currency math with no rates at all", () => {
    // Slice-1 behaviour: the whole engine is useful entirely offline.
    expect(valueWithUnit("1200 CAD + 42 CAD")).toBe("1242 CAD");
  });

  it("refuses to invent a currency for a plain number", () => {
    expect(errorCode("100 in USD", RATES)).toBe("unit-mismatch");
  });

  it("converts a value that is already in the target currency", () => {
    expect(valueWithUnit("100 USD in USD")).toBe("100 USD");
  });
});

describe("functions", () => {
  it("sums and averages money", () => {
    expect(valueWithUnit("sum(10 CAD, 20 CAD, 30 CAD)")).toBe("60 CAD");
    expect(valueWithUnit("avg(10 CAD, 20 CAD, 30 CAD)")).toBe("20 CAD");
  });

  it("sums across currencies when rates exist", () => {
    expect(valueWithUnit("sum(100 CAD, 100 USD)", RATES)).toBe("236.99 CAD");
  });

  it("picks extremes", () => {
    expect(valueWithUnit("min(10 CAD, 3 CAD, 30 CAD)")).toBe("3 CAD");
    expect(valueWithUnit("max(10 CAD, 3 CAD, 30 CAD)")).toBe("30 CAD");
  });

  it("defaults round() to the currency's own precision", () => {
    // JPY has no minor unit, so `round` must land on whole yen, not two places.
    expect(valueWithUnit("round(1200.678 JPY)")).toBe("1201 JPY");
    expect(valueWithUnit("round(1200.678 USD)")).toBe("1200.68 USD");
  });

  it("accepts an explicit number of places", () => {
    expect(valueWithUnit("round(1200.678 USD, 1)")).toBe("1200.7 USD");
  });

  it("takes an absolute value", () => {
    expect(valueWithUnit("abs(0 CAD - 42 CAD)")).toBe("42 CAD");
  });

  it("reports an unknown function and a bad argument count", () => {
    expect(errorCode("median(1, 2)")).toBe("bad-call");
    expect(errorCode("abs(1, 2)")).toBe("bad-call");
  });
});

describe("errors are values, not exceptions", () => {
  it("reports division by zero", () => {
    expect(errorCode("1 / 0")).toBe("divide-by-zero");
  });

  it("reports an empty expression", () => {
    expect(errorCode("")).toBe("syntax");
  });

  it("refuses an over-long expression", () => {
    expect(errorCode("1 + ".repeat(300) + "1")).toBe("limit-exceeded");
  });

  it("refuses deeply nested parentheses", () => {
    const deep = "(".repeat(40) + "1" + ")".repeat(40);

    expect(errorCode(deep)).toBe("limit-exceeded");
  });

  it("refuses an explosive exponent chain", () => {
    expect(errorCode("9^9^9")).toBe("limit-exceeded");
  });
});

describe("evaluateDocument", () => {
  it("binds names top to bottom and reads them downstream", () => {
    const { results, bindings } = evaluateDocument([
      { id: "a", source: "rent = 1200 CAD" },
      { id: "b", source: "domains = 42 CAD" },
      { id: "c", source: "rent * 3 + domains" },
    ]);

    expect(results.get("a")?.ok).toBe(true);
    expect(bindings.get("rent")?.currency).toBe("CAD");

    const total = results.get("c");

    expect(total?.ok).toBe(true);
    expect(total?.ok && decimalToString(total.value.amount)).toBe("3642");
  });

  it("renders a binding as its own value, so it reads inline in prose", () => {
    const { results } = evaluateDocument([
      { id: "a", source: "rent = 1200 CAD" },
    ]);

    const bound = results.get("a");

    expect(bound?.ok && decimalToString(bound.value.amount)).toBe("1200");
  });

  it("makes a forward reference an error, which is what forbids cycles", () => {
    const { results } = evaluateDocument([
      { id: "a", source: "total * 2" },
      { id: "b", source: "total = 10 CAD" },
    ]);

    const forward = results.get("a");

    expect(forward?.ok).toBe(false);
    expect(!forward?.ok && forward?.error.code).toBe("unknown-name");
  });

  it("rejects a redefinition and keeps the first binding", () => {
    const { results, bindings } = evaluateDocument([
      { id: "a", source: "rent = 1200 CAD" },
      { id: "b", source: "rent = 9999 CAD" },
      { id: "c", source: "rent" },
    ]);

    expect(!results.get("b")?.ok && results.get("b")).toBeTruthy();
    expect(bindings.get("rent")?.amount).toEqual(
      decimalFromString("1200") ?? undefined,
    );

    const read = results.get("c");

    expect(read?.ok && decimalToString(read.value.amount)).toBe("1200");
  });

  it("isolates a broken expression from the rest of the document", () => {
    const { results } = evaluateDocument([
      { id: "a", source: "rent = 1200 CAD" },
      { id: "b", source: "rent + " },
      { id: "c", source: "rent * 2" },
    ]);

    expect(results.get("b")?.ok).toBe(false);
    expect(results.get("c")?.ok).toBe(true);
  });

  it("carries a converted binding forward in its new currency", () => {
    const { bindings } = evaluateDocument(
      [
        { id: "a", source: "rent = 1200 CAD" },
        { id: "b", source: "rentUsd = rent in USD" },
      ],
      { rates: RATES },
    );

    expect(bindings.get("rentUsd")?.currency).toBe("USD");
    expect(
      bindings.get("rentUsd") &&
        decimalToString(bindings.get("rentUsd")!.amount),
    ).toBe("876");
  });
});

describe("formatMoney", () => {
  const amount = decimalFromString("1200.5")!;

  it("uses the currency's minor units", () => {
    expect(formatMoney(amount, "USD")).toContain("1,200.50");
  });

  it("shows no decimals for a zero-minor-unit currency", () => {
    const yen = formatMoney(decimalFromString("1200")!, "JPY");

    expect(yen).toContain("1,200");
    expect(yen).not.toContain(".");
  });

  it("shows three decimals for a three-minor-unit currency", () => {
    expect(formatMoney(decimalFromString("1200.5")!, "KWD")).toContain(
      "1,200.500",
    );
  });

  it("formats a dimensionless value as a plain number", () => {
    expect(formatMoney(decimalFromString("1200.5")!, null)).toBe("1,200.5");
  });

  it("falls back to a plain string rather than truncating a huge amount", () => {
    const huge = decimalFromString("123456789012345678")!;

    expect(formatMoney(huge, "USD")).toBe("123456789012345678 USD");
  });
});
