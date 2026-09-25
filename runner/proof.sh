#!/usr/bin/env bash
#
# Phase 24, slice 3: seven-language runner proof.
#
# This script MEASURES. It does not deploy anything, does not touch Vault's
# containers, and is not wired into scripts/deploy.sh — by design. Slice 3's
# output is a decision (is this host viable, and with what limits), and baking a
# runner into the deploy before that decision exists would be backwards. Wiring
# up comes in slice 6.
#
#   ./runner/proof.sh probe       read-only host facts; safe to run anywhere
#   ./runner/proof.sh build       build the language images (several GB)
#   ./runner/proof.sh bench       cold/warm run timings per language
#   ./runner/proof.sh isolation   network, filesystem, pids, timeout, cleanup
#   ./runner/proof.sh format      the native formatters (ruff, gjf, ormolu, clang-format)
#   ./runner/proof.sh clean       remove proof images, dangling layers, temp dirs
#   ./runner/proof.sh clean bases also remove the pulled base images
#   ./runner/proof.sh all         build + bench + isolation + format
#
# See runner/README.md for prerequisites and how to read the results.
set -euo pipefail

TAG_PREFIX="vault-runner-proof"
RUNTIME="${RUNTIME:-runsc}"
MEMORY="${MEMORY:-512m}"
CPUS="${CPUS:-1}"
PIDS="${PIDS:-128}"
TIMEOUT="${TIMEOUT:-20}"

# image | languages it serves
IMAGES="python node jvm gcc haskell"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
row() { printf '%-12s %-22s %s\n' "$1" "$2" "$3"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

here() { cd "$(dirname "${BASH_SOURCE[0]}")" && pwd; }
ROOT="$(here)"

# ---------------------------------------------------------------------------
# probe — read-only. Run this first, on its own, before spending disk.
# ---------------------------------------------------------------------------
cmd_probe() {
  say "Host"
  row "kernel" "$(uname -r)" ""
  row "distro" "$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo unknown)" ""
  row "arch" "$(uname -m)" ""
  row "cpu" "$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//')" ""
  row "cores" "$(nproc)" ""
  row "memory" "$(free -h | awk '/^Mem:/ {print $2 " total, " $7 " available"}')" ""
  row "disk" "$(df -h /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4 " free of " $2}')" "(docker root)"

  say "Docker"
  command -v docker >/dev/null || die "docker not found"
  row "version" "$(docker --version | sed 's/Docker version //')" ""
  row "storage" "$(docker info --format '{{.Driver}}' 2>/dev/null)" ""
  row "images" "$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)" "(current usage)"

  say "gVisor"
  if command -v runsc >/dev/null; then
    local version
    version="$(runsc --version 2>/dev/null | head -1 | sed 's/^runsc version //')"
    row "runsc" "$version" ""
    # Ubuntu's universe package lags the upstream release repo by years, and a
    # stale sandbox is the one dependency where "it still works" is not the
    # question. Upstream versions look like `release-20250915.0`.
    case "$version" in
      release-*) ;;
      *) row "" "DISTRO PACKAGE" "use the upstream repo — see runner/README.md" ;;
    esac
    # The platform is a runsc flag and the sandbox does not report it, so the
    # only honest answers are "what does the binary default to" and "did the
    # daemon override it". Recent releases default to systrap; no runtimeArgs
    # in daemon.json means that default is what you are getting.
    row "platform flag" \
      "$(runsc --help 2>&1 | grep -iA2 -- '-platform' | tr '\n' ' ' | tr -s ' ' | head -c 88 || true)" ""
    if [ -r /etc/docker/daemon.json ]; then
      local args
      args="$(tr -d '\n ' < /etc/docker/daemon.json | grep -oE '"runsc":\{[^}]*\}' | head -c 120 || true)"
      row "daemon.json" "$args" \
        "$(printf '%s' "$args" | grep -q runtimeArgs && echo 'overridden' || echo 'no runtimeArgs — build default applies')"
    fi
  else
    row "runsc" "NOT INSTALLED" "see runner/README.md"
  fi
  if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q runsc; then
    row "runtime" "registered with docker" ""
    # Cheapest end-to-end proof that the runtime actually starts a sandbox.
    if docker run --rm --runtime=runsc alpine:3 uname -a 2>/dev/null | grep -qi gvisor; then
      row "smoke test" "a sandbox starts and reports a gVisor kernel" ""
    else
      row "smoke test" "FAILED to start a sandbox" "try: docker run --rm --runtime=runsc alpine:3 uname -a"
    fi
  else
    row "runtime" "NOT registered with docker" "run: sudo runsc install && sudo systemctl reload docker"
  fi

  say "Vault services on this host (must be left alone)"
  docker ps --format '  {{.Names}}\t{{.Status}}' || true
}

