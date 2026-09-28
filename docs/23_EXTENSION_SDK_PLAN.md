# Extension SDK and Host Plan

Status as of 2026-09-26: **API settled; slices 0-4 implemented.** Slice 3
revised two parts of the design; see "Amendments from slice 3" at the end of §14. §16 records the
decisions; §18 covers tooling for extension developers. This plan supersedes the registry shape in
`docs/12_EXTENSION_REGISTRY_PLAN.md` §4 and §10 and the "Future Verified Extensions" note in
`docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` §8. The storage model in plan 12
§3 and the settings storage in plan 13 §4 are unchanged.

Tracked as Phase 25 in `docs/01_PROGRESS_TRACKER.md`.

## 1. Goal

An extension should be a self-contained folder that talks to Vault only through a
published API (the SDK), and Vault's core should never name a specific
extension. Today the opposite holds: shipping calendar, calc, stickers and
dictionary meant editing the editor, the renderer, the live-block engine and
every page that renders a document.

Two things come out of the boundary:

- **Containment.** An extension can be added, changed or deleted without
  touching core files, and core can be refactored without reading extension
  code.
- **Lazy loading.** Once core only reaches extensions through a registry, the
  registry can decide *when* to load each one. Users stop downloading code for
  extensions they have not enabled and documents do not use.

Third-party extensions are not in scope. §12 records which parts of this API
could later be offered to them and which are first-party forever, so that
decision is not made by accident.

---

## 2. What This Replaces

Coupling as of 2026-09-26. Counts are lines naming a specific extension.

| File | Lines | What it does by hand |
|---|---:|---|
| `components/markdown/MarkdownEditor.tsx` | ~126 | Calendar/calc/sticker toolbar groups, sticker picker state, `NewDefinitionDialog` state, `hostCommands` for `/def` and `/term`, calc completion gating, `createCalcLiveExtension`, `createDefinitionHoverExtension`, calc lines excluded from the Markdown pass, `StickerLayer` mount, 5 extension props |
| `components/markdown/MarkdownDocument.tsx` | ~75 | Imports `CalendarBlock`, `CalcBlock`, `CalcValue`; splits segments on calendar fences and calc blocks; runs the calc pre-pass; `remarkCalc`; definition hover cards on links |
| `components/markdown/live-blocks.ts` | 16 | `CalendarBlockWidget`; calendar settings on the generic `LiveBlockOptions` |
| `components/markdown/slash-commands.ts` | 8 | Suppresses the menu inside `:::calc` |
| `app/(workspace)/docs/[docId]/page.tsx` | 45 | Fetches 4 extension settings rows by id, parses 2 settings schemas, fetches FX rates, passes ~10 props |
| `app/public/[slug]`, `app/(workspace)/workspace/public/[slug]`, `app/share/[token]`, `app/docs/guides/[slug]` | ~30 | FX rates, public calendar states, public sticker items, `PublicStickerDisplay` |
| `server/extensions.ts` | 4 | Dictionary- and calc-specific services (`definitions`, `fx`) built into the generic agent context |

Also:

- `lib/extensions/catalog.ts` (43 KB) holds 13 agent action `handler`s. Client
  components import the catalog, so server-intended handler code ships to every
  browser.
- Per-user enablement (`resolveEnabledExtensionsForUser`) gates *contributions*
  (slash items, agent actions) but not *code*. All extension code is statically
  imported.

---

## 3. Principles

These are the rules the API is built to keep. A change that breaks one is a
change to this plan, not an implementation detail.

1. **Core never names an extension.** Outside the three registry files (§11),
   no file in `app/`, `components/`, `lib/` or `server/` mentions an extension id
   or imports from `extensions/`.
2. **Extensions import only the SDK.** Code under `extensions/<name>/` imports
   from its own folder, `@/lib/extension-api`, and an allowlist of packages and
   UI primitives (§11). Never from app internals, never from another extension.
3. **Rendering follows content; authoring follows enablement.** This formalises
   what the code already does: calc values, calendars and definition hover
   cards render for every reader because they are part of the document, while
   toolbar buttons, slash items and completions follow the user's switch. Every
   contribution belongs to exactly one side (§6, §7).
4. **Extension syntax is a directive or a fence, never new Markdown grammar.**
   Blocks are `:::name{attrs}`, inline is `:name[…]{attrs}` (decision
   2026-09-08 in project-knowledge §17), and a fence renderer claims a fence
   language. The host can then find which extensions a document needs with a
   cheap scan, and a document whose extension is gone degrades to readable
   source.
5. **Contributions are declarative.** An extension exports definition objects;
   there is no `activate()`. The same render module is imported statically on
   the server and lazily in the browser, and the host decides what is active by
   including or excluding definitions. This differs from Obsidian and VS Code on
   purpose: an imperative `activate()` does not fit server rendering.
6. **Props carry data; behaviour comes from hooks.** Components receive a
   serialisable `ctx` (it must cross the RSC boundary on public pages) and get
   state, actions and events from SDK hooks that take that `ctx`.
7. **Extensions never touch the database.** Anything needing `db` is a host
   service: generic, permission-checked, and added to the SDK deliberately.
8. **Client-side scoping is hygiene, not security.** A same-origin browser
   module can call any server action. The security boundary for first-party code
   is the server (permission-checked services, visibility-filtered state). A
   real client-side boundary only exists once §12's sandbox does.

---

## 4. Package Layout

