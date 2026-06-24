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

Do not start the real stickers prototype until the settings modal and extension
browser checkpoint in `docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` is
complete. Stickers should be registered, enabled, configured, and mounted as a
normal built-in extension, not as one-off workspace/editor code.

### Slice 6: Verified Plugin Design

- Add extension manifests.
- Add admin extension settings.
- Keep third-party publishing disabled until the built-in API proves stable.

---

## 10. Near-Term Groundwork Plan

This is the concrete order for the next implementation pass.

### Slice A: Registry Runtime Skeleton

Goal: create a real registry without changing current behavior.

Status: first runtime pass exists in `lib/extensions/registry.ts`. It provides
ordered extension storage plus Markdown LiveBlockSpec/preprocessor selectors.
The current Live block engine now routes its core specs through a core
`VaultExtension`, while the later file split remains follow-up work.

Add:

```txt
lib/extensions/registry.ts
lib/extensions/core.ts
lib/extensions/built-ins.ts
```

Responsibilities:

- Export a single ordered list of enabled extensions.
- Keep pure metadata server-safe.
- Keep React/CodeMirror implementation pieces in client-safe modules.
- Provide helper selectors:
  - `getMarkdownLiveBlockSpecs()`
  - `getMarkdownPreprocessors()`
  - `getCompletionContributions()`
  - `getToolbarContributions()`
  - `getDocumentOverlayContributions()`
  - `getWorkspaceContributions()`

Important boundary:

```txt
Core Markdown features may register through the same registry plumbing, but
they are still core features. Optional extensions should be removable without
breaking Markdown rendering.
```

### Slice B: Move Live Block Specs Into Registry

Goal: use the registry to prove the architecture with existing behavior.

Current state:

```txt
components/markdown/live-blocks.ts owns the block engine and local specs for
asset groups, callouts, document embeds, and GFM tables.
```

Target state:

```txt
components/markdown/live-blocks.ts
  owns the generic CodeMirror block-decoration engine.

components/markdown/live-block-specs/
  owns current core Markdown live block specs:
    asset-group.tsx
    callout.tsx
    document-embed.tsx
    table.tsx

lib/extensions/core.ts
  registers those specs as core Markdown contributions.
```

Rules:

- Keep the existing `StateField<DecorationSet>` behavior.
- Keep source reveal behavior identical.
- Keep priority ordering:
  1. asset groups
  2. callouts
  3. document embeds
  4. tables
- Keep fenced-code exclusion shared by the engine, not repeated by every spec.
- Add only focused tests/manual checks after migration:
  - asset group outside/inside source
  - callout outside/inside source
  - document embed outside/inside source
  - table outside/inside source
  - all ignored inside code fences

### Slice C: Core Math Rendering

Math/LaTeX is a core Markdown feature.

Status: initial core rendering is implemented with `remark-math` and
`rehype-katex`. Read/public/official/embed paths use the shared
`MarkdownDocument` pipeline, and inactive Live-mode display math is rendered as
a core LiveBlockSpec.

Use the unified/React Markdown pipeline:

```txt
remark-math + rehype-katex
```

Reasoning:

- `remark-math` adds dollar-delimited Markdown math syntax.
- `rehype-katex` renders math during Markdown processing, so
  Vault does not need to load arbitrary client-side math scripts on every
  page.
- The same rendered output can flow through Read mode, public pages, guide docs,
  share pages, embeds, and Live-mode block widgets that reuse
  `MarkdownDocument`.

Initial syntax:

```md
Inline math: $E = mc^2$

Block math:

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$
```

Initial support target:

- Read mode renders inline and block math.
- Public pages render inline and block math.
- Official docs render inline and block math.
- Markdown document embeds render math through the existing recursive
  `MarkdownDocument` path.
- Live mode renders inactive block math through a core `mathBlock` LiveBlockSpec.
- Live mode keeps inline math as styled source in the first slice unless a
  lightweight inline renderer proves stable.

Do not:

