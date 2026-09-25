#!/usr/bin/env bash
# Build the sandbox images the runner executes jobs in. Called by
# scripts/deploy.sh on every deploy when code execution is enabled, and safe to
# run by hand.
#
# Each image is labelled with the SHA-256 of the Dockerfile it came from, and an
# image whose label still matches is skipped without touching the build cache.
# That matters because deploy.sh prunes week-old build cache: without the label
# check, a routine deploy after a quiet week would quietly re-download GHC.
#
# Usage: runner/build-images.sh [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Must match CODE_RUNNER_IMAGE_PREFIX's default in server/code-runtime.ts.
PREFIX="${CODE_RUNNER_IMAGE_PREFIX:-vault-runner-proof-}"
IMAGES="python node jvm gcc haskell"
FORCE="${1:-}"

failed=""
for image in $IMAGES; do
  dockerfile="$ROOT/images/$image.Dockerfile"
  tag="$PREFIX$image"
  want="$(sha256sum "$dockerfile" | cut -d' ' -f1)"
  have="$(docker image inspect "$tag" --format '{{ index .Config.Labels "vault.runner.dockerfile-sha" }}' 2>/dev/null || true)"

  if [[ "$FORCE" != "--force" && "$have" == "$want" ]]; then
    echo "[runner-images] $tag is current"
    continue
  fi

  echo "[runner-images] building $tag"
  if ! docker build --quiet \
      --label "vault.runner.dockerfile-sha=$want" \
      -f "$dockerfile" -t "$tag" "$ROOT/images" >/dev/null; then
    failed="$failed $image"
  fi
done

if [[ -n "$failed" ]]; then
  echo "[runner-images] ERROR: failed to build:$failed" >&2
  exit 1
fi
echo "[runner-images] all images ready"
