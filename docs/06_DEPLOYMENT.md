# Vault — Deployment Plan

## 1. Deployment Goal

Deploy Vault to:

```txt
https://vault.ems-place.com
```

Using existing infrastructure:

```txt
Cloudflare DNS
DigitalOcean VPS
Caddy on VPS
FRP tunnel to mini-PC
Docker Compose on mini-PC
```

---

## 2. Production Services

MVP:

```txt
web container: vault-web
postgres container: vault-postgres
migrate one-off container: vault-migrate
collab container: vault-collab
```

Deployments are triggered by GitHub Actions on a self-hosted mini-PC runner. The workflow in `.github/workflows/deploy.yml` resets `/opt/apps/vault/repo` to `origin/master` and runs the repo deploy script:

```txt
/opt/apps/vault/repo/scripts/deploy.sh
```

Because the workflow uses `git reset --hard origin/master`, `scripts/deploy.sh` must be committed in this repo. The current script builds `web`, `collab`, and the profile-gated `migrate` image, starts Postgres, waits for Postgres health, runs the Compose `migrate` profile with `--build`, starts `collab` and `web`, then checks `/healthz` and the local collab port. After a successful deploy, it prunes stale Docker images older than 24 hours and build cache older than 7 days. It does not prune volumes.

Important migration caveat:

```txt
The `migrate` service is behind a Compose profile. A plain `docker compose build`
may not rebuild that image, so new migration files can be missing inside the
migrate container even when the server repo is up to date. Use the deploy script
or run the migrate service with `--build`.
```

Later:

```txt
vault-redis
```

---

## 3. Production Docker Compose Shape

Example conceptual compose:

```yaml
services:
  vault-web:
    build: .
    container_name: vault-web
    restart: unless-stopped
    env_file:
      - .env.production
    depends_on:
      - vault-postgres
    ports:
      - "127.0.0.1:18210:3000"

  vault-postgres:
    image: postgres:16
    container_name: vault-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: vault
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: vault
    volumes:
      - vault_postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"

volumes:
  vault_postgres_data:
```

The real production compose also includes `collab`, built from `Dockerfile.collab`, bound to:

```txt
127.0.0.1:18211 -> container 1234
```

Do not expose Postgres publicly.

---

## 4. Dockerfile Shape

Use Next.js standalone output.

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Make sure `next.config.ts` has:

```ts
const nextConfig = {
  output: "standalone",
};
```

---

## 5. Environment Variables

`.env.production` on mini-PC only:

```env
NODE_ENV=production

NEXTAUTH_URL=https://vault.ems-place.com
AUTH_SECRET=<generate strong secret>

GITHUB_CLIENT_ID=<github oauth client id>
GITHUB_CLIENT_SECRET=<github oauth secret>
GOOGLE_CLIENT_ID=<google oauth client id>
GOOGLE_CLIENT_SECRET=<google oauth secret>

POSTGRES_PASSWORD=<strong password>
DATABASE_URL=postgres://vault:<password>@postgres:5432/vault
NEXT_PUBLIC_COLLAB_URL=wss://vault.ems-place.com/collab
COLLAB_PORT=1234
```

Do not commit `.env.production`.

Commit only:

```txt
.env.example
```

---

## 6. OAuth Production Setup

GitHub callback URL:

```txt
https://vault.ems-place.com/api/auth/callback/github
```

Google callback URL:

```txt
https://vault.ems-place.com/api/auth/callback/google
```

Homepage URL:

```txt
https://vault.ems-place.com
```

Common production bug:

```txt
OAuth works locally but fails in production because NEXTAUTH_URL or callback URL is wrong.
```

Check this first.

---

## 7. FRP Plan

You already use FRP with the VPS as public endpoint and mini-PC as client.

Conceptual flow:

```txt
VPS localhost port 18xxx
  -> FRP
  -> mini-PC localhost/container port 3000
```

Example conceptual `frpc` proxy:

```toml
[[proxies]]
name = "vault-web"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3000
remotePort = 18030
```

Then Caddy on VPS proxies:

