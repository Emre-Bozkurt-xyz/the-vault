/**
 * Exact decimal arithmetic for the `:calc` extension, backed by `bigint`.
 *
 * Money in IEEE 754 is wrong in ways that matter here (`0.1 + 0.2 !== 0.3`), and
 * a finance report is exactly the document where that surfaces. A value is
 * `mantissa / 10^scale`, so `+`, `-` and `*` are *exact* — they only ever add or
 * align scales. Division is the sole lossy operation and is pinned to
 * {@link DIVISION_SCALE} digits with half-even rounding.
 *
 * Deliberately framework-free and dependency-free: this module runs unchanged in
 * RSC render, in the CodeMirror live decoration, and in an agent action.
 */

export type Decimal = {
  /** Unscaled digits; the represented value is `mantissa / 10n ** scale`. */
  readonly mantissa: bigint;
  /** Decimal places. Always >= 0. */
  readonly scale: number;
};

/** Digits kept after a division. Beyond this, results are rounded half-even. */
export const DIVISION_SCALE = 20;

/**
 * Hard ceiling on retained decimal places. Repeated multiplication grows scale
 * additively (`0.001 * 0.001` -> scale 6), so without a cap a long chain could
 * balloon the mantissa. Results past this are rounded half-even.
 */
export const MAX_SCALE = 28;

/**
 * Ceiling on integer digits. Guards the fuel budget: `9^9^9` is only three
 * tokens but would otherwise allocate a bigint large enough to hang the tab.
 */
export const MAX_INTEGER_DIGITS = 30;

export const ZERO: Decimal = { mantissa: 0n, scale: 0 };
export const ONE: Decimal = { mantissa: 1n, scale: 0 };
const HUNDRED: Decimal = { mantissa: 100n, scale: 0 };

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Builds a Decimal, stripping trailing zeros so `1.50` and `1.5` compare and
 * hash identically. Display padding (a CAD amount showing two places) is a
 * formatting concern, handled in `currency.ts`, not a property of the value.
 */
export function makeDecimal(mantissa: bigint, scale: number): Decimal {
  if (scale < 0) {
    return makeDecimal(mantissa * pow10(-scale), 0);
  }

  let m = mantissa;
  let s = scale;

  while (s > 0 && m !== 0n && m % 10n === 0n) {
    m /= 10n;
    s -= 1;
  }

  if (m === 0n) {
    return ZERO;
  }

  return { mantissa: m, scale: s };
}

export function isZero(value: Decimal): boolean {
  return value.mantissa === 0n;
}

export function isNegative(value: Decimal): boolean {
  return value.mantissa < 0n;
}

/** True when the value has no fractional part. */
export function isInteger(value: Decimal): boolean {
  return value.scale === 0;
}

/**
 * Count of digits left of the decimal point, used for the magnitude guard.
 */
export function integerDigits(value: Decimal): number {
  const whole = absBigInt(value.mantissa) / pow10(value.scale);
  return whole === 0n ? 1 : whole.toString().length;
}

export function exceedsMagnitudeLimit(value: Decimal): boolean {
  return integerDigits(value) > MAX_INTEGER_DIGITS;
}

/**
 * Parses a plain decimal literal. Underscores are accepted as digit group
 * separators (`1_200.50`); commas deliberately are not, because they are the
 * argument separator in `sum(a, b)` and allowing both makes `sum(1,200)`
 * ambiguous between one argument and two.
 *
 * Returns null for anything that is not a finite plain decimal — no exponent
 * notation, no leading `+`, no bare `.5`.
 */
export function decimalFromString(input: string): Decimal | null {
  const cleaned = input.replace(/_/g, "");

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole, fraction = ""] = unsigned.split(".");
  const mantissa = BigInt(whole + fraction);

  return makeDecimal(negative ? -mantissa : mantissa, fraction.length);
}

/** Aligns two values to a common scale so their mantissas are comparable. */
function align(a: Decimal, b: Decimal): { a: bigint; b: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);

  return {
    a: a.mantissa * pow10(scale - a.scale),
    b: b.mantissa * pow10(scale - b.scale),
    scale,
  };
}

export function add(a: Decimal, b: Decimal): Decimal {
  const aligned = align(a, b);
  return makeDecimal(aligned.a + aligned.b, aligned.scale);
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const aligned = align(a, b);
  return makeDecimal(aligned.a - aligned.b, aligned.scale);
}

