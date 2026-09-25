import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { codeJobs } from "@/db/schema";
import { boundOutputs, isActiveCodeJobState, isAllowedProgress } from "@/lib/code/jobs";
import {
  JOB_LEASE_MS,
  MAX_ACTIVE_JOBS,
  MAX_PENDING_JOBS_PER_USER,
  MAX_PENDING_JOBS_TOTAL,
  QUEUE_WAIT_TIMEOUT_MS,
  RESULT_RETENTION_MS,
  type CodeJobOperation,
  type CodeJobState,
  type CodeJobStatus,
} from "@/lib/config/code-execution";
import { runtimeProfileForLanguage, profileSupportsOperation } from "@/server/code-runtime";

/**
 * Durable code-job queue (plan §7, §9). Every function here takes identities it
 * has been handed, so this module is `server-only` and must never gain a
 * `"use server"` directive — see the 2026-09-18 IDOR note in project-knowledge
 * §16. Route handlers authenticate and authorize, then call in.
 */

export class CodeJobError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const NON_TERMINAL: CodeJobState[] = ["queued", "preparing", "compiling", "running", "formatting"];
const ACTIVE: CodeJobState[] = ["preparing", "compiling", "running", "formatting"];

// Arbitrary but fixed keys for pg_advisory_xact_lock. Admission and claiming
// each count rows and then act on the count, which is a race without a lock:
// two submissions could both see "2 pending" and both insert a 4th.
const ADMISSION_LOCK = 0x7661_7501; // "vau\x01"
const CLAIM_LOCK = 0x7661_7502;

export function hashSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------------

export type EnqueueInput = {
  userId: string;
  documentId: string;
  operation: CodeJobOperation;
  languageId: string;
  source: string;
  stdin: string;
  requestId: string;
};

/**
 * Idempotent on `(userId, requestId)`: a browser retry of the same click
 * returns the job it already created instead of running the code twice.
 * Callers must have already checked authentication, `canEdit` and the
 * execution allowlist.
 */