require_runtime() {
  docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q "$RUNTIME" \
    || die "docker runtime '$RUNTIME' not registered — run './runner/proof.sh probe' first"
}

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
cmd_build() {
  local failed=""
  for image in $IMAGES; do
    say "Building $image"
    # One broken base image must not stop the others from being measured.
    if ! docker build -f "$ROOT/images/$image.Dockerfile" -t "$TAG_PREFIX-$image" "$ROOT/images"; then
      failed="$failed $image"
    fi
  done
  say "Image sizes"
  for image in $IMAGES; do
    if have_image "$image"; then
      row "$image" "$(docker image inspect "$TAG_PREFIX-$image" --format '{{.Size}}' \
        | awk '{printf "%.2f GB", $1/1024/1024/1024}')" ""
    else
      row "$image" "MISSING" "build failed"
    fi
  done
  [ -z "$failed" ] || printf '\n\033[31mFailed to build:%s\033[0m\n' "$failed"
}

have_image() { docker image inspect "$TAG_PREFIX-$1" >/dev/null 2>&1; }

# Run one sandboxed job. Everything policy-relevant lives here in one place so
# the isolation tests below exercise the same shape a real job would get.
#   $1 image  $2 workspace dir  $3 shell command  [$4.. extra docker args]
sandbox() {
  local image="$1" work="$2" script="$3"; shift 3
  docker run --rm \
    --runtime="$RUNTIME" \
    --network=none \
    --memory="$MEMORY" --memory-swap="$MEMORY" \
    --cpus="$CPUS" \
    --pids-limit="$PIDS" \
    --read-only \
    --cap-drop=ALL \
    --security-opt=no-new-privileges \
    --tmpfs /tmp:rw,size=64m,mode=1777 \
    -v "$work:/w:rw" \
    -w /w \
    -e HOME=/tmp \
    "$@" \
    "$TAG_PREFIX-$image" \
    timeout --signal=KILL "$TIMEOUT" bash -c "$script"
}
# Two things above are load-bearing and were both found the hard way:
#   `bash -c`, never `bash -lc`. A login shell re-sources /etc/profile, which
#   resets PATH and throws away the image's own ENV PATH — that is how GHC went
#   missing from the haskell image, and it will bite any future image that puts
#   a toolchain somewhere other than /usr/bin.
#   HOME=/tmp, because useradd --create-home puts it under the read-only rootfs.
#   ruff, google-java-format and ormolu all want a writable home; clang-format
#   does not, which is why it was the only formatter that passed without this.

# Files a job leaves behind belong to uid 10001, and a directory it created
# (ruff's .ruff_cache) cannot be emptied by the host user. Fall back to a
# throwaway root container rather than leaving temp directories around.
discard_workspace() {
  [ -n "${1:-}" ] || return 0
  rm -rf "$1" 2>/dev/null && return 0
  docker run --rm -v "$1:/w" --entrypoint sh alpine:3 \
    -c 'rm -rf /w/* /w/.[!.]* 2>/dev/null; true' >/dev/null 2>&1 || true
  rm -rf "$1" 2>/dev/null || true
}

