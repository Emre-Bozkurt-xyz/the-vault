# Vault — Project Knowledge

This file is the living source of truth for the **actual current codebase**.

Planning docs describe the intended system. This file describes what really exists right now.

Update this file whenever the codebase changes in a meaningful way.

---

## 1. Current Status Snapshot

Last updated:

```txt
2026-05-31
```

Current phase:

```txt
Phase 6 - Deployment verification and MVP polish
```

Current deployment status:

```txt
GitHub Actions deploy workflow works on the production server, the production domain works, OAuth works, document create/edit works, and Postgres data persists across redeploys.
```

Current MVP status:

```txt
In progress
```

One-sentence current reality:

```txt
Vault currently has a runnable dark-first Next.js app shell, switchable theming, GitHub Auth.js wiring, Dockerized Postgres, Tiptap document editing with autosave, document sharing, public publishing, friend requests, server-side permission helpers, a protected dashboard, health endpoints, GitHub Actions deployment wiring, and a first Yjs/Hocuspocus collaborative editing service.
```

---

## 2. Tech Stack Actually Used

Update this as dependencies are added.

```txt
Frontend:
  - Next.js 16 App Router
  - React 19
  - TypeScript
  - Tailwind CSS v4
  - shadcn/ui
  - next-themes

Backend:
  - Next.js Route Handlers

Database:
  - PostgreSQL 16 via Docker Compose

ORM:
  - Drizzle ORM with schema and migrations

Auth:
  - Auth.js / NextAuth v5 beta
  - GitHub OAuth provider configured
  - Drizzle adapter with database sessions

Editor:
  - Tiptap
  - ProseMirror JSON stored in Postgres JSONB
  - Debounced autosave plus manual save

Realtime collaboration:
  - Yjs + Hocuspocus service for owner/editor live editing
  - Collaboration caret presence
  - ProseMirror JSON persistence back to Postgres

Deployment:
  - Production Docker/Compose scaffolding
  - GitHub Actions workflow targeting a self-hosted mini-PC runner
  - Separate `vault-collab` container scaffold
```

Notes:

```txt
- `next.config.ts` enables standalone output for the future production Dockerfile.
- `shadcn@4.8.0` initialized with the default Base/Nova preset, which uses Base UI primitives. Its Button does not support `asChild`; use `buttonVariants()` for styled links.
- Theme behavior is dark-first and switchable. `next-themes` controls the root `class`; page styling should use shadcn/Tailwind theme tokens instead of hard-coded light/dark colors.
- Auth uses `next-auth@5.0.0-beta.31` because the current App Router API exposes `auth`, `handlers`, `signIn`, and `signOut` from the root `auth.ts`.
```

---

## 3. Repo Structure

Current important directories/files:

```txt
vault/
  app/
    api/auth/[...nextauth]/
    api/health/
    dashboard/
      friends/
      settings/
    docs/[docId]/
    healthz/
    login/
    public/[slug]/
  components/
    editor/
    theme-provider.tsx
    theme-toggle.tsx
    ui/
  db/
  lib/
  server/
  docs/
  public/
  scripts/
  .github/workflows/
```

Add notes as real files appear:

