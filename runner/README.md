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
