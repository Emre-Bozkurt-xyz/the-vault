# Vault - Markdown Backbone Pivot Plan

## 1. Goal

Pivot Vault from a Tiptap/ProseMirror-JSON document model to a Markdown-native document model.

Target experience:

```txt
Obsidian-like Markdown editor on the web:
  - Markdown text is the real source of truth.
  - Toolbar buttons stay and insert Markdown syntax.
  - Keyboard-first writing feels natural.
  - Code fences, tables, task lists, frontmatter, callouts, and links feel first-class.
  - Collaboration still shows remote cursors/selections.
  - Live preview renders Markdown beautifully without making the source feel secondary.
```

This is a product direction change, not just an editor plugin swap.

---

## 2. Current Starting Point

Current implementation:

```txt
documents.content JSONB
  ProseMirror/Tiptap JSON

components/editor/VaultEditor.tsx
  Tiptap editor
  Tiptap collaboration extension
  autosave
  toolbar

scripts/collab-server.mjs
  Hocuspocus/Yjs service
  loads ProseMirror JSON
  stores ProseMirror JSON
```

Current collaboration model:

```txt
Yjs document room
  -> Tiptap Collaboration extension
  -> ProseMirror tree
  -> documents.content JSONB
```

Target collaboration model:

```txt
Yjs document room
  -> Y.Text
  -> CodeMirror Markdown editor
  -> documents.markdown TEXT
```

---

## 3. Non-Negotiables

- Markdown must become the canonical stored document body.
- The editor should feel like editing a real `.md` document.
- Collaboration must still show useful remote cursor/selection presence.
- Server-side auth and document permissions must remain the gate for every document read/write.
- Public rendering must sanitize Markdown/HTML output.
- Deployment must not rely on hidden manual DB changes unless explicitly documented.
- Every schema change must have a Drizzle migration and a production migration plan.

---

## 4. Technology Direction

### Editor

Use CodeMirror 6 as the primary Markdown editor.

Reason:

```txt
CodeMirror is a text editor. Markdown is text.
Tiptap is a structured rich-text editor. ProseMirror JSON is not Markdown.
```

Likely packages:

```txt
@codemirror/state
@codemirror/view
@codemirror/commands
@codemirror/language
@codemirror/lang-markdown
@codemirror/search
@codemirror/autocomplete
@codemirror/theme-one-dark, optional
y-codemirror.next
```

### Collaboration

Keep:

```txt
Yjs
Hocuspocus
signed room tokens
DB permission re-checks
```

Replace:

```txt
Tiptap Collaboration extension
```

With:

```txt
Y.Text + CodeMirror Yjs binding
```

Remote cursors/selections still work, but they appear in Markdown source text rather than a rendered rich-text surface.

### Rendering

Use a Markdown rendering pipeline for read-only and public pages.

Recommended shape:

```txt
markdown string
  -> Markdown parser
  -> sanitize HTML / safe React rendering
  -> themed document view
```

HTML policy:

```txt
Allowed:
  - fenced code blocks containing HTML source
  - inline code showing HTML source

Current:
  - sanitized raw HTML rendering through an explicit allowlist
  - no scripts, event handlers, iframes, forms, inline styles, or unsafe URL protocols
```

Raw HTML in Markdown is a security boundary. Treat unsafe rendering as a bug.

---

## 5. Target Data Model

Preferred transitional schema:

```txt
documents
  id UUID PRIMARY KEY
  owner_id UUID NOT NULL
  title TEXT NOT NULL
  markdown TEXT NOT NULL DEFAULT ''
  content JSONB NULL              -- legacy during migration only
  visibility TEXT NOT NULL DEFAULT 'private'
  public_slug TEXT UNIQUE
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
  deleted_at TIMESTAMP
```

Later final schema:

```txt
documents
  id UUID PRIMARY KEY
  owner_id UUID NOT NULL
  title TEXT NOT NULL
  markdown TEXT NOT NULL DEFAULT ''
  visibility TEXT NOT NULL DEFAULT 'private'
  public_slug TEXT UNIQUE
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
  deleted_at TIMESTAMP
```

Why keep `content` temporarily:

```txt
- Safer deploys.
- Rollback remains possible.
- Existing documents can be backfilled into Markdown.
- We can compare old rendering vs new rendering during transition.
```

