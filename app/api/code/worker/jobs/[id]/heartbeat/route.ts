import { NextResponse } from "next/server";
import { z } from "zod";

import { CODE_JOB_STATES } from "@/lib/config/code-execution";
import { codeErrorResponse, jsonError, readJson, workerIdentity } from "@/server/code-api";
import { heartbeatCodeJob } from "@/server/code-jobs";

export const runtime = "nodejs";

const bodySchema = z.object({
  attemptId: z.string().uuid(),
  state: z.enum(CODE_JOB_STATES as [string, ...string[]]).optional(),
});

/**
 * Keep a lease alive and report progress. `409` means the lease is gone — the
 * job was reclaimed, cancelled or finished elsewhere — and the worker must kill
 * its sandbox and drop the job rather than keep running it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workerId = workerIdentity(request);
  if (!workerId) return jsonError("Unauthorized.", 401, "UNAUTHORIZED");

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Not found.", 404, "NOT_FOUND");

  const parsed = bodySchema.safeParse(await readJson<unknown>(request, 1024));
  if (!parsed.success) return jsonError("Malformed heartbeat.", 400, "BAD_REQUEST");

  try {
    const result = await heartbeatCodeJob({
      jobId: id,
      workerId,
      attemptId: parsed.data.attemptId,
      state: parsed.data.state as never,
    });
    if (!result) return jsonError("Lease lost.", 409, "LEASE_LOST");
    return NextResponse.json(result);
  } catch (error) {
    return codeErrorResponse(error);
  }
}