```txt
lib/extension-api/                 the SDK — the only app code extensions may import
  index.ts                         define* helpers, types, client hooks
  server.ts                        server-only types and defineServer
  testing.ts                       createTestContext() for extension unit tests

lib/extension-host/                core-owned host implementation (never imported by extensions)
  ...                              loader, block engine, render set, runtime resolution

extensions/
  manifests.ts                     registry: every manifest (isomorphic, tiny)
  registry.client.ts               registry: lazy render/editor loaders
  registry.server.ts               registry: static render + server modules ("server-only")
  calendar/
    manifest.ts                    data only — imported everywhere
    render.tsx                     isomorphic: what readers see
    editor.tsx                     client-only: what authors use (lazy, enablement-gated)
    server.ts                      server-only: state schemas, actions, render data
    lib/…                          the extension's own pure helpers (e.g. today's lib/calendar.ts)
    *.test.ts
```

Four entry points, one per question:

| Entry | Loaded | Contains |
|---|---|---|
| `manifest.ts` | everywhere, always | identity, permissions, settings schema, syntax claims, command/slash/toolbar metadata |
| `render.tsx` | server: statically. Browser: lazily, when the document needs it (§9) | block/inline/fence components, link decorators, read-only overlays, document pre-pass, Live-mode rendering |
| `editor.tsx` | browser only, lazily, when the user has the extension enabled | command handlers, completions, authoring CodeMirror extensions, interactive overlays, dialogs |
| `server.ts` | server only | state schemas, actions (agent + own UI), render-data loaders |

`render.tsx` is **not** a `"use client"` module. It exports definition objects
whose components may live in `"use client"` files. It has to run on the server
because the pre-pass (calc) and server rendering execute its functions.

Dependency direction is one way: `extensions/*` → `lib/extension-api` ←
`lib/extension-host` → core. A helper both sides need (e.g. FX currency codes)
belongs in core behind a host service, not in an extension folder.

---

## 5. Manifest

```ts
type ExtensionManifest<TSettings = unknown> = {
  id: `${string}.${string}`;          // "vault.calendar"; third-party would be "<publisher>.<name>"
  name: string;
  version: number;                    // integer, as today
  description: string;
  category: VaultExtensionCategory;
  defaultEnabled?: boolean;
  permissions: ExtensionPermission[];

  settings?: {
    schema: ZodType<TSettings>;       // defaults come from the schema
    sections: ExtensionSettingsSection[];   // today's field types, unchanged
  };

  syntax?: {
    blocks?: string[];                // ":::calendar" → ["calendar"]
    inline?: string[];                // ":calc[…]"    → ["calc"]
    fences?: string[];                // "```mermaid"  → ["mermaid"]
  };

  /** Render even when no syntax or state is present (e.g. link decorators). */
  renderAlways?: boolean;
  /** Prefetch this extension's state rows with the page (§9). Default true. */
  prefetchState?: boolean;

  commands?: Array<{ id: string; title: string; description?: string; icon?: string; defaultKeys?: string[] }>;
  slashCommands?: Array<{ label: string; title: string; keywords?: string; command: string; directive?: string }>;
  toolbar?: Array<{ command: string; icon: string; label?: string }>;
};
```

Rules:

- A manifest is plain data plus a zod schema. It must survive being passed to a
  client component (the settings pages already do this). Icons are lucide names,
  resolved by the host.
- Every `slashCommands[].command` and `toolbar[].command` names a declared
  `commands[].id`. Every command id is namespaced under the extension id.
  `defineManifest` asserts both at module load, as the registry does today for
  agent actions.
- Syntax names are globally unique across installed extensions and may not
  collide with core directives (`assets`, callouts). The registry asserts this.
- Today's slash `insert` / `run` split goes away: a slash item always runs a
  command, and the command does the inserting. `/calcblock` and `:::cal` still
  reach the same item via `directive`, as decided on 2026-09-09.

---

## 6. Render Contributions (content-driven)

```ts
export default defineRender(manifest, {
  blocks?:   { [name in Syntax["blocks"]]: BlockContribution };
  inline?:   { [name in Syntax["inline"]]: InlineContribution };
  fences?:   { [lang in Syntax["fences"]]: FenceContribution };
  links?:    LinkDecorator;                  // privileged (§12)
  overlays?: Record<string, ComponentType<OverlayProps>>;   // read-only display layer
  analyze?:  (doc: AnalyzableDocument, ctx) => JsonValue;   // privileged
  live?:     (ctx: LiveContext) => Extension;               // privileged: CodeMirror, Live mode
});
```

### Blocks

```ts
type BlockContribution = {
  form: "leaf" | "container";   // ":::calendar{id=x}" alone, or ":::calc" … ":::"
  live: "widget" | "source";    // replace source with Component, or leave source editable
  Component: ComponentType<BlockProps>;
};

type BlockProps = {
  ctx: RenderContext;
  attributes: Record<string, string>;
  body: string | null;          // container form only
  source: string;
};
```

The host owns everything the calendar currently does by hand:

- **Read mode:** `MarkdownDocument` splits the document at claimed directives
  and mounts `Component` (replaces `splitCalendarSegments` / `planMarkdownParts`
  special cases).
- **Live mode, `widget`:** the host's block engine wraps `Component` in a
  CodeMirror widget. It handles the React root, `eq`, deferred unmount,
  `ignoreEvent`, and revealing the source when the cursor enters the range. That
  replaces `CalendarBlockWidget`, and extension options leave
  `LiveBlockOptions`.
- **Live mode, `source`:** the host only *claims* the range. The core Markdown
  pass, the slash menu and other blocks leave it alone (replaces
  `getCalcBlockLineNumbers` and `isInsideCalcBlock` in core), and the
  extension's `live` contribution decorates it.
- Fenced code is excluded from every scan by the host, once.

The same `Component` renders in Read, Live and public surfaces; `ctx.surface`
and `ctx.canEdit` tell it which.

### Inline and fences

`InlineContribution` is `{ Component: ComponentType<InlineProps> }`, receiving
the directive's raw source (sliced via `node.position`, per the 2026-09-08
decision), label and attributes. `FenceContribution` is `{ Component }`,
receiving the fence's language, info string and body. It renders instead of the
core code block. Nothing uses fences yet; they are here because a diagram
renderer (mermaid-class, ~1 MB) is exactly the large, niche extension that lazy
loading exists for.

### Links

```ts
type LinkDecorator = {
  /** Decides per resolved wiki link; runs in Read and Live. */
  decorate: (link: ResolvedWikiLink, ctx) => { className?: string; Hover?: ComponentType<HoverProps> } | null;
};
```

This is the dictionary's render half (hover cards on links to definition
documents). It is privileged because it touches every link in every document.

### Pre-pass

`analyze` runs once per document render before any segment renders, on the
whole body. Its result reaches every block and inline component as
`ctx.analysis`. This is calc's document-wide evaluation, which today lives in
`MarkdownDocument` because names bind top-to-bottom across segments.

### Render context and hooks

```ts
type RenderContext = {                 // serialisable
  extensionId: string;
  documentId: string | null;
  surface: "live" | "read" | "public" | "share" | "embed" | "preview";
  canEdit: boolean;
  enabled: boolean;                    // did the *viewer* enable this extension?
  settings: TSettings;                 // viewer's settings if enabled, else schema defaults
  state: Record<string, JsonValue>;    // prefetched rows, visibility-filtered (§9)
  data: JsonValue | null;              // from server.loadRenderData
  analysis: JsonValue | null;          // from analyze
};