workspace() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/vault-proof.XXXXXX")"
  # mktemp gives 0700 owned by the invoking user, but the sandbox runs as uid
  # 10001, so without this the job cannot even read its own source file. A real
  # runner would map uids properly; for a throwaway proof directory this is fine.
  chmod 0777 "$dir"
  printf '%s' "$dir"
}

# Writes a hello-world for $1 into $2 and echoes the command that builds+runs it.
sample() {
  local language="$1" work="$2"
  case "$language" in
    python)
      printf 'print("hello from %s")\n' python > "$work/main.py"
      echo "python3 main.py" ;;
    javascript)
      printf 'console.log("hello from javascript");\n' > "$work/main.mjs"
      echo "node main.mjs" ;;
    java)
      printf 'public class Main { public static void main(String[] a) { System.out.println("hello from java"); } }\n' > "$work/Main.java"
      echo "javac Main.java && java Main" ;;
    haskell)
      printf 'main :: IO ()\nmain = putStrLn "hello from haskell"\n' > "$work/Main.hs"
      echo "ghc -O0 -o main Main.hs >/dev/null && ./main" ;;
    c)
      printf '#include <stdio.h>\nint main(void){ puts("hello from c"); return 0; }\n' > "$work/main.c"
      echo "gcc -O0 main.c -o main && ./main" ;;
    cpp)
      printf '#include <iostream>\nint main(){ std::cout << "hello from cpp\\n"; }\n' > "$work/main.cpp"
      echo "g++ -O0 main.cpp -o main && ./main" ;;
    *) die "unknown language $language" ;;
  esac
}

image_for() {
  case "$1" in
    python) echo python ;;
    javascript) echo node ;;
    java) echo jvm ;;
    haskell) echo haskell ;;
    c|cpp) echo gcc ;;
  esac
}

LANGUAGES="python javascript java haskell c cpp"

# ---------------------------------------------------------------------------
# bench
# ---------------------------------------------------------------------------
cmd_bench() {
  require_runtime
  # Timings on a shared host are only meaningful next to what else was running.
  # Record it so a results table read weeks later is still interpretable.
  say "Host conditions at the time of this run"
  row "load average" "$(cut -d' ' -f1-3 /proc/loadavg)" "(1/5/15 min, $(nproc) cores)"
  row "memory free" "$(free -h | awk '/^Mem:/ {print $7 " available of " $2}')" ""
  row "containers" "$(docker ps -q | wc -l) running" ""
  local heavy
  heavy="$(docker ps --format '{{.Names}}' | grep -iE 'mc-server|minecraft' | tr '\n' ' ' || true)"
  row "minecraft" "${heavy:-not running}" "$([ -n "$heavy" ] && echo 'expect contention' || echo 'this is the quiet case')"

  say "Cold and warm wall time under --runtime=$RUNTIME (memory=$MEMORY cpus=$CPUS)"
  printf '%-12s %10s %10s  %s\n' LANGUAGE COLD WARM RESULT
  for language in $LANGUAGES; do
    local image work script cold warm out status
    image="$(image_for "$language")"
    if ! have_image "$image"; then
      printf '%-12s %10s %10s  image %s missing — run build first\n' "$language" "-" "-" "$TAG_PREFIX-$image"
      continue
    fi
    work="$(workspace)"
    script="$(sample "$language" "$work")"

    local start
    start=$(date +%s%N)
    if out="$(sandbox "$image" "$work" "$script" 2>&1)"; then status="ok"; else status="FAILED"; fi
    cold=$(( ($(date +%s%N) - start) / 1000000 ))

    discard_workspace "$work"; work="$(workspace)"; script="$(sample "$language" "$work")"
    start=$(date +%s%N)
    sandbox "$image" "$work" "$script" >/dev/null 2>&1 || true
    warm=$(( ($(date +%s%N) - start) / 1000000 ))

    local detail
    detail="$(printf '%s' "$out" | tail -1)"
    [ "$status" = ok ] || detail="FAILED: $detail"
    printf '%-12s %9dms %9dms  %s\n' "$language" "$cold" "$warm" "$detail"
    discard_workspace "$work"
  done
  echo
  echo "Warm time is what a user feels. Anything over ~5s needs a visible"
  echo "queued/running state in the editor rather than a spinner."
}

