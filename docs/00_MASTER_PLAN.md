# Vault — Master Project Plan

## 1. Project Goal

**Vault** is a self-hosted collaborative document and note platform deployed at:

```txt
https://vault.ems-place.com
```

The MVP should support:

- OAuth login.
- User accounts.
- Private documents.
- Public documents.
- Friend system.
- Collaborator access.
- Role-based document permissions.
- Rich text editing.
- Basic document dashboard.
- Production deployment on the existing home-lab infrastructure.

The first MVP does **not** need to be a perfect Notion clone. The goal is to ship a solid, deployed, secure, resume-worthy app.

---

## 2. Recommended MVP Stack

```txt
Frontend:
  Next.js App Router
  React
  TypeScript
  Tailwind CSS
  shadcn/ui

Backend:
  Next.js Server Actions / Route Handlers
  Node.js runtime

Database:
  PostgreSQL
  Drizzle ORM
  drizzle-kit migrations

Auth:
  Auth.js / NextAuth
  GitHub OAuth
  Google OAuth optional after GitHub works

Editor:
  Tiptap
  ProseMirror JSON document storage

Collaboration:
  Phase 1: no real-time collaboration
  Phase 2: Yjs + y-websocket

Infra:
  Docker Compose
  Caddy on DigitalOcean VPS
  FRP from mini-PC to VPS
  Cloudflare DNS
```

The MVP should start without real-time editing. Add real-time collaboration after the core document, auth, and permission model is stable.

---

## 3. MVP Feature Definition

### Required for MVP

| Feature | Required? | Notes |
|---|---:|---|
| OAuth login | Yes | GitHub first |
| User profile | Yes | Display name, avatar, email |
| Create document | Yes | Owner-only initially |
| Edit document | Yes | Tiptap editor |
| Delete/archive document | Yes | Soft delete preferred |
| Dashboard | Yes | List owned/shared/public docs |
| Document permissions | Yes | Owner, editor, viewer |
| Friend requests | Yes | Send, accept, reject |
| Add collaborator | Yes | By friend or email |
| Public notes | Yes | Public read-only page |
| Deployment | Yes | Working on vault.ems-place.com |
| Backups | Yes | Basic Postgres dump script |

### Not Required for MVP

| Feature | Reason |
|---|---|
| Real-time collaboration | Add after MVP |
| Comments | Nice-to-have |
| Attachments | Adds storage/security complexity |
| End-to-end encryption | Too much for v1 |
| Mobile app | Web is enough |
| AI search/summarization | Add after permissions are stable |
| Organizations/workspaces | Maybe later |

---

## 4. Target Architecture

```txt
User Browser
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
    +-- vault-web: Next.js app
    +-- vault-postgres: PostgreSQL
    +-- vault-redis: Redis, later
    +-- vault-collab: Yjs websocket server, later
```

For MVP:

```txt
vault-web + postgres
```

Redis and Yjs can wait.

---

## 5. Repo Structure

Recommended starting structure:

```txt
vault/
  app/
    (auth)/
    dashboard/
    docs/
    public/
    api/
  components/
    editor/
    layout/
    ui/
  db/
    schema.ts
    index.ts
    migrations/
  lib/
    auth.ts
    permissions.ts
    env.ts
    slug.ts
  server/
    documents.ts
    friends.ts
    users.ts
  scripts/
    backup-db.sh
    restore-db.sh
  docker/
    Caddyfile.example
  docs/
    00_MASTER_PLAN.md
    01_PROGRESS_TRACKER.md
    02_ARCHITECTURE.md
    03_DATA_MODEL.md
    04_AUTH_AND_PERMISSIONS.md
    05_EDITOR_AND_COLLAB.md
    06_DEPLOYMENT.md
    07_MVP_TASKS.md
    08_RESUME_NOTES.md
  docker-compose.yml
  Dockerfile
  .env.example
  README.md
```

---

## 6. Development Phases

### Phase 0 — Repo Bootstrap

Goal: project runs locally.

Tasks:

- Create Next.js app with TypeScript.
- Install Tailwind and shadcn/ui.
- Add Docker Compose with Postgres.
- Add Drizzle.
- Add `.env.example`.
- Add basic homepage.
- Add health endpoint.

Done when:

```txt
npm run dev
docker compose up postgres
GET /api/health returns ok
```

---

### Phase 1 — Auth

Goal: user can sign in and out.

Tasks:

- Configure Auth.js.
- Add GitHub OAuth app.
- Add Auth.js database adapter.
- Create login page.
- Create protected dashboard route.
- Store user in database.

Done when:

```txt
Unauthenticated users cannot access /dashboard.
GitHub login creates a user row.
Signed-in user can sign out.
```

---

### Phase 2 — Documents

Goal: user can create, edit, view, and delete their own documents.

Tasks:

