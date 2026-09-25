# Runner proof (Phase 24, slice 3)

This directory exists to answer one question before any execution code is
written: **can this mini-PC run the languages safely, and how fast?**

**Answered on 2026-09-24.** Isolation passes 12/12 and six languages run, four
of them under a second warm. Full numbers and conclusions are in
`docs/22_CODE_BLOCKS_AND_EXECUTION_PLAN.md` §6.1. C# was dropped — it is the
only language that needs a project scaffold rather than a loose file, and it
failed three runs for three unrelated scaffold reasons while the others worked.
C# highlighting is unaffected; only running and server-side formatting are gone.

It is deliberately *not* wired into `scripts/deploy.sh` or
`docker-compose.production.yml`. Slice 3's output is a decision; automating a
runner into the deploy before that decision exists would bake in the wrong
answer. Deployment comes in slice 6.

Nothing here touches Vault's containers, database, or `.env.production`. All
images and containers it creates are prefixed `vault-runner-proof-` and are
removed by `./runner/proof.sh clean`.

## Decisions already made

- **Measure on the mini-PC first, decide on hardware after** (2026-09-24). The
  host turned out to run four projects plus a large Minecraft modpack, so the
  realistic question is whether it copes under normal use — and normal use here
  means Vault *or* the modpack, rarely both. Run the proof with the modpack
  stopped; that is the honest condition. If the numbers are poor even then, the
  fallback is a small runner-only VPS, which the architecture already allows:
  plan §6 has the runner claiming jobs over an authenticated private API and
  never holding database, OAuth, or R2 credentials, so it can live anywhere.
- **The blast-radius decision below is not live yet.** Slice 3 executes only the
  hello-world samples this harness writes, so nothing untrusted runs on the host
  during measurement. The tradeoff only takes effect when Run ships, which is
  slice 4 at the earliest — and if the runner moves to its own VPS by then, it
  disappears entirely.
- **gVisor runs directly on the host**, not inside a dedicated VM. The plan
  (§6) suggests a VM; we chose the host because isolation comes from the
  per-job `runsc` sandbox either way, and a VM would cost 2–4 GB of the 16 GB
  the mini-PC already shares with web, collab, Postgres, and the CI runner.
  **The tradeoff is real and worth restating**: without the VM, a gVisor escape
  lands on the same host as Postgres and `.env.production`. Revisit this if the
  runner is ever exposed to untrusted users rather than one operator.
- **Only the OCI + gVisor backend is being evaluated.** Piston and Judge0 are
  not being benchmarked: neither addresses the native formatters, both
  would still need their cancellation, limits, and privileged deployment
  verified, and the per-language images below are the artifact slice 4 needs
  regardless.

## Prerequisites

The host is already Linux with Docker. The only new software is gVisor.

> **Install from the upstream repo below, not from whatever `apt` finds by
> default.** This is the one component whose entire job is to be the security
> boundary, so it should track upstream releases rather than a distro snapshot.
> Upstream versions are named `release-YYYYMMDD.0` — `probe` flags anything
> that is not. Note that `runsc --version` has been seen reporting a string
> unrelated to the installed package version, so trust the package
> (`dpkg -l runsc`) over the banner if they disagree.

```bash
# 1. Install runsc (Debian/Ubuntu)
curl -fsSL https://gvisor.dev/archive.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
sudo apt-get update && sudo apt-get install -y runsc

# 2. Register it as a Docker runtime (edits /etc/docker/daemon.json)
sudo runsc install
sudo systemctl reload docker
```

`runsc install` adds a `runsc` entry to `daemon.json`; it does **not** change
the default runtime, so every existing Vault container keeps running exactly as
before. Confirm that with `docker ps` after the reload.

## Running it

Run the steps in order. `probe` is read-only and safe to run first.

```bash
./runner/proof.sh probe       # host facts, Docker, whether runsc is registered
./runner/proof.sh build       # builds five images — ~6.5 GB, takes a while
./runner/proof.sh bench       # cold/warm wall time per language
./runner/proof.sh isolation   # network, filesystem, pids, memory, timeout, cleanup
./runner/proof.sh format      # ruff, google-java-format, ormolu, clang-format
./runner/proof.sh clean       # proof images, dangling layers, leftover temp dirs
./runner/proof.sh clean bases # the above plus the pulled base images
```

On a shared host, stop the heavy neighbours before `build` and `bench` —
`docker stop mc-server-atm-10-aero` is the big one — and start them again
afterwards. `bench` prints the load average, free memory and whether the
modpack was running, so a results table stays interpretable later. Running
`bench` twice, once quiet and once with the modpack up, is the cheapest way to
answer "can this host do both at once" directly rather than by argument.

Tunable via environment: `RUNTIME`, `MEMORY`, `CPUS`, `PIDS`, `TIMEOUT`. Running
`bench` with `RUNTIME=runc` gives the gVisor overhead as a ratio — useful, but
never a configuration to actually ship.

## What to look for

**In `probe`:**

- **gVisor platform.** `systrap` is the modern default and is much faster than
  `ptrace`. If it reports `ptrace`, every number in `bench` is pessimistic and
  worth fixing before drawing conclusions.
- **Disk free on the Docker root.** The five images came to 6.48 GB, of which
  `haskell:9.6` is 3.12 GB — 56% of the total for one language.

