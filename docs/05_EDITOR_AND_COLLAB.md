# Vault — Editor and Collaboration Plan

Current implementation note:

```txt
The original implementation used Tiptap/ProseMirror JSON. Vault is now Markdown-native: document bodies live in `documents.markdown`, editable pages use CodeMirror, and live collaboration uses Y.Text through Hocuspocus/Yjs.
```

Current Markdown pivot status:

```txt
Editable document pages now use CodeMirror for Markdown source editing.
Viewer/public pages render `documents.markdown` with sanitized raw HTML support.
Source/split/preview modes exist locally.
The Markdown editor is wired to Hocuspocus/Yjs through `Y.Text` when `NEXT_PUBLIC_COLLAB_URL` is set.
Production collaboration and Markdown editing have been user-confirmed working.
```

---

## 1. MVP Editor Strategy

Use:

```txt
CodeMirror 6
Markdown text
```

The previous Tiptap/ProseMirror editor has been removed. Keep future editor work Markdown-first unless there is an explicit product decision to change the document backbone again.

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

Store editor content as Markdown text in Postgres:

```txt
documents.markdown TEXT
```

Example shape:

```json
# My First Vault Doc

Start writing...
```

Avoid storing rendered HTML as the source of truth.

Why:

- Markdown is plain text and matches the intended Obsidian-like writing model.
- CodeMirror and Y.Text collaborate naturally over text.
- Public/viewer rendering can sanitize Markdown/HTML at the rendering boundary.
- Recovery/version history can store compact Markdown snapshots.

---

## 3. Editor Component Structure

Current files:

```txt
components/markdown/MarkdownEditor.tsx
components/markdown/MarkdownToolbar.tsx
components/markdown/MarkdownDocument.tsx
```

### `MarkdownEditor.tsx`

Responsibilities:

- Initialize CodeMirror.
- Load initial Markdown.
- Track dirty state.
- Trigger save action.
- Autosave.
- Bind to Y.Text when collaboration is available.
- Render source/live/split/preview modes.

### `MarkdownToolbar.tsx`

Responsibilities:

- Bold/italic/link/code syntax.
- Heading selector.
- Lists.
- Task list.
- Blockquote.
- Code fence/table/horizontal rule insertion.

### `MarkdownDocument.tsx`

Responsibilities:

- Render public documents.
- Render viewer-only documents.
- No editable controls.
- Sanitize raw Markdown HTML and allow only explicit safe iframe providers.

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
markdown max: 1 MB for current implementation
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
MarkdownDocument
```

Do not load the full dashboard/editor shell.

Make it feel like a clean public article page.

---

## 8. Collaboration v2

Implemented collaboration slice with:

```txt
Yjs
Hocuspocus server/provider
Y.Text
y-codemirror.next
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
| [x] | Install CodeMirror Markdown editor |
| [x] | Create Markdown editor component |
| [x] | Store content as Markdown text |
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
| [x] | Add CodeMirror/Y.Text binding |
| [x] | Add cursor/presence |
| [x] | Add persistence |
| [x] | Add Docker service |
| [x] | Add Caddy/FRP route |
| [x] | Test two-user editing |
