# Vault

Vault is a self-hosted collaborative document and note platform.

Current MVP features:

- GitHub OAuth with Auth.js.
- PostgreSQL persistence with Drizzle ORM.
- Private documents with server-side permission checks.
- Tiptap rich-text editing stored as ProseMirror JSONB.
- Viewer/editor/owner document roles.
- Basic document sharing and friend requests.
- Public read-only document publishing.
- Docker Compose local Postgres and production deployment scaffolding.

## Local Development

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Open:

```txt
http://localhost:3000
```

Required local env:

```env
DATABASE_URL=postgres://vault:vault@localhost:5432/vault
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=<local secret>
GITHUB_CLIENT_ID=<github oauth client id>
GITHUB_CLIENT_SECRET=<github oauth secret>
```

GitHub OAuth callback:

```txt
http://localhost:3000/api/auth/callback/github
```

## Production Shape

Production target:

```txt
https://vault.ems-place.com
```

Services:

- `vault-web`
- `vault-postgres`
- `vault-migrate` one-off migration profile

Run migrations:

```bash
docker compose -f docker-compose.production.yml --profile migrate run --rm vault-migrate
```

Start production services:

```bash
docker compose -f docker-compose.production.yml up -d vault-postgres vault-web
```

Create a backup:

```bash
bash scripts/backup-db.sh
```

On Windows/PowerShell against the local dev compose file:

```powershell
$env:COMPOSE_FILE="docker-compose.yml"
$env:POSTGRES_SERVICE_NAME="postgres"
.\scripts\backup-db.ps1
```
