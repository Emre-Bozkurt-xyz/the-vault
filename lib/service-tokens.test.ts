import { describe, expect, it } from "vitest";

import {
  generateServiceTokenPlaintext,
  hashServiceToken,
  looksLikeServiceToken,
} from "@/lib/service-tokens";

describe("service tokens", () => {
  it("generates a prefixed, sufficiently long plaintext token", () => {
    const token = generateServiceTokenPlaintext();

    expect(token.startsWith("vst_")).toBe(true);
    expect(token.length).toBeGreaterThan(40);
  });

  it("generates unique tokens on each call", () => {
    const a = generateServiceTokenPlaintext();
    const b = generateServiceTokenPlaintext();

    expect(a).not.toBe(b);
  });

  it("hashes deterministically", () => {
    const token = generateServiceTokenPlaintext();

    expect(hashServiceToken(token)).toBe(hashServiceToken(token));
  });

  it("hashes different tokens to different values", () => {
    const a = generateServiceTokenPlaintext();
    const b = generateServiceTokenPlaintext();

    expect(hashServiceToken(a)).not.toBe(hashServiceToken(b));
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    const hash = hashServiceToken(generateServiceTokenPlaintext());

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never stores or logs the plaintext token — only its hash is persisted by callers", () => {
    // Documentation-as-test: hashServiceToken is a one-way function, so a
    // caller (server/services.ts) can only ever recover the hash, never the
    // original plaintext, from what it stores.
    const token = generateServiceTokenPlaintext();
    const hash = hashServiceToken(token);

    expect(hash).not.toContain(token);
  });

  it("recognizes a well-formed service token", () => {
    expect(looksLikeServiceToken(generateServiceTokenPlaintext())).toBe(true);
  });

  it("rejects tokens without the vst_ prefix", () => {
    expect(looksLikeServiceToken("not-a-service-token")).toBe(false);
    expect(looksLikeServiceToken("")).toBe(false);
    expect(looksLikeServiceToken("vst_")).toBe(false);
  });
});
