param(
  [Parameter(Mandatory = $true)]
  [string] $BackupFile
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}

$ComposeFile = if ($env:COMPOSE_FILE) { $env:COMPOSE_FILE } else { "docker-compose.production.yml" }
$ServiceName = if ($env:POSTGRES_SERVICE_NAME) { $env:POSTGRES_SERVICE_NAME } else { "vault-postgres" }

Get-Content -LiteralPath $BackupFile -Raw |
  docker compose -f $ComposeFile exec -T $ServiceName psql `
    -U vault `
    -d vault
