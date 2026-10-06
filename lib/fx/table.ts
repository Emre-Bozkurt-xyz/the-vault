/**
 * A day's exchange-rate table, as the FX provider stores it and the host's
 * `fx.getTable` service hands it to extensions. Rates are decimal *strings* so
 * nothing is lost crossing JSON or the database column; the arithmetic over
 * them belongs to whoever consumes the table (calc).
 */
export type FxRateTable = {
  /** Currency the rates are quoted against. */
  base: string;
  /** `YYYY-MM-DD` the rates were published for. */
  date: string;
  /** Quote code -> units per 1 base, as a decimal string. Excludes `base`. */
  rates: Record<string, string>;
  /** Provider id, surfaced in the value's provenance tooltip. */
  provider: string;
  /**
   * True when this is not the table that was asked for — the provider was
   * unreachable, or the requested day has no publication yet. Rendered as a
   * distinct state so a reader can tell a stale figure from a current one.
   */
  stale?: boolean;
};

/** `YYYY-MM-DD` in UTC. Rates are day-scoped, never timestamped. */
export function fxDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isFxDayKey(value: string): boolean {
  return DAY_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}
