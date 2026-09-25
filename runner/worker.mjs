#!/usr/bin/env node
/**
 * Vault code runner (Phase 24, slice 4). Claims jobs from Vault's worker API,
 * runs each in a fresh gVisor sandbox, and reports the result.
 *
 * Runs on the HOST, beside Docker — never inside vault-web, which must not be
 * given the Docker socket (plan §8). It holds exactly one secret, the worker
 * token, which is never passed into a sandbox: containers get `HOME` and
 * nothing else from the environment.
 *
 * Required:  CODE_RUNNER_URL      e.g. http://127.0.0.1:18210
 *            CODE_RUNNER_TOKEN    >= 32 chars, same value Vault has
 * Optional:  CODE_RUNNER_ID       default: hostname
 *            CODE_RUNNER_PROFILES default: every profile below
 *            CODE_RUNNER_RUNTIME  default: runsc
 *
 * Isolation that slice 3 proved on the mini-PC is reproduced here as fixed
 * `docker run` flags. If gVisor is unavailable the runner refuses to start
 * (fail closed, plan §8) unless CODE_RUNNER_ALLOW_UNSANDBOXED=1 — a local
 * development escape hatch that must never be set on a real host.
 */
import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, chmod, rm, readdir } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const URL_BASE = (process.env.CODE_RUNNER_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.CODE_RUNNER_TOKEN ?? "";
const RUNNER_ID = (process.env.CODE_RUNNER_ID ?? hostname()).replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 64);
// Mirrors server/code-runtime.ts. A runner advertises only what it has images
// for, so narrowing this is how a host without the 3 GB Haskell image opts out.
const DEFAULT_PROFILES = "python-3.12,node-22,java-21,ghc-9.6,gcc-14-c,gcc-14-cpp";
const PROFILES = (process.env.CODE_RUNNER_PROFILES ?? DEFAULT_PROFILES).split(",").map((s) => s.trim()).filter(Boolean);
const RUNTIME = process.env.CODE_RUNNER_RUNTIME ?? "runsc";
const ALLOW_UNSANDBOXED = process.env.CODE_RUNNER_ALLOW_UNSANDBOXED === "1";

// Mirrors lib/config/code-execution.ts. The server bounds output again on
// receipt; bounding here too means an enormous stream is never buffered.
const MAX_OUTPUT_BYTES = 256 * 1024;
const HEARTBEAT_MS = 1_000;
const IDLE_POLL_MS = 1_000;
const CONTAINER_PREFIX = "vault-job-";
const WORKSPACE_PREFIX = "vault-job-";

