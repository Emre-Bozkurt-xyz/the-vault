import { describe, expect, it } from "vitest";

import {
  DIVISION_SCALE,
  add,
  compare,
  decimalFromString,
  decimalToString,
  divide,
  exceedsMagnitudeLimit,
  multiply,
  power,
  roundTo,
  subtract,
  type Decimal,
} from "@/lib/calc/decimal";

/** Parses a literal, asserting validity, so tests read as plain numbers. */
function d(literal: string): Decimal {
  const value = decimalFromString(literal);

  if (!value) {
    throw new Error(`test literal "${literal}" did not parse`);
  }

  return value;
}

function str(value: Decimal | null): string | null {
  return value === null ? null : decimalToString(value);
}

describe("decimalFromString", () => {
  it("accepts underscores as digit group separators", () => {
    expect(str(d("1_200.50"))).toBe("1200.5");
  });

  it("rejects comma-grouped numbers, which would make sum(1,200) ambiguous", () => {
    expect(decimalFromString("1,200")).toBeNull();
  });

  it("rejects exponent notation, a bare leading dot, and a leading plus", () => {
    expect(decimalFromString("1e6")).toBeNull();
    expect(decimalFromString(".5")).toBeNull();
    expect(decimalFromString("+5")).toBeNull();
  });

  it("normalizes trailing zeros so 1.50 and 1.5 are one value", () => {
    expect(d("1.50")).toEqual(d("1.5"));
  });
});

describe("exact arithmetic", () => {
  it("adds tenths without float drift", () => {
    // The reason this module exists rather than using `number`.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(str(add(d("0.1"), d("0.2")))).toBe("0.3");
  });

  it("keeps long money sums exact", () => {
    const total = [
      "1200.55",
      "42.99",
      "0.01",
      "999999.44",
    ].reduce((acc, part) => add(acc, d(part)), d("0"));

    expect(str(total)).toBe("1001242.99");
  });

  it("subtracts to exactly zero", () => {
    expect(str(subtract(d("1.1"), d("1.1")))).toBe("0");
  });

  it("multiplies exactly, growing scale additively", () => {
    expect(str(multiply(d("0.001"), d("0.001")))).toBe("0.000001");
    expect(str(multiply(d("1200"), d("3")))).toBe("3600");
  });
});

describe("divide", () => {
  it("returns null on division by zero rather than an Infinity", () => {
    expect(divide(d("1"), d("0"))).toBeNull();
  });

  it("divides exactly when the result terminates", () => {
    expect(str(divide(d("100"), d("4")))).toBe("25");
    expect(str(divide(d("1"), d("8")))).toBe("0.125");
  });

  it("caps a repeating result at DIVISION_SCALE digits", () => {
    const third = divide(d("1"), d("3"));

    expect(third).not.toBeNull();
    expect(str(third)).toBe(`0.${"3".repeat(DIVISION_SCALE)}`);
  });

  it("rounds the final digit rather than truncating it", () => {
    // 2/3 = 0.666… so the 20th digit rounds up to 7.
    expect(str(divide(d("2"), d("3")))).toBe(
      `0.${"6".repeat(DIVISION_SCALE - 1)}7`,
    );
  });
});

describe("roundTo", () => {
  it("rounds half to even, so a column of totals is not biased upward", () => {
    expect(str(roundTo(d("2.5"), 0))).toBe("2");
    expect(str(roundTo(d("3.5"), 0))).toBe("4");
    expect(str(roundTo(d("-2.5"), 0))).toBe("-2");
    expect(str(roundTo(d("-3.5"), 0))).toBe("-4");
  });

  it("rounds normally away from the exact half", () => {
    expect(str(roundTo(d("2.4"), 0))).toBe("2");
    expect(str(roundTo(d("2.6"), 0))).toBe("3");
  });

  it("rounds money to a given number of places", () => {
    expect(str(roundTo(d("1200.555"), 2))).toBe("1200.56");
    expect(str(roundTo(d("1200.545"), 2))).toBe("1200.54");
  });

  it("does not pad when asked for more places than it has", () => {
    // Padding is a display concern; the value itself stays normalized.
    expect(str(roundTo(d("1.5"), 4))).toBe("1.5");
  });
});

describe("power", () => {
  it("raises to a non-negative integer power", () => {
    expect(str(power(d("2"), 10))).toBe("1024");
    expect(str(power(d("1.1"), 2))).toBe("1.21");
  });

  it("treats anything to the zero as one", () => {
    expect(str(power(d("1200.55"), 0))).toBe("1");
  });

  it("refuses a fractional or negative exponent", () => {
    expect(power(d("2"), 0.5)).toBeNull();
    expect(power(d("2"), -1)).toBeNull();
  });

  it("bails out instead of allocating an unbounded bigint", () => {
    expect(power(d("9"), 999_999)).toBeNull();
  });
});

describe("compare", () => {
  it("compares across differing scales", () => {
    expect(compare(d("1.50"), d("1.5"))).toBe(0);
    expect(compare(d("1.5"), d("1.05"))).toBe(1);
    expect(compare(d("-2"), d("-1"))).toBe(-1);
  });
});

describe("exceedsMagnitudeLimit", () => {
  it("passes ordinary money and rejects absurd magnitudes", () => {
    expect(exceedsMagnitudeLimit(d("999999999.99"))).toBe(false);
    expect(exceedsMagnitudeLimit(d("1".repeat(40)))).toBe(true);
  });
});

describe("decimalToString", () => {
  it("never emits exponent notation, so results round-trip", () => {
    const tiny = multiply(d("0.0000001"), d("0.0000001"));

    expect(decimalToString(tiny)).toBe("0.00000000000001");
    expect(decimalFromString(decimalToString(tiny))).toEqual(tiny);
  });

  it("renders negatives and sub-one values with a leading zero", () => {
    expect(str(d("-0.5"))).toBe("-0.5");
  });
});
