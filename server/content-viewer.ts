import "server-only";

import { createHash } from "node:crypto";

import { headers } from "next/headers";

import { auth } from "@/auth";

export async function getCurrentContentViewerIdentity() {
  const [session, headerList] = await Promise.all([auth(), headers()]);

  return {
    userId: session?.user?.id ?? null,
    anonymousHash: session?.user?.id
      ? null
      : hashAnonymousViewer(headerList),
  };
}

export function getAnonymousHashFromHeaders(headerList: Headers) {
  return hashAnonymousViewer(headerList);
}

function hashAnonymousViewer(headerList: Headers) {
  const forwardedFor =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    "unknown-ip";
  const userAgent = headerList.get("user-agent") || "unknown-agent";
  const acceptLanguage = headerList.get("accept-language") || "";

  return createHash("sha256")
    .update(`${forwardedFor}|${userAgent}|${acceptLanguage}`)
    .digest("hex");
}
