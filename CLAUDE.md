# CLAUDE.md

## Read before acting — not optional

Before answering any non-trivial question or making any change in this repo, read:

1. **`AGENTS.md`** — the operating rules for this codebase (docs-first workflow, security, MVP discipline, architecture, doc-maintenance duties). Everything below is a pointer into it; that file is authoritative.
2. **`docs/project-knowledge.md`** — the living map of what actually exists right now (file structure, schema, auth, known bugs, and a dated changelog). Trust this over memory and over the planning docs when they disagree.

Then read the specific planning doc for the area you're touching, per the map in `AGENTS.md §1`:

| Task area | Read first |
|---|---|
| Overall direction | `docs/00_MASTER_PLAN.md` |
| What to work on next | `docs/01_PROGRESS_TRACKER.md`, `docs/07_MVP_TASKS.md` |
| Infra / deployment | `docs/02_ARCHITECTURE.md`, `docs/06_DEPLOYMENT.md` |
| Database / schema | `docs/03_DATA_MODEL.md` |
| Auth / permissions | `docs/04_AUTH_AND_PERMISSIONS.md` |
| Editor / collaboration | `docs/05_EDITOR_AND_COLLAB.md` |
| Current codebase reality | `docs/project-knowledge.md` |

Do **not** implement from memory or assumptions about what this app is. It is **Vault**, a self-hosted Next.js collaborative document/note platform (not Obsidian, not a generic vault) — confirm specifics in the code and docs before acting.

## After acting — keep the docs honest

Per `AGENTS.md §5/§6`, when you complete a meaningful change:

- Update **`docs/project-knowledge.md`** (add a dated changelog row; update the relevant section) whenever you change file structure, schema, env vars, auth/session behavior, permission helpers, server actions, API routes, deployment, known bugs, or an important implementation decision.
- Update **`docs/01_PROGRESS_TRACKER.md`** when a tracked task's status changes (`[ ]`/`[~]`/`[x]`/`[!]`).
- If implementation diverges from a planning doc, update that doc rather than letting it rot.

## Verification norms

The house checks (see recent changelog entries) are: `npx tsc --noEmit`, `npm run lint`, `npm test` (vitest), and `npm run build` for larger changes. Note the file `components/markdown/MarkdownEditor.tsx` carries **pre-existing** react-hooks ESLint errors unrelated to most edits — compare against baseline before attributing lint failures to your change.
