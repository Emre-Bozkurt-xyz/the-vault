# Runner proof (Phase 24, slice 3)

This directory exists to answer one question before any execution code is
written: **can this mini-PC run all seven languages safely, and how fast?**

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
  not being benchmarked: neither addresses the five native formatters, both
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
./runner/proof.sh build       # builds six images — several GB, takes a while
./runner/proof.sh bench       # cold/warm wall time per language
./runner/proof.sh isolation   # network, filesystem, pids, memory, timeout, cleanup
./runner/proof.sh format      # the five native formatters
./runner/proof.sh clean       # removes everything the above created
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
- **Disk free on the Docker root.** The six images land somewhere around 6–10
  GB, and `haskell:9.6` is the single biggest line item by a wide margin.

**A note on this host specifically.** The mini-PC is an Intel N150 (four
efficiency cores, no SMT) running well over a dozen containers across four
projects, with roughly 5 GB of its 16 GB free. Two consequences: benchmark
numbers will be noisy and on the pessimistic side, which is arguably the honest
number since production load is exactly this; and the `haskell` and `dotnet`
image builds are the memory-hungriest step here, so build them when the host is
otherwise quiet rather than alongside a busy Minecraft server.

**In `bench`:** warm time is what a user feels. Python and JavaScript should be
well under a second. Java, C, and C++ will be a few seconds. Haskell and C# are
the ones to watch on a mid-range CPU — if either is slow enough to be unpleasant,
that is a product decision (drop it from the first execution release, or commit
to a queued/running UI), not something to tune away.

**In `isolation`:** every line must say `OK`. A `BAD` on the network,
read-only-root, or gVisor-kernel checks means the host is not ready and slice 4
must not start. The memory and pid checks are expected to *fail the command*,
which is what `OK` means there — the sandbox killed it.

**In `format`:** C# is the most likely to need adjustment on first run; it is
the only language needing a host-owned project and an offline package cache.
Everything else compiles a loose file.

## Recording the results

Slice 3 is finished when the numbers exist and are written down, not when the
script runs clean. Put the measured table and the go/no-go into
`docs/22_CODE_BLOCKS_AND_EXECUTION_PLAN.md`, and tick the slice in
`docs/01_PROGRESS_TRACKER.md`.

## Status

**Untested against the mini-PC.** These files were written from the plan and
from the image documentation; nothing here has been executed on the real host.
Expect to fix something on the first run — most likely in the C# path. Treat the
first `build` and `bench` as part of the work, not as a formality.
