type Slot = {
  promise: Promise<unknown>;
  /** True until the current task ends: same-event callers share the request. */
  joinable: boolean;
  /** One re-run for everyone who asked after the request went out. */
  followUp: Promise<unknown> | null;
};

const inFlight = new Map<string, Slot>();

/**
 * Runs `request` once per `key` at a time. Several views refresh the same data
 * on the same event (the assets sidebar and library both hear "assets
 * changed"; the Tasks panel and home Today both hear "tasks changed"), and
 * without this each event cost one identical request per view.
 *
 * Callers in the same task as the request (listeners of one event) share it.
 * A caller that arrives once it is already on the wire may have been prompted
 * by a change it predates, say a second upload finishing while the first
 * one's refresh loads, so it gets a fresh run after the current one, shared
 * with everyone else who asks meanwhile. Nothing is cached once a promise
 * settles.
 */
export function shareInFlight<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);

  if (existing) {
    if (existing.joinable) return existing.promise as Promise<T>;
    existing.followUp ??= existing.promise
      .catch(() => undefined)
      .then(() => shareInFlight(key, request));
    return existing.followUp as Promise<T>;
  }

  const slot: Slot = { promise: Promise.resolve(), joinable: true, followUp: null };
  slot.promise = request().finally(() => {
    if (inFlight.get(key) === slot) inFlight.delete(key);
  });
  inFlight.set(key, slot);
  // Event listeners run synchronously in one task; anything later is a new ask.
  setTimeout(() => {
    slot.joinable = false;
  }, 0);
  return slot.promise as Promise<T>;
}

/**
 * `GET /api/assets` (or its `?view=summary` form), parsed and shared between
 * concurrent callers; null on failure.
 */
export function fetchAssetLibrary(view?: "summary" | "bin"): Promise<unknown> {
  const url = view ? `/api/assets?view=${view}` : "/api/assets";

  return shareInFlight(`GET ${url}`, async () => {
    const response = await fetch(url);

    return response.ok ? ((await response.json()) as unknown) : null;
  });
}
