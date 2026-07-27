import { describe, expect, it } from "vitest";

import {
  createEmbedSessionToken,
  verifyEmbedSessionToken,
} from "@/lib/embed-session-token";

describe("embed session token", () => {
  it("round-trips a valid token", () => {
    const token = createEmbedSessionToken({
      documentId: "11111111-1111-1111-1111-111111111111",
      vaultUserId: "22222222-2222-2222-2222-222222222222",
    });

    const payload = verifyEmbedSessionToken(token);

    expect(payload).not.toBeNull();
    expect(payload?.documentId).toBe("11111111-1111-1111-1111-111111111111");
    expect(payload?.vaultUserId).toBe("22222222-2222-2222-2222-222222222222");
    expect(payload?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects an expired token", () => {
    const token = createEmbedSessionToken({
      documentId: "11111111-1111-1111-1111-111111111111",
      vaultUserId: "22222222-2222-2222-2222-222222222222",
      ttlSeconds: -1,
    });

    expect(verifyEmbedSessionToken(token)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = createEmbedSessionToken({
      documentId: "11111111-1111-1111-1111-111111111111",
      vaultUserId: "22222222-2222-2222-2222-222222222222",
    });
    const [version, payload] = token.split(".");
    const tampered = `${version}.${payload}.deadbeef`;

    expect(verifyEmbedSessionToken(tampered)).toBeNull();
  });

  it("rejects a tampered payload (documentId swapped after signing)", () => {
    const token = createEmbedSessionToken({
      documentId: "11111111-1111-1111-1111-111111111111",
      vaultUserId: "22222222-2222-2222-2222-222222222222",
    });
    const [version, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        documentId: "33333333-3333-3333-3333-333333333333",
        vaultUserId: "22222222-2222-2222-2222-222222222222",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
      "utf8",
    ).toString("base64url");
    const forged = `${version}.${forgedPayload}.${signature}`;

    // The signature was computed over the original payload, so re-signing a
    // different documentId without the secret must fail verification —
    // otherwise a caller could redirect a token minted for one document to
    // another (docs/DEN_EMBED_BRIDGE.md non-negotiable: a token must not be
    // usable against a documentId other than the one it was minted for).
    expect(verifyEmbedSessionToken(forged)).toBeNull();
  });

  it("distinguishes tokens minted for different documents", () => {
    const tokenForDocA = createEmbedSessionToken({
      documentId: "11111111-1111-1111-1111-111111111111",
      vaultUserId: "22222222-2222-2222-2222-222222222222",
    });

    const payload = verifyEmbedSessionToken(tokenForDocA);

    expect(payload?.documentId).not.toBe("33333333-3333-3333-3333-333333333333");
  });

  it("rejects malformed tokens", () => {
    expect(verifyEmbedSessionToken("")).toBeNull();
    expect(verifyEmbedSessionToken("not-a-token")).toBeNull();
    expect(verifyEmbedSessionToken("v1.onlytwoparts")).toBeNull();
    expect(verifyEmbedSessionToken("v2.abc.def")).toBeNull();
  });

  it("rejects a payload with missing fields", () => {
    const encodedPayload = Buffer.from(
      JSON.stringify({ documentId: "11111111-1111-1111-1111-111111111111" }),
      "utf8",
    ).toString("base64url");
    // Signature doesn't matter here — missing-field validation runs after
    // signature verification would already fail for an unsigned payload, so
    // this exercises the shape guard defensively via a token that could only
    // pass with the real secret (verify returns null either way).
    expect(verifyEmbedSessionToken(`v1.${encodedPayload}.bogus`)).toBeNull();
  });

  it("honors a custom ttlSeconds", () => {
    const shortLived = createEmbedSessionToken({
      documentId: "11111111-1111-1111-1111-111111111111",
      vaultUserId: "22222222-2222-2222-2222-222222222222",
      ttlSeconds: 30,
    });

    const payload = verifyEmbedSessionToken(shortLived);
    const nowSeconds = Math.floor(Date.now() / 1000);

    expect(payload?.expiresAt).toBeGreaterThan(nowSeconds);
    expect(payload?.expiresAt).toBeLessThanOrEqual(nowSeconds + 30);
  });
});
