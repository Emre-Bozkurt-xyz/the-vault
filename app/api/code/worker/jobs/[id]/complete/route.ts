import { NextResponse } from "next/server";
import { z } from "zod";

import { isWorkerReportableTerminal } from "@/lib/code/jobs";
import { MAX_OUTPUT_BYTES } from "@/lib/config/code-execution";
import { jsonError, readJson, workerIdentity } from "@/server/code-api";
import { completeCodeJob } from "@/server/code-jobs";

export const runtime = "nodejs";

const ms = z.number().int().min(0).max(10 * 60 * 1000).nullable();

const bodySchema = z.object({
  attemptId: z.string().uuid(),
  state: z.string(),
  compilerOutput: z.string().default(""),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  exitCode: z.number().int().nullable(),
  signal: z.string().max(32).nullable(),
  truncated: z.boolean().default(false),
  imageDigest: z.string().max(128).nullable(),
  prepareMs: ms,
  compileMs: ms,
  runMs: ms,
});

/**
 * Finalize a job. `409` means the result was not accepted because this attempt
 * no longer holds the lease — a late result from a reclaimed attempt, which
 * at-least-once delivery makes possible and which must never overwrite the
 * recorded outcome.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workerId = workerIdentity(request);
  if (!workerId) return jsonError("Unauthorized.", 401, "UNAUTHORIZED");

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Not found.", 404, "NOT_FOUND");

  // Three output channels, each already bounded by the worker, plus JSON
  // escaping overhead. The store bounds again to MAX_OUTPUT_BYTES in total.
  const parsed = bodySchema.safeParse(await readJson<unknown>(request, MAX_OUTPUT_BYTES * 8));
  if (!parsed.success) return jsonError("Malformed result.", 400, "BAD_REQUEST");
  const body = parsed.data;

  if (!isWorkerReportableTerminal(body.state)) {
    return jsonError("A result must carry a terminal state.", 400, "BAD_STATE");
  }

  const accepted = await completeCodeJob({
    jobId: id,
    workerId,
    attemptId: body.attemptId,
    state: body.state,
    compilerOutput: body.compilerOutput,
    stdout: body.stdout,
    stderr: body.stderr,
    exitCode: body.exitCode,
    signal: body.signal,
    workerTruncated: body.truncated,
    imageDigest: body.imageDigest,
    prepareMs: body.prepareMs,
    compileMs: body.compileMs,
    runMs: body.runMs,
  });
  if (!accepted) return jsonError("Result not accepted: lease lost.", 409, "LEASE_LOST");
  return NextResponse.json({ accepted: true });
}