```txt
127.0.0.1:18030
```

Adjust ports to your actual FRP config.

---

## 8. Caddy Route

On the VPS Caddyfile:

```caddy
vault.ems-place.com {
    reverse_proxy 127.0.0.1:18030
}
```

If using WebSockets later, Caddy should handle upgrades automatically.

For the collaboration service, route a WebSocket path to the collab FRP/VPS port. Conceptual example:

```caddy
vault.ems-place.com {
    reverse_proxy /collab* 127.0.0.1:18031
    reverse_proxy 127.0.0.1:18030
}
```

Use the actual FRP remote port that maps to mini-PC `127.0.0.1:18211`.

After editing Caddyfile:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

---

## 9. Cloudflare DNS

Create DNS record:

```txt
Type: A
Name: vault
Content: 174.138.112.215
Proxy: usually on is fine for web HTTPS
```

If OAuth has weird issues, temporarily test with Cloudflare proxy off, then re-enable.

---

## 10. Production Migrations

Options:

### Manual

SSH into mini-PC or deploy directory:

```bash
docker compose -f docker-compose.production.yml --profile migrate run --rm migrate
```

### Init job

Add a one-off migration command before starting the app.

For MVP, manual is fine.

---

## 11. Health Endpoint

Implement:

```txt
GET /api/health
```

`/healthz` is the lightweight container liveness endpoint. It only proves the Next.js process is responding and is appropriate for Docker healthchecks.

`/api/health` is the deeper readiness endpoint. It checks:

- App alive.
- Database reachable.

Example response:

```json
{
  "ok": true,
  "service": "vault",
  "database": "ok"
}
```

Test:

```bash
curl https://vault.ems-place.com/api/health
```

---

## 12. Backup Script

Create:

```txt
scripts/backup-db.sh
```

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="./backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

docker compose exec -T vault-postgres pg_dump \
  -U vault \
  -d vault \
  > "$BACKUP_DIR/vault_$TIMESTAMP.sql"

echo "Backup created: $BACKUP_DIR/vault_$TIMESTAMP.sql"
```

Add backup directory to `.gitignore`.

```txt
backups/
```

Later, copy backups to another machine or object storage.

---

## 13. Restore Script

Create:

```txt
scripts/restore-db.sh
```

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup.sql>"
  exit 1
fi

BACKUP_FILE="$1"

cat "$BACKUP_FILE" | docker compose exec -T vault-postgres psql \
  -U vault \
  -d vault
```

---

## 14. Deployment Checklist

| Status | Item |
|---|---|
| [x] | Production Dockerfile added |
| [x] | Production compose works locally |
| [x] | `.env.production` created on mini-PC |
| [x] | Postgres volume persists |
| [x] | Migrations run |
| [x] | FRP proxy configured |
| [x] | Caddy route configured |
| [x] | Cloudflare DNS configured |
| [x] | GitHub OAuth production callback configured |
| [ ] | Google OAuth production callback configured |
| [x] | `https://vault.ems-place.com` loads |
| [x] | Login works |
| [x] | Document create/edit works |
| [x] | Restart containers and verify data persists |
| [x] | Backup script works |
| [x] | Health endpoint works |
| [ ] | Collab WebSocket route works |
| [ ] | Two-user live editing works |

---

## 15. Common Failure Modes

### App loads but login fails

Check:

```txt
NEXTAUTH_URL
AUTH_SECRET
GitHub callback URL
Google callback URL
Cloudflare HTTPS mode
```

### Caddy gives 502

Check:

```txt
FRP tunnel up?
remotePort correct?
mini-PC container running?
Caddy reverse_proxy port correct?
```

### Database connection fails

Check:

```txt
DATABASE_URL host should be vault-postgres inside Docker network
Postgres password matches
Database initialized
Migrations ran
```

### Data disappears after restart

Check:

```txt
Postgres volume configured
Not using ephemeral container filesystem
```

### Public route works but private route leaks

Check:

```txt
Permission helper called in server component/action
No client-side only filtering
No direct public API returning private docs
```
