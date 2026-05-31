import { createHmac, timingSafeEqual } from "node:crypto";

import type { DocumentRole } from "@/db/schema";

const tokenVersion = "v1";
const defaultTtlSeconds = 60 * 60 * 4;

export type CollabTokenPayload = {
  documentId: string;
  userId: string;
  role: Extract<DocumentRole, "owner" | "editor">;
  name: string | null;
  email: string | null;
  expiresAt: number;
};

type CreateCollabTokenInput = Omit<CollabTokenPayload, "expiresAt"> & {
  ttlSeconds?: number;
};

export function createCollabToken(input: CreateCollabTokenInput) {
  const payload: CollabTokenPayload = {
    documentId: input.documentId,
    userId: input.userId,
    role: input.role,
    name: input.name,
    email: input.email,
    expiresAt: Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? defaultTtlSeconds),
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return `${tokenVersion}.${encodedPayload}.${signature}`;
}

export function verifyCollabToken(token: string): CollabTokenPayload | null {
  const [version, encodedPayload, signature] = token.split(".");

  if (version !== tokenVersion || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as CollabTokenPayload;

  if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (payload.role !== "owner" && payload.role !== "editor") {
    return null;
  }

  return payload;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSecret() {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "vault-development-only-auth-secret");

  if (!secret) {
    throw new Error("AUTH_SECRET is required for collaboration tokens");
  }

  return secret;
}