**A note on this host specifically.** The mini-PC is an Intel N150 (four
efficiency cores, no SMT) running well over a dozen containers across four
projects. Two consequences: benchmark numbers are noisy unless the heavy
neighbours are stopped, and the `haskell` build is the most demanding step, so
run it when the host is otherwise quiet.

**In `bench`:** warm time is what a user feels. The measured baseline on this
host is Python 254ms, JavaScript 302ms, C 344ms, C++ 829ms, Haskell 1382ms and
Java 2747ms. A large regression against those means something changed in the
host, not in the harness. Anything over ~5s needs a visible queued/running state
in the editor rather than a spinner.

**In `isolation`:** every line must say `OK`. A `BAD` on the network,
read-only-root, or gVisor-kernel checks means the host is not ready and slice 4
must not start. The memory and pid checks are expected to *fail the command*,
which is what `OK` means there — the sandbox killed it.

**In `format`:** each formatter rewrites its sample in place, and the samples
are printed afterwards — a formatter that exits 0 without changing anything is
a failure that looks like a pass, so read the output rather than the OK.

## Cleaning up

`clean` removes the proof images, any dangling layers left by editing a
Dockerfile, and leftover workspaces. It deliberately leaves the **base** images
(`haskell:9.6` alone is ~3 GB, and they are most of the disk) and prints their
sizes; `clean bases` removes those too. Nothing here ever runs
`docker system prune`, because this host carries four unrelated projects and a
blanket prune would take their layers with it.

Repeated `build` runs are cheap — Docker reuses the layer cache and produces
the same image — but editing a Dockerfile leaves the previous build untagged,
and those accumulate silently. That is what `clean` sweeps.

## The worker (slice 4)

`proof.sh` measures; `worker.mjs` is the real runner. It claims jobs from
Vault's worker API, runs each in a fresh sandbox, and reports the result. It
runs **on the host**, beside Docker — never inside `vault-web`, which must not
be given the Docker socket.

```bash
# On the mini-PC, from the repo:
./runner/proof.sh build                               # the worker runs these images
export CODE_RUNNER_URL=http://127.0.0.1:18210        # vault-web's local port
export CODE_RUNNER_TOKEN=...                          # same value as Vault's
node runner/worker.mjs
```

By default the worker advertises all six profiles (`python-3.12`, `node-22`,
`java-21`, `ghc-9.6`, `gcc-14-c`, `gcc-14-cpp`), so all five images must exist
or those jobs fail as infrastructure errors. To run without one — say, to skip
the 3 GB Haskell image — narrow it:
`CODE_RUNNER_PROFILES=python-3.12,node-22,java-21,gcc-14-c,gcc-14-cpp`. A job for
a profile no runner advertises waits in the queue and expires after 5 minutes.

A quick per-language check once it is up: a block that reads a line of stdin
and prints it (use **Input**), a deliberate compile error, a non-zero exit,
**Format** on badly spaced code, and an infinite loop, which must say "Timed
out". Java needs `public class Main`.

And in Vault's `.env.production`:

```bash
CODE_EXECUTION_ENABLED=true
CODE_EXECUTION_USER_IDS=<your user id>
CODE_RUNNER_TOKEN=<32+ random chars>
```

What it guarantees, and why:

- **No shell.** Each profile's argv array goes straight to `docker run`. Nothing
  a document contains is ever parsed as a command line, which also makes the
  `bash -lc` PATH bug from slice 3 structurally impossible rather than avoided.
- **Refuses to start without gVisor.** If `runsc` is not a registered runtime
  it exits rather than run code under plain `runc`. `CODE_RUNNER_ALLOW_UNSANDBOXED=1`
  overrides this for local development on machines with no gVisor (Docker
  Desktop on Windows) and logs a warning on every start. **Never set it on a
  real host.**
- **The token never reaches a sandbox.** Containers get `HOME=/tmp` and nothing
  else from the environment, and have no network to send anything anywhere.
- **Two deadlines.** The worker's own timer kills a job at its limit, and an
  in-container `timeout --signal=KILL` backstop fires a few seconds later. The
  backstop exists for when the worker itself dies: without it, an infinite loop
  would outlive its supervisor indefinitely. Tested by hard-killing the worker
  mid-job — the orphaned sandbox stopped itself 6s later.
- **Output is capped while it streams**, never buffered past 256 KiB.
- **Stop takes about a second.** The worker heartbeats every second while a
  sandbox is live and kills it as soon as a heartbeat reports a cancel.
- **Crash-safe.** On startup it reaps any `vault-job-*` containers and
  workspaces an earlier run left behind. A job whose worker died becomes an
  `infrastructure_error` once its lease lapses, and is **never** re-run — the
  user reruns it explicitly.

Running it as a service (systemd, restart policy, log rotation) is slice 6.

## Recording the results

Slice 3 is finished when the numbers exist and are written down, not when the
script runs clean. Put the measured table and the go/no-go into
`docs/22_CODE_BLOCKS_AND_EXECUTION_PLAN.md`, and tick the slice in
`docs/01_PROGRESS_TRACKER.md`.

## Status

**Run against the mini-PC and passing** as of 2026-09-24: five images build,
six languages execute, isolation is 12/12, and the native formatters work.
Getting there took four rounds of fixes, and the two that would bite anyone
reusing this are worth knowing: a sandbox must be entered with `bash -c` rather
than `bash -lc` (a login shell resets `PATH` and discards the image's own), and
`HOME` must point somewhere writable because `useradd --create-home` puts it
under the read-only rootfs.
