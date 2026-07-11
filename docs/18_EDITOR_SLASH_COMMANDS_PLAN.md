# Editor Slash Commands Plan

## 1. Goal

Give the Markdown editor a Notion-style in-editor slash menu: typing `/` at the
cursor opens a filterable insert menu of document blocks, without leaving the
typing flow.

The target checkpoint is:

```txt
An editor with edit access types "/" at the start of a line (or after
whitespace), sees a filtered menu of insertable blocks at the cursor, picks one
with Enter or click, and the "/query" text is replaced by the inserted block —
including extension-contributed blocks, gated on the same enablement flags as
the rest of the editor.
```

This plan builds on:

```txt
components/markdown/MarkdownEditor.tsx   (autocompletion override, applyFormat)
components/markdown/MarkdownToolbar.tsx  (existing insertion entry points)
lib/extensions/types.ts                  (VaultExtension manifest)
lib/extensions/registry.ts               (contribution selectors)
components/workspace/WorkspaceCommandPalette.tsx (workspace "/" command mode)
```

## 2. Two command surfaces, one rule

Vault now has two `/` surfaces with distinct jobs:

| Surface | Lives in | Job |
|---|---|---|
| Workspace command bar (Ctrl/Cmd+K then `/`) | `WorkspaceCommandPalette` | Operations *on* documents and the workspace: share, publish, archive, snapshot, navigation, theme, settings |
| Editor slash menu (this plan) | CodeMirror completion at the cursor | Insertions *into* the document markdown: blocks, embeds, extension blocks |

The routing rule:

```txt
If the command's result is text in documents.markdown, it belongs in the
editor slash menu. If it manipulates state outside the markdown (sharing,
visibility, overlay extension state, navigation), it belongs in the command
bar. A command may declare both surfaces; each surface renders it natively.
```

Applied to today's extensions:

- **Calendar** inserts a calendar fence into the markdown (`applyFormat("calendar")`)
  → moves to the editor slash menu. It may *also* stay in the command bar
  (dual-surface) since the retained command bus already delivers it to the
  editor, but the slash menu is its primary home.
- **Stickers** write overlay JSON to `document_extension_states`, not markdown
  → stays a command bar command only.

## 3. Architecture

### 3.1 The completion source (core slice)

New file `components/markdown/slash-commands.ts` exporting
`createSlashCommandCompletionSource(options)`, registered as a fourth entry in
the existing `autocompletion({ override: [...] })` list in `MarkdownEditor.tsx`.

Trigger rules:

```txt
- match `/query` only when the "/" is at line start or preceded by whitespace
  (context.matchBefore) — "either/or" and "https://" never trigger
- never trigger inside fenced code blocks or the frontmatter block (syntax
  tree check, same exclusion approach live-blocks uses)
- only when the editor is editable (source + live modes)
- Escape dismisses and leaves the literal "/" (CodeMirror default); reuse the
  wiki-completion dismissal-store pattern if re-trigger suppression is needed
```

Insertion: each item's `apply` first deletes the matched `/query` range, then
performs the insertion. Core items reuse the existing insertion helpers —
`applyFormat` already implements headings, lists, task list, blockquote,
inline formats, link, code fence, table, region, horizontal rule, calendar,
image upload, and `:::assets` groups. The source receives an
`applyFormat`-shaped callback plus a raw `insertMarkdown(view, text)` fallback;
no large refactor of `MarkdownEditor.tsx` is required for slice 1.

Core item list (slice 1):

```txt
heading1/2/3, bullet list, numbered list, task list, quote, code block,
table, divider, callout (> [!note]), math block ($$), foldable region,
assets group, upload image, wiki link ("[[" + startCompletion chain)
```

Rendering uses the standard CodeMirror autocomplete tooltip (keyboard nav,
scrolling, and positioning come free — no bespoke list widget). Items carry
`label` (the slash token), `detail` (human label), and `section` (group).
Icons are a slice-3 polish via `addToOptions`.

### 3.2 Extension contributions (slice 2)

Add to `lib/extensions/types.ts` under `VaultExtension["markdown"]`:

```ts
export type SlashCommandContribution = {
  id: string;            // namespaced under the extension id
  label: string;         // the slash token shown/filtered, e.g. "calendar"
  description?: string;
  keywords?: string;
  group?: string;        // tooltip section, defaults to the extension name
  /**
   * Declarative insertion. A factory keeps dynamic content possible (e.g.
   * generateCalendarId()) while staying a pure client-runnable function —
   * same invariant as agent action handlers: no server-only imports.
   */
  insert:
    | { markdown: string | (() => string); cursorOffset?: number }
    | { format: MarkdownFormat };
};
```

Registry gets `getSlashCommandContributions()` (flatMap over
`markdown.slashCommands`, tagged with `sourceExtensionId`), mirroring
`getCommandContributions()`. The editor filters contributions through the same
per-user enablement set that currently produces `calendarEnabled` /
`stickersEnabled`, so disabled extensions never appear in the menu.

`vault.calendar` then declares its slash item in `lib/extensions/catalog.ts`
and the hardcoded calendar branch in the slash source is removed.

### 3.3 Settings

One toggle in the existing `editor/defaults` user-settings key:
`slashMenu: boolean`, default `true`, surfaced in the settings modal's Editor
section. No schema/migration work — `user_settings` values are free-form JSON
behind `server/user-settings.ts` validation.

## 4. Edge cases and invariants

```txt
- Collaboration: insertions are ordinary CodeMirror transactions, so they flow
  through yCollab/Y.Text like any keystroke. No collab-specific code.
- Autosave/versioning: unchanged — the insertion is a normal doc change.
- Live preview: inserting a block whose line the cursor occupies keeps the
  block "active" (literal source) per existing live-block rules; no special
  handling needed.
- The three existing completion sources (html, wiki-link, asset) stay ordered
  before/after the slash source in the override list; the slash source
  returns null whenever its trigger pattern doesn't match, so sources never
  fight over the same context.
- Read-only surfaces (MarkdownDocument, public/share routes) are untouched;
  the source is only registered in the editable editor build.
- No new server surface: slice 1 and 2 are entirely client-side; permission
  posture is unchanged (you can only insert into documents you can already
  edit).
```

## 5. Slices

| Slice | Contents | Exit test |
|---|---|---|
| 1 — core slash source | `slash-commands.ts`, core item list via `applyFormat`, trigger/exclusion rules, registered in `MarkdownEditor` | Type `/tab` on an empty line → pick Table → skeleton inserted, `/tab` gone; `either/or`, fenced code, and frontmatter never trigger |
| 2 — extension contributions | `SlashCommandContribution` type, registry selector, calendar declared in catalog, enablement gating | Calendar appears in the menu only when the extension is enabled; disabled → absent |
| 3 — polish | Icons in tooltip options, group sections, editor settings toggle, recent-first ordering, user docs (`content/docs/`) update | Toggle off in settings → `/` never opens the menu |

## 6. Explicitly out of scope

```txt
- Command palette fuzzy ranking, post-command toasts, jump-to-heading, and
  bindable palette commands (separate follow-ups; see 2026-07-10 UX notes).
- Unifying workspace commands and editor slash commands into one keybindable
  command registry — revisit after this ships and the command shape settles.
- AI/agent-invoked insertions (covered by MCP tools and agent actions).
```
