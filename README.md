# Vault

Vault is a self-hosted collaborative document platform with OAuth login, rich-text editing, private/public publishing, friend-based sharing, and server-enforced document permissions.

Live target:

```txt
https://vault.ems-place.com
```

## Features

- GitHub OAuth with Auth.js and database-backed sessions.
- PostgreSQL persistence through Drizzle ORM.
- Tiptap rich-text editing stored as ProseMirror JSONB.
- Autosave plus manual save status in the editor.
- Real-time collaborative editing for authorized owner/editor sessions.
- Live collaborator caret presence.
- Private documents with server-side read/write/share checks.
- Owner/editor/viewer document roles.
- Friend requests and friend-based sharing.
- Public read-only document publishing through stable slugs.
- Dockerized production app and Postgres services.
- GitHub Actions entrypoint for server-side deployment.
- Health endpoint for service and database checks.

## Architecture

```txt
Browser
  |
  | HTTPS
  v
Cloudflare DNS
  |
  v
DigitalOcean VPS
  |
  | Caddy reverse proxy
  v
FRP tunnel
  |
  v
Mini-PC Docker Compose
  |
  +-- vault-web
  +-- vault-postgres
  +-- vault-collab
```

The main app is a Next.js App Router project. Server components and server actions handle authenticated document reads, writes, sharing, publishing, and dashboard data. PostgreSQL stores users, sessions, documents, collaborator roles, friend requests, friendships, and public slugs. A separate Hocuspocus/Yjs service handles live document rooms and persists collaborative document state back to PostgreSQL.

## Security Model

Vault treats document authorization as a server-side concern. Every private document read or write goes through the session user and permission helpers before returning content or mutating data. Inaccessible private documents return a not-found response to avoid leaking document existence. Public documents are served only through the dedicated read-only public route and only when visibility is explicitly set to `public`.

Roles:

```txt
owner  - read, edit, archive, share, publish
editor - read, edit
viewer - read only
```

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- Auth.js / NextAuth v5
- PostgreSQL 16
- Drizzle ORM
- Tiptap / ProseMirror / Yjs
- Hocuspocus
- Docker Compose
- Caddy, FRP, Cloudflare DNS

## Local Development

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

In a second shell, start collaboration:

```bash
npm run collab
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
NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234
ENABLE_DEV_LOGIN=true
```

For localhost work, you do not need GitHub OAuth. In non-production, `/login`
shows dev-only buttons for `Dev owner` and `Dev collaborator`. Those buttons
create normal database-backed Auth.js sessions, so dashboard, document
permissions, sharing, and collaboration still use the real server-side auth
path. Set `ENABLE_DEV_LOGIN=false` to hide them.

GitHub OAuth callback:

```txt
http://localhost:3000/api/auth/callback/github
```

## Production Deployment

Production is handled by GitHub Actions on a self-hosted mini-PC runner. The workflow calls a server-local deployment script at:

```txt
/opt/apps/vault/repo/scripts/deploy.sh
```

That script is intentionally server-managed for now. The repo contains the production Dockerfile and Compose file used by the deployment.

Run migrations:

```bash
docker compose -f docker-compose.production.yml --profile migrate run --rm migrate
```

Start production services:

```bash
docker compose -f docker-compose.production.yml up -d postgres collab web
```

Required production env, stored only on the server:

```env
NODE_ENV=production
NEXTAUTH_URL=https://vault.ems-place.com
AUTH_SECRET=<strong secret>
GITHUB_CLIENT_ID=<github oauth client id>
GITHUB_CLIENT_SECRET=<github oauth secret>
POSTGRES_PASSWORD=<strong password>
DATABASE_URL=postgres://vault:<password>@postgres:5432/vault
NEXT_PUBLIC_COLLAB_URL=wss://vault.ems-place.com/collab
COLLAB_PORT=1234
ENABLE_DEV_LOGIN=false
```

Production GitHub OAuth callback:

```txt
https://vault.ems-place.com/api/auth/callback/github
```

Health check:

```bash
curl https://vault.ems-place.com/api/health
```

## Backups

Create a backup:

```bash
bash scripts/backup-db.sh
```

Restore from a backup:

```bash
bash scripts/restore-db.sh backups/<backup-file>.sql
```

On Windows/PowerShell against the local dev compose file:

```powershell
$env:COMPOSE_FILE="docker-compose.yml"
$env:POSTGRES_SERVICE_NAME="postgres"
.\scripts\backup-db.ps1
```

## Portfolio Notes

Resume-ready summary:

```txt
Built and deployed Vault, a self-hosted collaborative document platform using Next.js, TypeScript, PostgreSQL, Drizzle ORM, Auth.js OAuth authentication, server-enforced role-based permissions, and a Docker/Caddy/FRP home-lab deployment pipeline.
```

Roadmap:

- Add screenshots after production flow verification.
- Add full-text search and richer document organization.
- Verify production WebSocket routing and two-user live editing.
