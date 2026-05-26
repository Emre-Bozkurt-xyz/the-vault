$ErrorActionPreference = "Stop"

$BackupDir = "./backups"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ComposeFile = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { "docker-compose.production.yml" }
$ServiceName = if ($env:POSTGRES_SERVICE_NAME) { $env:POSTGRES_SERVICE_NAME } else { "vault-postgres" }
$BackupFile = Join-Path $BackupDir "vault_$Timestamp.sql"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

docker compose -f $ComposeFile exec -T $ServiceName pg_dump `
  -U vault `
  -d vault `
  | Out-File -FilePath $BackupFile -Encoding utf8

Write-Output "Backup created: $BackupFile"
