/**
 * Exchange-rate math for `:calc`. Pure: no network, no database.
 *
 * Rates arrive as a single day's table quoted against one base (ECB publishes
 * EUR-based), and every cross rate is triangulated from it:
 *
 *     CAD -> USD  =  (EUR -> USD) / (EUR -> CAD)
 *
 * Fetching one base table per day rather than per-pair means a single request
 * and a single cached row serve every conversion in every document.
 *
 * Amounts stay exact `Decimal`s throughout — rates are carried as decimal
 * *strings* rather than JS numbers so nothing is lost crossing JSON or the
 * database column.
 */

import {
  ONE,
  decimalFromString,
  decimalToString,
  divide,
  roundTo,
  type Decimal,
} from "./decimal";
import type { RateResolver } from "./types";
import type { FxRateTable } from "@/lib/extension-api/fx";


/** A conversion the evaluator performed, for provenance display. */
export type FxConversion = {
  from: string;
  to: string;
};

/** Significant decimal places shown for a rate in the provenance tooltip. */
const RATE_DISPLAY_SCALE = 6;

/**
 * Units of `base` per 1 unit of `code`, or null when the table has no entry.
 * The base itself is always exactly 1 — never look it up in `rates`, which by
 * construction omits it.
 */
function baseRate(table: FxRateTable, code: string): Decimal | null {
  if (code === table.base) {
    return ONE;
  }

  const raw = table.rates[code];

  return raw === undefined ? null : decimalFromString(raw);
}

/**
 * Builds the multiplier taking 1 unit of `from` to `to`, or null when either
 * side is missing from the table (which surfaces as `missing-rate` on that one
 * value rather than as a failed render).
 */
export function crossRate(
  table: FxRateTable,
  from: string,
  to: string,
): Decimal | null {
  if (from === to) {
    return ONE;
  }

  const fromRate = baseRate(table, from);
  const toRate = baseRate(table, to);

  if (!fromRate || !toRate) {
    return null;
  }

  return divide(toRate, fromRate);
}

/**
 * Adapts a rate table to the evaluator's {@link RateResolver}. A null table
 * (nothing cached, provider never reached) yields a resolver with no rates —
 * same-currency arithmetic still works, conversions report `missing-rate`.
 */
export function createRateResolver(table: FxRateTable | null): RateResolver {
  if (!table) {
    return { rate: () => null };
  }

  return { rate: (from, to) => crossRate(table, from, to) };
}

/**
 * One-line provenance for a converted value, e.g.
 * `1 CAD = 0.7335 USD · ECB · 2026-09-08`.
 *
 * Shown on hover so a figure is auditable: which rate, from whom, for what day.
 * Without it a converted number is unfalsifiable, which is the difference
 * between a report and a guess.
 */
export function describeConversion(
  table: FxRateTable | null,
  conversion: FxConversion,
): string | null {
  if (!table) {
    return null;
  }

  const rate = crossRate(table, conversion.from, conversion.to);

  if (!rate) {
    return null;
  }

  const shown = decimalToString(roundTo(rate, RATE_DISPLAY_SCALE));
  const suffix = table.stale ? " · rate may be out of date" : "";

  return `1 ${conversion.from} = ${shown} ${conversion.to} · ${table.provider} · ${table.date}${suffix}`;
}
