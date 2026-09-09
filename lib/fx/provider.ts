/**
 * Foreign-exchange rate providers for the `:calc` extension.
 *
 * Kept behind a one-method interface so swapping providers is a file, not a
 * refactor. The default is the ECB's daily reference rates via Frankfurter: no
 * API key, no quota, authoritative, and EUR-based — which is why every cross
 * rate is triangulated through EUR (see `lib/calc/fx.ts`).
 *
 * Fetching is **server-only**. The browser must never talk to a rate provider:
 * it would leak any future API key and rate-limit per viewer rather than per
 * deployment.
 */

import { isCurrencyCode } from "@/lib/calc/currency";
import { isFxDayKey, type FxRateTable } from "@/lib/calc/fx";

export type FxProvider = {
  id: string;
  /**
   * Fetches one day's table. `date` omitted means the latest publication.
   *
   * Providers answer a requested date with the most recent publication on or
   * before it — ECB publishes only on business days, so a weekend date legitimately
   * returns Friday's rates. The returned `date` is authoritative, not the request.
   */
  fetchTable(date?: string): Promise<FxRateTable>;
};

/** Base every rate is stored against. ECB publishes EUR-quoted. */
export const FX_BASE = "EUR";

/**
 * How long to wait on the provider. Deliberately short: a rate refresh must
 * never be the reason a document is slow, and a miss is recoverable — the
 * cached table is served instead and marked stale.
 */
const FETCH_TIMEOUT_MS = 4000;

const FRANKFURTER_ENDPOINT = "https://api.frankfurter.dev/v1";

type FrankfurterResponse = {
  base?: unknown;
  date?: unknown;
  rates?: unknown;
};

/**
 * Rejects anything that is not a plain positive decimal. The response is
 * third-party input feeding money arithmetic, so a malformed or absurd rate
 * must be dropped rather than stored.
 */
function normalizeRate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  // Fixed notation: a very small rate would otherwise stringify as `1e-7`,
  // which `decimalFromString` deliberately rejects.
  const text = value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");

  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

export const frankfurterProvider: FxProvider = {
  id: "ECB",

  async fetchTable(date?: string): Promise<FxRateTable> {
    if (date !== undefined && !isFxDayKey(date)) {
      throw new Error(`Invalid rate date "${date}".`);
    }

    const path = date ?? "latest";
    const response = await fetch(
      `${FRANKFURTER_ENDPOINT}/${path}?base=${FX_BASE}`,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
        // This is shared reference data, never per-user; Next must not try to
        // attach the request to a user cache scope.
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(`Rate provider returned ${response.status}.`);
    }

    const body = (await response.json()) as FrankfurterResponse;

    if (
      typeof body.date !== "string" ||
      !isFxDayKey(body.date) ||
      typeof body.rates !== "object" ||
      body.rates === null
    ) {
      throw new Error("Rate provider returned an unexpected payload.");
    }

    const rates: Record<string, string> = {};

    for (const [code, value] of Object.entries(
      body.rates as Record<string, unknown>,
    )) {
      // Ignore anything that is not a real ISO code we can also format.
      if (code === FX_BASE || !isCurrencyCode(code)) {
        continue;
      }

      const rate = normalizeRate(value);

      if (rate) {
        rates[code] = rate;
      }
    }

    if (Object.keys(rates).length === 0) {
      throw new Error("Rate provider returned no usable rates.");
    }

    return {
      base: FX_BASE,
      date: body.date,
      rates,
      provider: this.id,
    };
  },
};
