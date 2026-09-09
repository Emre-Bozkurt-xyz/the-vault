/**
 * Shared value and error types for the `:calc` evaluator.
 *
 * Nothing in the calc pipeline throws for authoring mistakes. A malformed
 * expression is a *value* — one bad `:calc[…]` renders as an inline error chip
 * while the rest of the document renders normally. Throwing would let a typo in
 * one sentence blank a whole page, including a published one.
 */

import type { Decimal } from "@/lib/calc/decimal";

/**
 * A computed result. `currency: null` is a dimensionless number (a count, a
 * ratio, a percentage) — it is not "unknown currency", it is the absence of a
 * unit, and the unit algebra in `evaluate.ts` treats it as such.
 */
export type CalcValue = {
  amount: Decimal;
  currency: string | null;
};

export type CalcErrorCode =
  /** Source text could not be tokenized (stray character, unterminated group). */
  | "syntax"
  /** Referenced a name that is not bound above this point in the document. */
  | "unknown-name"
  /** Bound the same name twice in one document. */
  | "duplicate-name"
  /** Tried to bind a reserved word or an ISO currency code as a name. */
  | "reserved-name"
  /** Operation is undefined for these units, e.g. `CAD * CAD` or `1 + 1 CAD`. */
  | "unit-mismatch"
  /** Needed an FX rate that the provider does not carry for that date. */
  | "missing-rate"
  /** Division by zero. */
  | "divide-by-zero"
  /** Unknown function name, or wrong argument count. */
  | "bad-call"
  /** Expression exceeded a size, depth, or magnitude guard. */
  | "limit-exceeded";

export type CalcError = {
  code: CalcErrorCode;
  message: string;
  /** Character offset into the expression source, when known. */
  position?: number;
};

export type CalcOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: CalcError };

export function ok<T>(value: T): CalcOutcome<T> {
  return { ok: true, value };
}

export function fail<T>(
  code: CalcErrorCode,
  message: string,
  position?: number,
): CalcOutcome<T> {
  return { ok: false, error: { code, message, position } };
}

/**
 * Resolves an FX rate. Injected rather than imported so the evaluator stays
 * pure and offline-testable: slice 1 passes a resolver that carries no rates at
 * all, and every same-currency expression still evaluates.
 *
 * Returns the multiplier taking one unit of `from` to `to`, or null when the
 * provider has no rate for that pair — which surfaces as a `missing-rate` error
 * on that one value, never as a thrown exception.
 */
export type RateResolver = {
  rate: (from: string, to: string) => Decimal | null;
};

/** A resolver with no rates. Same-currency arithmetic works; conversion fails. */
export const NO_RATES: RateResolver = { rate: () => null };
