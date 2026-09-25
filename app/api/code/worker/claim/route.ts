import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, readJson, workerIdentity } from "@/server/code-api";
import { claimNextCodeJob, maybeSweepCodeJobs } from "@/server/code-jobs";
import { executionEnabled, profileImage, runtimeProfileById } from "@/server/code-runtime";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** Profiles this worker has installed. It is only ever offered those. */
  profiles: z.array(z.string().max(64)).max(32),
});

/**
 * Hand the oldest eligible job to a worker. The response carries the fully
 * resolved profile — image, argv and limits — from the server-side registry,
 * so there is exactly one definition of how a language runs and the worker
 * never interprets anything a document said.
 */
export async function POST(request: Request) {
  const workerId = workerIdentity(request);
  if (!workerId) return jsonError("Unauthorized.", 401, "UNAUTHORIZED");
  if (!executionEnabled()) return new NextResponse(null, { status: 204 });

  const parsed = bodySchema.safeParse(await readJson<unknown>(request, 4096));
  if (!parsed.success) return jsonError("Malformed claim.", 400, "BAD_REQUEST");

  await maybeSweepCodeJobs();

  const job = await claimNextCodeJob(workerId, parsed.data.profiles);
  if (!job) return new NextResponse(null, { status: 204 });

  const profile = runtimeProfileById(job.profileId);
  if (!profile) {
    // The registry lost a profile a queued job still names (a deploy removed
    // it). Nothing can run it, so say so rather than hand out a half-resolved job.
    return jsonError("Claimed job has no runtime profile.", 500, "NO_PROFILE");
  }

  return NextResponse.json({
    job: {
      id: job.id,
      attemptId: job.attemptId,
      operation: job.operation,
      source: job.source,
      stdin: job.stdin,
    },
    profile: {
      id: profile.id,
      version: profile.version,
      image: profileImage(profile),
      entrypoint: profile.entrypoint,
      compileArgv: profile.compileArgv,
      runArgv: profile.runArgv,
      formatArgv: profile.formatArgv,
      memoryMb: profile.memoryMb,
      cpus: profile.cpus,
      pids: profile.pids,
      compileTimeoutMs: profile.compileTimeoutMs,
      runTimeoutMs: profile.runTimeoutMs,
      formatTimeoutMs: profile.formatTimeoutMs,
    },
  });
}
