# Definition Authoring and Previews

Status: proposed follow-up, 2026-09-18. Planning only; not implemented.

This revises the summary-first authoring and Live styling choices in
`20_DICTIONARY_EXTENSION_PLAN.md`. The original implementation remains the
current behavior until the slices below ship.

## Product model

A definition is still an ordinary document tagged `definition`. Its title is
the term, aliases remain metadata, and references remain ordinary wiki links.
The **body is the definition**. The hover card shows an excerpt of that body.
`summary` returns to being optional document metadata, not a second definition
that authors have to keep synchronized. No new table or link syntax is needed.

## Findings in the current code

- `live-definitions.ts` deliberately keeps normal wiki-link styling;
  `MarkdownEditor.tsx` gives every Live wiki link the same static decoration.
- Read mode has a weight-only definition style, but `buildDefinitionsByHref`
  and the Live hover resolver both require a nonempty preview. Empty definition
  documents therefore lose their definition treatment.
- `DefinitionPreviewCard.tsx` gives Open a separate footer and divider. The CSS
  uppercases and mutes the title, while the body uses compact page rendering.
- `NewDefinitionDialog.tsx` uses a two-line textarea, limits it to 500 characters,
  and submits on Enter. Creation stores this text in frontmatter `summary`.
- `definitionPreview` prefers summary; its body fallback skips fences,
  directives, callouts and standalone transclusions, then cuts at 600 characters.
- `createDefinitionForUser` reuses any owned, non-deleted same-title document,
  without checking the definition tag, and ignores submitted content on reuse.
- The full `MarkdownEditor` owns persistence, collaboration and document
  integrations. Nesting it unchanged inside the creation dialog is unsuitable.

## 1. Term appearance

Recommended default: body text color, medium weight, and a fine dotted underline
with a small offset. Normal wiki links keep their existing link styling. Keep
term text inline, without pills or per-term icons. This intentionally revises
the original weight-only design; check dense prose beside existing calc styling.

Use the same treatment in Live, Read, public views and embeds. The server's
`isDefinition` flag determines the treatment even when the body is empty.
Empty definitions show a short "No definition written yet" preview and Open.

Keep the first-mention preference: repeated mentions lose extra weight and the
underline but retain hover/focus behavior. Key mentions by resolved document
identity, including aliases. Live decoration updates must react to resolution
changes as well as text edits, without changing selection or scroll position.
Source mode keeps literal Markdown.

## 2. Compact preview

```text
Program                                  Open ↗
A passive entity stored on disk.
```

- Title and Open share one header row; no footer or divider.
- Preserve the title's casing; use readable foreground text and modest weight.
- Start around 320–360 px wide, 12–14 px padding, 14 px body text and 1.5 line
  height. Use existing font/color tokens and verify both themes and zoom.
- Scope compact block spacing to the card. Preserve authored emphasis, lists,
  code and math without inheriting page-sized heading or paragraph spacing.
- Bound height; scroll only when needed. Keep a visible header and Open action.
- Preserve hover delay, pointer travel into the popup, keyboard dismissal and
  viewport collision handling. Check Live keyboard access separately from the
  Read trigger; touch users must be able to open the document without hover.
- Keep one shared card for Live and Read/public surfaces.

The preview is a small read-only excerpt, not a live widget workspace. Select
leading complete Markdown blocks from the body, excluding frontmatter and a
redundant opening title. Use the parser/block model rather than blank-line regex
or arbitrary character slicing, so fences and formatting remain valid.

Initial budget: up to three complete blocks and roughly 1,200 source characters.
Use a safe text excerpt for an oversized first block rather than malformed
Markdown. Include a truncation flag for a subtle "More in document" indication.
These are starting budgets to verify against real examples, not schema limits.

Support paragraphs, lists, quotes/callouts, code and math first through the
existing renderer. For stateful widgets, transclusions or assets requiring
additional context, show a compact labeled placeholder and Open; do not silently
omit a definition whose first content is a widget. Full document pages retain
normal widget functionality. Later static widget previews can opt into this
surface with explicit document context and permissions.

Suppress nested definition cards and recursive transclusions. Do not attach
whole bodies, asset maps or extension state to every autocomplete entry. Keep
excerpts bounded; richer future previews should resolve on demand and recheck
access. Public previews must not expose private content, assets or app routes.

## 3. Create without leaving the sentence

Recommended layout, pending feedback: a compact modal with the familiar Vault
Live editor, wide enough to write a short paragraph or list comfortably. Use
the existing responsive dialog pattern on small screens.

