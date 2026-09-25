import "server-only";

import type { CodeJobOperation } from "@/lib/config/code-execution";

/**
 * The private half of the language catalog (plan §3): image names, fixed argv
 * arrays and resource policy. **Never import this from client code.** The
 * public half — which languages exist, what they are called, what can run — is
 * `lib/code/languages.ts` and `lib/config/code-execution.ts`.
 *
 * The separation is the security property. A fence's info string is matched
 * against the public catalog to get a `languageId`, and only a `languageId`
 * that appears here can select a profile. No part of a document ever becomes an
 * image name, a command, a compiler flag or a filename.
 */

export type RuntimeProfile = {
  id: string;
  languageId: string;
  /** Shown in the execution UI and recorded with every result (plan §3). */
  version: string;
  /** Image key; the deployment prefix is applied by `profileImage`. */
  imageKey: string;
  /** Filename the submitted source is written to inside the workspace. */
  entrypoint: string;
  /** Fixed argv. No user input reaches any element of these arrays. */
  compileArgv: readonly string[] | null;
  runArgv: readonly string[];
  /** Native formatter argv, when the runner owns formatting for this language. */
  formatArgv: readonly string[] | null;
  memoryMb: number;
  cpus: number;
  pids: number;
  compileTimeoutMs: number | null;
  runTimeoutMs: number;
  formatTimeoutMs: number;
};

/**
 * Slice 4 wires the two interpreted languages. The compiled profiles were
 * proven in slice 3 (plan §6.1) and are added in slice 5 — they are absent
 * here rather than present-and-disabled so that an unfinished profile cannot
 * be selected by accident.
 */
const PROFILES: readonly RuntimeProfile[] = [
  {
    id: "python-3.12",
    languageId: "python",
    version: "CPython 3.12",
    imageKey: "python",
    entrypoint: "main.py",
    compileArgv: null,
    runArgv: ["python3", "main.py"],
    formatArgv: ["ruff", "format", "main.py"],
    memoryMb: 512,
    cpus: 1,
    pids: 128,
    compileTimeoutMs: null,
    runTimeoutMs: 5_000,
    formatTimeoutMs: 10_000,
  },
  {
    id: "node-22",
    languageId: "javascript",
    version: "Node.js 22",
    imageKey: "node",
    entrypoint: "main.mjs",
    compileArgv: null,
    runArgv: ["node", "main.mjs"],
    // JavaScript formatting stays in the browser worker (plan §5). The runner
    // never needs to format it, so there is no adapter to go wrong.
    formatArgv: null,
    memoryMb: 512,
    cpus: 1,
    pids: 128,
    compileTimeoutMs: null,
    runTimeoutMs: 5_000,
    formatTimeoutMs: 10_000,
  },
];

const BY_LANGUAGE = new Map(PROFILES.map((profile) => [profile.languageId, profile]));
const BY_ID = new Map(PROFILES.map((profile) => [profile.id, profile]));

export function runtimeProfileForLanguage(languageId: string): RuntimeProfile | undefined {
  return BY_LANGUAGE.get(languageId);
}

export function runtimeProfileById(profileId: string): RuntimeProfile | undefined {
  return BY_ID.get(profileId);
}

export function listRuntimeProfiles(): readonly RuntimeProfile[] {
  return PROFILES;
}

/**
 * Slice 3 proved the `vault-runner-proof-*` images, so they are the default.
 * Slice 6 publishes digest-pinned images and points this at them; until then
 * the prefix is the one knob a deployment has.
 */
export function profileImage(profile: RuntimeProfile): string {
  const prefix = process.env.CODE_RUNNER_IMAGE_PREFIX ?? "vault-runner-proof-";
  return `${prefix}${profile.imageKey}`;
}

export function profileSupportsOperation(
  profile: RuntimeProfile,
  operation: CodeJobOperation,
): boolean {
  return operation === "run" ? profile.runArgv.length > 0 : profile.formatArgv !== null;
}

/** Execution is off unless the deployment turns it on (plan §1). */
export function executionEnabled(): boolean {
  return process.env.CODE_EXECUTION_ENABLED === "true";
}

/**
 * Editing a document does not grant access to compute (plan §7). Membership in
 * this allowlist is a second, deployment-controlled gate on top of `canEdit`.
 * An unset allowlist denies everyone rather than allowing everyone — an empty
 * config must never be the permissive case.
 */
export function userMayExecute(userId: string): boolean {
  const raw = process.env.CODE_EXECUTION_USER_IDS ?? "";
  const allowed = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(userId);
}