If existing production documents do not matter, a full wipe is acceptable, but it should still be deliberate and scripted.

---

## 6. Migration Strategy

### Preferred: Expand-Then-Contract

Use this unless there is a strong reason to wipe.

Phase A - Expand:

```txt
1. Add documents.markdown TEXT NOT NULL DEFAULT ''.
2. Keep documents.content JSONB.
3. Update createDocumentAction() to write markdown.
4. Update read paths to prefer markdown when present, fallback to content.
5. Keep old Tiptap editor operational until Markdown editor is stable.
```

Phase B - Backfill:

```txt
1. Add a script to convert existing ProseMirror JSON to Markdown.
2. Run it locally first.
3. Run it in production after backup.
4. Mark converted documents with non-empty markdown.
```

Phase C - Switch:

```txt
1. Replace editor route with Markdown editor.
2. Replace public/viewer renderer with Markdown renderer.
3. Replace collab service load/store with Y.Text markdown load/store.
4. Stop writing ProseMirror JSON.
```

Phase D - Contract:

```txt
1. After production has run Markdown-only for a while, remove documents.content.
2. Remove Tiptap editor/rendering code.
3. Remove ProseMirror JSON validation helpers.
```

### Full Wipe Option

Use this only if you explicitly decide production document data can be destroyed.

This is simpler because there is no content conversion:

```txt
1. Stop production services.
2. Take one final backup anyway.
3. Drop the production Postgres volume or database.
4. Deploy Markdown schema.
5. Run migrations from scratch.
6. Recreate users through OAuth/dev flow.
```

The full wipe should be done manually with the exact production volume name confirmed on the server. Do not guess the volume name from memory.

Discovery command on server:

```bash
docker volume ls | grep vault
```

Backup before wipe:

```bash
bash scripts/backup-db.sh
```

Then, only after confirming the actual volume name:

```bash
docker compose -f docker-compose.production.yml down
docker volume rm <confirmed-vault-postgres-volume-name>
docker compose -f docker-compose.production.yml up -d postgres
docker compose -f docker-compose.production.yml --profile migrate run --rm migrate
docker compose -f docker-compose.production.yml up -d collab web
```

If the deploy script owns service startup, update the script first and use that path instead of manually starting mismatched services.

---

## 7. Deployment Safety Rules

Important repo fact:

```txt
Pushing to the deployment branch triggers the server deploy script.
```

Therefore:

- Do not push a commit that requires a manual DB change before the app can boot unless the deploy script already handles that migration.
- Prefer backward-compatible migrations first.
- Make migrations safe to run before the new app starts.
- Make the app tolerate both old and new schema during transition when possible.
- Keep destructive schema changes in a later commit after verification.
- Document any manual server step in the commit message or deployment notes.

Recommended deployment choreography for schema changes:

```txt
1. Commit migration that only adds nullable/defaulted columns.
2. Ensure app still boots if old content exists.
3. Push and let deploy run.
4. Run/confirm migration on server.
5. Verify health, login, dashboard, create doc.
6. Only then push editor behavior changes.
```

Better deploy script behavior:

```txt
git pull
docker compose build
docker compose up -d postgres
docker compose --profile migrate run --rm migrate
docker compose up -d collab web
docker compose ps
curl -f http://127.0.0.1:18210/healthz
```

For app-level readiness:

```bash
curl -f http://127.0.0.1:18210/api/health
```

---

## 8. Implementation Milestones

### Milestone 1 - Schema Prep

Goal:

```txt
documents.markdown exists and new documents can be Markdown-backed.
```

Current status:

```txt
Complete locally. `documents.markdown TEXT NOT NULL DEFAULT ''` has been added
to the Drizzle schema, migration `0003_slimy_puppet_master.sql` has been
generated and applied locally, and new documents now write initial Markdown
while legacy JSON remains the active editor/rendering format.
```

Tasks:

- Update `db/schema.ts`.
- Generate Drizzle migration.
- Update `docs/03_DATA_MODEL.md`.
- Update `docs/project-knowledge.md`.
- Update create/list/get document server actions.
- Keep Tiptap route working using fallback conversion or legacy content.

Acceptance:

```txt
npm run lint
npm run build
npm run db:migrate
create document locally
dashboard still loads
old docs still open
```

### Milestone 2 - Markdown Renderer

Goal:

```txt
Viewer/public pages render Markdown safely.
```

Tasks:

- Add Markdown rendering library. Done locally with `react-markdown` and `remark-gfm`.
- Add `components/markdown/MarkdownDocument.tsx`. Done locally.
- Support headings, lists, task lists, tables, links, code fences, blockquotes, horizontal rules. Done locally.
- Add syntax highlighting for code blocks if lightweight. Deferred.
- Sanitize or disallow raw HTML rendering. Done locally with `rehype-raw` plus an explicit `rehype-sanitize` allowlist.
- Replace public route renderer for Markdown-backed docs. Done locally.

Acceptance:

```txt
public doc renders from markdown
private viewer route renders from markdown
HTML code fence displays as code, not executable page HTML
```

### Milestone 3 - Markdown Editor Without Collaboration

Goal:

```txt
Owner/editor can edit Markdown source with toolbar and autosave.
```

Tasks:

- Add CodeMirror editor component. Done locally.
- Add Markdown syntax highlighting. Done locally.
- Add toolbar buttons that insert Markdown syntax. Done locally:
  - heading
  - bold
  - italic
  - link
  - bullet list
  - ordered list
  - task list
  - blockquote
  - inline code
  - code fence
  - table starter
- Save `documents.markdown`. Done locally through `saveMarkdownDocumentAction()`.
- Keep title editing. Done locally.
- Keep viewer read-only. Done locally.

Acceptance:

```txt
create Markdown doc
edit Markdown
autosave Markdown
reopen doc and source is preserved exactly
toolbar inserts Markdown, not rich-text nodes
```

### Milestone 4 - Markdown Collaboration

Goal:

```txt
Two authorized editors can collaboratively edit Markdown text with remote cursors/selections.
```

Tasks:

- Change collab room load/store from ProseMirror JSON to `documents.markdown`. Done locally.
- Use `Y.Text` per document. Done locally using the `markdown` shared text field.
- Wire CodeMirror to Yjs binding. Done locally with `y-codemirror.next`.
- Keep signed room token auth. Done locally.
- Keep DB permission re-check in collab service. Done locally.
- Keep viewer/public users out of collab. Done locally by only issuing tokens to owner/editor sessions.

Acceptance:

```txt
two browser sessions edit same Markdown source live
remote cursors/selections are visible
unauthorized user cannot connect
server stores final Markdown text
page reload shows latest Markdown
```

Current status:

```txt
Implemented at code/build level. Needs local two-browser verification with
`npm run collab` and `NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234`.
The editor remains in local-autosave mode until the provider reports synced,
so a stopped websocket should not blank the Markdown body or drop normal saves.
```

### Milestone 5 - Live Preview

Goal:

```txt
Markdown editor gains Obsidian-like live preview ergonomics.
```

Initial live preview modes:

```txt
Source mode:
  full Markdown source

Live mode:
  edit in CodeMirror
  inactive Markdown syntax is hidden/styled as preview
  cursor object remains source-like
  current default editor mode

Split mode:
  Markdown source left, rendered preview right

Preview mode:
  rendered document only
```

Later Obsidian-like live preview:

```txt
same editor surface
Markdown syntax remains editable
some syntax is visually softened
headings/lists/code blocks are styled in place
```

Tasks:

- Add preview mode state. Done locally.
- Render preview from current editor value without saving first. Done locally.
- Debounce preview rendering for large docs. Deferred.
- Keep toolbar available in source and split modes. Done locally.
- Add first-pass live mode. Done locally with CodeMirror decorations for headings, inline bold/italic/code/link, blockquotes, lists, and code fences. Inline marks reveal source when the cursor is inside that object; structural blocks reveal the relevant line/block.
- Add scroll sync later, not required in first slice.

Acceptance:

```txt
typing updates preview
code fences render correctly
HTML code is safe
toolbar remains usable
mobile layout does not break
```

---

## 9. Files Expected To Change

Likely additions:

```txt
components/markdown/MarkdownEditor.tsx
components/markdown/MarkdownDocument.tsx
components/markdown/MarkdownToolbar.tsx
components/markdown/markdown-renderer.ts
lib/markdown.ts
scripts/backfill-markdown.ts
```