export async function enqueueCodeJob(input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  const profile = runtimeProfileForLanguage(input.languageId);
  if (!profile || !profileSupportsOperation(profile, input.operation)) {
    throw new CodeJobError("That action is not available for this language.", 400, "UNSUPPORTED");
  }

  const existing = await findByRequest(input.userId, input.requestId);
  if (existing) return { id: existing, created: false };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMISSION_LOCK})`);

    // Re-check inside the lock: a concurrent retry may have landed first.
    const [again] = await tx
      .select({ id: codeJobs.id })
      .from(codeJobs)
      .where(and(eq(codeJobs.userId, input.userId), eq(codeJobs.requestId, input.requestId)))
      .limit(1);
    if (again) return { id: again.id, created: false };

    const [{ mine, total }] = await tx
      .select({
        mine: sql<number>`count(*) filter (where ${codeJobs.userId} = ${input.userId})`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(codeJobs)
      .where(inArray(codeJobs.state, NON_TERMINAL));

    if (mine >= MAX_PENDING_JOBS_PER_USER) {
      throw new CodeJobError(
        `You already have ${mine} runs in progress. Wait for one to finish, or stop it.`,
        429,
        "USER_QUEUE_FULL",
      );
    }
    if (total >= MAX_PENDING_JOBS_TOTAL) {
      throw new CodeJobError("The runner is busy. Try again in a minute.", 503, "QUEUE_FULL");
    }

    const now = new Date();
    const [row] = await tx
      .insert(codeJobs)
      .values({
        userId: input.userId,
        documentId: input.documentId,
        operation: input.operation,
        languageId: input.languageId,
        profileId: profile.id,
        runtimeVersion: profile.version,
        source: input.source,
        stdin: input.stdin,
        sourceHash: hashSource(input.source),
        requestId: input.requestId,
        queuedAt: now,
        expiresAt: new Date(now.getTime() + RESULT_RETENTION_MS),
      })
      .returning({ id: codeJobs.id });
    return { id: row.id, created: true };
  });
}

async function findByRequest(userId: string, requestId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: codeJobs.id })
    .from(codeJobs)
    .where(and(eq(codeJobs.userId, userId), eq(codeJobs.requestId, requestId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The submitting user's view of a job, or null. A job belonging to someone else
 * is indistinguishable from one that does not exist — callers return 404 for
 * both. Document access is rechecked by the caller, not here.
 */
export async function getCodeJobForUser(
  jobId: string,
  userId: string,
  currentSourceHash?: string,
): Promise<(CodeJobStatus & { documentId: string }) | null> {
  const [job] = await db
    .select()
    .from(codeJobs)
    .where(and(eq(codeJobs.id, jobId), eq(codeJobs.userId, userId)))
    .limit(1);
  if (!job) return null;

  const finished = job.finishedAt !== null;
  return {
    id: job.id,
    documentId: job.documentId,
    state: job.state,
    operation: job.operation,
    languageId: job.languageId,
    stale: currentSourceHash !== undefined && currentSourceHash !== job.sourceHash,
    result: finished
      ? {
          compilerOutput: job.compilerOutput ?? "",
          stdout: job.stdout ?? "",
          stderr: job.stderr ?? "",
          exitCode: job.exitCode,
          signal: job.signal,
          truncated: job.outputTruncated,
        }
      : null,
    queuedAt: job.queuedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    runtimeVersion: job.runtimeVersion,
  };
}

/**
 * Idempotent. A job no worker has touched yet is cancelled outright; an active
 * one gets a cancel request that its worker sees on the next heartbeat and acts
 * on by killing the whole sandbox. A finished job is left alone.
 */
export async function requestCodeJobCancel(jobId: string, userId: string): Promise<boolean> {
  const now = new Date();
  const queued = await db
    .update(codeJobs)
    .set({ state: "cancelled", cancelRequestedAt: now, finishedAt: now })
    .where(and(eq(codeJobs.id, jobId), eq(codeJobs.userId, userId), eq(codeJobs.state, "queued")))
    .returning({ id: codeJobs.id });
  if (queued.length) return true;

  const active = await db
    .update(codeJobs)
    .set({ cancelRequestedAt: now })
    .where(
      and(
        eq(codeJobs.id, jobId),
        eq(codeJobs.userId, userId),
        inArray(codeJobs.state, ACTIVE),
        isNull(codeJobs.cancelRequestedAt),
      ),
    )
    .returning({ id: codeJobs.id });
  return active.length > 0;
}

// ---------------------------------------------------------------------------
// Worker side. Everything below is reached only through the worker API, which
// authenticates with a worker credential — never a user cookie.
// ---------------------------------------------------------------------------

export type ClaimedCodeJob = {
  id: string;
  attemptId: string;
  operation: CodeJobOperation;
  profileId: string;
  source: string;
  stdin: string;
  cancelRequested: boolean;
};

/**
 * Atomically hand the oldest eligible queued job to `workerId`, or return null.
 * `MAX_ACTIVE_JOBS` is enforced inside the same lock as the claim, so two
 * workers polling at once cannot both start a job over the global limit.
 * `FOR UPDATE SKIP LOCKED` keeps this correct once there are several workers.
 */
export async function claimNextCodeJob(
  workerId: string,
  profileIds: readonly string[],
): Promise<ClaimedCodeJob | null> {
  if (!profileIds.length) return null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CLAIM_LOCK})`);

    const [{ active }] = await tx
      .select({ active: sql<number>`count(*)`.mapWith(Number) })
      .from(codeJobs)
      .where(inArray(codeJobs.state, ACTIVE));
    if (active >= MAX_ACTIVE_JOBS) return null;

    const candidates = await tx.execute<{ id: string; queued_at: Date }>(sql`
      select id, queued_at from ${codeJobs}
      where state = 'queued'
        and cancel_requested_at is null
        and profile_id in ${profileIds}
      order by queued_at
      limit 1
      for update skip locked
    `);
    const candidate = candidates[0];
    if (!candidate) return null;

    const now = new Date();
    const attemptId = randomUUID();
    const [job] = await tx
      .update(codeJobs)
      .set({
        state: "preparing",
        workerId,
        attemptId,
        startedAt: now,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
        queueMs: now.getTime() - new Date(candidate.queued_at).getTime(),
      })
      .where(and(eq(codeJobs.id, candidate.id), eq(codeJobs.state, "queued")))
      .returning();
    if (!job) return null;

    return {
      id: job.id,
      attemptId,
      operation: job.operation,
      profileId: job.profileId,
      source: job.source,
      stdin: job.stdin,
      cancelRequested: false,
    };
  });
}

/**
 * Extend a lease and optionally advance the job's in-flight state. Returns
 * `null` when the lease is no longer this attempt's — the worker must then stop
 * and discard its sandbox, because the job has been reclaimed or finished.
 */
export async function heartbeatCodeJob(input: {
  jobId: string;
  workerId: string;
  attemptId: string;
  state?: CodeJobState;
}): Promise<{ cancelRequested: boolean } | null> {
  const [job] = await db
    .select({
      state: codeJobs.state,
      operation: codeJobs.operation,
      cancelRequestedAt: codeJobs.cancelRequestedAt,
    })
    .from(codeJobs)
    .where(
      and(
        eq(codeJobs.id, input.jobId),
        eq(codeJobs.workerId, input.workerId),
        eq(codeJobs.attemptId, input.attemptId),
      ),
    )
    .limit(1);
  if (!job || !isActiveCodeJobState(job.state)) return null;

  const next = input.state ?? job.state;
  if (!isAllowedProgress(job.operation, job.state, next)) {
    throw new CodeJobError("Illegal state transition.", 409, "BAD_TRANSITION");
  }

  const now = new Date();
  const updated = await db
    .update(codeJobs)
    .set({
      state: next,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
    })
    .where(
      and(
        eq(codeJobs.id, input.jobId),
        eq(codeJobs.attemptId, input.attemptId),
        inArray(codeJobs.state, ACTIVE),
      ),
    )
    .returning({ id: codeJobs.id });
  if (!updated.length) return null;
  return { cancelRequested: job.cancelRequestedAt !== null };
}

