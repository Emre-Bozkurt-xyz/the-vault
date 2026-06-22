# Vault Extension Registry Plan

## 1. Goal

Vault should support rich, optional features without turning the core editor into
a pile of hardcoded special cases.

The first extension system should support **trusted built-in extensions** only.
These are features written and shipped by Vault, but registered through a shared
interface so they can be enabled, disabled, composed, and eventually exposed as a
verified plugin surface.

Important distinction:

```txt
Math/LaTeX is a core Markdown editor feature, not an extension.
```

Extensions are for optional product capabilities such as calendars, drawings,
stickers, widgets, kanban boards, custom panels, and other non-core workflows.

---

## 2. Extension Categories

Vault needs more than one extension shape.

### Markdown Content Extensions

These live directly in `documents.markdown`.

Examples:

```md
:::calendar {view=month source=tasks}
:::

:::drawing id="diagram-1"
:::
```

Responsibilities:

- Parse Markdown source.
- Render in Read mode.
- Render as a specialized block widget in Live mode.
- Reveal source when the cursor enters the source range.
- Add toolbar commands, autocomplete, and optional formatting panels.

Use this for content that should be portable in the Markdown document and visible
where the document is rendered.

### Document State Extensions

These do **not** live in Markdown. They attach extra state to a document.

Examples:

- Stickers placed around a page, including outside the document text bounds.
- Canvas annotations.
- Per-document layout metadata.
- Reading-progress overlays.
- Floating widgets that are not part of exported Markdown.

Responsibilities:

- Store extension state outside `documents.markdown`.
- Load only after the viewer has document read access.
- Save only after the actor has document edit access.
- Render as document-layer overlays in the editor/read workspace.
- Decide separately whether the state appears on public pages.

Use this for interactive or visual features where Markdown would be the wrong
source of truth.

### Workspace Extensions

These add pages, side panels, commands, or app-level tools.

Examples:

- Calendar page.
- Backlinks graph.
- Asset organizer.
- Command palette actions.
- Custom right-panel inspector.

Responsibilities:

- Register workspace routes/panels/actions.
- Reuse existing auth and profile gates.
- Avoid direct private data access; fetch through server helpers.

### Asset-Backed Extensions

These use uploaded assets as part of their state.

Examples:

- Drawings saved as JSON/SVG/PNG assets.
- Sticker packs.
- Audio/video widgets.
- PDF annotation layers.

Responsibilities:

- Use private R2 bytes through Vault asset APIs.
- Store metadata in Postgres.
- Never insert raw R2 URLs into extension state.
- Respect asset visibility independently from document visibility.

---

## 3. Storage Model

Do not add one generic JSON field directly to `documents`.

Reason:

- It becomes hard to permission, query, audit, version, and clean up.
- Large extension state would bloat every document read.
- Multiple extensions would fight over one opaque blob.

Preferred first schema:

```ts
document_extension_states
  id uuid primary key
  document_id uuid not null references documents(id) on delete cascade
  extension_id text not null
  state_key text not null default 'default'
  state jsonb not null
  version integer not null default 1
  visibility text not null default 'private'
  created_by uuid references users(id) on delete set null
  updated_by uuid references users(id) on delete set null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
  deleted_at timestamptz

unique(document_id, extension_id, state_key)
index(document_id)
index(extension_id)
index(visibility)
```

Visibility values:

```txt
private       Only readable with document access.
public        May render on public document pages if the document is public.
editor-only   Only shown inside the authenticated editor/workspace.
```

This supports both one-state-per-extension and many named states per extension.

Examples:

```txt
document_id = doc-1
extension_id = stickers
state_key = layer
state = { stickers: [...] }

document_id = doc-1
extension_id = drawing
state_key = "diagram-1"
state = { assetId: "...", viewport: ... }
```

---

## 4. Registry Shape

The registry should describe what an extension contributes without giving it
unrestricted access to the app.

Initial trusted TypeScript shape:

```ts
type VaultExtension = {
  id: string;
  name: string;
  version: number;
  kind: "core" | "built-in";

  markdown?: {
    liveBlocks?: LiveBlockSpec[];
    preprocessors?: MarkdownPreprocessor[];
    renderers?: MarkdownRendererContribution[];
    completions?: CompletionContribution[];
    toolbarItems?: ToolbarContribution[];
  };

  documentState?: {
    schemas: ExtensionStateSchema[];
    overlays?: DocumentOverlayContribution[];
    inspectors?: DocumentInspectorContribution[];
  };

  workspace?: {
    pages?: WorkspacePageContribution[];
    panels?: WorkspacePanelContribution[];
    commands?: CommandContribution[];
  };
};
```

The runtime should expose a curated context, not global app internals:

```ts
type ExtensionRuntimeContext = {
  document: { id: string; canRead: boolean; canEdit: boolean };
  user: { id: string; role: "user" | "admin" } | null;
  assets: ExtensionAssetApi;
  state: ExtensionStateApi;
};
```

For built-in extensions this is mostly organization. For future verified
plugins, this context becomes the security boundary.

---

## 5. Live Preview Registry

The current `components/markdown/live-blocks.ts` already proves the right model:
syntax-aware scanners plus direct `StateField<DecorationSet>` block widgets.

Refactor target:

