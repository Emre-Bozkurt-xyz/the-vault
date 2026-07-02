/**
 * Minimal in-process fixed-window rate limiter for expensive authenticated
 * endpoints (e.g. snippet compilation). This is intentionally simple: a single
 * app instance, in-memory counters. For multi-instance deployments this should
 * be swapped for a shared store (Redis/Postgres); the call sites only depend on
 * `checkRateLimit` returning an allow/deny result.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterMs: existing.resetAt - now,
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterMs: 0,
  };
}

/** Test/maintenance helper: drop all counters. */
export function resetRateLimits() {
  buckets.clear();
}
