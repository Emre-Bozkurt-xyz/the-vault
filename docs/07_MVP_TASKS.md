# Vault — MVP Build Tasks

This is the practical build order from empty repo to deployed MVP.

---

## Milestone 0 — Empty Repo to Running App

### 0.1 Create app

```bash
npx create-next-app@latest vault
```

Recommended choices:

```txt
TypeScript: yes
ESLint: yes
Tailwind: yes
src directory: optional, pick no for simplicity
App Router: yes
Turbopack: yes
Import alias: yes
```

### 0.2 Install base dependencies

```bash
npm install drizzle-orm postgres zod
npm install -D drizzle-kit
```

### 0.3 Add shadcn/ui

```bash
npx shadcn@latest init
npx shadcn@latest add button card input dialog dropdown-menu avatar badge textarea
```

### 0.4 Add health route

Create:

```txt
app/api/health/route.ts
```

Return:

```json
{ "ok": true, "service": "vault" }
```

---

## Milestone 1 — Database

### 1.1 Add Docker Compose Postgres

Create:

```txt
docker-compose.yml
```

For dev:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: vault
      POSTGRES_PASSWORD: vault
      POSTGRES_DB: vault
    ports:
      - "5432:5432"
    volumes:
      - vault_pg_data:/var/lib/postgresql/data

volumes:
  vault_pg_data:
```

### 1.2 Add Drizzle config

Create:

```txt
drizzle.config.ts
db/schema.ts
db/index.ts
```

### 1.3 Create first migration

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Milestone 2 — Auth

### 2.1 Install Auth.js

```bash
npm install next-auth
```

Depending on adapter choice, also install required adapter package.

### 2.2 Create GitHub OAuth app

Local callback:

```txt
http://localhost:3000/api/auth/callback/github
```

### 2.3 Add login page

Create:

```txt
app/login/page.tsx
```

### 2.4 Add protected dashboard

Create:

```txt
app/dashboard/page.tsx
```

Server-side:

```txt
if no session -> redirect("/login")
```

---

## Milestone 3 — Document CRUD

### 3.1 Add document schema

Add:

```txt
documents
document_permissions
```

### 3.2 Add server actions

Create:

```txt
server/documents.ts
```

Functions:

```txt
createDocument()
updateDocument()
archiveDocument()
getDocumentForUser()
listDocumentsForUser()
```

### 3.3 Add dashboard list

Show:

```txt
My Documents
Shared With Me
Public Notes
```

At first, only `My Documents` needs to work.

### 3.4 Add document editor route

Create:

```txt
app/docs/[docId]/page.tsx
```

---

## Milestone 4 — Markdown Editor

### 4.1 Install Markdown editor stack

```bash
npm install @uiw/react-codemirror @codemirror/lang-markdown
```

Optional later:

```bash
npm install @codemirror/search @codemirror/autocomplete
```

### 4.2 Create editor component

Create:

```txt
components/markdown/MarkdownEditor.tsx
components/markdown/MarkdownToolbar.tsx
```

### 4.3 Save Markdown content

Store:

```txt
documents.markdown
```

Not:

```txt
rendered HTML
```

### 4.4 Add read-only renderer

Create:

```txt
components/markdown/MarkdownDocument.tsx
```

---

## Milestone 5 — Permissions

### 5.1 Add permission helpers

Create:

```txt
lib/permissions.ts
```

Implement:

```txt
canReadDocument
canEditDocument
canShareDocument
```

### 5.2 Wrap every document action

All document actions must check permissions.

### 5.3 Add collaborator UI

Create:

```txt
components/documents/ShareDialog.tsx
```

MVP behavior:

```txt
Search registered user by email
Add as viewer/editor
Remove collaborator
Change role
```

---

## Milestone 6 — Friends

### 6.1 Add tables

```txt
friend_requests
friendships
```

### 6.2 Add friends page

Create:

```txt
app/dashboard/friends/page.tsx
```

### 6.3 Add friend actions

Create:

```txt
server/friends.ts
```

Functions:

```txt
searchUsers()
sendFriendRequest()
acceptFriendRequest()
rejectFriendRequest()
listFriends()
```

---

## Milestone 7 — Public Notes

### 7.1 Add visibility controls

Document fields:

```txt
visibility
public_slug
```

### 7.2 Add publish action

```txt
publishDocument()
unpublishDocument()
```

### 7.3 Add public route

Create:

```txt
app/public/[slug]/page.tsx
```

Render read-only document.

---

## Milestone 8 — Polish MVP

Add:

- Loading states.
- Empty states.
- Error pages.
- Save status.
- Dashboard search/filter.
- Basic responsive layout.
- Clean README screenshots.

Do not over-polish before deployment.

---

## Milestone 9 — Production Deployment

### 9.1 Add production Dockerfile

Use Next.js standalone.

### 9.2 Add production compose

Services:

```txt
vault-web
vault-postgres
```

### 9.3 Configure production env

Set:

```txt
NEXTAUTH_URL=https://vault.ems-place.com
AUTH_SECRET
DATABASE_URL
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
```

### 9.4 Configure FRP

Forward app port from mini-PC to VPS.

### 9.5 Configure Caddy

```caddy
vault.ems-place.com {
    reverse_proxy 127.0.0.1:18030
}
```

### 9.6 Configure Cloudflare

```txt
vault.ems-place.com -> VPS reserved IP
```

### 9.7 Verify

```bash
curl https://vault.ems-place.com/api/health
```

---

## Milestone 10 — Backups

### 10.1 Add backup script

```txt
scripts/backup-db.sh
```

### 10.2 Test backup

```bash
bash scripts/backup-db.sh
```

### 10.3 Test restore locally

Do not skip this forever.

---

## Milestone 11 — Resume/Portfolio

Add to README:

- Architecture diagram.
- Feature list.
- Security model.
- Deployment model.
- Screenshots.
- Tech stack.
- What you learned.
- Future work.

Draft resume bullet:

```txt
Built and deployed a self-hosted collaborative document platform with Next.js, TypeScript, PostgreSQL, Drizzle ORM, OAuth authentication, role-based document sharing, and a Docker/Caddy/FRP home-lab deployment pipeline.
```

Better after Yjs:

```txt
Implemented real-time collaborative Markdown editing using CodeMirror, Hocuspocus, and Yjs CRDTs with server-side room authorization and PostgreSQL persistence.
```

---

## MVP Priority Rule

When stuck, prioritize in this order:

```txt
1. Auth works
2. Data persists
3. Private documents stay private
4. Editing works
5. Sharing works
6. Public docs work
7. Deployment works
8. UI polish
9. Collaboration
```

Security beats polish.
