/**
 * ISO 4217 currency data and money formatting for the `:calc` extension.
 *
 * This table is the *parser's* authority, not the FX provider's. Three tiers are
 * deliberately separate:
 *
 *   1. Is `CAD` a currency?      -> this table. Static, offline, deterministic.
 *   2. How do I display it?      -> this table (symbol placement + minor units).
 *   3. Can I convert it to USD?  -> the FX provider, at runtime, may fail.
 *
 * So `:calc[123.45 MGA]` always parses and always formats, and only degrades if
 * someone asks to convert it and the provider has no ariary rate that day. A
 * missing rate marks one value, it never breaks the document.
 *
 * Codes must be written uppercase. That is the whole disambiguation rule between
 * a unit and an identifier: `CAD` is money, `cad` is a variable. It also means an
 * ISO code can never be bound as a name, so `:calc[CHF = 5]` is a clean error
 * rather than a variable that shadows the Swiss franc.
 */

import {
  decimalToNumber,
  decimalToString,
  roundTo,
  type Decimal,
} from "./decimal";
import { currencyMinorUnits } from "@/lib/extension-api/fx";


/**
 * The locale money is rendered in. Pinned rather than left to the runtime
 * default on purpose: `Intl` would otherwise resolve the *server's* locale
 * during RSC render and the *browser's* on hydration, and any disagreement about
 * grouping or symbol placement is a React hydration mismatch. Made configurable
 * through extension settings later; it must stay a single value per render.
 */
export const DEFAULT_CALC_LOCALE = "en-US";

/** Above this magnitude `Intl` loses digits, so we format the string ourselves. */
const INTL_SAFE_DIGITS = 15;

/**
 * Formats an amount for display. Money is rounded to its currency's minor units
 * first, so `Intl` only ever receives a value it can represent exactly; very
 * large amounts bypass `Intl` entirely and fall back to a plain grouped string
 * with the code, which is honest rather than silently truncated.
 *
 * A dimensionless value (`currency === null`) is rendered as a plain number with
 * up to {@link PLAIN_DISPLAY_SCALE} places and no trailing-zero padding.
 */
export function formatMoney(
  amount: Decimal,
  currency: string | null,
  options: { locale?: string; places?: number } = {},
): string {
  const locale = options.locale ?? DEFAULT_CALC_LOCALE;

  if (currency === null) {
    return formatPlainNumber(amount, locale, options.places);
  }

  // `places` is the `{dp=N}` display override. It rounds the *rendering* only —
  // the bound value keeps full precision, so a downstream total never inherits a
  // display choice made further up the page.
  const minorUnits = options.places ?? currencyMinorUnits(currency);
  const rounded = roundTo(amount, minorUnits);

  if (rounded.mantissa.toString().replace("-", "").length > INTL_SAFE_DIGITS) {
    return `${decimalToString(rounded)} ${currency}`;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
    }).format(decimalToNumber(rounded));
  } catch {
    // `XTS`/`XXX` and any code a runtime's ICU build does not carry.
    return `${decimalToString(rounded)} ${currency}`;
  }
}

/** Decimal places shown for a dimensionless result before half-even rounding. */
export const PLAIN_DISPLAY_SCALE = 6;

function formatPlainNumber(
  amount: Decimal,
  locale: string,
  places?: number,
): string {
  const scale = places ?? Math.min(amount.scale, PLAIN_DISPLAY_SCALE);
  const rounded = roundTo(amount, scale);

  if (rounded.mantissa.toString().replace("-", "").length > INTL_SAFE_DIGITS) {
    return decimalToString(rounded);
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: places ?? 0,
    maximumFractionDigits: places ?? PLAIN_DISPLAY_SCALE,
  }).format(decimalToNumber(rounded));
}