```ts
type LiveBlockSpec<TBlock extends LiveBlockInstance = LiveBlockInstance> = {
  id: string;
  priority: number;
  scan: (state: EditorState, context: LiveBlockScanContext) => TBlock[];
  isActive?: (state: EditorState, block: TBlock) => boolean;
  widget: (block: TBlock, context: LiveBlockWidgetContext) => WidgetType;
};
```

Then the existing hardcoded blocks become built-in specs:

- `assetGroupLiveBlock`
- `calloutLiveBlock`
- `documentEmbedLiveBlock`

Future specs:

- `calendarLiveBlock`
- `drawingLiveBlock`
- `kanbanLiveBlock`
- `widgetLiveBlock`

Rules:

- Block scanners must ignore fenced code blocks and other excluded syntax.
- Rendered widgets must reveal source when the cursor or selection enters their
  source range.
- Vertical-layout-changing widgets must be provided through direct decoration
  sources, not viewport-only plugins.
- Read mode remains the visual source of truth.

---

## 6. Document Overlay Model

Stickers and page-level decorations should be separate from the Markdown editor.

Conceptual layers:

```txt
Workspace document tab
  document column
    title
    toolbar/mode controls
    Markdown editor/read surface
  extension overlay root
    stickers layer
    annotation layer
    drawing handles
```

Overlay coordinates should be explicit and stable:

```ts
type StickerState = {
  stickers: Array<{
    id: string;
    assetId: string;
    x: number;
    y: number;
    coordinateSpace: "document" | "viewport";
    width: number;
    rotation: number;
    zIndex: number;
  }>;
};
```

Coordinate spaces:

- `document`: relative to the document surface or document page origin.
- `viewport`: relative to the workspace tab viewport.

Start with `document`; add `viewport` only when there is a clear use case.

Permissions:

- Read document -> can load public/private readable extension state.
- Edit document -> can mutate extension state.
- Public page -> can only load extension state marked `public`.

Collaboration:

- First version can use normal debounced JSON saves.
- Later real-time overlays can use Yjs subdocuments/maps per extension.

---

## 7. Verified Plugin Path

Do not allow arbitrary third-party JavaScript in the first implementation.

Milestones:

1. **Built-in registry**
   - All extensions are local TypeScript modules shipped with Vault.
   - No external plugin packages.

2. **Admin-enabled built-ins**
   - Admin can enable/disable built-in extensions globally.
   - Optional per-user or per-document enablement later.

3. **Manifested verified plugins**
   - Plugin has a manifest with extension id, version, permissions, and
     contribution points.
   - Code is reviewed and bundled by Vault, not uploaded by random users.

4. **Sandboxed external plugins**
   - Only consider after Vault has a stable permission/runtime API.
   - Third-party code must not get raw database access, raw assets, auth tokens,
     or unrestricted DOM access around private documents.

Manifest sketch:

```json
{
  "id": "vault.stickers",
  "name": "Stickers",
  "version": "1.0.0",
  "permissions": ["document:read", "document:write-extension-state", "asset:read"],
  "contributes": {
    "documentOverlays": ["stickers"],
    "workspacePanels": ["stickers"]
  }
}
```

---

## 8. What Should Stay Core

Keep these as core editor/document features:

- Markdown source storage.
- CodeMirror editor.
- Read/Live/Source modes.
- Wiki links and document embeds.
- Uploaded assets and asset embeds.
- Safe HTML rendering.
- Obsidian-style callouts.
- LaTeX/math rendering.
- Permission checks.
- Collaboration.
- Version history.

Make these extensions:

- Calendar.
- Stickers.
- Drawings.
- Kanban.
- Custom widgets.
- Page decorations.
- Optional workspace tools.

---

## 9. Implementation Slices

### Slice 1: Planning and Types

- Add this plan.
- Add a small `lib/extensions/` folder with registry types only.
- Do not add runtime behavior yet.

### Slice 2: Live Block Registry

- Extract live block interfaces from `live-blocks.ts`.
- Convert asset groups, callouts, and document embeds into built-in live block
  specs.
- Keep output behavior identical.
- Verify with existing editor flows.

### Slice 3: Extension State Schema

- Add `document_extension_states`.
- Add server helpers:
  - `getDocumentExtensionStateForUser`
  - `upsertDocumentExtensionStateForUser`
  - `listPublicDocumentExtensionStates`
- Enforce document read/edit permissions server-side.

### Slice 4: Overlay Host

- Add an extension overlay root around document editor/read surfaces.
- Implement no-op extension mounting.
- Ensure scroll/resize math works in the workspace shell.

### Slice 5: Stickers Prototype

- Built-in trusted `stickers` extension.
- Use uploaded public/private image assets as sticker sources.
- Store positions in `document_extension_states`.
- Render only inside authenticated workspace first.
- Add public rendering later only if `visibility=public`.

### Slice 6: Verified Plugin Design

- Add extension manifests.
- Add admin extension settings.
- Keep third-party publishing disabled until the built-in API proves stable.

---

## 10. Open Questions

- Should extension state be included in restore points/version history?
  - Recommendation: not initially. Add extension-owned history later for large
    interactive state.
- Should public documents show document-state extensions by default?
  - Recommendation: no. Require `visibility=public` per extension state.
- Should stickers be document-relative or viewport-relative?
  - Recommendation: start document-relative.
- Should built-in extensions be per-user toggleable?
  - Recommendation: global enabled first, user preferences later.
