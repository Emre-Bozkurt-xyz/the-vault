import { describe, expect, it } from "vitest";

import { ASSET_LIMITS } from "./lib/config/asset-limits";
import nextConfig from "./next.config";

describe("next.config headers", () => {
  it("enforces the static CSP on every route except /embed/...", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((candidate) =>
      candidate.headers.some((header) => header.key === "Content-Security-Policy"),
    );

    expect(rule?.source).toBe("/((?!embed/).*)");
    const value = rule?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(value).toContain("frame-ancestors 'self'");
    expect(value).toContain("object-src 'none'");
    // No script/style restriction is enforced yet: that is report-only.
    expect(value).not.toContain("script-src");
  });

  it("excludes embed routes and includes everything else", () => {
    const matches = (path: string) => new RegExp("^/((?!embed/).*)$").test(path);
    expect(matches("/workspace")).toBe(true);
    expect(matches("/public/some-note")).toBe(true);
    expect(matches("/embed/editor/abc")).toBe(false);
  });
});

describe("next.config proxy body limit", () => {
  it("lets uploads up to the ceiling through proxy.ts untruncated", () => {
    // Next truncates proxied bodies past this (default 10 MB), which silently
    // broke every upload over 10 MB. Admin caps are clamped to the ceiling.
    const limit = nextConfig.experimental?.proxyClientMaxBodySize;
    expect(typeof limit).toBe("number");
    expect(limit as number).toBeGreaterThan(ASSET_LIMITS.uploadCeilingBytes);
  });
});