- Execute author-provided scripts.
- Add remote CDN math scripts.
- Treat math as raw HTML.
- Allow math rendering inside fenced code blocks.

### Slice D: Extension State Runtime API

Goal: make document-state extensions useful without wiring stickers yet.

Status: implemented for object-shaped state with
`server/document-extension-actions.ts` and
`components/extensions/use-document-extension-state.ts`. The first pass is
workspace/authenticated and non-realtime.

Add a small runtime wrapper around `server/document-extensions.ts`:

- Server APIs/actions for listing readable states for a document.
- Server APIs/actions for upserting/deleting editor-writable states.
- Client hook for authenticated workspace use:
  - `useDocumentExtensionState(extensionId, stateKey)`
  - reads initial server-provided state
  - debounces JSON writes
  - exposes `dirty`, `saving`, `error`

Rules:

- Do not expose raw DB rows to generic components.
- Validate state through the extension's registered schema before save.
- Keep first version non-realtime; later Yjs maps can be extension-owned.

### Slice E: Overlay Runtime Mounting

Goal: make the overlay host actually consume registered contributions.

Add:

```txt
components/extensions/DocumentExtensionRenderer.tsx
```

Responsibilities:

- Receive `documentId`, access flags, and resolved extension states.
- Ask the registry which document overlay contributions are enabled.
- Render overlays inside `DocumentOverlayHost`.
- Keep pointer behavior explicit:
  - overlay layer is pointer-safe by default
  - an extension must opt into interactive handles

This still ships no sticker UI. It only makes the mounting point real.

### Slice F: Workspace Contribution Shell

Goal: prepare non-document extension surfaces.

Add registry-backed slots for:

- left-panel views
- right-panel inspectors
- workspace pages
- command palette entries later

First pass can expose no new user-visible extension UI. The goal is for a
future calendar/drawing/sticker extension to add panels without editing the
workspace shell directly.

### Slice G: First Real Extension Prototypes

After the registry, math, state API, and overlay mounting are stable:

1. Stickers
   - Tests document-state overlays.
   - Uses uploaded assets.
   - Stores positions in `document_extension_states`.
   - Starts authenticated-workspace-only.

2. Calendar
   - Tests workspace/page contributions and optional Markdown content blocks.
   - Starts as a workspace page reading document metadata and/or tasks.
   - Adds Markdown block syntax only if the workspace page proves useful.

---

## 11. Core Math Acceptance Criteria

Math is considered working when:

- `$inline$` math renders in Read mode, public pages, official docs, and embeds.
- `$$block$$` math renders in Read mode, public pages, official docs, and embeds.
- Invalid TeX fails softly as visible source or a non-crashing placeholder.
- Fenced code containing `$...$` remains code.
- Live mode can edit math source without cursor jumps.
- Live mode renders inactive block math through the Live block registry.
- Build passes without relying on CDN scripts or browser-only global math renderers.

Inline Live rendering can be a follow-up if block math and Read-mode math are
stable.

---

## 12. Extension Registry Acceptance Criteria

The registry foundation is considered ready for stickers/calendar work when:

- Existing Live block behavior is provided by registered core specs.
- Adding/removing a built-in optional LiveBlockSpec does not require editing the
  generic live block engine.
- Extension metadata is centralized and discoverable.
- Extension state reads/writes go through permission-checked server helpers.
- Overlay contributions mount through `DocumentOverlayHost`.
- Workspace contribution slots exist even if no optional extension uses them
  yet.
- `docs/project-knowledge.md` names the registry entrypoints and security
  boundaries.

---

## 13. Open Questions

- Should extension state be included in restore points/version history?
  - Recommendation: not initially. Add extension-owned history later for large
    interactive state.
- Should public documents show document-state extensions by default?
  - Recommendation: no. Require `visibility=public` per extension state.
- Should stickers be document-relative or viewport-relative?
  - Recommendation: start document-relative.
- Should built-in extensions be per-user toggleable?
  - Recommendation: global enabled first, user preferences later.
