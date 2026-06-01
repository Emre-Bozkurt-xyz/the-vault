# Vault — Editor and Collaboration Plan

Note:

```txt
The original implementation used Tiptap/ProseMirror JSON. The active local development direction is the Markdown-native replacement documented in `docs/09_MARKDOWN_PIVOT_PLAN.md`.
```

Current Markdown pivot status:

```txt
Editable document pages now use CodeMirror for Markdown source editing.
Viewer/public pages render `documents.markdown` with sanitized raw HTML support.
Source/split/preview modes exist locally.
The Markdown editor is wired to Hocuspocus/Yjs through `Y.Text` when `NEXT_PUBLIC_COLLAB_URL` is set.
```

---

## 1. MVP Editor Strategy

Use:

```txt
Tiptap
ProseMirror JSON
```

Do **not** start with real-time collaboration. First build a stable single-user editor with database persistence and permissions.

MVP editor should support:

- Paragraphs.
- Headings.
- Bold.
- Italic.
- Bullet list.
- Ordered list.
- Code block.
- Blockquote.
- Link, optional.
- Document title.

---

## 2. Content Storage Format

Store editor content as JSONB in Postgres:

```txt
documents.content JSONB
```

Example shape:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "My First Vault Doc" }]
    }
  ]
}
```

Avoid storing HTML as the source of truth.

Why:

- ProseMirror JSON is structured.
- Easier to render safely.
- Easier to migrate later.
- Better for collaboration later.

---

## 3. Editor Component Structure

Recommended files:

```txt
components/editor/VaultEditor.tsx
components/editor/EditorToolbar.tsx
components/editor/ReadOnlyDocument.tsx
components/editor/editor-extensions.ts
```

### `VaultEditor.tsx`

Responsibilities:

- Initialize Tiptap.
- Load initial JSON.
- Track dirty state.
- Trigger save action.
- Optionally autosave.

### `EditorToolbar.tsx`

Responsibilities:

- Bold/italic.
- Heading selector.
- Lists.
- Code block.
- Undo/redo.

### `ReadOnlyDocument.tsx`

Responsibilities:

- Render public documents.
- Render viewer-only documents.
- No editable controls.

---

## 4. Save Strategy

Start with manual save.

Then add autosave.

### Manual Save MVP

```txt
User edits document
  |
Save button becomes active
  |
User clicks Save
  |
Server action validates permission
  |
Database update
```

### Autosave v1

Autosave after debounce:

```txt
editor update
  |
wait 1000-2000ms
  |
if dirty, save
```

Show status:

```txt
Saved
Saving...
Unsaved changes
Error saving
```

### Autosave Warning

Do not autosave every keystroke directly to Postgres. Debounce it.

---

## 5. Validation

Before saving:

- Confirm user can edit document.
- Validate document ID.
- Validate title length.
- Validate content size.
- Reject extremely large payloads.

Suggested limits:

```txt
title max: 200 chars
content JSON max: 1-2 MB for MVP
```

---

## 6. Viewer Mode

If user role is `viewer`:

- Render read-only document.
- Disable editor controls.
- Hide save button.
- Hide title editing.

If user role is `editor` or `owner`:

- Render editable document.

---

## 7. Public Rendering

Public route:

```txt
/public/[slug]
```

Should use:

```txt
ReadOnlyDocument
```

Do not load the full dashboard/editor shell.

Make it feel like a clean public article page.

---

## 8. Collaboration v2

Implemented first collaboration slice with:

```txt
Yjs
Hocuspocus server/provider
Tiptap Collaboration extension
Tiptap CollaborationCursor extension
```

Architecture:

```txt
Browser editor
  |
  | WebSocket
  v
vault-collab service
  |
  +-- authorization check
  +-- Yjs document room
  +-- persistence
```

---

## 9. Collaboration Authorization

Do not allow clients to connect directly to arbitrary document rooms.

Bad:

```txt
ws://server/doc-123
```

Better:

```txt
Next.js document page creates short-lived room token
  |
Server checks canEditDocument/canReadDocument
  |
Server issues signed token
  |
Client connects to collab server with token
  |
Collab server validates token
  |
Collab server re-checks current database edit permission
```

Room token includes:

```txt
document_id
user_id
role
expires_at
signature
```

---

## 10. Collaboration Roles

For Yjs:

```txt
owner/editor:
  can connect read-write

viewer:
  read-only, or no collab connection for MVP

anonymous public user:
  read-only static render
```

Read-only Yjs clients can be tricky. Simpler:

- Only editors connect to Yjs.
- Viewers receive normal rendered content.
- Public users receive static rendered content.

---

## 11. Persistence Options

### Simple Post-MVP

Current Markdown pivot slice serializes the collaborative Y.Doc text back to `documents.markdown` through `onStoreDocument`.

Later, use Yjs updates stored in database.

```txt
yjs_updates
  id
  document_id
  update BYTEA
  created_at
```

Periodically compact updates into a snapshot.

### Easier MVP-ish Alternative

Use Yjs for live editing, but periodically serialize current editor JSON back to `documents.content`.

This is less ideal but simpler.

---

## 12. Collaboration Deployment

Add service:

```yaml
collab:
  build:
    context: .
    dockerfile: Dockerfile.collab
  environment:
    DATABASE_URL: ...
    AUTH_SECRET: ...
  ports:
    - "127.0.0.1:18211:1234"
```

Caddy later:

```caddy
collab.vault.ems-place.com {
    reverse_proxy 127.0.0.1:18xxx
}
```

Or path-based:

```caddy
vault.ems-place.com {
    reverse_proxy /collab/* 127.0.0.1:18xxx
    reverse_proxy 127.0.0.1:18yyy
}
```

Subdomain is cleaner.

---

## 13. Editor MVP Checklist

| Status | Item |
|---|---|
| [x] | Install Tiptap |
| [x] | Create editor component |
| [x] | Store content as JSONB |
| [x] | Load document into editor |
| [x] | Save document content |
| [x] | Save document title |
| [x] | Add toolbar |
| [x] | Add read-only renderer |
| [x] | Add viewer mode |
| [x] | Add public document render |
| [x] | Add dirty/saved state |
| [x] | Add autosave, optional |

---

## 14. Collaboration Checklist

| Status | Item |
|---|---|
| [x] | Install Yjs |
| [x] | Create websocket server |
| [x] | Add document room model |
| [x] | Add room token generation |
| [x] | Add token validation |
| [x] | Add Tiptap collaboration extension |
| [x] | Add cursor/presence |
| [x] | Add persistence |
| [x] | Add Docker service |
| [ ] | Add Caddy/FRP route |
| [ ] | Test two-user editing |
