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
} from "@/lib/calc/decimal";

/**
 * Active ISO 4217 codes mapped to `[minorUnits, name]`.
 *
 * `minorUnits` is what makes rounding correct per currency: JPY has no minor
 * unit, KWD has three, CLF has four. Rounding money to a blanket two places is
 * the classic bug this table exists to prevent.
 */
const ISO_4217: Record<string, readonly [number, string]> = {
  AED: [2, "UAE Dirham"],
  AFN: [2, "Afghani"],
  ALL: [2, "Lek"],
  AMD: [2, "Armenian Dram"],
  ANG: [2, "Netherlands Antillean Guilder"],
  AOA: [2, "Kwanza"],
  ARS: [2, "Argentine Peso"],
  AUD: [2, "Australian Dollar"],
  AWG: [2, "Aruban Florin"],
  AZN: [2, "Azerbaijan Manat"],
  BAM: [2, "Convertible Mark"],
  BBD: [2, "Barbados Dollar"],
  BDT: [2, "Taka"],
  BGN: [2, "Bulgarian Lev"],
  BHD: [3, "Bahraini Dinar"],
  BIF: [0, "Burundi Franc"],
  BMD: [2, "Bermudian Dollar"],
  BND: [2, "Brunei Dollar"],
  BOB: [2, "Boliviano"],
  BRL: [2, "Brazilian Real"],
  BSD: [2, "Bahamian Dollar"],
  BTN: [2, "Ngultrum"],
  BWP: [2, "Pula"],
  BYN: [2, "Belarusian Ruble"],
  BZD: [2, "Belize Dollar"],
  CAD: [2, "Canadian Dollar"],
  CDF: [2, "Congolese Franc"],
  CHF: [2, "Swiss Franc"],
  CLF: [4, "Unidad de Fomento"],
  CLP: [0, "Chilean Peso"],
  CNY: [2, "Yuan Renminbi"],
  COP: [2, "Colombian Peso"],
  CRC: [2, "Costa Rican Colon"],
  CUP: [2, "Cuban Peso"],
  CVE: [2, "Cabo Verde Escudo"],
  CZK: [2, "Czech Koruna"],
  DJF: [0, "Djibouti Franc"],
  DKK: [2, "Danish Krone"],
  DOP: [2, "Dominican Peso"],
  DZD: [2, "Algerian Dinar"],
  EGP: [2, "Egyptian Pound"],
  ERN: [2, "Nakfa"],
  ETB: [2, "Ethiopian Birr"],
  EUR: [2, "Euro"],
  FJD: [2, "Fiji Dollar"],
  FKP: [2, "Falkland Islands Pound"],
  GBP: [2, "Pound Sterling"],
  GEL: [2, "Lari"],
  GHS: [2, "Ghana Cedi"],
  GIP: [2, "Gibraltar Pound"],
  GMD: [2, "Dalasi"],
  GNF: [0, "Guinean Franc"],
  GTQ: [2, "Quetzal"],
  GYD: [2, "Guyana Dollar"],
  HKD: [2, "Hong Kong Dollar"],
  HNL: [2, "Lempira"],
  HTG: [2, "Gourde"],
  HUF: [2, "Forint"],
  IDR: [2, "Rupiah"],
  ILS: [2, "New Israeli Sheqel"],
  INR: [2, "Indian Rupee"],
  IQD: [3, "Iraqi Dinar"],
  IRR: [2, "Iranian Rial"],
  ISK: [0, "Iceland Krona"],
  JMD: [2, "Jamaican Dollar"],
  JOD: [3, "Jordanian Dinar"],
  JPY: [0, "Yen"],
  KES: [2, "Kenyan Shilling"],
  KGS: [2, "Som"],
  KHR: [2, "Riel"],
  KMF: [0, "Comorian Franc"],
  KPW: [2, "North Korean Won"],
  KRW: [0, "Won"],
  KWD: [3, "Kuwaiti Dinar"],
  KYD: [2, "Cayman Islands Dollar"],
  KZT: [2, "Tenge"],
  LAK: [2, "Lao Kip"],
  LBP: [2, "Lebanese Pound"],
  LKR: [2, "Sri Lanka Rupee"],
  LRD: [2, "Liberian Dollar"],
  LSL: [2, "Loti"],
  LYD: [3, "Libyan Dinar"],
  MAD: [2, "Moroccan Dirham"],
  MDL: [2, "Moldovan Leu"],
  MGA: [2, "Malagasy Ariary"],
  MKD: [2, "Denar"],
  MMK: [2, "Kyat"],
  MNT: [2, "Tugrik"],
  MOP: [2, "Pataca"],
  MRU: [2, "Ouguiya"],
  MUR: [2, "Mauritius Rupee"],
  MVR: [2, "Rufiyaa"],
  MWK: [2, "Malawi Kwacha"],
  MXN: [2, "Mexican Peso"],
  MYR: [2, "Malaysian Ringgit"],
  MZN: [2, "Mozambique Metical"],
  NAD: [2, "Namibia Dollar"],
  NGN: [2, "Naira"],
  NIO: [2, "Cordoba Oro"],
  NOK: [2, "Norwegian Krone"],
  NPR: [2, "Nepalese Rupee"],
  NZD: [2, "New Zealand Dollar"],
  OMR: [3, "Rial Omani"],
  PAB: [2, "Balboa"],
  PEN: [2, "Sol"],
  PGK: [2, "Kina"],
  PHP: [2, "Philippine Peso"],
  PKR: [2, "Pakistan Rupee"],
  PLN: [2, "Zloty"],
  PYG: [0, "Guarani"],
  QAR: [2, "Qatari Rial"],
  RON: [2, "Romanian Leu"],
  RSD: [2, "Serbian Dinar"],
  RUB: [2, "Russian Ruble"],
  RWF: [0, "Rwanda Franc"],
  SAR: [2, "Saudi Riyal"],
  SBD: [2, "Solomon Islands Dollar"],
  SCR: [2, "Seychelles Rupee"],
  SDG: [2, "Sudanese Pound"],
  SEK: [2, "Swedish Krona"],
  SGD: [2, "Singapore Dollar"],
  SHP: [2, "Saint Helena Pound"],
  SLE: [2, "Leone"],
  SOS: [2, "Somali Shilling"],
  SRD: [2, "Surinam Dollar"],
  SSP: [2, "South Sudanese Pound"],
  STN: [2, "Dobra"],
  SVC: [2, "El Salvador Colon"],
  SYP: [2, "Syrian Pound"],
  SZL: [2, "Lilangeni"],
  THB: [2, "Baht"],
  TJS: [2, "Somoni"],
  TMT: [2, "Turkmenistan New Manat"],
  TND: [3, "Tunisian Dinar"],
  TOP: [2, "Pa'anga"],
  TRY: [2, "Turkish Lira"],
  TTD: [2, "Trinidad and Tobago Dollar"],
  TWD: [2, "New Taiwan Dollar"],
  TZS: [2, "Tanzanian Shilling"],
  UAH: [2, "Hryvnia"],
  UGX: [0, "Uganda Shilling"],
  USD: [2, "US Dollar"],
  UYU: [2, "Peso Uruguayo"],
  UYW: [4, "Unidad Previsional"],
  UZS: [2, "Uzbekistan Sum"],
  VED: [2, "Bolivar Soberano"],
  VES: [2, "Bolivar Soberano"],
  VND: [0, "Dong"],
  VUV: [0, "Vatu"],
  WST: [2, "Tala"],
  XAF: [0, "CFA Franc BEAC"],
  XCD: [2, "East Caribbean Dollar"],
  XCG: [2, "Caribbean Guilder"],
  XOF: [0, "CFA Franc BCEAO"],
  XPF: [0, "CFP Franc"],
  XTS: [2, "Reserved for testing"],
  XXX: [2, "No currency"],
  YER: [2, "Yemeni Rial"],
  ZAR: [2, "Rand"],
  ZMW: [2, "Zambian Kwacha"],
  ZWG: [2, "Zimbabwe Gold"],
};

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

export function isCurrencyCode(token: string): boolean {
  return Object.hasOwn(ISO_4217, token);
}

export function currencyMinorUnits(code: string): number {
  return ISO_4217[code]?.[0] ?? 2;
}

export function currencyName(code: string): string | null {
  return ISO_4217[code]?.[1] ?? null;
}

export function listCurrencyCodes(): string[] {
  return Object.keys(ISO_4217);
}

/** Every code with its name, for the in-editor autocomplete inside `:calc[…]`. */
export function listCurrencies(): Array<{ code: string; name: string }> {
  return Object.entries(ISO_4217).map(([code, [, name]]) => ({ code, name }));
}

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
