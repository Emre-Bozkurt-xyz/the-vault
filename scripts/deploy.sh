#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/apps/vault/repo"
COMPOSE_FILE="$APP_DIR/docker-compose.production.yml"
ENV_FILE="$APP_DIR/.env.production"
WEB_HEALTH_URL="http://127.0.0.1:18210/healthz"
COLLAB_PORT="18211"
BRANCH="master"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "[deploy] Starting Vault deployment..."

cd "$APP_DIR"

echo "[deploy] Fetching latest $BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] Checking required files..."
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[deploy] ERROR: production compose file missing at $COMPOSE_FILE"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[deploy] ERROR: .env.production missing at $ENV_FILE"
  exit 1
fi

echo "[deploy] Building images..."
dc --profile migrate build web collab migrate

echo "[deploy] Starting Postgres..."
dc up -d postgres

echo "[deploy] Waiting for Postgres health..."
for i in {1..30}; do
  if dc exec -T postgres pg_isready -U vault -d vault >/dev/null 2>&1; then
    echo "[deploy] Postgres is healthy."
    break
  fi

  if [[ "$i" == "30" ]]; then
    echo "[deploy] ERROR: Postgres did not become healthy."
    dc logs --tail=100 postgres || true
    exit 1
  fi

  echo "[deploy] Postgres not ready yet... attempt $i/30"
  sleep 2
done

echo "[deploy] Running database migrations..."
dc --profile migrate run --rm --build migrate

echo "[deploy] Starting Vault web + collab..."
dc up -d --remove-orphans collab web

echo "[deploy] Waiting for web health check..."
for i in {1..40}; do
  if curl -fsS "$WEB_HEALTH_URL" > /dev/null; then
    echo "[deploy] Vault web is healthy."
    curl -fsS "$WEB_HEALTH_URL"
    echo
    break
  fi

  if [[ "$i" == "40" ]]; then
    echo "[deploy] ERROR: web health check failed"
    echo
    echo "===== Compose state ====="
    dc ps || true
    echo
    echo "===== Web logs ====="
    dc logs --tail=200 web || true
    echo
    echo "===== Collab logs ====="
    dc logs --tail=200 collab || true
    echo
    echo "===== Postgres logs ====="
    dc logs --tail=100 postgres || true
    exit 1
  fi

  echo "[deploy] Web not healthy yet... attempt $i/40"
  sleep 2
done

echo "[deploy] Checking collab port locally..."
if nc -z 127.0.0.1 "$COLLAB_PORT"; then
  echo "[deploy] Collab port $COLLAB_PORT is reachable."
else
  echo "[deploy] WARNING: Collab port $COLLAB_PORT is not reachable from mini-PC localhost."
  echo "===== Collab logs ====="
  dc logs --tail=150 collab || true
  exit 1
fi

# Code execution (Phase 24). Off unless .env.production says otherwise, so a
# deployment that never opted in never builds the ~6.5 GB of sandbox images.
if grep -qx 'CODE_EXECUTION_ENABLED=true' "$ENV_FILE"; then
  echo "[deploy] Code execution is enabled; preparing the runner..."
  if ! docker info --format '{{json .Runtimes}}' | grep -q '"runsc"'; then
    # The worker refuses to start without gVisor anyway; failing here says why
    # in the deploy log instead of in a restart loop.
    echo "[deploy] ERROR: gVisor (runsc) is not a registered Docker runtime. See runner/README.md."
    exit 1
  fi
  bash "$APP_DIR/runner/build-images.sh"
  # Recreated every deploy so it always runs this commit's worker.mjs. A job in
  # flight gets stop_grace_period to finish; one that cannot is reported as an
  # infrastructure error and is never re-run.
  dc --profile runner up -d --build --force-recreate runner
  sleep 3
  if [[ "$(docker inspect -f '{{.State.Running}}' vault-runner 2>/dev/null)" != "true" ]]; then
    echo "[deploy] ERROR: the runner did not stay up."
    dc --profile runner logs --tail=50 runner || true
    exit 1
  fi
  dc --profile runner logs --tail=5 runner || true
else
  echo "[deploy] Code execution is disabled; making sure no runner is left running..."
  dc --profile runner rm -sf runner >/dev/null 2>&1 || true
fi

echo "[deploy] Deployment complete."
dc ps

echo "[deploy] Cleaning stale Docker images/build cache..."
docker image prune -f --filter "until=24h" || true
docker builder prune -f --filter "until=168h" || true
