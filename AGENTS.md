# Vault Agent Guide

> This file is the operating contract for **every** coding agent in this repo —
> Codex, Claude Code, or anything else. Codex loads it automatically. Claude Code
> reaches it via `CLAUDE.md`, which is only a pointer to this file. Keep
> agent-facing rules here, not in vendor-specific files.

---

## 0. Start here (every session)

**Read, in this order, before any non-trivial answer or edit:**

1. **This file** — the operating rules below.
2. **`docs/project-knowledge.md`** — the living map of what actually exists right
   now: file structure, schema, auth, permission helpers, known bugs, and a dated
   changelog. **Trust it over your memory and over the planning docs** when they
   disagree.
3. **The planning doc for the area you are touching** — see the map in §1.
4. **`.agents/SKILLS.md`** — the skill index. If a row matches your task, read
   that `SKILL.md` before you start. Agents without a built-in skill loader
   (Codex included) must open these files manually; nothing does it for you.

**Do not implement from memory or from assumptions about what this app is.** It
is **Vault**, a self-hosted Next.js collaborative document/note platform — not
Obsidian, not a generic "vault" app. Confirm specifics in the code and docs
before acting.

### Verification norms

Run the relevant subset before claiming work is done:

```bash
npx tsc --noEmit      # types
npm run lint          # eslint
npm test              # vitest
npm run build         # larger changes only
```

`components/markdown/MarkdownEditor.tsx` carries **pre-existing** react-hooks
ESLint errors unrelated to most edits. Compare against the baseline before
attributing a lint failure to your change.

### Before you finish

Per §5/§6, a meaningful change is not done until the docs are honest again:
update `docs/project-knowledge.md` (dated changelog row + the sections you
touched) and `docs/01_PROGRESS_TRACKER.md`. The `update-docs` skill in
`.agents/SKILLS.md` is the cheap procedure for exactly this — use it.

---

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

`docs/project-knowledge.md` describes the codebase as it is today; the numbered
`docs/NN_*.md` files describe where it is going. §1 maps task areas to the file
you should open first.

Your job is to use these docs as the source of truth while implementing the app.

---

## Operating Rules

### 1. Read the docs before acting

Before making architectural, schema, auth, permission, editor, or deployment changes, inspect the relevant docs.

All paths below are relative to `docs/`. Core map:

| Task Type | Read First |
|---|---|
| Current codebase reality | `project-knowledge.md` |
| Overall direction | `00_MASTER_PLAN.md` |
| What to work on next | `01_PROGRESS_TRACKER.md`, `07_MVP_TASKS.md` |
| Infra/deployment | `02_ARCHITECTURE.md`, `06_DEPLOYMENT.md` |
| Database/schema | `03_DATA_MODEL.md` |
| Auth/access control | `04_AUTH_AND_PERMISSIONS.md` |
| Editor/collaboration | `05_EDITOR_AND_COLLAB.md` |
| README/resume/portfolio polish | `08_RESUME_NOTES.md` |

Feature-area plans — read the one that matches what you are touching:

| Area | Plan |
|---|---|
| Markdown backbone | `09_MARKDOWN_PIVOT_PLAN.md` |
| Workspace UI/shell | `10_WORKSPACE_UI_REVAMP_PLAN.md` |
| Assets and library | `11_ASSET_STORAGE_AND_LIBRARY_PLAN.md` |
| Extension registry | `12_EXTENSION_REGISTRY_PLAN.md` |
| Settings modal, extension browser | `13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` |
| Metadata, tags, search | `14_METADATA_TAGS_SEARCH_PLAN.md` |
| MCP integration | `15_MCP_INTEGRATION_PLAN.md` |
| Agent extension actions | `16_AGENT_EXTENSION_ACTIONS_PLAN.md` |
| Polish, hardening, CSS snippets | `17_POLISH_AND_CSS_SNIPPETS_PLAN.md` |
| Editor slash commands | `18_EDITOR_SLASH_COMMANDS_PLAN.md` |
| Calc extension | `19_CALC_EXTENSION_PLAN.md` |
| Dictionary extension | `20_DICTIONARY_EXTENSION_PLAN.md` |
| Definition authoring and previews | `21_DEFINITION_AUTHORING_AND_PREVIEWS_PLAN.md` |
| Code highlighting, formatting, and execution | `22_CODE_BLOCKS_AND_EXECUTION_PLAN.md` |

Standing contracts, read when the change touches them:

| Contract | Doc |
|---|---|
| Styling document content | `CSS_CONTRACT.md` |
| Den embed bridge | `DEN_EMBED_BRIDGE.md` |

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

### 11. Load the matching skill before specialist work

`.agents/SKILLS.md` indexes the repo's skills — self-contained markdown
procedures for recurring kinds of work (doc upkeep, shadcn/ui, frontend design,
GitHub Actions).

- **Claude Code** surfaces these automatically; invoke the named skill.
- **Codex and every other agent** must open the index and read the matching
  `SKILL.md` themselves. Nothing loads it for you.

Check the index when you start a unit of work, and again before you finish — the
`update-docs` skill is the required procedure for §5/§6 doc upkeep. Read only the
rows that match; loading an irrelevant skill wastes context.

Skill instructions outrank your default approach. They never outrank this file
or an explicit instruction from the user.

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
1. Read relevant docs (project-knowledge.md, then the plan for the area).
2. Check .agents/SKILLS.md and load any matching skill.
3. Inspect current code.
4. Compare docs vs current implementation.
5. Implement the smallest useful slice.
6. Verify: tsc --noEmit, lint, test (build for larger changes).
7. Update progress tracker.
8. Update project-knowledge.md (see the update-docs skill).
9. Summarize what changed and what remains.
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
