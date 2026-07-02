import { describe, expect, it } from "vitest";

import {
  buildEnforcedCsp,
  buildReportOnlyCsp,
  generateNonce,
} from "@/lib/security/csp";

describe("buildEnforcedCsp", () => {
  it("carries the safe high-value directives", () => {
    const csp = buildEnforcedCsp();
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("does not restrict script/style (that is report-only for now)", () => {
    const csp = buildEnforcedCsp();
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("style-src");
  });
});

describe("buildReportOnlyCsp", () => {
  it("uses the nonce for script and style elements", () => {
    const csp = buildReportOnlyCsp("abc123");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it("permits the iframe embed hosts and https/data images", () => {
    const csp = buildReportOnlyCsp("n");
    expect(csp).toContain("https://www.youtube-nocookie.com");
    expect(csp).toContain("https://*.bandcamp.com");
    expect(csp).toContain("img-src 'self' https: data: blob:");
  });
});

describe("generateNonce", () => {
  it("produces distinct base64 nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
