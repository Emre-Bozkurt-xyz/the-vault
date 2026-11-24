import { describe, expect, it } from "vitest";

import { decodeShareToken, encodeShareToken } from "@/lib/share-token";

const id = "3f2b7c1e-9a4d-4e8f-b6a1-0c2d3e4f5a6b";
const secret = "test-secret-with-enough-entropy-0123456789";

describe("share tokens", () => {
  it("round-trips a link id in a 44-character URL-safe token", () => {
    const token = encodeShareToken(id, secret);
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    expect(decodeShareToken(token, secret)).toBe(id);
    // Stable, so the owner can copy the same link again later.
    expect(encodeShareToken(id, secret)).toBe(token);
    expect(encodeShareToken(id.toUpperCase(), secret)).toBe(token);
  });

  it("rejects a token signed with another secret", () => {
    expect(decodeShareToken(encodeShareToken(id, secret), "another-secret")).toBeNull();
  });

  it("rejects any tampering with the id or the signature", () => {
    const token = encodeShareToken(id, secret);
    for (const index of [0, 10, 21, 22, 30, 43]) {
      const flipped = token[index] === "A" ? "B" : "A";
      const tampered = `${token.slice(0, index)}${flipped}${token.slice(index + 1)}`;
      expect(decodeShareToken(tampered, secret)).toBeNull();
    }
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [undefined, null, 42, "", "short", `${encodeShareToken(id, secret)}x`, "a".repeat(43) + "/", "=".repeat(44)]) {
      expect(decodeShareToken(bad, secret)).toBeNull();
    }
    expect(decodeShareToken(encodeShareToken(id, secret), "")).toBeNull();
    expect(() => encodeShareToken(id, "")).toThrow();
    expect(() => encodeShareToken("not-a-uuid", secret)).toThrow();
  });
});