Likely replacements/removals later:

```txt
components/editor/VaultEditor.tsx
components/editor/ReadOnlyDocument.tsx
components/editor/editor-extensions.ts
lib/editor-content.ts
scripts/collab-server.mjs ProseMirror load/store logic
```

Schema:

```txt
db/schema.ts
db/migrations/*
```

Docs:

```txt
docs/03_DATA_MODEL.md
docs/05_EDITOR_AND_COLLAB.md
docs/06_DEPLOYMENT.md
docs/project-knowledge.md
```

---

## 10. UX Requirements

Markdown editor should support:

- `#`, `##`, `###` headings.
- Bold/italic insertion.
- Links and wiki-link style later.
- Bullet and ordered lists.
- Task lists with checkboxes.
- Blockquotes.
- Inline code.
- Fenced code blocks with language names.
- Tables.
- Horizontal rules.
- Frontmatter display/editing.
- Drag/drop or paste image handling later.
- Command palette later.

Toolbar should remain:

```txt
Buttons insert Markdown syntax at selection.
Buttons never hide the fact that the document is Markdown.
```

Good first toolbar behavior:

```txt
Bold selected text:
  selected -> **selected**

Heading:
  line -> ## line

Code fence:
  insert:
    ```txt
    cursor
    ```
```

### Theming and CSS Snippets

Vault should eventually expose a deliberate rendered-document styling surface,
similar in spirit to Obsidian snippets.

Current foundation:

```txt
components/markdown/MarkdownDocument.tsx renders stable classes:
  .vault-markdown
  .vault-md-h1
  .vault-md-h2
  .vault-md-h3
  .vault-md-p
  .vault-md-ul
  .vault-md-ol
  .vault-md-li
  .vault-md-blockquote
  .vault-md-pre
  .vault-md-code
  .vault-md-table
  .vault-md-link
```

Future settings model:

```txt
1. Built-in document themes using CSS variables.
2. Per-user CSS snippets stored separately from document content.
3. Snippet enable/disable controls.
4. Sanitization/guardrails before snippets are applied to public pages.
```

Do not store custom CSS inside the Markdown document body. Treat user snippets
as presentation settings, not content.

---

## 11. Risks

### Collaboration Semantics

Markdown text collaboration is simpler than ProseMirror collaboration, but preview rendering can lag or jump if it is too eager.

Mitigation:

```txt
Use Y.Text as source of truth.
Debounce preview.
Do not make preview editable in first slice.
```

### Raw HTML

Markdown can contain raw HTML. Rendering arbitrary HTML can create XSS.

Mitigation:

```txt
Render HTML code fences as code.
Sanitize any raw HTML if enabled.
Raw HTML is allowed only through an explicit sanitizer allowlist in public/viewer rendering.
```

### Deployment

Automatic deploy on push can expose half-migrated code.

Mitigation:

```txt
Use additive migrations first.
Keep fallback reads.
Only remove legacy columns after production verification.
```

### Data Loss

Changing the backbone can lose formatting if conversion is poor.

Mitigation:

```txt
Keep content JSONB until conversion is verified.
Take backups.
Allow full wipe only as explicit manual decision.
```

---

## 12. Recommended First Commit

Do not start by deleting Tiptap.

First commit should only:

```txt
1. Add documents.markdown TEXT NOT NULL DEFAULT ''.
2. Generate migration.
3. New documents write markdown = default starter text or ''.
4. Existing document reads keep working.
5. Docs updated.
```

This is safe with auto-deploy and gives us a clean rollback point.

Suggested initial Markdown for new docs:

```md
# Untitled document

Start writing...
```

---

## 13. Definition Of Done For The Pivot

The Markdown pivot is complete when:

```txt
documents.markdown is the canonical source of truth.
Create/edit/save/reopen uses Markdown.
Public/viewer pages render Markdown safely.
Owner/editor collaboration uses Y.Text.
Remote cursors/selections work in Markdown source.
Toolbar inserts Markdown syntax.
Live preview is available.
Legacy ProseMirror JSON is no longer required.
Deployment and migration steps are documented and tested.
```
