# Vault — Architecture

## 1. System Overview

Vault is a full-stack web application deployed through the existing home-lab setup.

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
  +-- vault-redis, later
  +-- vault-collab, later
```

The main application is a Next.js app. It handles frontend rendering, server actions, route handlers, authentication, document CRUD, permissions, and public pages.

---

## 2. Runtime Components

### `vault-web`

Main Next.js app.

Responsibilities:

- Render UI.
- Handle OAuth session.
- Serve dashboard.
- Serve editor.
- Handle document CRUD.
- Enforce permissions.
- Render public documents.
- Expose health endpoint.

### `vault-postgres`

Main relational database.

Responsibilities:

- Users.
- OAuth accounts.
- Sessions.
- Documents.
- Document permissions.
- Friend requests.
- Friendships.
- Public slugs.
- Audit logs, later.

### `vault-redis`

Post-MVP.

Responsibilities:

- Rate limiting.
- Presence.
- WebSocket room metadata.
- Background job coordination.
- Temporary share tokens.

### `vault-collab`

Real-time collaboration service.

Responsibilities:

- Yjs websocket sync.
- Room authorization.
- Presence/awareness.
- Persisting collaborative document state back to Postgres JSONB.

---

## 3. Request Flow

### Private document view/edit

```txt
Browser requests /docs/:docId
  |
Next.js server reads session
  |
Check document permission in database
  |
If allowed:
  render editor
Else:
  return 404 or access denied
```

### Public document view

```txt
Browser requests /public/:slug
  |
Next.js server looks up public document
  |
If document visibility is public:
  render read-only page
Else:
  return 404
```

### Document update

```txt
Editor submits updated JSON
  |
Server action reads session
  |
Check canEditDocument(userId, docId)
  |
Validate payload
  |
Update document row
  |
Return success
```

---

## 4. Permission Model

Document access should always be checked server-side.

Roles:

```txt
owner:
  can read
  can edit
  can delete/archive
  can share
  can publish
  can transfer ownership, later

editor:
  can read
  can edit

viewer:
  can read only
```

Rule:

```txt
No server-side permission check = bug.
```

---

## 5. Data Boundaries

### Public data

Can be shown to anonymous users:

- Public document title.
- Public document content.
- Public author display name, if enabled.
- Public updated timestamp.

### Private data

Must require auth and permission:

- Private document content.
- Document collaborator list.
- Friend list.
- Email addresses.
- Internal user IDs.
- Audit logs.

---

## 6. Domain Plan

MVP:

```txt
vault.ems-place.com
```

Optional later:

```txt
api.ems-place.com/v1/vault
collab.vault.ems-place.com
```

Recommendation:

Keep the MVP under one domain. Add separate API/collab subdomains later only when needed.

---

## 7. Caddy/FRP Deployment Shape

The VPS receives HTTPS traffic and forwards it to the mini-PC through FRP.

Example conceptual route:

```txt
vault.ems-place.com
  -> VPS Caddy
  -> 127.0.0.1:18xxx on VPS
  -> FRP tunnel
  -> mini-PC:3000 container
```

For WebSockets later, make sure the proxy supports upgrade headers. Caddy usually handles this automatically with `reverse_proxy`.

Current collaboration service shape:

```txt
Browser editor
  -> wss://vault.ems-place.com/collab
  -> VPS Caddy
  -> FRP remote port for collab
  -> mini-PC 127.0.0.1:18211
  -> vault-collab:1234
```

The Next.js document page only issues collaboration tokens after server-side edit permission checks. The collab service validates the signed token and re-checks current database edit permission before joining a room.

---

## 8. Health Checks

Add:

```txt
GET /api/health
```

Suggested response:

```json
{
  "ok": true,
  "service": "vault",
  "database": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Use this in the future modular health diagnostic page.

---

## 9. MVP Architecture Diagram

```txt
+-------------------+
| Browser           |
+---------+---------+
          |
          v
+-------------------+
| vault.ems-place   |
| Cloudflare DNS    |
+---------+---------+
          |
          v
+-------------------+
| DigitalOcean VPS  |
| Caddy             |
+---------+---------+
          |
          v
+-------------------+
| FRP tunnel        |
+---------+---------+
          |
          v
+-------------------+
| Mini-PC Docker    |
|                   |
| +---------------+ |
| | vault-web     | |
| +-------+-------+ |
|         |         |
| +-------v-------+ |
| | PostgreSQL    | |
| +---------------+ |
+-------------------+
```

---

## 10. Post-MVP Architecture Diagram

```txt
Mini-PC Docker

+------------------+
| vault-web        |
| Next.js          |
+--------+---------+
         |
         +------------------+
         |                  |
+--------v---------+  +-----v----------+
| PostgreSQL       |  | Redis          |
+------------------+  +----------------+
         |
+--------v---------+
| vault-collab     |
| Yjs WebSocket    |
+------------------+
```

---

## 11. Engineering Principles

Use these throughout the project:

- Prefer server-side checks over client-side trust.
- Keep MVP simple.
- Ship vertical slices.
- Add real-time collaboration only after permissions are solid.
- Use boring infrastructure and interesting product features.
- Treat deployment as part of the project, not an afterthought.
- Document decisions inside the repo.
