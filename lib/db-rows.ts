/**
 * Helpers for normalizing rows returned by raw `db.execute(sql\`...\`)` calls.
 *
 * Drizzle's query builder maps columns according to the schema (e.g.
 * `timestamp({ mode: "date" })` → `Date`), but raw `db.execute` bypasses that
 * mapping and hands back whatever the postgres-js driver produces. For
 * timestamp columns that means an ISO string, not a `Date`, which breaks any
 * downstream `.getTime()` / `.toISOString()` call. Use these at raw-execute call
 * sites to coerce timestamp fields back to `Date`.
 */

export function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Returns a copy of `row` with the given keys coerced to `Date`. Useful when a
 * raw-execute row has several timestamp columns.
 */
export function coerceDates<T extends Record<string, unknown>>(
  row: T,
  keys: readonly (keyof T)[],
): T {
  const next = { ...row };
  for (const key of keys) {
    const value = next[key];
    if (value != null) {
      next[key] = coerceDate(value as Date | string | number) as T[keyof T];
    }
  }
  return next;
}
