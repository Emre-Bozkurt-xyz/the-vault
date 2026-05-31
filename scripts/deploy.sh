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
dc build

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
dc --profile migrate run --rm migrate

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

echo "[deploy] Deployment complete."
dc ps