| Path | Purpose |
|---|---|
| `app/` | Next.js routes |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js route handlers |
| `app/api/health/route.ts` | App/database health check route |
| `app/dashboard/page.tsx` | Server-protected dashboard with owned/shared/public document sections |
| `app/dashboard/friends/page.tsx` | Protected friend request/friend list page |
| `app/dashboard/settings/page.tsx` | Protected account/settings page |
| `app/docs/[docId]/page.tsx` | Protected document edit/view route |
| `app/healthz/route.ts` | Lightweight app-only health route |
| `app/login/page.tsx` | GitHub OAuth sign-in page |
| `app/public/[slug]/page.tsx` | Anonymous public read-only document route |
| `.github/workflows/deploy.yml` | Production deploy workflow for the self-hosted mini-PC runner |
| `app/loading.tsx` | Global loading skeleton |
| `app/not-found.tsx` | Global not-found page for missing/private/unpublished docs |
| `app/error.tsx` | Global recoverable error page |
| `components/` | Shared UI components |
| `components/copy-public-link.tsx` | Client-side copy public URL button |
| `components/editor/VaultEditor.tsx` | Tiptap editor with autosave and optional collaboration provider |
| `components/editor/EditorToolbar.tsx` | Tiptap toolbar controls |
| `components/editor/ReadOnlyDocument.tsx` | ProseMirror JSON read-only renderer |
| `components/editor/editor-extensions.ts` | Tiptap extension configuration |
| `components/theme-provider.tsx` | Root client theme provider using `next-themes` |
| `components/theme-toggle.tsx` | Dark/light icon toggle |
| `components/ui/` | shadcn/ui components |
| `db/` | Database client/schema/migrations |
| `db/index.ts` | Drizzle/Postgres client |
| `db/schema.ts` | Auth, document, and document permission schema |
| `lib/` | Shared helpers |
| `lib/auth.ts` | Re-export of auth helpers for app imports |
| `lib/collab-token.ts` | Signed room token creation/verification for collaboration |
| `lib/editor-content.ts` | ProseMirror JSON types and validation helpers |
| `lib/permissions.ts` | Server-side document access helpers |
| `lib/slug.ts` | Public slug generation helper |
| `lib/utils.ts` | shadcn utility for class merging |
| `server/documents.ts` | Document server actions and queries |
| `server/friends.ts` | Friend request and friendship server actions/queries |
| `auth.ts` | Auth.js configuration, Drizzle adapter, GitHub provider, session callback |
| `scripts/collab-server.mjs` | Hocuspocus/Yjs collaboration websocket service |
| `docs/` | Planning and project knowledge |
| `docker-compose.yml` | Local Postgres service |
| `docker-compose.production.yml` | Production web/postgres/migration compose file with `/healthz` container liveness healthcheck |
| `Dockerfile` | Production standalone Next.js image |
| `Dockerfile.collab` | Production collaboration service image |
| `scripts/backup-db.sh` | Bash Postgres backup script |
| `scripts/backup-db.ps1` | PowerShell Postgres backup script |
| `scripts/restore-db.sh` | Bash Postgres restore script |
| `scripts/restore-db.ps1` | PowerShell Postgres restore script |
| `.env.example` | Committed placeholder environment values |

---

## 4. Environment Variables

### Local

```env
DATABASE_URL=postgres://vault:vault@localhost:5432/vault
AUTH_SECRET=replace-with-a-generated-secret
NEXTAUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=replace-with-github-oauth-client-id
GITHUB_CLIENT_SECRET=replace-with-github-oauth-client-secret
NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234
COLLAB_PORT=1234
```

### Production

```env
# Add production env vars here, but never commit real secret values
```

Rules:

- Do not store real secrets in this file.
- Use placeholder values only.
- Record what each variable is for.

| Variable | Required? | Used by | Purpose |
|---|---:|---|---|
| `DATABASE_URL` | Yes | App/Drizzle | PostgreSQL connection |
| `AUTH_SECRET` | Yes | Auth.js | Session/auth secret |
| `NEXTAUTH_URL` | Yes | Auth.js | Public app URL |
| `GITHUB_CLIENT_ID` | Yes | Auth.js | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | Yes | Auth.js | GitHub OAuth secret |
| `NEXT_PUBLIC_COLLAB_URL` | Optional | Editor | WebSocket URL for live collaboration; when absent, editor falls back to normal autosave |
| `COLLAB_PORT` | Optional | Collab service | Internal Hocuspocus listen port, default `1234` |

---

## 5. Database State

Current database engine:

```txt
PostgreSQL 16 via `docker compose up -d postgres`
```

Current ORM:

```txt
Drizzle ORM configured
```

Current tables:

