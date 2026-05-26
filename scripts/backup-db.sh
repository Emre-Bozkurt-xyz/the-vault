#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="./backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
SERVICE_NAME="${POSTGRES_SERVICE_NAME:-vault-postgres}"

mkdir -p "$BACKUP_DIR"

docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" pg_dump \
  -U vault \
  -d vault \
  > "$BACKUP_DIR/vault_$TIMESTAMP.sql"

echo "Backup created: $BACKUP_DIR/vault_$TIMESTAMP.sql"