# ---------------------------------------------------------------------------
# isolation — the tests that decide whether this host is safe, not just fast
# ---------------------------------------------------------------------------
check() { # $1 label  $2 expected(pass|fail)  $3.. command
  local label="$1" expect="$2"; shift 2
  # $4 is the image name whenever the command is `sandbox <image> ...`.
  if [ "${1:-}" = sandbox ] && ! have_image "${2:-}"; then
    printf '  \033[33mSKIP\033[0m %s (image %s-%s missing)\n' "$label" "$TAG_PREFIX" "${2:-}"
    return 0
  fi
  local got="pass" out
  out="$("$@" 2>&1)" || got="fail"
  if [ "$got" = "$expect" ]; then
    printf '  \033[32mOK\033[0m   %s\n' "$label"
  else
    printf '  \033[31mBAD\033[0m  %s (expected to %s, did %s)\n' "$label" "$expect" "$got"
    # Without this a failure is undiagnosable and costs a whole round trip.
    printf '%s\n' "$out" | tail -4 | sed 's/^/         | /'
  fi
}

cmd_isolation() {
  require_runtime
  local work; work="$(workspace)"
  trap 'discard_workspace "$work"' RETURN

  say "Isolation"
  check "outbound network is denied" fail \
    sandbox python "$work" "python3 -c 'import socket;socket.create_connection((\"1.1.1.1\",80),3)'"
  check "DNS is unavailable" fail \
    sandbox python "$work" "getent hosts example.com"
  check "root filesystem is read-only" fail \
    sandbox python "$work" "touch /etc/proof"
  check "workspace is writable" pass \
    sandbox python "$work" "touch /w/proof && rm /w/proof"
  check "job runs unprivileged" pass \
    sandbox python "$work" "test \"\$(id -u)\" -ne 0"
  check "privilege escalation is off" pass \
    sandbox python "$work" "grep -q 'NoNewPrivs:\s*1' /proc/self/status"
  check "fork bomb hits the pid limit" fail \
    sandbox python "$work" "python3 -c 'import os
while True: os.fork()'"
  check "memory hog is killed" fail \
    sandbox python "$work" "python3 -c 'b=bytearray()
while True: b.extend(bytes(10_000_000))'"
  check "runaway loop is killed by the timeout" fail \
    sandbox python "$work" "while true; do :; done"
  check "kernel is gVisor, not the host" pass \
    sandbox python "$work" "uname -a | grep -qi gvisor"

  say "Cancellation and cleanup"
  local name="$TAG_PREFIX-cancel-$$"
  docker run -d --rm --name "$name" --runtime="$RUNTIME" --network=none \
    --memory="$MEMORY" --pids-limit="$PIDS" "$TAG_PREFIX-python" \
    bash -lc "sleep 300" >/dev/null
  sleep 2
  if docker kill "$name" >/dev/null 2>&1; then
    printf '  \033[32mOK\033[0m   a running job can be killed mid-execution\n'
  else
    printf '  \033[31mBAD\033[0m  could not kill a running job\n'
  fi
  sleep 2
  if [ -z "$(docker ps -aq --filter "name=$TAG_PREFIX-" )" ]; then
    printf '  \033[32mOK\033[0m   no container survives the job\n'
  else
    printf '  \033[31mBAD\033[0m  leftover containers: %s\n' "$(docker ps -a --filter "name=$TAG_PREFIX-" --format '{{.Names}}' | tr '\n' ' ')"
  fi
}

