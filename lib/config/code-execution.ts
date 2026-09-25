/**
 * Client-safe execution config (Phase 24 slice 4).
 *
 * Everything here is allowed to reach the browser: it describes *what the
 * product offers*, never *how a job is run*. Image names, digests, argv arrays
 * and per-profile resource limits live in `server/code-runtime.ts` and must not
 * be imported from client code — a fence string has to stay a lookup key rather
 * than anything that resembles a command.
 */

export type CodeJobOperation = "run" | "format";

/**
 * Lifecycle from plan §7. `formatting` replaces compile/run for format jobs,
 * and interpreted languages simply never report `compiling`.
 */
export type CodeJobState =
  | "queued"
  | "preparing"
  | "compiling"
  | "running"
  | "formatting"
  | "succeeded"
  | "compile_error"
  | "runtime_error"
  | "timed_out"
  | "resource_limit"
  | "output_limit"
  | "cancelled"
  | "infrastructure_error";

export const CODE_JOB_STATES: readonly CodeJobState[] = [
  "queued", "preparing", "compiling", "running", "formatting",
  "succeeded", "compile_error", "runtime_error", "timed_out",
  "resource_limit", "output_limit", "cancelled", "infrastructure_error",
];

const TERMINAL: ReadonlySet<CodeJobState> = new Set<CodeJobState>([
  "succeeded", "compile_error", "runtime_error", "timed_out",
  "resource_limit", "output_limit", "cancelled", "infrastructure_error",
]);

export function isTerminalCodeJobState(state: CodeJobState): boolean {
  return TERMINAL.has(state);
}

/** A job that failed for reasons outside the user's program. */
export function isInfrastructureFailure(state: CodeJobState): boolean {
  return state === "infrastructure_error";
}

/**
 * Languages the runner can execute, keyed by the catalog id in
 * `lib/code/languages.ts`. Every language proven in slice 3 is here as of
 * slice 5. C# is deliberately absent — see plan §1.
 */
export const RUNNABLE_LANGUAGE_IDS: readonly string[] = [
  "python", "javascript", "java", "haskell", "c", "cpp",
];

export function canRunLanguage(languageId: string | undefined): boolean {
  return !!languageId && RUNNABLE_LANGUAGE_IDS.includes(languageId);
}

// Plan §8. Bounds are enforced server-side; the client uses them only to avoid
// submitting something it already knows will be rejected.
export const MAX_SOURCE_BYTES = 128 * 1024;
export const MAX_STDIN_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 256 * 1024;

/** Admission control, per plan §8. */
export const MAX_PENDING_JOBS_PER_USER = 3;
export const MAX_PENDING_JOBS_TOTAL = 20;
export const MAX_ACTIVE_JOBS = 1;

export const QUEUE_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
export const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** How long a claim survives without a heartbeat before it can be reclaimed. */
export const JOB_LEASE_MS = 30 * 1000;
export const JOB_HEARTBEAT_MS = 10 * 1000;

/** Slice 4 uses polling; plan §9.5 leaves streaming as a later optimization. */
export const JOB_POLL_INTERVAL_MS = 400;

export type CodeJobResult = {
  compilerOutput: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
};

/** What a user-facing status response exposes. Never includes worker identity. */
export type CodeJobStatus = {
  id: string;
  state: CodeJobState;
  operation: CodeJobOperation;
  languageId: string;
  /** True once the block's current text no longer matches what was submitted. */
  stale: boolean;
  result: CodeJobResult | null;
  queuedAt: string;
  finishedAt: string | null;
  runtimeVersion: string | null;
};

const MESSAGES: Record<CodeJobState, string> = {
  queued: "Queued",
  preparing: "Preparing a sandbox",
  compiling: "Compiling",
  running: "Running",
  formatting: "Formatting",
  succeeded: "Finished",
  compile_error: "Compilation failed",
  runtime_error: "Exited with an error",
  timed_out: "Timed out",
  resource_limit: "Stopped: resource limit reached",
  output_limit: "Stopped: too much output",
  cancelled: "Cancelled",
  infrastructure_error: "The runner failed. Nothing was re-run automatically.",
};

export function codeJobStateMessage(state: CodeJobState): string {
  return MESSAGES[state] ?? state;
}
