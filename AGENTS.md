# Vault Agent Skill

## Purpose

You are working inside the **Vault** codebase.

Vault is a self-hosted collaborative document/note platform deployed at:

```txt
https://vault.ems-place.com
```

The project is built for both practical use and portfolio/resume value. Treat it as a real production-style app, not a throwaway tutorial.

The repo contains planning documentation under:

```txt
docs/
```

The most important files are:

```txt
docs/00_MASTER_PLAN.md
docs/01_PROGRESS_TRACKER.md
docs/02_ARCHITECTURE.md
docs/03_DATA_MODEL.md
docs/04_AUTH_AND_PERMISSIONS.md
docs/05_EDITOR_AND_COLLAB.md
docs/06_DEPLOYMENT.md
docs/07_MVP_TASKS.md
docs/08_RESUME_NOTES.md
docs/project-knowledge.md
```

Your job is to use these docs as the source of truth while implementing the app.

---

## Operating Rules

### 1. Read the docs before acting

Before making architectural, schema, auth, permission, editor, or deployment changes, inspect the relevant docs.

Use this rough map:

| Task Type | Read First |
|---|---|
| Overall direction | `00_MASTER_PLAN.md` |
| What to work on next | `01_PROGRESS_TRACKER.md`, `07_MVP_TASKS.md` |
| Infra/deployment | `02_ARCHITECTURE.md`, `06_DEPLOYMENT.md` |
| Database/schema | `03_DATA_MODEL.md` |
| Auth/access control | `04_AUTH_AND_PERMISSIONS.md` |
| Editor/collaboration | `05_EDITOR_AND_COLLAB.md` |
| README/resume/portfolio polish | `08_RESUME_NOTES.md` |
| Current codebase reality | `project-knowledge.md` |

Do not blindly implement from memory if the relevant docs exist.

---

### 2. Prefer vertical slices

Implement in small working slices.

Good:

```txt
schema -> server action -> route/UI -> manual test -> update tracker
```

Bad:

```txt
create 20 half-finished files across unrelated features
```

The project should always remain runnable after each meaningful change.

---

### 3. Keep MVP discipline

The MVP priority order is:

```txt
1. Auth works
2. Data persists
3. Private documents stay private
4. Editing works
5. Sharing works
6. Public docs work
7. Deployment works
8. UI polish
9. Real-time collaboration
```

Do **not** start Yjs/real-time collaboration before:

- Auth works.
- Document CRUD works.
- Permission helpers exist.
- Viewer/editor/owner roles are enforced server-side.

---

### 4. Security is not optional

For every document-related operation:

- Authenticate the user server-side.
- Check authorization server-side.
- Validate inputs.
- Never trust document IDs or roles from the client.
- Never rely on frontend-only permission checks.
- Prefer returning `404` for inaccessible private documents to avoid leaking existence.

Any code path that reads or writes private document data without a permission check is a bug.

---

### 5. Update the progress tracker

When a task is completed, update:

```txt
docs/01_PROGRESS_TRACKER.md
```

Use:

```txt
[ ] Not started
[~] In progress
[x] Done
[!] Blocked
```

When work is partially complete, use `[~]`, not `[x]`.

If implementation differs from the original plan, update the relevant docs rather than letting them rot.

---

### 6. Maintain `project-knowledge.md`

`docs/project-knowledge.md` is the living map of the actual codebase.

Update it whenever you introduce or significantly change:

- File structure.
- Database schema.
- Environment variables.
- Auth/session behavior.
- Permission helpers.
- Server actions.
- API routes.
- Deployment ports/services.
- Known bugs.
- Important implementation decisions.

This file should answer:

```txt
What exists right now?
Where is it?
How does it work?
What should future agents avoid breaking?
```

Do not use it as a dumping ground for vague notes. Keep it factual and current.

---

### 7. Preserve clean architecture

Preferred structure:

```txt
app/                  Next.js routes
components/           Reusable UI
components/editor/    Tiptap/editor components
db/                   Drizzle schema, migrations, db client
lib/                  Shared helpers: auth, permissions, env, slug
server/               Server-side domain actions
scripts/              Backup/restore/dev scripts
docs/                 Planning and project knowledge
```

Avoid placing business logic directly inside UI components when it belongs in `server/` or `lib/`.

---

### 8. Database changes require documentation

When modifying schema:

1. Update Drizzle schema.
2. Generate migration.
3. Update `docs/03_DATA_MODEL.md` if the design changed.
4. Update `docs/project-knowledge.md` with the actual current schema.
5. Update progress tracker.

Do not make undocumented schema changes.

---

### 9. Auth and permissions require extra care

When changing auth or permissions:

- Update `lib/auth.ts` / auth route as needed.
- Ensure session includes `user.id`.
- Ensure permission helpers remain the single source of truth.
- Add or update manual test notes in `project-knowledge.md`.
- Check both owner and collaborator cases.

Never create a new ad-hoc permission check when an existing helper should be used.

---

### 10. Deployment changes require exact notes

When changing deployment:

Update `project-knowledge.md` with:

- Service names.
- Container ports.
- Host ports.
- FRP remote ports.
- Caddy route.
- Required env vars.
- Migration command.
- Backup command.
- Any production-only caveats.

The deployment path is part of the project’s value. Keep it legible.

---

## Implementation Style

### Prefer boring, reliable code

Use modern tools, but do not over-engineer.

Good choices:

```txt
Next.js App Router
TypeScript
PostgreSQL
Drizzle ORM
Auth.js
Tiptap
Docker Compose
Caddy
```

Avoid adding new major services unless they clearly support the current milestone.

---

### Strong typing

Use TypeScript types and validation.

Prefer:

```txt
zod schemas for server action inputs
explicit role unions
typed database helpers
```

Avoid:

```txt
any
stringly typed role checks scattered everywhere
unchecked JSON payloads
```

---

### Error handling

Use clear internal errors, but avoid leaking private resource existence.

Examples:

```txt
Unauthenticated -> redirect/login or unauthorized
Private doc no access -> 404 preferred
Invalid input -> validation error
Database failure -> generic failure message
```

---

### UI style

Keep the app clean and portfolio-ready.

Preferred feel:

```txt
Notion + Linear + GitHub
```

Use:

```txt
Tailwind
shadcn/ui
simple layouts
good empty states
visible save status
```

Do not waste time on heavy animations before MVP.

---

## Required Agent Workflow

For non-trivial work, follow this loop:

```txt
1. Read relevant docs.
2. Inspect current code.
3. Compare docs vs current implementation.
4. Implement the smallest useful slice.
5. Run/check what is reasonable.
6. Update progress tracker.
7. Update project-knowledge.md.
8. Summarize what changed and what remains.
```

If docs and code disagree, trust the code for current reality, then update the docs to reflect the new decision.

---

## Definition of Good Agent Output

A good change should include:

- Working implementation.
- Minimal unrelated edits.
- Updated tracker.
- Updated project knowledge.
- Clear summary.
- Clear next step.

A bad change:

- Adds a huge feature without finishing it.
- Touches auth/permissions casually.
- Leaves docs stale.
- Adds real-time collaboration too early.
- Breaks deployment assumptions.
- Stores secrets in committed files.
- Exposes private document data.

---

## Current MVP Target

Build toward this deployed MVP:

```txt
A user can log in with GitHub, create rich-text documents, keep them private, share them with registered users as viewer/editor, publish selected documents publicly, and use the app at https://vault.ems-place.com with persistent PostgreSQL storage and backups.
```

Real-time collaboration is post-MVP unless explicitly prioritized after the core model works.