# ---------------------------------------------------------------------------
# format — the native formatters (Prettier stays in the browser; C# execution dropped)
# ---------------------------------------------------------------------------
cmd_format() {
  require_runtime
  say "Native formatters"
  local work; work="$(workspace)"
  trap 'discard_workspace "$work"' RETURN

  printf 'x   =  1\ndef  f( a ):\n  return  a\n' > "$work/main.py"
  printf 'public class Main{public static void main(String[] a){System.out.println( 1 );}}\n' > "$work/Main.java"
  printf 'main::IO ()\nmain   =  putStrLn    "x"\n' > "$work/Main.hs"
  printf 'int  main( void ){return   0;}\n' > "$work/main.c"
  printf 'int  main( ){return   0;}\n' > "$work/main.cpp"
  # A formatter rewrites its input in place, and these files are created by the
  # host user while the job runs as uid 10001 — so without this every formatter
  # that opens the file for writing gets EACCES. clang-format was the only one
  # that passed before, because it writes a temp file and renames, which needs
  # permission on the directory (0777) rather than on the file.
  chmod 0666 "$work"/*

  check "ruff (python)" pass sandbox python "$work" "ruff format main.py"
  check "google-java-format (java)" pass sandbox jvm "$work" "\$GJF_CMD --replace Main.java"
  check "ormolu (haskell)" pass sandbox haskell "$work" "ormolu --mode inplace Main.hs"
  check "clang-format (c)" pass sandbox gcc "$work" "clang-format -i main.c"
  check "clang-format (c++)" pass sandbox gcc "$work" "clang-format -i main.cpp"

  say "Formatted output (each should differ from the mangled input)"
  for file in main.py Main.java Main.hs main.c; do
    printf '\n--- %s\n' "$file"
    cat "$work/$file"
  done
}

# Base images this proof pulls. Listed explicitly rather than pruned, because
# this host runs four unrelated projects and a blanket `docker system prune`
# would take their layers with it.
BASE_IMAGES="python:3.12-slim node:22-slim eclipse-temurin:21-jdk gcc:14 haskell:9.6 debian:bookworm-slim"

cmd_clean() {
  local before after
  before="$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)"

  say "Containers"
  docker ps -aq --filter "name=$TAG_PREFIX-" | xargs -r docker rm -f

  say "Proof images"
  for image in $IMAGES; do
    docker rmi -f "$TAG_PREFIX-$image" >/dev/null 2>&1 && row "$image" removed "" || row "$image" "not present" ""
  done

  # Every Dockerfile edit leaves the previous build untagged. These accumulate
  # quietly and are invisible to the loop above, which only knows current tags.
  say "Dangling layers from these builds"
  local dangling
  dangling="$(docker images -f dangling=true -q | wc -l)"
  if [ "$dangling" -gt 0 ]; then
    docker image prune -f | tail -1
  else
    echo "none"
  fi

  say "Leftover workspaces"
  rm -rf "${TMPDIR:-/tmp}"/vault-proof.* 2>/dev/null || true
  local stale
  stale="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'vault-proof.*' 2>/dev/null | wc -l)"
  [ "$stale" -eq 0 ] && echo "none" || echo "$stale left (job-owned files; sudo rm -rf ${TMPDIR:-/tmp}/vault-proof.*)"

  if [ "${1:-}" = bases ]; then
    say "Base images"
    for image in $BASE_IMAGES; do
      docker rmi "$image" >/dev/null 2>&1 && row "$image" removed "" || row "$image" "in use or absent" ""
    done
  else
    say "Base images kept"
    for image in $BASE_IMAGES; do
      row "$image" "$(docker image inspect "$image" --format '{{.Size}}' 2>/dev/null \
        | awk '{printf "%.2f GB", $1/1024/1024/1024}' || echo absent)" ""
    done
    echo
    echo "These are most of the disk. Remove them with: ./runner/proof.sh clean bases"
  fi

  after="$(docker system df --format '{{.Size}}' 2>/dev/null | head -1)"
  say "Docker image usage: $before -> $after"
  echo "Vault's own containers and images were not touched."
}

case "${1:-probe}" in
  probe) cmd_probe ;;
  build) cmd_build ;;
  bench) cmd_bench ;;
  isolation) cmd_isolation ;;
  format) cmd_format ;;
  clean) cmd_clean ;;
  all) cmd_build; cmd_bench; cmd_isolation; cmd_format ;;
  *) die "unknown command '$1' — see the header of this file" ;;
esac