export type CompletionInput = {
  jobId: string;
  workerId: string;
  attemptId: string;
  state: CodeJobState;
  compilerOutput: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  workerTruncated: boolean;
  imageDigest: string | null;
  prepareMs: number | null;
  compileMs: number | null;
  runMs: number | null;
};

/**
 * Finalize a job. Only the attempt that currently holds the lease can do this,
 * which is what makes at-least-once delivery safe: a late result from an
 * attempt that was reclaimed matches no row and is dropped. Output is bounded
 * and neutralised again here even though the worker already did it — the
 * worker is the component most likely to be wrong, and this is the last point
 * before the text is stored.
 */
export async function completeCodeJob(input: CompletionInput): Promise<boolean> {
  const bounded = boundOutputs(input);
  const now = new Date();
  const updated = await db
    .update(codeJobs)
    .set({
      state: input.state,
      compilerOutput: bounded.compilerOutput,
      stdout: bounded.stdout,
      stderr: bounded.stderr,
      exitCode: input.exitCode,
      signal: input.signal,
      outputTruncated: bounded.truncated || input.workerTruncated,
      imageDigest: input.imageDigest,
      prepareMs: input.prepareMs,
      compileMs: input.compileMs,
      runMs: input.runMs,
      finishedAt: now,
      leaseExpiresAt: null,
      expiresAt: new Date(now.getTime() + RESULT_RETENTION_MS),
    })
    .where(
      and(
        eq(codeJobs.id, input.jobId),
        eq(codeJobs.workerId, input.workerId),
        eq(codeJobs.attemptId, input.attemptId),
        inArray(codeJobs.state, ACTIVE),
      ),
    )
    .returning({ id: codeJobs.id });
  return updated.length > 0;
}

// ---------------------------------------------------------------------------
// Sweeping. Safe to run from anywhere, any number of times.
// ---------------------------------------------------------------------------

export type SweepResult = { reclaimed: number; queueExpired: number; purged: number };

const SWEEP_EVERY_MS = 15_000;
let lastSweep = 0;

/**
 * Sweep at most every 15s, from whichever route happens to be busy. Called on
 * worker claims *and* on user polls: if it only ran on claims, a runner that
 * crashed would never be around to reclaim its own lapsed lease, and the user
 * would watch a job say "running" forever. Idempotent, so concurrent calls
 * from several processes are harmless.
 */
export async function maybeSweepCodeJobs(): Promise<void> {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  await sweepCodeJobs().catch((error) =>
    console.error("[code-jobs] sweep failed", error instanceof Error ? error.message : error),
  );
}

/**
 * - A lease that lapsed means the worker died or lost contact. The job becomes
 *   `infrastructure_error` and is **not** requeued: plan §9 says never silently
 *   replay user code after an uncertain failure, so the user reruns explicitly.
 * - A job queued past the wait limit also fails, rather than running minutes
 *   after the user stopped expecting it.
 * - Rows past retention are deleted, taking their source and output with them.
 */
export async function sweepCodeJobs(now = new Date()): Promise<SweepResult> {
  const reclaimed = await db
    .update(codeJobs)
    .set({
      state: "infrastructure_error",
      stderr: "The runner stopped responding while this job was running. It was not re-run.",
      finishedAt: now,
      leaseExpiresAt: null,
    })
    .where(and(inArray(codeJobs.state, ACTIVE), lt(codeJobs.leaseExpiresAt, now)))
    .returning({ id: codeJobs.id });

  const queueExpired = await db
    .update(codeJobs)
    .set({
      state: "infrastructure_error",
      stderr: "No runner picked this job up in time. It was not run.",
      finishedAt: now,
    })
    .where(
      and(
        eq(codeJobs.state, "queued"),
        lt(codeJobs.queuedAt, new Date(now.getTime() - QUEUE_WAIT_TIMEOUT_MS)),
      ),
    )
    .returning({ id: codeJobs.id });

  const purged = await db
    .delete(codeJobs)
    .where(lt(codeJobs.expiresAt, now))
    .returning({ id: codeJobs.id });

  return { reclaimed: reclaimed.length, queueExpired: queueExpired.length, purged: purged.length };
}
