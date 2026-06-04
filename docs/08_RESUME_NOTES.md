# Vault — Resume and Portfolio Notes

## 1. Project Positioning

Do not describe Vault as just a notes app.

Stronger description:

```txt
Vault is a self-hosted collaborative knowledge platform with OAuth login, private/public document publishing, friend-based sharing, role-based permissions, and a production deployment pipeline through a home-lab VPS tunnel architecture.
```

Even stronger after Yjs:

```txt
Vault is a self-hosted collaborative document platform using CRDT-based real-time editing, OAuth authentication, server-side authorization, and a Dockerized deployment across a home server and public VPS edge.
```

---

## 2. Resume Bullets — MVP

Use these once the MVP is deployed:

```txt
Built and deployed Vault, a self-hosted collaborative document platform using Next.js, TypeScript, PostgreSQL, Drizzle ORM, and Auth.js OAuth authentication.
```

```txt
Designed a role-based document access system supporting private notes, public publishing, friend-based sharing, and viewer/editor/owner permissions enforced server-side.
```

```txt
Deployed the application through a Dockerized home-lab stack using Caddy, Cloudflare DNS, FRP tunneling, and a DigitalOcean VPS public endpoint.
```

```txt
Implemented a Markdown-native document editor using CodeMirror with PostgreSQL persistence, live preview modes, safe public rendering, and secure document access guards.
```

---

## 3. Resume Bullets — After Real-Time Collaboration

```txt
Implemented real-time collaborative Markdown editing with CodeMirror, Yjs CRDTs, and Hocuspocus, including room-level authorization, presence, and live document synchronization.
```

```txt
Built a WebSocket collaboration service for multi-user document editing with authenticated access control, presence tracking, and persistent document state.
```

---

## 4. Portfolio README Sections

Recommended README structure:

```txt
# Vault

## Overview
## Live Demo
## Screenshots
## Features
## Architecture
## Tech Stack
## Security Model
## Deployment
## Local Development
## Database Schema
## Roadmap
## What I Learned
```

---

## 5. Portfolio Feature List

Use:

```txt
- OAuth login with GitHub and Google.
- Private document dashboard.
- Markdown-native editing with CodeMirror.
- PostgreSQL-backed document persistence.
- Friend request system.
- Role-based sharing with owner/editor/viewer permissions.
- Public read-only document publishing.
- Dockerized deployment.
- Reverse-proxied production domain through Caddy and Cloudflare.
- Health endpoint for service monitoring.
```

After collaboration:

```txt
- Real-time collaborative Markdown editing with Yjs CRDTs.
- WebSocket-based document rooms.
- Live collaborator presence.
```

---

## 6. Architecture Blurb

```txt
Vault is deployed across a hybrid home-lab architecture. Public HTTPS traffic reaches a DigitalOcean VPS through Cloudflare DNS, Caddy terminates TLS and reverse proxies requests through an FRP tunnel to a Dockerized Next.js application running on a home mini-PC. PostgreSQL runs as a private Docker service with persistent volumes and backup scripts.
```

This is a very good portfolio detail. It shows practical infrastructure skill.

---

## 7. Security Blurb

```txt
Vault enforces document access on the server for every read and write operation. Documents support owner, editor, and viewer roles, with public publishing handled through dedicated read-only routes and unique public slugs. Private document routes avoid leaking document existence to unauthorized users.
```

---

## 8. Good Screenshots to Include

Take screenshots of:

- Landing page.
- Login page.
- Dashboard with documents.
- Editor page.
- Share dialog.
- Friends page.
- Public document page.
- Architecture diagram.
- Health check page/result.

---

## 9. Demo Script

For portfolio/interview demos:

```txt
1. Open vault.ems-place.com.
2. Log in with GitHub.
3. Create a new document.
4. Edit and save content.
5. Share it with another user as viewer.
6. Show that viewer cannot edit.
7. Change role to editor.
8. Publish document publicly.
9. Open public link in incognito.
10. Show deployment/architecture README.
```

After Yjs:

```txt
Open two browsers and show live editing.
```

---

## 10. Interview Talking Points

Strong points to mention:

- Why Postgres over a document DB.
- Why server-side authorization is mandatory.
- How OAuth sessions connect to document permissions.
- Why real-time collaboration was delayed until after MVP.
- How the app is deployed through VPS + FRP + Caddy.
- How the database is backed up.
- How public and private document access differ.
- What you would improve next.

---

## 11. Things Not To Oversell

Do not claim:

```txt
end-to-end encrypted
Google Docs clone
enterprise-grade
zero-trust
fully distributed
```

Unless actually implemented.

Say:

```txt
self-hosted
role-based access
server-side permission enforcement
real-time collaboration, if added
Dockerized deployment
```

---

## 12. Future Roadmap for README

```txt
- Batched document version history.
- Real-time editing with Yjs.
- Document comments.
- Document version history.
- Full-text search.
- Semantic search and AI summarization.
- Markdown import/export.
- File attachments.
- Passkey login.
- Workspace/team support.
- Admin dashboard.
```

---

## 13. Final One-Line Pitch

MVP:

```txt
A self-hosted collaborative notes platform with OAuth, Markdown-native editing, public/private publishing, friend-based sharing, and server-enforced permissions.
```

After collaboration:

```txt
A self-hosted Obsidian-style document platform with OAuth, CRDT-powered real-time Markdown collaboration, role-based sharing, and a production home-lab deployment architecture.
```
