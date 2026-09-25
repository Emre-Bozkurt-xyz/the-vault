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
#   ./runner/proof.sh format      the five native formatters
#   ./runner/proof.sh clean       remove everything this script created
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
IMAGES="python node jvm gcc haskell dotnet"

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
    row "runsc" "$(runsc --version | head -1 | sed 's/^runsc version //')" ""
  else
    row "runsc" "NOT INSTALLED" "see runner/README.md"
  fi
  if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q runsc; then
    row "runtime" "registered with docker" ""
    # systrap is the modern default and is substantially faster than ptrace.
    # A mid-range CPU running ptrace will look far worse than it should.
    local platform
    platform="$(docker run --rm --runtime=runsc alpine:3 dmesg 2>/dev/null \
      | grep -oiE 'platform (systrap|kvm|ptrace)' | head -1 || true)"
    row "platform" "${platform:-could not detect}" ""
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
  for image in $IMAGES; do
    say "Building $image"
    docker build -f "$ROOT/images/$image.Dockerfile" -t "$TAG_PREFIX-$image" "$ROOT/images"
  done
  say "Image sizes"
  for image in $IMAGES; do
    row "$image" "$(docker image inspect "$TAG_PREFIX-$image" --format '{{.Size}}' \
      | awk '{printf "%.2f GB", $1/1024/1024/1024}')" ""
  done
}

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
    "$@" \
    "$TAG_PREFIX-$image" \
    timeout --signal=KILL "$TIMEOUT" bash -lc "$script"
}

workspace() { mktemp -d "${TMPDIR:-/tmp}/vault-proof.XXXXXX"; }

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
    csharp)
      # Named job.cs, not Program.cs: the host-owned template ships its own
      # Program.cs and the copy below would otherwise clobber the job's file.
      printf 'System.Console.WriteLine("hello from csharp");\n' > "$work/job.cs"
      # obj/bin are discarded because the template's restore wrote absolute
      # paths under /opt/project. The re-restore is offline, out of the image's
      # NUGET_PACKAGES cache.
      echo "cp -r /opt/project/. . && cp job.cs Program.cs && rm -rf obj bin && dotnet build -c Release -v q --nologo >/dev/null && dotnet bin/Release/net8.0/app.dll" ;;
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
    csharp) echo dotnet ;;
  esac
}

LANGUAGES="python javascript java haskell c cpp csharp"

# ---------------------------------------------------------------------------
# bench
# ---------------------------------------------------------------------------
cmd_bench() {
  require_runtime
  say "Cold and warm wall time under --runtime=$RUNTIME (memory=$MEMORY cpus=$CPUS)"
  printf '%-12s %10s %10s  %s\n' LANGUAGE COLD WARM RESULT
  for language in $LANGUAGES; do
    local image work script cold warm out status
    image="$(image_for "$language")"
    work="$(workspace)"
    script="$(sample "$language" "$work")"

    local start
    start=$(date +%s%N)
    if out="$(sandbox "$image" "$work" "$script" 2>&1)"; then status="ok"; else status="FAILED"; fi
    cold=$(( ($(date +%s%N) - start) / 1000000 ))

    rm -rf "$work"; work="$(workspace)"; script="$(sample "$language" "$work")"
    start=$(date +%s%N)
    sandbox "$image" "$work" "$script" >/dev/null 2>&1 || true
    warm=$(( ($(date +%s%N) - start) / 1000000 ))

    local detail
    detail="$(printf '%s' "$out" | tail -1)"
    [ "$status" = ok ] || detail="FAILED: $detail"
    printf '%-12s %9dms %9dms  %s\n' "$language" "$cold" "$warm" "$detail"
    rm -rf "$work"
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
  local got="pass"
  "$@" >/dev/null 2>&1 || got="fail"
  if [ "$got" = "$expect" ]; then
    printf '  \033[32mOK\033[0m   %s\n' "$label"
  else
    printf '  \033[31mBAD\033[0m  %s (expected to %s, did %s)\n' "$label" "$expect" "$got"
  fi
}

cmd_isolation() {
  require_runtime
  local work; work="$(workspace)"
  trap 'rm -rf "$work"' RETURN

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
# format — the five native formatters (Prettier stays in the browser)
# ---------------------------------------------------------------------------
cmd_format() {
  require_runtime
  say "Native formatters"
  local work; work="$(workspace)"
  trap 'rm -rf "$work"' RETURN

  printf 'x   =  1\ndef  f( a ):\n  return  a\n' > "$work/main.py"
  check "ruff (python)" pass sandbox python "$work" "ruff format main.py"

  printf 'public class Main{public static void main(String[] a){System.out.println( 1 );}}\n' > "$work/Main.java"
  check "google-java-format (java)" pass sandbox jvm "$work" "\$GJF_CMD --replace Main.java"

  printf 'main::IO ()\nmain   =  putStrLn    "x"\n' > "$work/Main.hs"
  check "ormolu (haskell)" pass sandbox haskell "$work" "ormolu --mode inplace Main.hs"

  printf 'int  main( void ){return   0;}\n' > "$work/main.c"
  check "clang-format (c)" pass sandbox gcc "$work" "clang-format -i main.c"

  printf 'int  main( ){return   0;}\n' > "$work/main.cpp"
  check "clang-format (c++)" pass sandbox gcc "$work" "clang-format -i main.cpp"

  printf 'class P{static void Main(){System.Console.WriteLine( 1 );}}\n' > "$work/Program.cs"
  check "csharpier (c#)" pass sandbox dotnet "$work" "csharpier format Program.cs"

  say "Formatted output"
  cat "$work/main.py"
}

cmd_clean() {
  say "Removing proof containers and images"
  docker ps -aq --filter "name=$TAG_PREFIX-" | xargs -r docker rm -f
  for image in $IMAGES; do docker rmi -f "$TAG_PREFIX-$image" 2>/dev/null || true; done
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
