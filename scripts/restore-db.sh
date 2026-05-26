#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup.sql>"
  exit 1
fi

BACKUP_FILE="$1"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
SERVICE_NAME="${POSTGRES_SERVICE_NAME:-vault-postgres}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" psql \
  -U vault \
  -d vault \
  < "$BACKUP_FILE"
