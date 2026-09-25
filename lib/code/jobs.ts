/**
 * Pure code-job logic (plan §7–§8). Kept out of `server/` so it can be tested:
 * `server/` reaches `auth.ts` transitively, which cannot load under vitest.
 */

import {
  canRunLanguage,
  MAX_OUTPUT_BYTES,
  MAX_SOURCE_BYTES,
  MAX_STDIN_BYTES,
  type CodeJobOperation,
  type CodeJobState,
} from "@/lib/config/code-execution";

export type CodeJobInputError =
  | "invalid_request_id"
  | "invalid_operation"
  | "unsupported_language"
  | "source_too_large"
  | "stdin_too_large"
  | "empty_source";

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

/**
 * A client-generated id that makes a retried submission idempotent. Bounded
 * and restricted so it can never be used to smuggle anything into a log line
 * or a query plan.
 */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function validateCodeJobInput(input: {
  requestId: unknown;
  operation: unknown;
  languageId: string | undefined;
  source: string;
  stdin: string;
}): CodeJobInputError | null {
  if (!isValidRequestId(input.requestId)) return "invalid_request_id";
  if (input.operation !== "run" && input.operation !== "format") return "invalid_operation";
  if (!canRunLanguage(input.languageId)) return "unsupported_language";
  if (!input.source.trim()) return "empty_source";
  if (utf8Length(input.source) > MAX_SOURCE_BYTES) return "source_too_large";
  if (utf8Length(input.stdin) > MAX_STDIN_BYTES) return "stdin_too_large";
  return null;
}

const INPUT_ERROR_MESSAGES: Record<CodeJobInputError, string> = {
  invalid_request_id: "The request was malformed. Reload the page and try again.",
  invalid_operation: "That action is not available for code blocks.",
  unsupported_language: "Running code is not available for this language yet.",
  source_too_large: `This code block is too large to run (${MAX_SOURCE_BYTES / 1024} KiB limit).`,
  stdin_too_large: `The input is too large (${MAX_STDIN_BYTES / 1024} KiB limit).`,
  empty_source: "There is no code to run in this block.",
};

export function codeJobInputErrorMessage(error: CodeJobInputError): string {
  return INPUT_ERROR_MESSAGES[error];
}

/**
 * Cut a string to at most `maxBytes` of UTF-8 without splitting a multi-byte
 * character. A naive `slice` on the byte array can leave half a code point,
 * which then decodes to U+FFFD and corrupts the tail of otherwise good output.
 */
export function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) return { text: value, truncated: false };
  let end = maxBytes;
  // Continuation bytes are 10xxxxxx; back up to the start of a character.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true };
}

// CSI (`ESC [ … final`), OSC (`ESC ] … BEL|ST`), and any other two-byte escape.
const ANSI_ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// C0 controls except tab, newline and carriage return, plus DEL and C1.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * Plan §7: output renders as inert text, never with terminal escapes
 * interpreted. React already refuses to treat it as HTML; this removes the
 * sequences that would otherwise recolour, move the cursor or retitle a
 * terminal if someone pasted the output into one, and the OSC 8 hyperlinks a
 * program could use to disguise a link.
 */
export function inertOutput(value: string): string {
  return value.replace(ANSI_ESCAPES, "").replace(CONTROL_CHARS, "");
}

/** Bound and neutralise every output channel together, sharing one byte budget. */
export function boundOutputs(outputs: {
  compilerOutput: string;
  stdout: string;
  stderr: string;
}): { compilerOutput: string; stdout: string; stderr: string; truncated: boolean } {
  let remaining = MAX_OUTPUT_BYTES;
  let truncated = false;
  const take = (value: string) => {
    const clean = inertOutput(value);
    const cut = truncateUtf8(clean, Math.max(0, remaining));
    remaining -= utf8Length(cut.text);
    truncated ||= cut.truncated;
    return cut.text;
  };
  // Compiler diagnostics first: when output runs out, the reason the program
  // failed to build matters more than the tail of what it printed.
  const compilerOutput = take(outputs.compilerOutput);
  const stderr = take(outputs.stderr);
  const stdout = take(outputs.stdout);
  return { compilerOutput, stdout, stderr, truncated };
}

const ACTIVE: ReadonlySet<CodeJobState> = new Set<CodeJobState>([
  "preparing", "compiling", "running", "formatting",
]);

export function isActiveCodeJobState(state: CodeJobState): boolean {
  return ACTIVE.has(state);
}

/**
 * The only in-flight transitions a worker may report on heartbeat. A worker
 * cannot move a job backwards, and cannot jump to a terminal state this way —
 * terminal states go through completion, which checks the attempt token.
 */
export function isAllowedProgress(
  operation: CodeJobOperation,
  from: CodeJobState,
  to: CodeJobState,
): boolean {
  if (from === to) return true;
  if (operation === "format") return from === "preparing" && to === "formatting";
  if (from === "preparing") return to === "compiling" || to === "running";
  if (from === "compiling") return to === "running";
  return false;
}

const WORKER_TERMINAL: ReadonlySet<CodeJobState> = new Set<CodeJobState>([
  "succeeded", "compile_error", "runtime_error", "timed_out",
  "resource_limit", "output_limit", "cancelled", "infrastructure_error",
]);

export function isWorkerReportableTerminal(state: unknown): state is CodeJobState {
  return typeof state === "string" && WORKER_TERMINAL.has(state as CodeJobState);
}
