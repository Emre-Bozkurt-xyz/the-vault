import "server-only";

import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isUserBanActive } from "@/server/authz";
import { CodeJobError } from "@/server/code-jobs";

/**
 * Shared guards for the code execution routes (plan §7). Two populations call
 * these routes and they must never be able to stand in for each other:
 *
 *   - **Users**, authenticated by session cookie. Mutations are cross-site
 *     protected, because a cookie rides along on any request a hostile page
 *     can make the browser send.
 *   - **Workers**, authenticated by a bearer token and nothing else. Worker
 *     routes never read a cookie, so a signed-in user's browser cannot claim a
 *     job or post a forged result no matter what it sends.
 */

export function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export function codeErrorResponse(error: unknown) {
  if (error instanceof CodeJobError) return jsonError(error.message, error.status, error.code);
  console.error("[code-api]", error instanceof Error ? error.message : error);
  return jsonError("Something went wrong. Please try again.", 500, "INTERNAL");
}

/**
 * Cross-site request guard for cookie-authenticated mutations. Browsers send
 * `Sec-Fetch-Site` on every request and a page cannot forge it; `Origin` is the
 * fallback for clients that predate it. A request with neither is refused —
 * the only legitimate caller of these routes is Vault's own editor.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * The signed-in, non-banned user behind a cookie, or null. Deliberately does
 * not redirect (unlike `requireActiveUser`): an API caller gets a status code.
 * The ban is re-read from the database on every call, so a ban or revocation
 * takes effect on the next request rather than when the session expires.
 */
/**
 * The signed-in, unbanned user, re-read from the database on every request so
 * a ban or a revoked grant takes effect on the next call rather than when the
 * session expires.
 *
 * `mayExecute` is the per-user grant an admin sets (`users.code_execution_allowed`).
 * Editing a document does not imply it (plan §7): it is a second gate on top
 * of `canEdit`, and it defaults to off, so a new account can never run code
 * until someone decides it should.
 */
export async function currentCodeUser(): Promise<{ id: string; mayExecute: boolean } | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [user] = await db
    .select({
      id: users.id,
      bannedAt: users.bannedAt,
      bannedUntil: users.bannedUntil,
      codeExecutionAllowed: users.codeExecutionAllowed,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user || isUserBanActive(user)) return null;
  return { id: user.id, mayExecute: user.codeExecutionAllowed };
}

/**
 * Constant-time check of the worker bearer token. An unset token denies every
 * worker rather than admitting one with an empty credential, and a short token
 * is refused outright so a placeholder value cannot ship to production.
 */
export function workerIdentity(request: Request): string | null {
  const expected = process.env.CODE_RUNNER_TOKEN ?? "";
  if (expected.length < 32) return null;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return null;

  const given = Buffer.from(match[1]);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  // The worker names itself so leases can be attributed; the token is what
  // authenticates it. Bounded so it cannot bloat a row or a log line.
  const name = request.headers.get("x-runner-id") ?? "";
  return /^[A-Za-z0-9_.-]{1,64}$/.test(name) ? name : null;
}

export async function readJson<T>(request: Request, maxBytes: number): Promise<T | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) return null;
  const text = await request.text().catch(() => null);
  if (text === null || text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