useExtensionState(ctx, stateKey, { schema, visibility? })  // seeded from ctx.state; saves only when canEdit
useExtensionAction(ctx, actionId)                          // calls the extension's own server action (§8)
useSessionEvent(ctx, name, handler) / emitSessionEvent(ctx, name, payload)   // render ↔ editor handoff
```

`ctx.enabled` covers authoring affordances inside rendered content, such as the
dictionary's "define this term" offer on a hover card, which today follows the
extension switch.

---

## 7. Editor Contributions (enablement-driven)

```ts
export default defineEditor(manifest, {
  commands: { [id in Manifest["commands"][number]["id"]]: CommandHandler };   // exhaustive
  completions?: (ctx: EditorContext) => CompletionSource[];                   // privileged
  extensions?:  (ctx: EditorContext) => Extension;                            // privileged
  overlays?:    Record<string, ComponentType<OverlayProps>>;   // interactive layer; replaces the render overlay of the same id
  dialogs?:     Record<string, ComponentType<DialogProps>>;
});

type CommandHandler = (editor: EditorHandle, ctx: EditorContext) => void | Promise<void>;

type EditorHandle = {
  insertBlock(markdown: string, options?: { cursorOffset?: number }): void;
  insertInline(markdown: string, options?: { cursorOffset?: number }): void;
  selection(): { from: number; to: number; text: string };
  replaceSelection(markdown: string): void;
  openLinkCompletion(options?: { filter?: (link: ResolvedWikiLink) => boolean }): void;
  openDialog(id: string, props?: JsonValue): void;
  pickAsset(options: { kind: "image" | "pdf" }): Promise<PickedAsset | null>;
};
```

`defineEditor` is typed so a manifest command without a handler fails to
compile.

The current couplings map as follows:

| Today (in `MarkdownEditor`) | Becomes |
|---|---|
| `CalendarToolbarGroup`, `CalcToolbarGroup`, `StickerToolbarGroup` | manifest `toolbar`, rendered by the host |
| `applyFormat("calendar")`, `insertCalcBlock` | command → `editor.insertBlock` |
| `stickerPickerOpen` / `pendingStickerAsset` state | command → `await editor.pickAsset()` → `emitSessionEvent` → sticker overlay |
| `hostCommands` for `/def`, `/term` | command → `editor.openDialog("newDefinition")` / `editor.openLinkCompletion({ filter })` |
| `NewDefinitionDialog` state | dictionary `dialogs.newDefinition`, which submits via `useExtensionAction` |
| `createCalcCompletionSource` gated on `calcEnabled` | calc `completions` (active only when enabled) |

---

## 8. Server Contributions and Host Services

```ts
import "server-only";

