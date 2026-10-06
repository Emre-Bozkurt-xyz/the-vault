/**
 * Currency reference data and the FX table shape, for extensions
 * (`docs/23_EXTENSION_SDK_PLAN.md` §8). Core owns both: the table comes from
 * the host's `fx.getTable` service (via `loadRenderData` or an action), never
 * from a fetch of the extension's own.
 *
 * A subpath rather than part of `@/lib/extension-api` so the ISO table lands
 * only in bundles that use it.
 */
export {
  currencyMinorUnits,
  currencyName,
  isCurrencyCode,
  listCurrencies,
  listCurrencyCodes,
} from "@/lib/fx/currencies";
export { fxDayKey, isFxDayKey, type FxRateTable } from "@/lib/fx/table";