1. Select a term and invoke Define, run `/def`, or choose Define on an unresolved
   title link. Prefill the term; focus the body when a term is already supplied.
2. Show Term, Definition, and a quiet destination hint. Honor the existing folder
   setting and permission-checked fallback. Avoid a properties panel by default.
3. Write in Live mode with Source available. Basic Markdown formatting, lists,
   links, code, math and supported stateless blocks render as in the main editor.
   Enter inserts a newline; Ctrl/Cmd+Enter submits.
4. Primary action: **Create and insert**, or **Create definition** for an existing
   unresolved link. Save title, tagged Markdown body and ownership successfully
   before modifying the source document. Insert a canonical ID link while keeping
   the selected/typed visible label. Refresh resolution so styling and preview
   work immediately. Restore the original selection/scroll context.
5. Secondary action: **Create and open** saves the same draft and opens the full
   definition for longer writing, uploads and stateful widgets. Return to the
   original document through the normal workspace tab.

No document is created just by opening the modal. Keep the draft on errors and
protect nonempty drafts from accidental dismissal. An explicit **Define later**
action may create an empty tagged document, insert its link and open a background
tab; keep this distinct from submitting an accidentally empty body.

Extract a reusable controlled editor surface from the existing editor, sharing
Live rendering and formatting behavior. The draft owns its Markdown locally;
it has no autosave, collaboration session or fake document ID. Capability flags
hide upload/stateful commands until a real document exists. Do not build a
separate Markdown renderer or enable recursive `/def` modals. The full editor
continues to own persistence and document-specific capabilities.

Map the insertion range through source-document edits while the dialog is open,
including collaboration changes. If the original range disappears, keep the
created definition and offer insertion at the current cursor; do not overwrite
unrelated text. Prevent duplicate submissions and preserve drafts if a race
discovers an existing match after the user has written content.

## 4. Existing terms and collisions

Show permission-scoped existing definition matches as the term is entered,
including title/alias and folder context. Offer **Use existing** explicitly;
never discard the authored body as a successful silent reuse.

An ordinary same-title document is not automatically a definition. Offer an
explicit choice to use that document as a normal link, or create a separate
definition with a canonical ID link. Converting an existing document can be a
later explicit edit action with normal permissions. Titles remain non-unique.
Aliases and shared definitions may be referenced without granting edit access.

## 5. Body storage and compatibility

- New UI and agent creation accept body Markdown and store it in
  `documents.markdown`; preserve the existing explicit `definition` tag.
- Preview priority becomes body, then legacy summary only when the body is empty.
  A body consisting of a widget still wins and gets its compact placeholder.
- Keep existing summaries intact. No automatic destructive migration is needed.
  For a legacy summary-only definition, offer **Use summary as body** to an
  authorized editor; persist through the normal collaboration-safe write path.
- Update `defineTerm`, the extension API types/context, list output and user
  guides together. Add an explicit preview/excerpt output; do not relabel the
  metadata summary as a body. Temporarily accept legacy `summary` input as an
  initial body when Markdown is absent; reject conflicting dual inputs clearly.
- Validate body size using normal document limits, report invalid input, and
  keep permission helpers authoritative. Any future asset insertion must link
  assets to the new definition's ID, never the source document's ID.

No database schema migration is expected. If a later slice introduces persistent
drafts or preview-selection metadata, plan and document that separately.

## 6. Delivery slices and acceptance

1. **Visual repair:** distinguish terms, handle empty definitions, unify first
   mention behavior, and compact the shared card. Check Live/Read/public views,
   aliases, both themes, keyboard, touch and dense paragraphs in the browser.
2. **Body contract:** body-first previews, valid bounded extraction, server/agent
   contracts and legacy compatibility. Test fences, lists, callouts, oversized
   blocks, widget-only documents, inaccessible/private targets and stale maps.
3. **Live composer:** shared editor surface, local draft lifecycle, explicit
   reuse, canonical insertion and Create and open. Exercise cancellation,
   failures, repeated submit, name collisions and concurrent source edits.
4. **Integration verification:** owner/editor/viewer/public permissions, folder
   placement, save/reopen, source-editor regression checks and legacy documents.
   Update editor/data docs, CSS contract, user guides and project knowledge to
   the shipped behavior; keep the progress tracker accurate per slice.

Deferred: automatic linking of bare prose, a separate glossary database, custom
per-definition preview regions, stateful widgets inside hover cards, and a
second rich-document editing system.
