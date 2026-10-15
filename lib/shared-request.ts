const inFlight = new Map<string, Promise<unknown>>();

/**
 * Runs `request` once per `key` at a time: callers that ask while one is
 * already in flight get that same promise. Several views refresh the same data
 * on the same event (the assets sidebar and library both hear "assets changed";
 * the Tasks panel and home Today both hear "tasks changed"), and without this
 * each event cost one identical request per view.
 *
 * Only concurrent calls are shared — nothing is cached once the promise
 * settles, so a later event always fetches fresh data.
 */
export function shareInFlight<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);

  if (existing) {
    return existing as Promise<T>;
  }

  const promise = request().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/**
 * `GET /api/assets` (or its `?view=summary` form), parsed and shared between
 * concurrent callers; null on failure.
 */
export function fetchAssetLibrary(view?: "summary"): Promise<unknown> {
  const url = view ? `/api/assets?view=${view}` : "/api/assets";

  return shareInFlight(`GET ${url}`, async () => {
    const response = await fetch(url);

    return response.ok ? ((await response.json()) as unknown) : null;
  });
}
