import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then denies within the window", () => {
    const t = 1000;
    expect(checkRateLimit("k", 3, 1000, t).ok).toBe(true);
    expect(checkRateLimit("k", 3, 1000, t).ok).toBe(true);
    expect(checkRateLimit("k", 3, 1000, t).ok).toBe(true);
    const denied = checkRateLimit("k", 3, 1000, t);
    expect(denied.ok).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    expect(checkRateLimit("k", 1, 1000, 1000).ok).toBe(true);
    expect(checkRateLimit("k", 1, 1000, 1500).ok).toBe(false);
    expect(checkRateLimit("k", 1, 1000, 2001).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("a", 1, 1000, 1000).ok).toBe(true);
    expect(checkRateLimit("b", 1, 1000, 1000).ok).toBe(true);
    expect(checkRateLimit("a", 1, 1000, 1000).ok).toBe(false);
  });
});
