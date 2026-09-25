import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocumentAccess } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { currentCodeUser, isSameOriginRequest, jsonError } from "@/server/code-api";
import { getCodeJobForUser, requestCodeJobCancel } from "@/server/code-jobs";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

/**
 * Stop a job. Idempotent: stopping a finished job is a successful no-op, so a
 * double click or a retry never surfaces as an error. A queued job is cancelled
 * immediately; a running one is killed by its worker on the next heartbeat.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-site request refused.", 403, "CROSS_SITE");

  const user = await currentCodeUser();
  if (!user) return jsonError("Authentication required.", 401, "UNAUTHENTICATED");

  if (!checkRateLimit(`code-cancel:${user.id}`, 60, 60_000).ok) {
    return jsonError("Too many requests.", 429, "RATE_LIMITED");
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return jsonError("Not found.", 404, "NOT_FOUND");

  const job = await getCodeJobForUser(id, user.id);
  if (!job) return jsonError("Not found.", 404, "NOT_FOUND");

  const access = await getDocumentAccess(user.id, job.documentId);
  if (!access.canEdit) return jsonError("Not found.", 404, "NOT_FOUND");

  const requested = await requestCodeJobCancel(id, user.id);
  return NextResponse.json({ requested });
}