export default defineServer(manifest, {
  state?: Array<{ key: string; version: number; schema: ZodType }>;   // key: exact, or "prefix:*"
  actions?: ExtensionAction[];
  loadRenderData?: (ctx: RenderDataContext) => Promise<JsonValue>;
});
```

**Actions** are today's agent actions, unchanged in shape (id, input/output zod,
scope, mutates, permissions, handler). What changes is who can call them. The
extension's own UI calls them through one host server action, the same
permission-checked dispatcher MCP uses, and `agent: false` hides one from MCP
discovery. The dictionary's `/def` dialog and its agent `defineTerm` become one
code path.

**Render data** is for data a page must fetch before render that is not state:
calc's FX table (which day to fetch depends on the document's
`calc_rate_date`). The host
calls it only for extensions in the page's render set.

**Host services** reach handlers through `ctx`, gated by declared permissions,
as today:

| Service | Status | Change |
|---|---|---|
| `document.state` (scoped to own extension) | exists | none |
| `document.markdown` read/append/insertAtHeading/edit | exists | none |
| `document.assets.get` | exists | none |
| `workspace.state.listAcrossDocuments` | exists | none |
| `fx.getTable` | exists | stays a core service: provider-sourced reference data with no owner. Currency primitives move from `lib/calc` to core `lib/fx` |
| `definitions.list/create` | exists | **removed from core.** Replaced by a generic `documents.list({ tag })` / `documents.create({ title, tags, folderId, markdown })`. Definition-ness is already a core document tag (plan 20 §2) |

Adding a service is a reviewed change to `lib/extension-api/server.ts`.
Extensions do not grow private back doors.

---

## 9. Host: Loading and Activation

**Workspace (the app).** An `ExtensionHostProvider` in
`app/(workspace)/layout.tsx`, next to `KeybindingsProvider`. That layout already
loads user settings and persists across document navigation, so it is Vault's
"app load". The server resolves `{ id, settings }` for the user's enabled
extensions once. On mount, the host starts `render` and `editor` imports for all
of them in parallel with the CodeMirror chunk, and keeps them resident for the
session. This is Obsidian's model: by the time any document opens, its
extensions are ready.

**Content-driven render loading.** A document can need the render module of an
extension the viewer has not enabled. The server computes the document's
**render set**:

```txt
enabled for this viewer
∪ extensions whose syntax the document uses        (line scan, fences skipped)
∪ extensions with state rows on this document
∪ extensions with renderAlways
```

The page hands this set to the host with the page payload, so there is no
waterfall. The host loads any missing render modules; editor modules still load
only by enablement.

**State prefetch.** For every extension in the render set with `prefetchState`,
the server loads the document's state rows. Public, share and embed surfaces get
only `visibility = public` rows (the server filters). Rows arrive in
`ctx.state`. This replaces `getPublicCalendarStates` and
`getPublicStickerItems`, and removes the calendar's mount-time fetch in the
workspace.

**Server-rendered surfaces** (public, share, guides, Den embed HTML) import
render modules statically from `registry.server.ts`, so the server pays nothing
extra. Slice 0 showed that Next 16 (Turbopack) bundles every client component a
server component references into the page entry, rendered or not. So the host
never lets a server component reference an extension's client component
directly: it wraps each `"use client"` render component in `next/dynamic` (SSR
kept on), which puts it in its own chunk loaded only when that component
actually renders.

**`MarkdownDocument` takes the render set as a prop** (`extensions`), not from
context. It renders on both sides of the RSC boundary, and server components
cannot read context. Server pages get it from `registry.server.ts`; client
callers get it from the host.

**Mid-session changes.** Enabling an extension loads its modules and adds its
contributions live. Disabling removes them. Content that gains a new directive
while being edited loads that render module on demand (one frame of raw source
at most).

**Degradation.** A directive or fence claimed by no installed extension renders
as its source in a muted block in Read mode and stays plain source in Live
mode, never an error.

---

## 10. CodeMirror Rules

The editor's extension array is rebuilt whenever any input changes (see the
`enabledExtensionKey` comment in `MarkdownEditor`). The host must not make this
worse:

- Each extension's CodeMirror contributions (`live`, `extensions`,
  `completions`, block widgets) live in a per-extension `Compartment`. Enabling,
  disabling or loading one extension reconfigures only its compartment.
- Contribution factories run once per editor instance. Anything that changes
  afterwards (settings, resolution maps, `canEdit`) is read through getters on
  `ctx` (the `wikiLinkMapStore` pattern), never closed over. The host
  dispatches one `extensionContextChanged` effect so decorations can recompute.
- Changing an extension setting never rebuilds the editor.
- Precedence: extension compartments sit at default precedence below core
  keymaps. A privileged contribution may use `Prec` itself.
- Block widgets are the host's, not the extension's. The engine keeps plan 12
  §5's invariants (direct `StateField` decorations, source reveal, fenced-code
  exclusion).

---

## 11. Enforcement

The boundary only holds if it is checked. Three ESLint `no-restricted-imports`
rules:

1. **Inside `extensions/<name>/`:** allowed are relative imports within the
   folder, `@/lib/extension-api` (`/server` only from `server.ts`),
   `@/components/ui/*`, `@/lib/utils`, and packages (`react`, `zod`,
   `@codemirror/*`, `@lezer/*`, `lucide-react`). Anything else from `@/`, or
   from another extension, is an error.
2. **Outside `extensions/`:** only `@/extensions/manifests`,
   `@/extensions/registry.client` and `@/extensions/registry.server` may be
   imported.
3. **`registry.client.ts`** may reference `render` and `editor` modules only
   through `() => import()`, and never `server.ts` (whose `import "server-only"`
   would fail the build anyway).

Migration runs with a shrinking allowlist of known violations. The phase is done
when the allowlist is empty.

Tests: each extension's unit tests run against `createTestContext()` from
`lib/extension-api/testing.ts`, with no app mocks. The existing
`calc-actions.test.ts` and `dictionary-actions.test.ts` move into their
extension folders.

---

## 12. Portable and Privileged Contributions

Not implemented. This records which way each contribution points if
third-party extensions ever happen.

| Portable (could be sandboxed later) | Privileged (first-party only) |
|---|---|
| manifest; blocks/inline/fences/overlays (render into an iframe); commands (`EditorHandle` over `postMessage`); state and actions via RPC | `live`, `extensions`, `completions` (raw CodeMirror); `analyze` and `links` (run inside core rendering); anything server-side |

A third-party runtime would load the manifest from a registry and run the
portable parts in a sandboxed iframe or worker against a proxied `ctx`. The
privileged parts cannot be proxied without giving up the performance or the
safety they exist for. The SDK types mark privileged fields now, so the split is
visible in every extension that uses them.

---

## 13. How Each Existing Extension Maps

| Extension | render | editor | server |
|---|---|---|---|
| **Calendar** | block `calendar` (leaf, widget) | `insert` command | state `calendar:*`; 5 actions |
| **Stickers** | overlay `stickers` (read-only display, today's `PublicStickerDisplay`) | overlay `stickers` (interactive, today's `StickerLayer`); `add` command via `pickAsset` | state `layout`; 3 actions |
| **Dictionary** | `links` decorator (hover card); `renderAlways` | `newDefinition` / `insertReference` commands; `newDefinition` dialog | actions via generic `documents` service |
| **Calc** | block `calc` (container, source); inline `calc`; `analyze`; `live` (inline value decorations) | `insertBlock` command; operand `completions` | `loadRenderData` (FX table for `calc_rate_date`); actions |

Core features stay core, per plan 12 §8: callouts, math, tables, asset groups,
document embeds, and the code runner (security-sensitive infrastructure). They
may share the host's block engine internally, but they are not SDK extensions.

---

## 14. Migration Slices

Each slice leaves the app runnable with identical user-visible behaviour, except
where §16 changes it.

**Slice 0 — Baseline.** Done 2026-09-26 (`npm run build`, Next 16.2.6 with
Turbopack, at `a7909c3`). Route JS is the union of `entryJSFiles` in each page's
`page_client-reference-manifest.js`; extension code was sized separately by
bundling only the extension-specific modules with esbuild (minified, gzipped,
everything shared with core external).

| Route | Entry chunks | Raw | Gzip |
|---|---:|---:|---:|
| `/docs/[docId]` (workspace) | 21 | 2787 KB | 833 KB |
| `/public/[slug]` | 10 | 1611 KB | 455 KB |

| Extension-specific code | Min | Gzip |
|---|---:|---:|
| `lib/extensions/catalog.ts` (manifests + 13 agent handlers) | 22.1 KB | 6.8 KB |
| calc (engine, live decorations, completions, blocks) | 15.4 KB | 5.9 KB |
| calendar (block, helpers) | 11.0 KB | 4.1 KB |
| stickers (layer, public display) | 7.6 KB | 2.9 KB |
| dictionary (hover, dialog, live) | 5.6 KB | 2.4 KB |
| **total** | | **~22 KB** |

Findings:

- Extension code is ~3% of the doc page and ~5% of the public page today. The
  case for this plan is the boundary, not current bytes; the bytes matter for
  the next, larger extension.
- Agent handler code (`listUpcomingTasks`, `removeSticker`, …) is present in
  both routes' client chunks, including the public page, confirming §2.
- **§9's hoped-for behaviour does not hold.** Every client component a server
  component references is bundled into that page's entry chunks and loaded
  eagerly, rendered or not: the public page's manifest lists `CalendarBlock` and
  `PublicStickerDisplay`, and no client-reference chunk sits outside the entry
  set. Render-side client components must therefore be loaded through
  `next/dynamic` / `React.lazy` (§9).

**Slice 1 — SDK skeleton and boundary.** Done 2026-09-26. `lib/extension-api`
types and `define*` helpers, the generated registry files (§18.1), the lint
rules with an allowlist, and the contract test (§18.4). As built:
`lib/extensions/catalog.ts` is gone; each extension has `manifest.ts`,
`server.ts` and, where the browser needs its state schema, `state.ts`.
`lib/extension-host/compat.ts` adapts manifests and server modules to the
legacy `VaultExtension` shape so existing consumers are unchanged, and the
client reads `manifestRegistry` (no handlers) while server code reads
`extensionRegistry`. The manifest keeps today's slash `insert`/`run` and
command shapes until slice 3. Measured after the slice (same method as slice 0):
no browser chunk contains agent-handler code any more; the doc page went from
833 to 823 KB gzip and the public page from 455 to 443 KB. Split `lib/extensions/catalog.ts` into `extensions/*/manifest.ts` and
`extensions/*/server.ts`, and point existing consumers at the registries. No
behaviour change. Agent handlers leave the client bundle.

**Slice 2 — Host runtime.** Done 2026-09-26. `ExtensionHostProvider`,
server-side runtime resolution, render-set computation, state prefetch,
`loadRenderData`, the action endpoint for extension UIs, and the SDK hooks.
Document pages drop per-extension props for one runtime object;
`MarkdownDocument` takes `extensions`. As built:

- `server/extension-runtime.ts`: `resolveViewerExtensions` (one settings query,
  React-`cache`d per request) and `resolveDocumentExtensions`, which returns
  the serialisable `DocumentExtensions` (surface, render set, enabled ids,
  settings, visibility-filtered state, render data). State comes from the
  existing permission-checked readers: `listPublicDocumentExtensionStates` on
  public surfaces (which also requires the document to be public),
  `listDocumentExtensionStatesForUser` in the workspace, none on share/guide.
- Render set detection is `lib/extension-host/syntax.ts`, a fence-aware line
  scan over manifest `syntax` claims. While a document is editable the render
  set is every installed extension, because an author can type a directive
  whose server data (the FX table) cannot be fetched later.
- `loadRenderData` replaced the per-page wiring: calc returns the FX table for
  `calc_rate_date`; calendar returns public calendar states on public pages;
  stickers returns public-asset-only items on public pages.
  `server/calendar-state.ts` and `server/sticker-state.ts` are deleted.
- Public, share and guide pages resolve as an anonymous viewer (`userId: null`):
  they never applied a reader's own preferences, and still do not.
- `lib/extension-host/legacy.ts` is the single temporary adapter that still
  reads extension-specific values (FX table, calendar states and settings,
  sticker items, definition emphasis, authoring switches) out of
  `DocumentExtensions` for core components. Each later slice deletes its part.
- `runExtensionActionAction` (`server/extension-actions.ts`) runs the MCP
  dispatcher with `caller: "extension"`; actions marked `agent: false` are
  hidden from MCP discovery and refused to agents as unknown.
- SDK client hooks in `lib/extension-api/react.ts`: `useExtensionAction`,
  `useExtensionState` (seeded from prefetched state, saves only with
  `canEdit`). No extension uses them yet; calendar adopts them in slice 3.
- `ExtensionHostProvider` is mounted in the workspace layout and loads
  enabled extensions' client modules via `selectModulesToLoad`. No extension
  has render or editor modules yet, so it loads nothing until slice 3.

Deliberately not changed yet: the Den embed editor and embed HTML route still
pass no extension data (as before); the workspace does not yet consume
prefetched state (calendar still fetches its own there, slice 3); and the
read-only sticker layer for workspace readers (§16 decision 1) lands with
slice 4. One small behaviour change: an extension's stored settings now apply
only while it is enabled, so a disabled calendar's week-start preference no
longer reaches calendars in the editor, matching how the dictionary already
treated its reading preference.

**Slice 3 — Calendar end to end.** Done 2026-09-26. Host block engine (Read
segmentation and Live widget), manifest-driven toolbar/slash/commands,
per-extension error isolation (§18.5), `npm run ext:new` (§18.1), and the test
helpers (§18.4). The playground and fixtures (§18.3), the author guide and
the `create-extension` skill (§18.8) followed on 2026-09-26; see §18.9. As
built:

- `extensions/calendar/` now holds everything: `manifest.ts`, `render.tsx`
  (one leaf block, `load: () => import("./CalendarBlock")`), `editor.tsx` (the
  insert command and its toolbar button), `server.ts`, `state.ts`,
  `lib/calendar.ts` (moved from `lib/`) and `CalendarBlock.tsx` (moved from
  `components/extensions/`, now a default-exported `BlockProps` component
  using `useExtensionState` and `ExtensionMarkdown`). No core file names the
  calendar.
- `lib/extension-host/blocks.ts` parses and splits claimed `:::name{…}` leaf
  blocks (fence-aware; the old calendar splitter was not).
  `components/extensions/ExtensionBlockHost.tsx` renders every block: lazy
  component, Suspense, per-extension error boundary with a source fallback.
  `MarkdownDocument` splits and renders through it (always read-only), and
  `live-blocks.ts` has one generic `extensionBlock` spec whose widget mounts it
  with the page's `canEdit`.
- Editor modules load through `ExtensionHostProvider`. `MarkdownEditor` adds
  their commands to `hostCommands` (so slash `run` items work), renders their
  toolbar groups, and runs `extension:<command id>` from the command palette,
  which lists the manifest commands of enabled extensions that have an editor
  module. `lib/extension-host/editor-handle.ts` owns `insertBlock` /
  `insertInline` for both the editor and extension commands.
- `lib/extension-api/testing.ts`: `createTestContext`, `runCommand` (commands
  against a bare `EditorState`). `scripts/new-extension.mjs`
  (`npm run ext:new -- <name>`) generates an extension that passes the
  contract, the type check and lint as generated (verified by scaffolding
  one).
- The contract test now also checks that render modules never statically
  import a `"use client"` file (verified to fail on one), that claimed blocks
  have components, and that editor modules handle every manifest command.

Measured (clean `npm run build`): `CalendarBlock` is its own lazy chunk and no
longer in either route's entry. The **public page went from 443 to 208 KB
gzip**: the eager calendar block had pulled the whole client-side Markdown
stack (react-markdown, KaTeX, highlighting) into every public page. The doc
page is 823 KB. A Playwright check with a temporary calendar anchor on
`/privacy` confirmed server rendering, clean hydration (no console errors),
and that the calendar chunk loads only on pages that contain a calendar.

Behaviour changes: Read-mode calendars in the workspace render from
prefetched state instead of fetching; saves no longer overwrite an existing
calendar's visibility with the user's default (the setting always said
existing calendars keep their own; the old code did not); a calendar inside an
embedded document, a preview or the Den embed editor renders a "Calendar"
notice instead of raw text or a calendar bound to the wrong document; and the
Den embed HTML shows a block's empty placeholder.

**Amendments from slice 3.** Two parts of §4, §6, §7 and §9 changed while
building calendar:

1. **Render modules are light and loaded statically; their components are
   lazy.** A render module holds definitions and `load: () => import(...)`
   loaders only (the contract test enforces it). `MarkdownDocument` can then
   render synchronously on both sides, and `registry.client.ts` loads editor
   modules only. The host's block *index* is built from manifests, not render
   modules: a server module that can reach a render module's `import()` still
   puts that client component into the page's entry chunk (the build showed
   it). Only the client-side `ExtensionBlockHost` imports
   `extensions/registry.render.ts`.
2. **Toolbar items live in the editor module**, because their icons are
   components; the manifest keeps plain command metadata for the palette and
   hotkeys. Slash items reference commands with the existing `run` shape.

Also added: `syntax.containers` for `:::name` … `:::` directives, so calc's
`:::calc` is claimed for render-set detection without the host treating its
opening line as a leaf block (the contract test caught that regression). Delete every calendar
reference in core. Calendar goes first because it touches the most contribution
types.

**Slice 4 — Stickers.** Done 2026-09-26. Render and editor overlays,
`pickAsset`, session events. As built:

- `components/extensions/ExtensionOverlays.tsx`: `ExtensionOverlayLayer`
  renders each overlay for extensions in the render set (lazy, per-extension
  error boundary, a failed overlay disappears), substituting an enabled
  extension's editor-module overlay of the same id where the document is
  editable; `ExtensionOverlaySurface` wraps a read view's document with the
  layer and leaves documents without overlays untouched. The public pages
  and the workspace read view use the surface; `MarkdownEditor` passes the
  layer to its existing `DocumentOverlayHost`.
- SDK: `OverlayProps`, `overlays` in `defineRender`/`defineEditor`,
  `OverlayItem` and `useSessionEvent` in `@/lib/extension-api/react`,
  `editor.pickAsset()` and `context.emit()` for commands.
  `lib/extension-host/session-events.ts` is the per-document,
  per-extension event bus. `MarkdownEditor` owns one generic asset picker.
- `extensions/stickers/` now holds everything: `StickerDisplay` (read-only,
  from state in the workspace and from `loadRenderData`'s public-image-only
  items on public pages), `StickerLayer` (moved from `components/extensions`,
  interactive, placed via a `place` session event), `editor.tsx` (the add
  command picks an image and emits `place`; toggle-layer, previously declared
  but never implemented, hides the layer), and a fixture.
  `PublicStickerDisplay`, the sticker toolbar group, picker state and palette
  entry, `stickersEnabled` and `stickerItems` are gone from core.
- Tests: SDK hooks' server actions are aliased to stubs under vitest
  (`test/stubs/server-actions.ts`), so extension components are importable in
  unit tests; the contract test checks declared overlays are rendered and
  editor overlays are declared.

Behaviour changes, per §16 decision 1: stickers now show read-only to every
reader in the workspace (read view and editor), not only to users who
enabled stickers. A sticker picked while the layout was still loading used to
be dropped; it is now placed once loading finishes. The extension toolbar
order is now editor-module extensions (alphabetical) then calc.

**Slice 5 — Dictionary.** Done 2026-09-27. `links`, dialogs,
`openLinkCompletion`, and the generic `documents` service; `definitions` is
gone from the core action context. As built:

- **Link previews** replace link decorators: a render module's
  `links.preview(link, ctx)` returns a `LinkPreview` (`title`, `markdown` or
  `emptyText`, `quiet`, an optional `action` naming a command) or `null`. The
  host hands it a `WikiLinkInfo` (`target`, `label`, `href`, `resolved`,
  `isDefinition`, `preview`, `occurrence` on the page). The first non-null
  preview wins (`lib/extension-host/links.ts`). Read surfaces render links
  through `components/extensions/ExtensionLinkHost.tsx`; Live mode's hover
  extension (`live-link-hover.ts`, renamed from `live-definitions.ts`) asks
  the same resolver. `DefinitionPreviewCard` became the generic
  `LinkPreviewCard` / `LinkHoverCard`; `lib/wiki-links.ts` builds
  `WikiLinkTarget`s for every resolved link, not only definitions. A separate
  `live` contribution was not needed.
- **Dialogs**: `defineEditor({ dialogs })` and `editor.openDialog(id, props)`
  resolve with the dialog's `close(result)`. `MarkdownEditor` renders one
  extension dialog at a time. Also new on the handle: `openLinkCompletion({
  filter })` (the `[[` completion narrowed by a predicate) and
  `openDocument(id, title)`. Commands receive `folderId` and `args`.
- **Documents service**: `ctx.documents` (`listByTag`, and with
  `document:write` `findOwnedByTitle` / `create`) backed by
  `server/extension-documents.ts` (renamed from `definitions-data.ts`). The
  dialog calls `vault.dictionary.defineTerm` through the action dispatcher,
  which also covers MCP; `server/definitions.ts` (the old `/def` server action)
  is deleted. `ctx.settings` now carries the caller's settings for the
  extension.
- `extensions/dictionary/` owns `render.tsx` (previews, plus the "Define"
  offer on unresolved links for authors who enabled it), `editor.tsx` (`/def`
  and `/term` as declared commands) and `NewDefinitionDialog.tsx`. The
  contract test's `HOST_COMMANDS` exception and the core lint allowlist are
  gone; `legacy.ts` now holds only calc's props.
- Bundle: the link host is a client component on every read surface, so it
  loads the preview's `MarkdownDocument` with `next/dynamic`. A static import
  put react-markdown and KaTeX back into every public page (433 KB gz); with
  the dynamic import it measures 210 KB, and the doc page 824 KB.
  `NewDefinitionDialog` and `defineTerm` are in no route entry except the dev
  playground's.
- Lint: the React compiler started flagging the slash/directive completion
  sources in `MarkdownEditor`'s extension memo ("passing a ref to a
  function"); they call their callbacks only on input. Both calls carry a
  commented `react-hooks/refs` disable, so the baseline stays at 17.

Behaviour changes: hovering an unresolved link offers "Define" (authors with
the dictionary enabled). Repeat mentions are quieted per the reader's own
`definitionEmphasis` setting on every surface.

**Slice 6 — Calc.** `analyze`, inline directives, container blocks with
`live: "source"`, completions, and the FX currency primitives moving to core.
Deepest integration, so it goes last. If a contribution type turns out wrong,
it is revised here rather than special-cased.

**Slice 7 — Close-out.** Empty the lint allowlist, delete
`lib/extensions/catalog.ts` and `components/extensions/`, update
project-knowledge §3/§9/§18, and mark plan 12 §4/§10 superseded.

---

## 15. Acceptance Criteria

- `rg "vault\.(calendar|calc|stickers|dictionary)"` over `app/ components/ lib/
  server/` finds only `lib/extension-api/testing.ts` fixtures, if anything.
- All three lint rules pass with an empty allowlist.
- Adding an extension means a new folder. No other file changes: the registry
  files are generated (§18.1).
- With every extension disabled and a document using none of their syntax, the
  workspace doc page downloads no `render` or `editor` module (network panel).
- A document using `:::calendar` renders it for a viewer who has the calendar
  disabled, in both Read and Live mode, without a toolbar button or slash item.
- Public, share and embed surfaces render extension content from prefetched
  public state only. Private rows never reach them (server test).
- Changing an extension setting does not recreate the `EditorView`.
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` pass.

---

## 16. Decisions

Settled 2026-09-26.

1. **Sticker display follows principle 3.** The read-only sticker layer renders
   for every reader of a document, in the workspace as on public pages; only the
   interactive layer follows the viewer's switch. This is a behaviour change
   from plan 13 §10, which mounted nothing for a viewer with stickers off.
2. **Enabling or disabling takes effect immediately**, mid-session, through the
   per-extension compartments in §10. No reload.
3. **One action system.** Extension UIs call their own server actions through
   the same permission-checked dispatcher MCP uses; `agent: false` hides
   UI-only actions from discovery. No extension-specific server actions.
4. **State is prefetched by default** for every extension in the render set,
   with `prefetchState: false` as the opt-out for large state.

---

## 17. Relationship to Other Plans

- `12_EXTENSION_REGISTRY_PLAN.md`: §3 storage stands; §4 `VaultExtension` and §10
  slices are superseded by §5–§8 here; §7's milestones 3–4 are refined by §12.
- `13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md`: settings storage and the
  settings/extension browser UI stand; they read manifests instead of
  `localBuiltInExtensions`. §10's runtime rules are restated by principle 3.
- `16_AGENT_EXTENSION_ACTIONS_PLAN.md`: action shape and dispatcher stand;
  §8 here widens who may call them and replaces `definitions` with `documents`.
- `19`–`21` (calc, dictionary, definitions): behaviour unchanged; their code
  moves into `extensions/`.

---

## 18. Authoring Experience

Settled 2026-09-26. Status: 18.1-18.5 and 18.8 are built; 18.6 (debug panel)
and 18.7 (migrations) wait until needed. As built after slice 3:

- **Playground**: `app/dev/extensions` (index) and `app/dev/extensions/[id]`,
  404 in production. `components/extensions/playground/ExtensionPlayground.tsx`
  renders each fixture as Live (a CodeMirror view running the host's
  live-block engine, with a button per editor command), Read, Public and
  Extension disabled, all from one in-memory state store, so an edit in Live
  shows everywhere and the public pane shows only public rows. The settings
  panel is generated from the manifest and reconfigures the Live view through
  a compartment, never recreating it. The playground renders client-only
  (see project-knowledge §16, heading ids).
- **State store seam**: `ExtensionStateStoreProvider` in
  `@/lib/extension-api/react`; `useExtensionState` uses a provided store instead
  of server actions, and `LiveBlockOptions.extensionStateStore` provides it to
  Live widgets, whose React roots do not inherit context.
- **Fixtures**: `lib/extension-host/fixtures.ts` (`@today±N` tokens) and
  `fixtures.server.ts`; the contract test validates fixture state against the
  extension's state schemas. Calendar ships `fixtures/basic.md`.
- **Docs**: `extensions/README.md` (the author guide) and
  `.agents/skills/create-extension/SKILL.md` (the process), indexed in
  `.agents/SKILLS.md` and mapped in `AGENTS.md`. `ext:new` now also writes a
  fixture.

The people writing extensions are mostly the maintainer and
coding agents, so the aim is that the right thing is the default and a mistake
fails loudly and early. Final verification still happens by hand in
production, after dev testing; nothing here replaces that.

### 18.1 Scaffold and generated registries

- `npm run ext:new <name> [--render] [--editor] [--server]` creates
  `extensions/<name>/` with a manifest, only the requested modules, one fixture
  document and a test file.
- `extensions/manifests.ts`, `registry.client.ts` and `registry.server.ts` are
  **generated** by `scripts/generate-extension-registry.mjs` from the folders
  present (a folder counts when it has `manifest.ts`; the other modules are
  optional). It runs before `dev` and `build`, and the output is committed. A
  test fails when the committed files are stale.

### 18.2 Types that teach

`defineManifest` keeps literal types (`const` generics), so command ids, syntax
names and the settings type flow into `defineRender`, `defineEditor` and
`defineServer`. Compile errors, not runtime surprises, for: a command without a
handler, a `blocks` key the manifest does not claim, a settings field whose key
is not in the schema, an action id outside the extension's namespace.

### 18.3 Playground

A dev-only route, `/dev/extensions/[id]` (404 in production), renders every
`extensions/<name>/fixtures/*.md` side by side in:

- Read mode;
- Live mode (a real editor, local only, no collab);
- public (public-visibility state only);
- a viewer with the extension disabled.

State comes from an in-memory store seeded by an optional
`fixtures/<fixture>.state.json`. A settings panel is generated from the
manifest, and changes apply live (which exercises decision 2). An index at
`/dev/extensions` lists installed extensions with their render-set reasons and
module sizes.

### 18.4 Tests

- **Helpers** in `lib/extension-api/testing.ts`: `createTestContext()`,
  `renderFixture(ext, markdown, { surface })`, `runCommand(ext, commandId, doc)`
  (returns the resulting Markdown), `runAction(ext, actionId, input, { state })`.
- **Contract test** (`extensions/contract.test.ts`) over every registered
  extension, with no per-extension code: manifest validity, namespaced and
  unique ids, unique syntax claims, slash/toolbar commands declared,
  settings defaults parse, `render` imports without touching `window`, `editor`
  never reaches `server`, and every fixture renders on every surface without
  throwing.

### 18.5 Error isolation

Every extension component renders inside its own error boundary, and each
extension's CodeMirror contributions are guarded per compartment. In dev, a
failure shows a loud overlay naming the extension. In production, the block
falls back to its source and that extension is disabled for the session. A
broken extension never takes down the editor or a page.

### 18.6 Debugging

A panel (always in dev; `?ext-debug` for admins in production) lists loaded
extensions, why each loaded (enabled, syntax, state, `renderAlways`), module
load time and size, current settings and state rows. Edited modules hot-swap
into their compartment in dev, reusing decision 2's mechanism.

### 18.7 State and settings migrations

State schemas and settings schemas take `migrations: { [toVersion]: (previous) => next }`.
The host upgrades on read and persists the upgraded shape on the next write.
Built the first time a shipped shape changes.

### 18.8 Documentation

- `extensions/README.md`: the mental model on one page (four modules, render
  vs authoring, the import rules, privileged contributions), then a walkthrough.
  Calendar is the fully commented reference extension.
- `.agents/skills/create-extension/SKILL.md`, indexed in `.agents/SKILLS.md`:
  the process for agents: scaffold, fixtures, contract test, playground check,
  `update-docs`. The npm script makes the files; the skill enforces the
  process.

### 18.9 Order

| When | What |
|---|---|
| Slice 1 | generated registries, typed `define*` for manifest and server, contract test |
| Slice 3 | `ext:new`, typed render/editor, test helpers, error isolation |
| After slice 3 | playground and fixtures, author guide, skill (done 2026-09-26) |
| When first needed | debug panel, migrations, per-extension size budgets |
