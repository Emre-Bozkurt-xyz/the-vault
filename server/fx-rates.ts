import { and, desc, eq, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { fxRates } from "@/db/schema";
import { fxDayKey, isFxDayKey, type FxRateTable } from "@/lib/calc/fx";
import {
  FX_BASE,
  frankfurterProvider,
  type FxProvider,
} from "@/lib/fx/provider";

/**
 * Cached daily FX rates for `:calc`.
 *
 * Three rules shape this module, all of them consequences of the same goal —
 * a report must total the same on every page load:
 *
 * 1. **Never fail a render.** Provider down, no network, nothing cached — the
 *    document still renders; conversions just report `missing-rate`.
 * 2. **Never block a render on the provider.** If any table is cached it is
 *    served immediately and the refresh happens after the response.
 * 3. **Day-scoped, not live.** One table per day, one request covering every
 *    conversion in every document.
 *
 * No permission checks: `fx_rates` is provider-sourced public reference data
 * with no owner. It is the one table in this app where that is true.
 */

/**
 * How old a cached table may be before a refresh is attempted. Sized against
 * ECB's daily (business-day) publication — long enough that a weekend or a
 * holiday does not cause repeated fetches, short enough that a new publication
 * is picked up the same day.
 */
const MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000;

/** Deduplicates concurrent refreshes within a server process. */
let inFlight: Promise<FxRateTable | null> | null = null;

function rowsToTable(
  rows: Array<{ quote: string; rate: string; rateDate: string; provider: string }>,
): FxRateTable | null {
  if (rows.length === 0) {
    return null;
  }

  const rates: Record<string, string> = {};

  for (const row of rows) {
    rates[row.quote] = row.rate;
  }

  return {
    base: FX_BASE,
    date: rows[0].rateDate,
    rates,
    provider: rows[0].provider,
  };
}

/** Newest cached table published on or before `date`. */
async function readCachedTable(
  date: string,
): Promise<{ table: FxRateTable; fetchedAt: Date } | null> {
  const [newest] = await db
    .select({ rateDate: fxRates.rateDate })
    .from(fxRates)
    .where(and(eq(fxRates.base, FX_BASE), lte(fxRates.rateDate, date)))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);

  if (!newest) {
    return null;
  }

  const rows = await db
    .select({
      quote: fxRates.quote,
      rate: fxRates.rate,
      rateDate: fxRates.rateDate,
      provider: fxRates.provider,
      fetchedAt: fxRates.fetchedAt,
    })
    .from(fxRates)
    .where(and(eq(fxRates.base, FX_BASE), eq(fxRates.rateDate, newest.rateDate)));

  const table = rowsToTable(rows);

  return table ? { table, fetchedAt: rows[0].fetchedAt } : null;
}

async function storeTable(table: FxRateTable): Promise<void> {
  const rows = Object.entries(table.rates).map(([quote, rate]) => ({
    base: table.base,
    quote,
    rateDate: table.date,
    rate,
    provider: table.provider,
  }));

  if (rows.length === 0) {
    return;
  }

  // Upsert rather than insert: re-fetching a day the provider has revised must
  // correct the stored rate, and `fetchedAt` is what the cache-age check reads.
  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.base, fxRates.quote, fxRates.rateDate],
      set: {
        rate: sql`excluded.rate`,
        provider: sql`excluded.provider`,
        fetchedAt: sql`now()`,
      },
    });
}

async function refresh(
  provider: FxProvider,
  date?: string,
): Promise<FxRateTable | null> {
  try {
    const table = await provider.fetchTable(date);
    await storeTable(table);
    return table;
  } catch {
    // Swallowed on purpose: a provider outage must be invisible to the reader
    // beyond a value being marked stale.
    return null;
  }
}

export type GetFxRateTableOptions = {
  /** `YYYY-MM-DD` to price against. Defaults to today (UTC). */
  date?: string;
  provider?: FxProvider;
};

/**
 * Returns the rate table to price a document with, or null when nothing is
 * available (no cache and the provider could not be reached) — in which case
 * conversions report `missing-rate` and everything else still renders.
 *
 * A cached table is returned **immediately**; any refresh it triggers is not
 * awaited, so the provider's latency never lands on a page load. The refreshed
 * rates appear on the next render.
 */
export async function getFxRateTable(
  options: GetFxRateTableOptions = {},
): Promise<FxRateTable | null> {
  const provider = options.provider ?? frankfurterProvider;
  const target =
    options.date && isFxDayKey(options.date)
      ? options.date
      : fxDayKey(new Date());

  let cached: { table: FxRateTable; fetchedAt: Date } | null = null;

  try {
    cached = await readCachedTable(target);
  } catch {
    // A database hiccup reading a cache must not take the document with it.
    cached = null;
  }

  if (cached) {
    const age = Date.now() - cached.fetchedAt.getTime();
    // A pinned past day is settled history — once fetched it never changes, so
    // never spend a request re-confirming it.
    const isHistorical = target < fxDayKey(new Date());
    const current =
      isHistorical || cached.table.date === target || age < MAX_CACHE_AGE_MS;

    if (current) {
      return cached.table;
    }

    // Serve what we have now, refresh for next time. Not awaited by design.
    if (!inFlight) {
      inFlight = refresh(provider, options.date).finally(() => {
        inFlight = null;
      });
      void inFlight.catch(() => {});
    }

    return { ...cached.table, stale: true };
  }

  // Nothing cached at all — this one has to block, or conversion never works on
  // a cold database.
  if (!inFlight) {
    inFlight = refresh(provider, options.date).finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}
