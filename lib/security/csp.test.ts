import { afterEach, describe, expect, it } from "vitest";

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

describe("embed frame-ancestors", () => {
  const originalEnv = process.env.EMBED_FRAME_ANCESTORS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EMBED_FRAME_ANCESTORS;
    } else {
      process.env.EMBED_FRAME_ANCESTORS = originalEnv;
    }
  });

  it("non-embed requests keep frame-ancestors 'self' regardless of the env var", () => {
    process.env.EMBED_FRAME_ANCESTORS = "https://den.ems-place.com";
    expect(buildEnforcedCsp()).toContain("frame-ancestors 'self'");
    expect(buildReportOnlyCsp("n")).toContain("frame-ancestors 'self'");
  });

  it("embed requests get the configured allow-list", () => {
    process.env.EMBED_FRAME_ANCESTORS = "https://den.ems-place.com,https://other.example.com";
    const enforced = buildEnforcedCsp({ embed: true });
    const reportOnly = buildReportOnlyCsp("n", { embed: true });
    expect(enforced).toContain(
      "frame-ancestors https://den.ems-place.com https://other.example.com",
    );
    expect(reportOnly).toContain(
      "frame-ancestors https://den.ems-place.com https://other.example.com",
    );
    expect(enforced).not.toContain("frame-ancestors 'self'");
  });

  it("an absent env var defaults embed requests to the Den origin, not '*'", () => {
    delete process.env.EMBED_FRAME_ANCESTORS;
    const csp = buildEnforcedCsp({ embed: true });
    expect(csp).toContain("frame-ancestors https://den.ems-place.com");
    expect(csp).not.toContain("*");
  });

  it("an empty env var does not degrade into '*'", () => {
    process.env.EMBED_FRAME_ANCESTORS = "";
    const csp = buildEnforcedCsp({ embed: true });
    expect(csp).toContain("frame-ancestors https://den.ems-place.com");
    expect(csp).not.toContain("*");
  });

  it("a literal '*' in the env var does not pass through", () => {
    process.env.EMBED_FRAME_ANCESTORS = "*";
    const csp = buildEnforcedCsp({ embed: true });
    expect(csp).toContain("frame-ancestors https://den.ems-place.com");
    expect(csp).not.toMatch(/frame-ancestors [^;]*\*/);
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
