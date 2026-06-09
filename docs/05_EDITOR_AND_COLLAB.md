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

## 2.1 Wiki Links and Attachments

Document titles are display labels, not stable identifiers. Do not add a global
or per-user uniqueness constraint to private document titles just to support
wiki links; repeated titles such as "Meeting notes" or "Draft" should remain
valid user behavior.

Canonical internal document links should use stable IDs:

```txt
[[doc:<document-id>|Readable label]]
```

Convenience title links are allowed:

```txt
[[Readable title]]
[[Readable title|Custom label]]
```

Resolution rules:

- `[[doc:id|label]]` resolves by document ID when the current viewer can read
  the target.
- `[[Title]]` resolves only when exactly one readable document has that title.
- `[[doc:id#heading|label]]`, `[[doc:id|label#heading]]`, and
  `[[Title#heading]]` link to heading anchors inside the resolved document.
  Title-based heading links use the last `#` as the heading separator; canonical
  `doc:id` links are the robust form when a title itself contains `#`.
- `[[doc:id#^block-id|label]]` links to an Obsidian-style block anchor. A block
  anchor can be written inline at the end of a block or on its own line after a
  block; preview/public rendering hides the `^block-id` marker. Embeds with the
  same fragment render only that block.
- `[[doc:id#@region-id|label]]` links to a Vault region declared with hidden
  HTML comments:

```md
<!-- vault-region id="region-id" title="Region title" foldable collapsed -->
...
<!-- /vault-region -->
```

  Region markers are hidden in preview/public rendering. Embeds with the same
  fragment render only the Markdown between the markers. `foldable` renders the
  region as a collapsible disclosure block, and `collapsed` makes it initially
  closed.
- Ambiguous title links render as unresolved/ambiguous and should be fixed by
  selecting a specific document from future autocomplete.
- Public rendering resolves links only to public document routes.
- Public rendering must never expose private document IDs or private app routes;
  private or inaccessible links render as non-clickable text.
- Publishing should eventually warn when the document contains private or
  unresolved wiki links, but publishing should not be blocked solely because
  the author included private references.

Current first slice:

- Preview/view/public Markdown rendering supports `[[...]]` document links
  using server-provided permission-aware resolution maps.
- External image embeds support Obsidian-like `![[https://...]]` syntax by
  translating it to standard Markdown image rendering; live mode renders
  inactive external image embeds as stable preview frames.
- Standalone document embeds support `![[doc:id|label]]` and unambiguous
  `![[Title]]` syntax. They render as inline transclusions with a subtle left
  rail in Preview/view/public and Live mode. Embeds use the same permission-aware
  wiki map as normal wiki links; public pages only embed public documents.
  Recursive embeds are capped. Heading fragments on embeds render only the
  selected heading's owned section, from that heading until the next heading of
  equal or higher level. Block fragments render only the selected block. Region
  fragments render only the Markdown inside the hidden region markers.

Future slices:

- `![[asset:id]]` uploaded document assets served through permission-checked
  routes.

Current editor behavior:

- CodeMirror wiki autocomplete fetches the current readable document map from
  `/api/documents/wiki-links` when completion starts in either `[[...]]` links
  or `![[...]]` document embeds, then inserts canonical `doc:id|title` targets.
  Arrow keys navigate suggestions, Tab/Enter accept the selected suggestion,
  Escape closes the popup, and mouse selection applies the completion.
  Completion is bracket-aware: if CodeMirror has already paired `[[|]]`, the
  suggestion fills the inside and leaves the existing closing marker instead of
  adding another `]]`; if completion has to insert `]]`, it leaves the cursor
  before the closing marker so the user can keep typing. Typing `#` inside a
  wiki field explicitly starts fragment completion, including after accepting a
  canonical `doc:id|title` completion. Fragment completion can suggest headings,
  `^block-id` block anchors, and `@region-id` Vault regions.
- HTML tag autocomplete is available in editable Source, Split, and Live modes.
  Vault's custom wiki-link completion is registered alongside CodeMirror's HTML
  completion instead of replacing it.
- The Region toolbar button and `Ctrl/Cmd+Alt+R` insert a foldable collapsed
  Vault region scaffold. If text is selected, the scaffold wraps the selection.
- Live mode hides inactive wiki-link markers and styles the visible label; moving
  the cursor into the link reveals the source.
- Live mode renders standalone document embeds as a single-line source widget,
  so the `![[...]]` line can expand visually without needing multi-line
  CodeMirror block replacement.

Uploaded assets should be private-by-default document attachments, not public
opaque URLs. Store metadata in a future `document_assets` table and serve files
through routes that check `canReadDocument()` before returning the object.

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
- Render Obsidian-style callouts from blockquote syntax with snippet-ready CSS hooks.

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

Current recovery layer stores batched Markdown checkpoints in `document_versions`.
It does not store every Yjs update or every keystroke.

Checkpoint rules:

```txt
normal save:
  create a previous-state checkpoint before overwrite when the latest checkpoint
  is older than 10 minutes, missing, or the change is large

collab save:
  same batching policy from the Hocuspocus store hook, reason = collab

manual:
  user can create a restore point from the document History panel

restore/archive:
  create a protective checkpoint before restoring or archiving
```

Later, if lower-level replay is needed, use Yjs updates stored in database.

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
