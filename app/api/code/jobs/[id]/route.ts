import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocumentAccess } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { currentCodeUser, jsonError } from "@/server/code-api";
import { getCodeJobForUser, maybeSweepCodeJobs } from "@/server/code-jobs";

export const runtime = "nodejs";

const idSchema = z.string().uuid();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Poll a job. Only the submitting user can read it, and only while they still
 * have edit access to its document — revoking access or banning the user stops
 * results reaching them on the next poll. Every failure mode is a 404, so the
 * response never confirms that a job id exists for someone else.
 *
 * `?hash=` is the SHA-256 of the block's *current* text; when it no longer
 * matches what was submitted, the result is marked stale.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentCodeUser();
  if (!user) return jsonError("Authentication required.", 401, "UNAUTHENTICATED");

  // Generous: the editor polls roughly every 400ms while a job is live.
  if (!checkRateLimit(`code-poll:${user.id}`, 600, 60_000).ok) {
    return jsonError("Polling too fast.", 429, "RATE_LIMITED");
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return jsonError("Not found.", 404, "NOT_FOUND");

  const hash = new URL(request.url).searchParams.get("hash");
  const currentHash = hash && hashSchema.safeParse(hash).success ? hash : undefined;

  // Surfaces a crashed runner's lapsed lease even when no runner is alive to
  // sweep it — otherwise the job would read "running" indefinitely.
  await maybeSweepCodeJobs();

  const job = await getCodeJobForUser(id, user.id, currentHash);
  if (!job) return jsonError("Not found.", 404, "NOT_FOUND");

  const access = await getDocumentAccess(user.id, job.documentId);
  if (!access.canEdit) return jsonError("Not found.", 404, "NOT_FOUND");

  // documentId stays server-side; the client already knows which block asked.
  const { documentId: _documentId, ...status } = job;
  void _documentId;
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