| Table | Exists? | Purpose |
|---|---:|---|
| `users` | Yes | Auth users |
| `accounts` | Yes | OAuth accounts |
| `sessions` | Yes | Auth sessions |
| `verification_tokens` | Yes | Email login tokens |
| `documents` | Yes | Documents/notes |
| `document_permissions` | Yes | Per-document access |
| `friend_requests` | Yes | Friend request workflow |
| `friendships` | Yes | Accepted friendships |

Current migrations:

| Migration | Purpose | Applied locally? | Applied production? |
|---|---|---:|---:|
| `0000_closed_jackal.sql` | Auth.js users/accounts/sessions/verification_tokens | Yes | No |
| `0001_black_barracuda.sql` | Documents and document_permissions | Yes | No |
| `0002_sturdy_archangel.sql` | Friend requests and friendships | Yes | No |

Schema notes:

```txt
- `db/schema.ts` currently defines Auth.js tables, documents, document_permissions, friend_requests, and friendships.
- `documents.content` stores ProseMirror-style JSONB, even while the UI is temporarily a textarea.
- Owners are stored both as `documents.owner_id` and as an owner row in `document_permissions`.
- `/api/health` uses `select 1` and does not require any application tables.
```

---

## 6. Auth Implementation

Current auth status:

```txt
Implemented structurally; real GitHub login still requires OAuth credentials in `.env.local`.
```

Provider(s):

```txt
GitHub
```

Important files:

| Path | Purpose |
|---|---|
| `auth.ts` | Auth.js config, provider, adapter, session callback |
| `app/api/auth/[...nextauth]/route.ts` | GET/POST route handlers |
| `app/login/page.tsx` | Sign-in UI and GitHub sign-in action |
| `app/dashboard/page.tsx` | Protected route and sign-out action |
| `types/next-auth.d.ts` | Adds `session.user.id` to TypeScript session type |

Session shape:

```ts
session.user.id: string
session.user.email?: string | null
session.user.name?: string | null
session.user.image?: string | null
```

Known auth caveats:

```txt
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_SECRET`, and `NEXTAUTH_URL` must be set in `.env.local` before real sign-in will work.
- GitHub OAuth app callback for local dev must be `http://localhost:3000/api/auth/callback/github`.
- The provider config uses placeholder fallback strings only so builds succeed before secrets are configured; those are not valid credentials.
- `auth.ts` uses a development-only fallback `AUTH_SECRET` so logged-out auth routes can run locally before `.env.local` exists. Production must provide a real `AUTH_SECRET`.
```

Manual auth tests performed:

| Test | Result | Date |
|---|---|---|
| Logged-out `/dashboard` redirects to `/login` | Passed | 2026-05-26 |
| `/login` renders | Passed | 2026-05-26 |
| `/api/auth/session` returns `null` when logged out | Passed | 2026-05-26 |
| Auth tables exist after migration | Passed | 2026-05-26 |

---

## 7. Permission Model Implementation

Current permission status:

```txt
Implemented for document read/edit/share/delete/publish checks.
```

Roles currently supported:

```txt
owner
editor
viewer
```

Important files:

| Path | Purpose |
|---|---|
| `lib/permissions.ts` | Permission helpers, once created |

Current permission helpers:

```txt
getDocumentAccess(userId, documentId)
canReadDocument(userId, documentId)
canEditDocument(userId, documentId)
canShareDocument(userId, documentId)
canDeleteDocument(userId, documentId)
canPublishDocument(userId, documentId)
```

Rules currently enforced:

| Rule | Enforced? | Where |
|---|---:|---|
| Owner can read own document | Yes | `lib/permissions.ts`, `server/documents.ts` |
| Owner can edit own document | Yes | `lib/permissions.ts`, `server/documents.ts` |
| Editor can edit shared document | Yes | `lib/permissions.ts`, `server/documents.ts` |
| Viewer can only read shared document | Yes | `lib/permissions.ts`, document route renders read-only |
| Unauthorized users cannot read private docs | Yes | `getDocumentForUser()` returns null and route calls `notFound()` |
| Only owner can share | Yes | `shareDocumentAction()`, role update/remove actions |
| Only owner can publish | Yes | `publishDocumentAction()`, `unpublishDocumentAction()` |

Known permission caveats:

```txt
-
```

Manual permission tests performed:

| Test | Result | Date |
|---|---|---|
|  |  |  |

---

## 8. Document System

Current document status:

```txt
Basic private document CRUD, sharing, and public publishing are implemented.
```

Document storage format:

```txt
ProseMirror-style JSONB
```

Important files:

| Path | Purpose |
|---|---|
| `db/schema.ts` | `documents` and `document_permissions` tables |
| `server/documents.ts` | Create, update, archive, list, and fetch document functions |
| `app/dashboard/page.tsx` | Owned document list and create form |
| `app/docs/[docId]/page.tsx` | Protected editor/viewer route |
| `lib/editor-content.ts` | ProseMirror JSON types and validation |

Current document actions:

```txt
createDocumentAction()
updateDocumentAction()
archiveDocumentAction()
shareDocumentAction()
shareDocumentWithFriendAction()
updateCollaboratorRoleAction()
removeCollaboratorAction()
publishDocumentAction()
unpublishDocumentAction()
listDocumentsForUser()
listSharedDocumentsForUser()
listPublishedDocumentsForUser()
getDocumentForUser()
getPublicDocumentBySlug()
```

Current routes:

| Route | Status | Purpose |
|---|---|---|
| `/` | Implemented | Public homepage/app shell |
| `/login` | Implemented | GitHub OAuth sign-in |
| `/api/auth/[...nextauth]` | Implemented | Auth.js handlers |
| `/api/health` | Implemented | App and database health check |
| `/healthz` | Implemented | App-only lightweight health check |
| `/dashboard` | Protected placeholder | Server-side auth guard redirects logged-out users to `/login` |
| `/dashboard/friends` | Implemented | Friend request and friend list page |
| `/dashboard/settings` | Implemented | Account/settings page |
| `/docs/[docId]` | Implemented | Protected document editor/viewer |
| `/public/[slug]` | Implemented | Public read-only document page |

Known document caveats:

```txt
-
```

---

## 9. Editor Implementation

Current editor status:

```txt
Tiptap editor implemented with debounced autosave and manual save.
```

Editor library:

```txt
Tiptap
```

Important files:

| Path | Purpose |
|---|---|
| `app/docs/[docId]/page.tsx` | Protected editor/viewer route |
| `components/editor/VaultEditor.tsx` | Editable Tiptap document component |
| `components/editor/EditorToolbar.tsx` | Formatting toolbar |
| `components/editor/ReadOnlyDocument.tsx` | Read-only renderer for viewer/public pages |
| `lib/editor-content.ts` | ProseMirror JSON validation/types |

Supported editor features:

| Feature | Supported? |
|---|---:|
| Paragraph | Yes |
| Heading | Yes |
| Bold | Yes |
| Italic | Yes |
| Bullet list | Yes |
| Ordered list | Yes |
| Code block | Yes |
| Blockquote | Yes |
| Link | Partial |
| Read-only mode | Yes |
| Save status | Saved/saving/unsaved/error status |
| Autosave | Yes |

Known editor caveats:

```txt
- Autosave is debounced and writes through the same server-side permission checks as manual save.
- Link editing UI is not implemented yet, but Tiptap autolink is enabled and read-only rendering supports link marks.
```

---

## 10. Collaboration Implementation

Current collaboration status:

```txt
First working Yjs/Hocuspocus slice is implemented for authenticated owner/editor sessions.
```

Important files:

| Path | Purpose |
|---|---|
| `scripts/collab-server.mjs` | Hocuspocus websocket service |
| `lib/collab-token.ts` | Signed room token helper |
| `components/editor/VaultEditor.tsx` | Creates Hocuspocus provider and Tiptap Collaboration extensions |
| `Dockerfile.collab` | Production collab service image |
| `docker-compose.production.yml` | Adds `collab` service on `127.0.0.1:18211` |

Current behavior:

```txt
- Only owner/editor document sessions receive a collaboration token.
- Token includes document id, user id, role, display identity, expiry, and HMAC signature.
- Collab service validates the token and re-checks current database edit permission before room access.
- Hocuspocus loads existing `documents.content` into a Y.Doc.
- Hocuspocus stores collaborative document state back to `documents.content` as ProseMirror JSON.
- Viewer/public routes remain read-only and do not connect to the collaboration service.
```

Known collaboration caveats:

```txt
- Caddy/FRP WebSocket route for `/collab` still needs production verification.
- Two-browser/two-user live editing still needs manual verification.
- Title editing is still saved through the normal document autosave path, not collaborative Yjs state.
- Yjs update-history tables are not implemented; current persistence stores compact ProseMirror JSON.
```

---

## 11. Friend System

Current friend system status:

```txt
Implemented with exact-email requests, accept/reject, friend list, remove friend, and friend-aware document sharing.
```

Important files:

| Path | Purpose |
|---|---|
| `db/schema.ts` | `friend_requests` and `friendships` tables |
| `server/friends.ts` | Friend request and friendship actions/queries |
| `app/dashboard/friends/page.tsx` | Friend management UI |

Current friend actions:

```txt
sendFriendRequestAction()
acceptFriendRequestAction()
rejectFriendRequestAction()
removeFriendAction()
listFriendPageData()
listFriendsForUser()
```

Known friend system caveats:

```txt
- User lookup is exact email only, not fuzzy search.
- Friend-based document sharing verifies friendship server-side before granting access.
```

---

## 12. Public Notes

Current public notes status:

```txt
Implemented for owner-published documents.
```

Public route:

```txt
/public/[slug]
```

Current behavior:

```txt
- Owner can publish/unpublish a document from the document page.
- Publishing generates a stable `public_slug` if one does not already exist.
- Unpublishing keeps the slug reserved and sets visibility back to private.
- `/public/[slug]` selects only title/content/updated_at for public, non-deleted documents.
- Public documents show a badge in dashboard/editor views.
- Published documents expose a copy-link button in the editor.
```

Known public note caveats:

```txt
-
```

---

## 13. Deployment Knowledge

Current deployment status:

```txt
GitHub Actions deploy workflow exists and calls a server-local mini-PC deploy script; production flow still needs manual verification.
```

Production domain:

```txt
https://vault.ems-place.com
```

Current services:

| Service | Location | Port | Status |
|---|---|---:|---|
| `vault-web` | local dev / mini-PC Docker | 3000 in container, `127.0.0.1:18210` host bind | Runs with `npm run dev`; production image builds |
| `vault-postgres` | local Docker / mini-PC Docker | 5432 internal | Created for local dev and production compose |
| `vault-migrate` | mini-PC Docker | n/a | Production compose profile for `npm run db:migrate` |
| `vault-collab` | mini-PC Docker | 1234 in container, `127.0.0.1:18211` host bind | Hocuspocus/Yjs websocket service |
| `vault-redis` | mini-PC Docker | 6379 | Post-MVP |

FRP mapping:

```txt
Not configured yet
```

Caddy route:

```caddy
# Not configured yet
```

Cloudflare DNS:

```txt
Not configured yet
```

Migration command:

```bash
docker compose -f docker-compose.production.yml --profile migrate run --rm migrate
```

Backup command:

```bash
bash scripts/backup-db.sh
```

Windows local backup command:

```powershell
$env:COMPOSE_FILE="docker-compose.yml"
$env:POSTGRES_SERVICE_NAME="postgres"
.\scripts\backup-db.ps1
```

Known deployment caveats:

```txt
- `.env.production` is intentionally not committed. Create it on the deployment host.
- `.github/workflows/deploy.yml` calls `/opt/apps/vault/repo/scripts/deploy.sh`; that deploy script currently exists only on the server.
- Bash backup scripts need Docker available in the shell environment. On this Windows machine, WSL Bash could not see Docker Desktop; the PowerShell backup script works locally.
```

---

## 14. Testing / Verification

Current test setup:

```txt
No automated tests yet; lint and production build are configured.
```

Manual checks:

| Area | Check | Status | Date |
|---|---|---|---|
| Build | `npm run build` succeeds | Passed | 2026-05-26 |
| Lint | `npm run lint` succeeds | Passed | 2026-05-26 |
| Health | `/api/health` returns OK with database `ok` | Passed | 2026-05-26 |
| Auth | Logged-out `/dashboard` redirects to `/login` | Passed | 2026-05-26 |
| Auth | `/api/auth/providers` returns GitHub provider | Passed | 2026-05-26 |
| Auth | GitHub login works with real OAuth credentials | Not tested |  |
| Documents | Document tables migrated locally | Passed | 2026-05-26 |
| Documents | Create/edit/save/reopen document through browser | Passed | 2026-05-26 |
| Permissions | Logged-out dashboard blocked | Passed | 2026-05-26 |
| Permissions | Unauthorized user blocked from another private doc | Passed | 2026-05-26 |
| Public notes | Public slug works logged out | Passed | 2026-05-26 |
| Public notes | Unknown public slug returns 404 | Passed | 2026-05-26 |
| Public notes | Public badge/copy-link UI builds | Passed | 2026-05-26 |
| Friends | Friend tables migrated locally | Passed | 2026-05-26 |
| Friends | Logged-out `/dashboard/friends` redirects to `/login` | Passed | 2026-05-26 |
| Dashboard | Sidebar items are real anchors/routes, not noop labels | Passed | 2026-05-26 |
| Settings | `/dashboard/settings` loads for signed-in user | Passed | 2026-05-26 |
| Deployment | `docker compose -f docker-compose.production.yml config` validates with placeholder `POSTGRES_PASSWORD` | Passed | 2026-05-26 |
| Deployment | `docker build --target runner -t vault:test .` succeeds | Passed | 2026-05-26 |
| Backups | `scripts/backup-db.ps1` creates a local Postgres dump | Passed | 2026-05-26 |
| Editor | Autosave implementation builds and lints | Passed | 2026-05-31 |
| Deployment | Production domain loads | Passed, user-reported | 2026-05-31 |
| Deployment | GitHub Actions deploy workflow runs on server | Passed, user-reported | 2026-05-31 |
| Deployment | Postgres persists across redeploy | Passed, user-reported | 2026-05-31 |
| Auth | Production GitHub OAuth works | Passed, user-reported | 2026-05-31 |
| Documents | Production document create/edit works | Passed, user-reported | 2026-05-31 |
| Collaboration | `npm run build` succeeds with collaboration code | Passed | 2026-05-31 |
| Collaboration | `npm run lint` succeeds with collaboration code | Passed | 2026-05-31 |
| Collaboration | `node --check scripts/collab-server.mjs` succeeds | Passed | 2026-05-31 |
| Collaboration | `node scripts/collab-server.mjs` starts locally with env values | Passed | 2026-05-31 |
| Collaboration | Two-browser/two-user live editing | Not tested |  |

---

## 15. Known Bugs / Issues

| Status | Issue | Impact | Notes |
|---|---|---|---|
|  |  |  |  |

---

## 16. Important Decisions Made

| Date | Decision | Reason | Files affected |
|---|---|---|---|
| 2026-05-26 | Use Next.js App Router | One deployable full-stack app | `app/`, `package.json` |
| 2026-05-26 | Use Postgres | Reliable self-hosted relational storage | `docker-compose.yml`, `.env.example` |
| 2026-05-26 | Use Drizzle with an empty schema placeholder for Phase 0 | Avoid fake tables before the first real auth/document migration | `db/index.ts`, `db/schema.ts`, `drizzle.config.ts` |
| 2026-05-26 | Keep UI dark-first with switchable themes | User prefers dark mode now, with room for additional themes later | `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `app/layout.tsx`, `app/page.tsx`, `app/dashboard/page.tsx` |
| 2026-05-26 | Use database sessions with Auth.js | Server-side permission checks need stable `session.user.id` from Postgres-backed users | `auth.ts`, `db/schema.ts` |
| 2026-05-26 | Delay Yjs until post-MVP | Prevent complexity before permissions work | docs |