export function negate(value: Decimal): Decimal {
  return makeDecimal(-value.mantissa, value.scale);
}

export function absolute(value: Decimal): Decimal {
  return isNegative(value) ? negate(value) : value;
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  const product = makeDecimal(a.mantissa * b.mantissa, a.scale + b.scale);
  return product.scale > MAX_SCALE ? roundTo(product, MAX_SCALE) : product;
}

/**
 * Divides, or returns null on division by zero (a caller-visible error rather
 * than an Infinity that would silently poison every downstream total).
 *
 * Computes two guard digits past {@link DIVISION_SCALE} and applies a sticky
 * digit when the division is inexact, so a truncated remainder can never be
 * mistaken for an exact half and rounded the wrong way.
 */
export function divide(a: Decimal, b: Decimal): Decimal | null {
  if (isZero(b)) {
    return null;
  }

  const guardScale = DIVISION_SCALE + 2;
  const numerator = a.mantissa * pow10(b.scale + guardScale);
  const denominator = b.mantissa * pow10(a.scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  // Sticky digit: mark an inexact result so `roundTo` never sees a false exact
  // half. Nudges away from zero, which cannot change the rounded digit itself.
  const sticky =
    remainder !== 0n && quotient % 5n === 0n
      ? quotient + (quotient < 0n ? -1n : 1n)
      : quotient;

  return roundTo({ mantissa: sticky, scale: guardScale }, DIVISION_SCALE);
}

/** Raises to a non-negative integer power via binary exponentiation. */
export function power(base: Decimal, exponent: number): Decimal | null {
  if (!Number.isInteger(exponent) || exponent < 0) {
    return null;
  }

  let result = ONE;
  let factor = base;
  let remaining = exponent;

  while (remaining > 0) {
    if (remaining % 2 === 1) {
      result = multiply(result, factor);

      if (exceedsMagnitudeLimit(result)) {
        return null;
      }
    }

    remaining = Math.floor(remaining / 2);

    if (remaining > 0) {
      factor = multiply(factor, factor);

      if (exceedsMagnitudeLimit(factor)) {
        return null;
      }
    }
  }

  return result;
}

/** Interprets the value as a percentage, i.e. divides by 100. */
export function percent(value: Decimal): Decimal {
  return divide(value, HUNDRED) ?? ZERO;
}

/**
 * Rounds to `scale` decimal places using banker's rounding (half-to-even), the
 * convention financial reporting expects: it does not bias a column of totals
 * upward the way half-away-from-zero does.
 */
export function roundTo(value: Decimal, scale: number): Decimal {
  if (scale < 0) {
    return roundTo(value, 0);
  }

  if (value.scale <= scale) {
    return makeDecimal(value.mantissa * pow10(scale - value.scale), scale);
  }

  const drop = value.scale - scale;
  const divisor = pow10(drop);
  const negative = value.mantissa < 0n;
  const magnitude = absBigInt(value.mantissa);

  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const half = divisor / 2n;

  let rounded = quotient;

  if (remainder > half) {
    rounded += 1n;
  } else if (remainder === half && quotient % 2n === 1n) {
    rounded += 1n;
  }

  return makeDecimal(negative ? -rounded : rounded, scale);
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const aligned = align(a, b);

  if (aligned.a < aligned.b) return -1;
  if (aligned.a > aligned.b) return 1;
  return 0;
}

export function equals(a: Decimal, b: Decimal): boolean {
  return compare(a, b) === 0;
}

/**
 * Plain digit string, e.g. `-1200.5`. Never exponent notation, so it round-trips
 * through {@link decimalFromString} and is safe to hand to `Number()` for
 * display formatting.
 */
export function decimalToString(value: Decimal): string {
  const negative = value.mantissa < 0n;
  const digits = absBigInt(value.mantissa).toString();

  if (value.scale === 0) {
    return negative ? `-${digits}` : digits;
  }

  const padded = digits.padStart(value.scale + 1, "0");
  const whole = padded.slice(0, padded.length - value.scale);
  const fraction = padded.slice(padded.length - value.scale);

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Lossy conversion for display-layer APIs (`Intl.NumberFormat`) that only take
 * numbers. Callers must round to the display scale first and must not feed the
 * result back into further arithmetic.
 */
export function decimalToNumber(value: Decimal): number {
  return Number(decimalToString(value));
}
