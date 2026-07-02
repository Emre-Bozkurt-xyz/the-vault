import { describe, expect, it } from "vitest";

import { isAllowedContentClass, sanitizeClassList } from "@/lib/html-class";

describe("isAllowedContentClass", () => {
  it("allows snippet, language, and generated content classes", () => {
    for (const token of [
      "snip-hero",
      "language-ts",
      "lang-js",
      "vault-asset-embed",
      "vault-asset-embed--image",
      "vault-asset-group-columns-3",
      "vault-md-wiki-link",
      "vault-md-wiki-link-private",
      "vault-md-hidden-anchor",
      "vault-region",
    ]) {
      expect(isAllowedContentClass(token)).toBe(true);
    }
  });

  it("rejects app chrome, utilities, and unlisted vault-* classes", () => {
    for (const token of [
      "fixed",
      "inset-0",
      "z-50",
      "bg-background",
      "vault-calendar-overlay",
      "vault-calendar-overlay-backdrop",
      "vault-md-h1",
      "callout",
      "",
    ]) {
      expect(isAllowedContentClass(token)).toBe(false);
    }
  });
});

describe("sanitizeClassList", () => {
  it("filters a string value to allowed tokens", () => {
    expect(sanitizeClassList("fixed snip-hero z-50 vault-asset-embed")).toEqual([
      "snip-hero",
      "vault-asset-embed",
    ]);
  });

  it("filters a hast array value", () => {
    expect(
      sanitizeClassList(["fixed", "snip-a", "vault-calendar-overlay"]),
    ).toEqual(["snip-a"]);
  });

  it("returns undefined when nothing survives", () => {
    expect(sanitizeClassList("fixed inset-0")).toBeUndefined();
    expect(sanitizeClassList(undefined)).toBeUndefined();
    expect(sanitizeClassList(42)).toBeUndefined();
  });
});
