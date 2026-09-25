import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveCodeLanguage } from "@/lib/code/languages";
import { codeJobInputErrorMessage, validateCodeJobInput } from "@/lib/code/jobs";
import { MAX_SOURCE_BYTES, MAX_STDIN_BYTES } from "@/lib/config/code-execution";
import { getDocumentAccess } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  codeErrorResponse,
  currentCodeUser,
  isSameOriginRequest,
  jsonError,
  readJson,
} from "@/server/code-api";
import { enqueueCodeJob } from "@/server/code-jobs";
import { executionEnabled, userMayExecute } from "@/server/code-runtime";

export const runtime = "nodejs";

const bodySchema = z.object({
  documentId: z.string().uuid(),
  operation: z.string(),
  /** The fence's info string. Resolved against the catalog, never used raw. */
  language: z.string().max(64),
  source: z.string(),
  stdin: z.string().default(""),
  requestId: z.string(),
});

// Source and stdin are bounded separately below; this only stops a request
// from forcing an unbounded parse before those checks run.
const MAX_BODY_BYTES = (MAX_SOURCE_BYTES + MAX_STDIN_BYTES) * 2 + 4096;

/**
 * Submit a job. Returns 202 with a job id immediately — no request ever waits
 * for a compiler (plan §7). The order of checks matters: identity and the
 * cross-site guard first, then the cheap validation, and only then the
 * database-backed authorization.
 */
export async function POST(request: Request) {
  if (!executionEnabled()) return jsonError("Not found.", 404, "NOT_FOUND");
  if (!isSameOriginRequest(request)) return jsonError("Cross-site request refused.", 403, "CROSS_SITE");

  const user = await currentCodeUser();
  if (!user) return jsonError("Authentication required.", 401, "UNAUTHENTICATED");

  const limit = checkRateLimit(`code-submit:${user.id}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many runs. Wait a moment and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  const raw = await readJson<unknown>(request, MAX_BODY_BYTES);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError("The request was malformed.", 400, "BAD_REQUEST");
  const body = parsed.data;

  const languageId = resolveCodeLanguage(body.language)?.id;
  const invalid = validateCodeJobInput({
    requestId: body.requestId,
    operation: body.operation,
    languageId,
    source: body.source,
    stdin: body.stdin,
  });
  if (invalid) return jsonError(codeJobInputErrorMessage(invalid), 400, invalid.toUpperCase());

  // Editing a document does not by itself grant compute (plan §7).
  if (!userMayExecute(user.id)) {
    return jsonError("Running code is not enabled for your account.", 403, "NOT_ALLOWED");
  }

  // An inaccessible document is reported as missing, not as forbidden, so the
  // response does not confirm that a given document id exists.
  const access = await getDocumentAccess(user.id, body.documentId);
  if (!access.canEdit) return jsonError("Not found.", 404, "NOT_FOUND");

  try {
    const job = await enqueueCodeJob({
      userId: user.id,
      documentId: body.documentId,
      operation: body.operation as "run" | "format",
      languageId: languageId!,
      source: body.source,
      stdin: body.stdin,
      requestId: body.requestId,
    });
    return NextResponse.json({ id: job.id, created: job.created }, { status: 202 });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