- Add documents table.
- Add document create action.
- Add dashboard document list.
- Add document editor route.
- Store title and Tiptap JSON content.
- Add autosave or manual save.
- Add soft delete.

Done when:

```txt
User can create a document.
User can edit and save it.
User can reopen it later.
Other users cannot access it.
```

---

### Phase 3 — Permissions

Goal: sharing works securely.

Tasks:

- Add document permissions table.
- Add roles: owner, editor, viewer.
- Add server-side permission guard.
- Add share modal.
- Add collaborator list.
- Add remove collaborator action.

Done when:

```txt
Owner can share document with another user.
Editor can edit.
Viewer can only view.
Unauthorized users get 404 or access denied.
```

Prefer 404 for private documents to avoid leaking existence.

---

### Phase 4 — Friends

Goal: user can manage trusted collaborators.

Tasks:

- Add friend_requests table.
- Add friendships table.
- Search users by email/username.
- Send friend request.
- Accept/reject friend request.
- Use friends in share modal.

Done when:

```txt
User A can send request to User B.
User B can accept.
Both can see each other as friends.
Owner can share a document with a friend.
```

---

### Phase 5 — Public Notes

Goal: selected documents can be published publicly.

Tasks:

- Add `visibility` to document.
- Add public slug.
- Add public read-only route.
- Add publish/unpublish toggle.
- Add OpenGraph metadata later.

Done when:

```txt
Public document works at /public/:slug.
Private documents are not visible publicly.
Published docs are read-only to anonymous users.
```

---

### Phase 6 — Production Deployment

Goal: deployed and usable at `vault.ems-place.com`.

Tasks:

- Create production Dockerfile.
- Create production docker-compose.
- Set environment variables.
- Run migrations.
- Configure FRP.
- Configure Caddy.
- Configure Cloudflare DNS.
- Add health endpoint.
- Add backup script.

Done when:

```txt
https://vault.ems-place.com loads.
OAuth callback works.
Documents persist after restart.
Database backup can be created.
```

---

### Phase 7 — Collaboration v2

Goal: optional real-time collaborative editing.

Tasks:

- Add Yjs document sync server.
- Add WebSocket route/service.
- Add awareness/presence.
- Add document-room authorization.
- Persist Yjs state.
- Add conflict-safe save/export to Postgres.

Done when:

```txt
Two users with edit access can open the same doc.
Typing syncs live.
Unauthorized users cannot connect to the room.
```

---

## 7. MVP Security Rules

Non-negotiable:

- All document access must be checked server-side.
- Never trust document IDs from the client.
- Never expose private docs through public routes.
- Use opaque document IDs or UUIDs.
- Use 404 for private unauthorized documents where possible.
- OAuth callback URLs must match production domain.
- Secrets must only live in `.env`, not committed.
- Database must not be directly exposed publicly.
- Postgres should bind only inside Docker network.
- Backups should not be stored in a public web directory.

---

## 8. Suggested Route Map

```txt
/                         Landing page
/login                    Login page
/dashboard                Main document dashboard
/dashboard/friends        Friend management
/dashboard/settings       Account settings
/docs/new                 Create new document
/docs/[docId]             View/edit document
/public/[slug]            Public read-only document
/api/health               Health check
/api/auth/[...nextauth]   Auth.js route
```

---

## 9. Suggested MVP UI

Main dashboard sections:

```txt
Sidebar:
  - Vault
  - My Documents
  - Shared With Me
  - Public Notes
  - Friends
  - Settings

Main:
  - New Document button
  - Search input
  - Recent documents
  - Shared documents
```

Document editor:

```txt
Top bar:
  - Document title
  - Save status
  - Share button
  - Publish toggle
  - User avatar menu

Editor area:
  - Tiptap editor
```

---

## 10. Opinionated Build Order

Build in this exact order:

1. Local app shell.
2. Database.
3. Auth.
4. Basic document CRUD.
5. Permission guard.
6. Dashboard.
7. Sharing.
8. Friends.
9. Public notes.
10. Deployment.
11. Backups.
12. Real-time collaboration.

Do not touch real-time collaboration before the normal editor and permissions work.

---

## 11. Definition of MVP Done

MVP is done when:

- App is deployed at `vault.ems-place.com`.
- User can log in with GitHub.
- User can create/edit/delete documents.
- User can share a document with another registered user.
- User can set collaborator role to viewer/editor.
- User can publish a document publicly.
- Unauthorized users cannot access private documents.
- Data persists across container restarts.
- Database can be backed up.
- README explains the system clearly.

---

## 12. Future Features

Good post-MVP features:

- Real-time collaborative editing with Yjs.
- Comments.
- Document history.
- Full-text search.
- Tags.
- AI summarization.
- AI semantic search.
- Attachment uploads.
- Markdown import/export.
- Public profile page.
- Workspaces.
- Mobile-friendly PWA.
- Passkeys.
- Audit log UI.
- Rate limiting.
- Admin panel.
