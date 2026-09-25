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
 * google-java-format reflects into javac internals, and these exports are its
 * documented requirement on modern JDKs. The image carries the same list as
 * `$GJF_CMD` for the slice 3 proof; it is spelled out here because the worker
 * passes argv without a shell, so an environment variable would never expand.
 */
const GJF_ARGV = [
  "java",
  "--add-exports", "jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
  "--add-exports", "jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED",
  "--add-exports", "jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED",
  "--add-exports", "jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED",
  "--add-exports", "jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED",
  "-jar", "/opt/google-java-format.jar",
] as const;

/**
 * Every language proven in slice 3 (plan §6.1), minus C#, which was dropped.
 *
 * Formatter settings are pinned here rather than discovered (plan §5): Ruff
 * runs `--isolated` and clang-format gets an explicit style, so neither goes
 * looking for a configuration file. A job's workspace only ever holds the one
 * source file, but relying on that would make the settings an accident.
 *
 * Compilers run with warnings on because the output panel is the only place
 * an author sees diagnostics, and a successful build that warned is still
 * worth reading. Nothing is `-Werror`: a warning never blocks a run.
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
    formatArgv: ["ruff", "format", "--isolated", "--no-cache", "main.py"],
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
  {
    id: "java-21",
    languageId: "java",
    version: "Java 21 (Temurin)",
    imageKey: "jvm",
    // javac requires a public class to live in a file of the same name, so a
    // block must declare `public class Main`. The error for anything else is
    // javac's own and says exactly that; no source is rewritten to hide it.
    entrypoint: "Main.java",
    compileArgv: ["javac", "-Xlint:all", "-Xmaxerrs", "50", "Main.java"],
    runArgv: ["java", "-XX:+UseSerialGC", "-Xss8m", "Main"],
    formatArgv: [...GJF_ARGV, "--replace", "Main.java"],
    // The JVM sizes its heap from the container limit (a quarter by default),
    // and javac plus the JIT want far more threads than an interpreter.
    memoryMb: 1024,
    cpus: 1,
    pids: 256,
    compileTimeoutMs: 30_000,
    // The run deadline covers sandbox start as well as the program, and JVM
    // start is the largest fixed cost here: the first run on a cold page cache
    // measured past 5s locally for a program that takes 0.8s warm.
    runTimeoutMs: 10_000,
    formatTimeoutMs: 15_000,
  },
  {
    id: "ghc-9.6",
    languageId: "haskell",
    version: "GHC 9.6",
    imageKey: "haskell",
    entrypoint: "Main.hs",
    // -v0 drops "[1 of 2] Compiling Main" chatter; errors are still reported.
    compileArgv: ["ghc", "-v0", "-O0", "-Wall", "-o", "main", "Main.hs"],
    runArgv: ["./main"],
    formatArgv: ["ormolu", "--mode", "inplace", "Main.hs"],
    memoryMb: 1024,
    cpus: 1,
    pids: 256,
    compileTimeoutMs: 30_000,
    runTimeoutMs: 5_000,
    formatTimeoutMs: 10_000,
  },
  {
    id: "gcc-14-c",
    languageId: "c",
    version: "GCC 14 (C17)",
    imageKey: "gcc",
    entrypoint: "main.c",
    // The math library is linked after the source, where the linker needs it.
    compileArgv: ["gcc", "-std=gnu17", "-O0", "-Wall", "-Wextra", "-o", "main", "main.c", "-lm"],
    runArgv: ["./main"],
    formatArgv: ["clang-format", "--style=LLVM", "-i", "main.c"],
    memoryMb: 512,
    cpus: 1,
    pids: 128,
    compileTimeoutMs: 30_000,
    runTimeoutMs: 5_000,
    formatTimeoutMs: 10_000,
  },
  {
    id: "gcc-14-cpp",
    languageId: "cpp",
    version: "GCC 14 (C++20)",
    imageKey: "gcc",
    entrypoint: "main.cpp",
    compileArgv: ["g++", "-std=gnu++20", "-O0", "-Wall", "-Wextra", "-o", "main", "main.cpp"],
    runArgv: ["./main"],
    formatArgv: ["clang-format", "--style=LLVM", "-i", "main.cpp"],
    // cc1plus on a template-heavy file is the hungriest compile in this set.
    memoryMb: 1024,
    cpus: 1,
    pids: 128,
    compileTimeoutMs: 30_000,
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