const log = (...args) => console.log(new Date().toISOString(), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let stopping = false;

// ---------------------------------------------------------------------------
// Vault API
// ---------------------------------------------------------------------------

async function api(path, body) {
  const response = await fetch(`${URL_BASE}/api/code/worker${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-runner-id": RUNNER_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

const digests = new Map();
async function imageDigest(image) {
  if (!digests.has(image)) {
    const { stdout } = await exec("docker", ["image", "inspect", image, "--format", "{{.Id}}"]);
    digests.set(image, stdout.trim());
  }
  return digests.get(image);
}

/**
 * The whole isolation policy, in one place. Every flag here was exercised by
 * `runner/proof.sh isolation` on the mini-PC before this file existed.
 */
function sandboxArgs({ name, image, workspace, memoryMb, cpus, pids, argv, interactive, timeoutMs }) {
  // The runner's own timer is the primary deadline, but it dies with the
  // runner. This in-container backstop means a sandbox still stops itself if
  // the runner crashes mid-job — without it an infinite loop would outlive its
  // supervisor indefinitely. The grace keeps the runner's timer firing first,
  // so a normal timeout is still reported as `timed_out`.
  const backstop = String(Math.ceil(timeoutMs / 1000) + 3);
  return [
    "run",
    "--name", name,
    `--runtime=${RUNTIME}`,
    "--network=none",
    `--memory=${memoryMb}m`, `--memory-swap=${memoryMb}m`,
    `--cpus=${cpus}`,
    `--pids-limit=${pids}`,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs", "/tmp:rw,size=64m,mode=1777",
    "-v", `${workspace}:/w:rw`,
    "-w", "/w",
    // HOME is under the read-only rootfs in these images; the job's tmpfs is
    // the only writable home. Nothing else from the runner's env goes in.
    "-e", "HOME=/tmp",
    ...(interactive ? ["-i"] : []),
    image,
    // argv from the server-side registry, passed straight through. No shell:
    // nothing a document contains is ever parsed as a command line.
    "timeout", "--signal=KILL", backstop,
    ...argv,
  ];
}

/**
 * Run one sandboxed phase. Resolves with the exit code and captured output;
 * `kill(reason)` stops it early. Output is capped as it streams — a program
 * printing forever is killed at the limit, never buffered past it.
 */
function runPhase({ name, args, stdin, timeoutMs, budget }) {
  let killReason = null;
  let stdout = "";
  let stderr = "";
  let bytes = 0;

  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });

  const kill = (reason) => {
    if (killReason) return;
    killReason = reason;
    // Kill the container, not just the docker CLI: SIGKILL to the client
    // would leave the sandbox running.
    execFile("docker", ["kill", name], () => {});
  };

  const take = (chunk, append) => {
    const room = budget.remaining - bytes;
    if (room <= 0) return kill("output");
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    bytes += piece.length;
    append(piece.toString("utf8"));
    if (chunk.length > room) kill("output");
  };
  child.stdout.on("data", (chunk) => take(chunk, (text) => { stdout += text; }));
  child.stderr.on("data", (chunk) => take(chunk, (text) => { stderr += text; }));

  // The deadline is enforced here, locally, so it holds even if the runner
  // loses contact with Vault mid-job (plan §9).
  const timer = setTimeout(() => kill("timeout"), timeoutMs);

  if (stdin) child.stdin.write(stdin);
  child.stdin.end();

  const done = new Promise((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      budget.remaining -= bytes;
      resolve({ code, stdout, stderr, killReason, truncated: killReason === "output" });
    });
  });
  return { done, kill };
}

async function removeContainer(name) {
  await exec("docker", ["rm", "-f", name]).catch(() => {});
}

/**
 * Files a job creates belong to the sandbox user (uid 10001), so the runner
 * cannot always delete them — a directory the job made is unemptiable from the
 * host. Fall back to deleting from inside a throwaway container.
 */
async function removeWorkspace(dir) {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    await exec("docker", ["run", "--rm", "--network=none", "-v", `${dir}:/w`, "--entrypoint", "sh", "alpine:3",
      "-c", "rm -rf /w/* /w/.[!.]* 2>/dev/null; true"]).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// One job
// ---------------------------------------------------------------------------

function classify(phase, { code, killReason }) {
  if (killReason === "cancel") return "cancelled";
  if (killReason === "timeout") return "timed_out";
  if (killReason === "output") return "output_limit";
  if (killReason === "lease") return "cancelled";
  if (code === 0) return "succeeded";
  // 125 is reserved by Docker for its own failures (bad image, bad flag) —
  // nothing the program did. 137 without a kill of ours is the kernel's SIGKILL,
  // i.e. the memory limit.
  if (code === 125) return "infrastructure_error";
  if (code === 137) return "resource_limit";
  return phase === "compile" ? "compile_error" : "runtime_error";
}

async function runJob({ job, profile }) {
  const workspace = await mkdtemp(join(tmpdir(), WORKSPACE_PREFIX));
  await chmod(workspace, 0o777);
  const entry = join(workspace, profile.entrypoint);
  await writeFile(entry, job.source, "utf8");
  await chmod(entry, 0o666);

  const attempt = job.attemptId;
  const short = attempt.slice(0, 8);
  const budget = { remaining: MAX_OUTPUT_BYTES };
  const timings = { prepareMs: null, compileMs: null, runMs: null };
  const started = Date.now();

  let current = null;
  let leaseLost = false;
  let cancelled = false;

  // Heartbeat on a short interval while a sandbox is live, so Stop takes effect
  // within about a second rather than at the end of the lease.
  const beat = async (state) => {
    try {
      const res = await api(`/jobs/${job.id}/heartbeat`, { attemptId: attempt, ...(state ? { state } : {}) });
      if (res.status === 409) { leaseLost = true; current?.kill("lease"); return; }
      if (res.body?.cancelRequested) { cancelled = true; current?.kill("cancel"); }
    } catch (error) {
      // Lost contact. The local deadline still stands; keep going.
      log(`heartbeat failed for ${job.id}: ${error.message}`);
    }
  };
  const heartbeat = setInterval(() => beat(), HEARTBEAT_MS);

  const result = { compilerOutput: "", stdout: "", stderr: "", exitCode: null, signal: null, truncated: false };
  let state = "infrastructure_error";

  try {
    const digest = await imageDigest(profile.image);
    timings.prepareMs = Date.now() - started;

    const phase = async (kind, argv, timeoutMs, stdin, reported) => {
      await beat(reported);
      const name = `${CONTAINER_PREFIX}${job.id.slice(0, 8)}-${short}-${kind}`;
      current = runPhase({
        name,
        args: sandboxArgs({ name, image: profile.image, workspace, memoryMb: profile.memoryMb,
          cpus: profile.cpus, pids: profile.pids, argv, interactive: Boolean(stdin), timeoutMs }),
        stdin, timeoutMs, budget,
      });
      if (cancelled) current.kill("cancel");
      const t0 = Date.now();
      const outcome = await current.done;
      await removeContainer(name);
      current = null;
      return { outcome, ms: Date.now() - t0 };
    };

    if (job.operation === "format") {
      const { outcome, ms } = await phase("format", profile.formatArgv, profile.formatTimeoutMs, null, "formatting");
      timings.runMs = ms;
      state = classify("run", outcome);
      // For a format job, stdout carries the *formatted source* read back from
      // the workspace; the formatter's own chatter goes in compilerOutput.
      result.compilerOutput = outcome.stdout + outcome.stderr;
      if (state === "succeeded") result.stdout = await readFile(entry, "utf8");
      result.exitCode = outcome.code;
      result.truncated = outcome.truncated;
    } else {
      if (profile.compileArgv) {
        const { outcome, ms } = await phase("compile", profile.compileArgv, profile.compileTimeoutMs, null, "compiling");
        timings.compileMs = ms;
        result.compilerOutput = outcome.stdout + outcome.stderr;
        result.truncated = outcome.truncated;
        state = classify("compile", outcome);
        if (state !== "succeeded") {
          result.exitCode = outcome.code;
          throw new Stop();
        }
      }
      const { outcome, ms } = await phase("run", profile.runArgv, profile.runTimeoutMs, job.stdin, "running");
      timings.runMs = ms;
      state = classify("run", outcome);
      result.stdout = outcome.stdout;
      result.stderr = outcome.stderr;
      result.exitCode = outcome.code;
      result.truncated ||= outcome.truncated;
      if (outcome.killReason) result.signal = "SIGKILL";
    }
    result.imageDigest = digest;
  } catch (error) {
    if (!(error instanceof Stop)) {
      state = "infrastructure_error";
      result.stderr = "The runner could not start this job.";
      log(`job ${job.id} failed in the runner: ${error.message}`);
    }
  } finally {
    clearInterval(heartbeat);
    await removeWorkspace(workspace);
  }

  if (leaseLost) {
    log(`job ${job.id}: lease lost, result discarded`);
    return;
  }

  // Retry delivery briefly: a result is worth a few attempts, but a 409 means
  // this attempt no longer owns the job and the result must be dropped.
  for (let tries = 0; tries < 5; tries++) {
    try {
      const res = await api(`/jobs/${job.id}/complete`, {
        attemptId: attempt, state, ...result,
        imageDigest: result.imageDigest ?? null, ...timings,
      });
      if (res.status === 200) { log(`job ${job.id} ${profile.id} ${job.operation}: ${state} (${describeTimings(timings)})`); return; }
      if (res.status === 409) { log(`job ${job.id}: result rejected, lease lost`); return; }
      log(`job ${job.id}: complete returned ${res.status}`);
    } catch (error) {
      log(`job ${job.id}: complete failed: ${error.message}`);
    }
    await sleep(500 * (tries + 1));
  }
}

class Stop extends Error {}

/** "compile 820ms, run 254ms" — never the source, stdin or output (plan §9). */
function describeTimings({ compileMs, runMs }) {
  const parts = [];
  if (compileMs !== null) parts.push(`compile ${compileMs}ms`);
  if (runMs !== null) parts.push(`run ${runMs}ms`);
  return parts.join(", ") || "did not start";
}

// ---------------------------------------------------------------------------
// Startup and main loop
// ---------------------------------------------------------------------------

async function preflight() {
  if (!URL_BASE) throw new Error("CODE_RUNNER_URL is not set");
  if (TOKEN.length < 32) throw new Error("CODE_RUNNER_TOKEN must be at least 32 characters");

  const { stdout } = await exec("docker", ["info", "--format", "{{json .Runtimes}}"]);
  if (!stdout.includes(`"${RUNTIME}"`)) {
    throw new Error(`Docker runtime '${RUNTIME}' is not registered (see runner/README.md)`);
  }
  if (RUNTIME !== "runsc") {
    if (!ALLOW_UNSANDBOXED) {
      throw new Error(`refusing to run untrusted code without gVisor (runtime is '${RUNTIME}')`);
    }
    log(`WARNING: runtime '${RUNTIME}' is NOT a sandbox. Development only — never on a real host.`);
  }
}

/** Plan §9: recovery reaps sandboxes and workspaces an earlier run abandoned. */
async function reap() {
  const { stdout } = await exec("docker", ["ps", "-aq", "--filter", `name=${CONTAINER_PREFIX}`]).catch(() => ({ stdout: "" }));
  const ids = stdout.split(/\s+/).filter(Boolean);
  if (ids.length) {
    await exec("docker", ["rm", "-f", ...ids]).catch(() => {});
    log(`reaped ${ids.length} abandoned sandbox(es)`);
  }
  const entries = await readdir(tmpdir()).catch(() => []);
  for (const entry of entries.filter((name) => name.startsWith(WORKSPACE_PREFIX))) {
    await removeWorkspace(join(tmpdir(), entry));
  }
}

async function main() {
  await preflight();
  await reap();
  log(`runner ${RUNNER_ID} up: ${URL_BASE} runtime=${RUNTIME} profiles=${PROFILES.join(",")}`);

  while (!stopping) {
    let claim;
    try {
      claim = await api("/claim", { profiles: PROFILES });
    } catch (error) {
      log(`claim failed: ${error.message}`);
      await sleep(IDLE_POLL_MS * 3);
      continue;
    }
    if (claim.status === 204) { await sleep(IDLE_POLL_MS); continue; }
    if (claim.status !== 200) {
      log(`claim returned ${claim.status}: ${JSON.stringify(claim.body)}`);
      await sleep(IDLE_POLL_MS * 3);
      continue;
    }
    await runJob(claim.body);
  }
  log("runner stopped");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`${signal}: finishing the current job, then stopping (again to force)`);
  });
}

main().catch((error) => {
  console.error(`runner failed to start: ${error.message}`);
  process.exit(1);
});