---

## 17. Things Future Agents Should Not Break

Add invariants here as they emerge.

Current invariants:

```txt
- Document access must be checked server-side.
- Private documents must not be exposed through public routes.
- Real-time collaboration should not be added before core auth/document permissions are stable.
- Secrets must not be committed.
- New UI should use theme tokens (`background`, `foreground`, `card`, `border`, `muted`) rather than hard-coded one-off colors unless there is a deliberate design reason.
```

---

## 18. Next Best Tasks

Keep this short and current.

```txt
1. Configure Caddy/FRP routing for `wss://vault.ems-place.com/collab` to the `vault-collab` service.
2. Set `NEXT_PUBLIC_COLLAB_URL=wss://vault.ems-place.com/collab` in production and confirm the deploy script starts `collab`.
3. Test two owner/editor browser sessions editing the same shared document.
```

---

## 19. Changelog

Use this as a compact implementation log.

| Date | Change | Notes |
|---|---|---|
| 2026-05-26 | Bootstrapped Next.js app shell | Added TypeScript, Tailwind, shadcn/ui, homepage, dashboard placeholder, health route, Docker Postgres, Drizzle config, env example |
| 2026-05-26 | Initialized local Git repository | Remote GitHub repo still needs to be created separately |
| 2026-05-26 | Added dark-first switchable theming | Added `next-themes`, root provider, theme toggle, and converted current pages to theme tokens |
| 2026-05-26 | Removed temporary scaffold issue | User deleted `vault-scaffold/`; known issue cleared |
| 2026-05-26 | Added Auth.js foundation | Added NextAuth v5 beta, Drizzle adapter, auth tables/migration, login page, protected dashboard, sign-out action, and session typing |
| 2026-05-26 | Added basic private document persistence | Added document schema/migration, permission helpers, document server actions, dashboard document list/create, and protected document edit route |
| 2026-05-26 | Added Tiptap editor and read-only renderer | Replaced textarea with Tiptap, toolbar, JSON save, viewer/public renderer, and editor styling |
| 2026-05-26 | Added basic document sharing | Added owner-only share by email, role update/remove, collaborator list, and shared-with-me dashboard list |
| 2026-05-26 | Added public document publishing | Added publish/unpublish actions, stable public slugs, and `/public/[slug]` read-only route |
| 2026-05-26 | Added friend system | Added friend request/friendship schema, server actions, protected friends dashboard page, accept/reject/remove flows |
| 2026-05-26 | Integrated friends into sharing | Added friend selector for document sharing and server-side friendship verification before granting access |
| 2026-05-26 | Added production deployment scaffolding | Added Dockerfile, production compose, migration profile, README deployment notes, and backup/restore scripts |
| 2026-05-26 | Verified Windows backup path | PowerShell backup script created a local Postgres dump; Bash script needs Docker-visible shell environment |
| 2026-05-26 | Added public-note and route polish | Added public badges, copy-public-link button, global loading state, not-found page, and error page |
| 2026-05-26 | Removed dashboard noop controls | Sidebar labels are now anchors/routes, Public Notes has real data, and Settings is a real protected page |
| 2026-05-31 | Added editor autosave and portfolio docs polish | Debounced autosave uses server-side permission checks; README now documents architecture, security, deployment, and resume positioning |
| 2026-05-31 | Clarified healthcheck split | Docker healthcheck uses `/healthz` for liveness; `/api/health` remains the database readiness endpoint |
| 2026-05-31 | Added first collaborative editing slice | Added Yjs/Hocuspocus dependencies, collab room tokens, `vault-collab` service, Tiptap collaboration/caret wiring, and Postgres JSON persistence |
