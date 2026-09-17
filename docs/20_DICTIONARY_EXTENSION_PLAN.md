# Vault Dictionary Extension Plan

## 1. Goal

Hover a term in prose and read its definition without leaving the sentence.

```md
The queue handler must be [[Idempotence|idempotent]], or a retry
double-charges the customer.
```

The extension is `vault.dictionary`. Its framing is load-bearing:

> **A definition is a document. A reference to it is an ordinary wiki link.**

The dictionary is not a new content type. It is a *lens* over documents that
already exist, and almost everything below follows from refusing to build a
parallel system for them.

---

## 2. Non-Negotiable Invariants

Changing one of these is a redesign, not a tweak.

### A definition is a document tagged `definition`

- **Title** is the term.
- **`aliases:`** are the synonyms and inflections.
- **`summary:`** is the hover text, with the first body paragraph as fallback.

There is no `definitions` table and no new frontmatter key. A dedicated table
would have to re-earn permissions, versions, the Bin, search, backlinks,
transclusion, the Properties UI, and MCP access — all of which a document has
already.

### No new link syntax

`[[Term]]` already is the reference. `[[Term|inflected]]` already handles
inflections, `[[Term#Formal statement]]` already deep-links, and an
`unresolved` wiki link is already the "write the term now, define it later"
workflow. Introducing `[[def:Term]]` or `:def[Term]` would add a second thing to
parse and resolve in exchange for nothing the author cannot already express.

### The tag is data; every reader gets the render

Extension enablement gates **authoring**, not **reading**. This matches calc:
`enabledExtensionIds` gates the editor's slash menu
(`components/markdown/MarkdownEditor.tsx:379`) while `MarkdownDocument` renders
`:calc` values unconditionally on public pages.

A published document whose links stopped previewing because the reader has no
account — or because the *reader* has the extension off — would simply be
broken. The `definition` tag is in the document's own data; the renderer honours
it for everyone.

### Definition-ness is resolved server-side, never sniffed from Markdown

A `Definitions/` folder can supply `definition` through `folders.default_tags`,
and folder-inherited tags are materialised **only** into `document_tags`, never
into frontmatter (`lib/folder-tags.ts`). So a definition document's Markdown may
contain no evidence whatsoever that it is one.

Therefore `isDefinition` rides on `WikiLinkResolution`, computed from the
database alongside `href` and `label`. No renderer may parse frontmatter to
decide whether a link is a definition.

### The preview never becomes a second renderer

One card component, used by Live mode, Read mode, and public pages. A
hand-built DOM preview in CodeMirror and a React preview in Read mode would
drift within a release, and the drift would be invisible until an author asked
why their callout renders differently in a popover.

### Preview depth is capped at zero

The card renders Markdown, that Markdown can contain wiki links, and those
links would otherwise carry cards of their own. The card renders with links
disabled and nested previews suppressed — one level, always. Same reasoning as
`maxWikiEmbedDepth` in `components/markdown/MarkdownDocument.tsx`.

---

## 3. Data Model — Nothing New

| Concept | Where it lives | Already exists |
|---|---|---|
| The term | `documents.title` | yes |
| Synonyms | `aliases:` frontmatter → `document_metadata.aliases` | yes |
| Hover text | `summary:` frontmatter → `document_metadata.summary` | yes |
| "This is a definition" | `document_tags` row for the `definition` tag | yes |
| Reserved marker | `tags.category = "system"` | **one-line change** |

`TagCategory` (`db/schema.ts:33`, mirrored in `lib/content-metadata.ts:1`) gains
a `"system"` member. The column is `text` with no DB-level enum, so **no
migration** is required — only the TS union and the tag admin's category
labels.

Tag slugs are `[a-z0-9_]` only (`normalizeTagSlug`), so namespacing like
`vault:definition` is unavailable. The slug is the bare word `definition`;
`category: "system"` is what marks it as not-yours-to-invent.

### Two ways to author one

1. **Frontmatter** — `tags: definition` in the document itself.
2. **A folder** — file it in a folder whose `default_tags` include `definition`.

Both land the same row in `document_tags`, which is the only thing resolution
reads. (2) is the reason for the server-side invariant above, and it is the
nicer workflow: a `Definitions/` folder makes every document inside it a
definition with no frontmatter at all.

---

## 4. Resolution Map Additions

`WikiLinkResolution` (`lib/wiki-links.ts:7`) gains two optional fields:

```ts
/** Target carries the `definition` tag (own or folder-inherited). */
isDefinition?: boolean;
/** Bounded Markdown for the hover card: summary, else first paragraph. */
preview?: string;
```

Filled in `buildWikiLinkResolutionMap`, which slice 1 **moved to
`lib/wiki-links.ts`** — it was always pure, and being trapped in a `"use server"`
module meant its rules had no tests. Both document-backed entry points funnel
through it: `listWikiLinkResolutionsForUser` and
`listPublicWikiLinkResolutions`. `listOfficialDocWikiLinkResolutions` does
**not** — it mints its own resolutions in `server/official-docs.ts`, and a guide
carries no tags, so it is out of scope for the flag.

### The definition set is one narrow query, not a tag map

`listTagsForDocumentIds` (`server/documents.ts:1526`) exists, but the resolution
map spans *every readable document* — fetching all tags for all of them to find
one slug is the wrong shape. Instead: select `document_tags.document_id` joined
to `tags` where `slug = 'definition'`, scoped to the same readable set, into a
`Set<string>`.

### `preview` needs no join

The row already selects `documents.markdown` — `includeEmbeds` controls only
whether that markdown is *sent*, not whether it is read. So the preview comes
from `parseDocumentMetadata(row.markdown).summary`, falling back to the first
body paragraph. This is also *more* correct than joining `document_metadata`:
it is literally what the document says right now.

`preview` is computed **only for definitions** and bounded (~600 chars), which
is what keeps the public payload from growing. Everything else keeps `preview`
undefined.

### New pure helper: `lib/definitions.ts`

```ts
export function definitionPreview(markdown: string): string | undefined;
```

Summary first; otherwise the first paragraph after frontmatter, skipping
headings, fences, directive blocks (`:::calc`, `:::calendar`), region markers,
and callout syntax — a preview must never open mid-fence.

In `lib/`, not `server/`, for the established reason: everything under
`server/` transitively imports `auth.ts`, which cannot load under vitest (see
the comment atop `lib/folder-paths.ts`).

---

## 5. Aliases Resolve Wiki Links

`buildWikiLinkResolutionMap` currently registers only
`wikiTitleKey(document.title)`. It will also register `wikiTitleKey(alias)` for
each alias in the document's frontmatter.

This is a general improvement — it is not dictionary-specific — but it is most
of what makes the dictionary feel alive: `[[idempotent]]` finding a document
titled "Idempotence".

Precedence, mirroring the existing ambiguity handling:

1. A real **title** always beats an alias.
2. Two aliases colliding, with no title claim, is `ambiguous` — a status the
   renderer already draws.
3. No stemming, ever. `[[idempotency]]` does not find "Idempotence" unless
   someone aliased it. A stemmer is a language-specific guess that silently
   links the wrong document.

---

## 6. The Hover Card

### Not a `title` attribute

Explicitly rejected. The card shows a **rendered miniature of the definition** —
formatted text, scrollable when it overflows — which a browser tooltip cannot
do, and which is the whole point of the feature.

### Primitive

`@base-ui/react/preview-card`, already installed. It is built for exactly this:
hover-with-delay, keyboard and focus safe, dismissible, closes on scroll-away.
`@base-ui/react/scroll-area` handles the overflow body. Nothing hand-rolled.

New component: `components/markdown/DefinitionPreviewCard.tsx` — a client
component wrapping the link, receiving `{ label, href, preview }`. It renders
`MarkdownDocument` with `disableLinks` and previews suppressed, styled as a
small document page (border, radius, `--muted` ground) with a max height and a
footer affordance to open the definition properly.

### Read mode and public pages

`transformWikiLinks` emits a plain Markdown link for a resolved target, and a
Markdown link cannot carry attributes. Rather than emit raw HTML and widen
`lib/markdown/sanitize.ts`, `MarkdownDocument` builds a `Map<href, resolution>`
from the `wikiLinks` prop it already receives and checks it in its existing `a`
component override. **No new HTML, no sanitizer change.** Fragments are
stripped before lookup.

`MarkdownDocument` stays RSC-renderable: the card is the client boundary, the
link text passes through as children.

### Live mode parity

The live-preview wiki link already gets a mark decoration
(`previewWikiLink`, `MarkdownEditor.tsx:2411`), so a real `<span>` exists in
`.cm-content` to anchor to. Two changes:

1. `addWikiLinkDecorations` mints per-target marks carrying
   `attributes: { "data-vault-definition": "<docId>" }` instead of reusing one
   shared static mark.
2. A single delegated `pointerover` handler on the content DOM drives one
   controlled `DefinitionPreviewCard`, anchored to the hovered span.

The editor already holds `wikiLinkMap` client-side with `embedMarkdown` for
every readable document (`app/(workspace)/docs/[docId]/page.tsx:109`), so **no
fetch is needed in Live mode.**

Fallback if controlled anchoring fights CodeMirror's DOM recycling: a CM
`hoverTooltip` that mounts the same component via `createRoot`. Prior art for
the tooltip mechanics is the inline-math tooltip (`MarkdownEditor.tsx:2734`),
though that one is cursor-driven rather than mouse-driven.

Source mode gets nothing. It is source.

### Link styling: weight only

```css
.vault-md-definition-link { font-weight: 500; text-decoration: none; }
```

No dotted underline, no colour change, no icon. A dense document can carry a
dozen defined terms in a paragraph, and anything louder turns prose into a
warning label. Weight is also theme-agnostic, so it needs no dark/light
tuning — unlike the calc hairline, which had to be fixed for exactly that
reason.

Register the class in `docs/CSS_CONTRACT.md`.

---

## 7. Authoring: `/def` and `/term`

### Framework gap this forces

`SlashCommandContribution` (`lib/extensions/types.ts:290`) requires `insert` —
every slash contribution today can only put Markdown in the document. `/def`
must *create a document*, which no contribution shape expresses.

`insert` becomes optional, and a sibling arrives:

```ts
/**
 * Instead of inserting Markdown, run a named editor capability. The host owns
 * the implementation; an unknown name means the item is filtered out, so an
 * extension can never declare a capability the editor does not have.
 */
run?: { command: string };
```

The catalog stays pure data and factories — no `db`, no server action import,
preserving the §18 invariant. The editor maps the name to a handler built from
its own props and imports, the way it already imports
`saveMarkdownDocumentAction` (`MarkdownEditor.tsx:134`).

### `/def` does not navigate away

The sketch that started this feature said `/def` "sends you to a new file". It
should not: you are mid-sentence when you type it, and moving the viewport to a
blank document to name a term costs more than it saves.

Instead `/def` takes the term inline, then:

1. creates the definition document in the background — title = term,
   `tags: definition`, empty `summary`, filed per the setting below;
2. inserts `[[Term]]` at the cursor;
3. opens it as a **background tab** in the strip, without stealing focus.

You keep writing. The stub is waiting when you stop.

### Where new definitions land

Default: **the current document's folder**. `folderId` is on the document page
already, threaded for the breadcrumb work. Configurable through a new
preference (`lib/settings/preferences.ts`) offering *same folder as the current
document* or *a chosen folder*.

Note the interaction worth choosing deliberately: pointing that setting at a
folder whose `default_tags` include `definition` means `/def` does not need to
write `tags: definition` into frontmatter at all.

### `/term`

The wiki-link completion `/link` already opens, filtered to `isDefinition`.
Cheap once the flag exists, since the completion source reads the same
resolution map.

---

## 8. Agent Actions

Registry membership makes these nearly free, and they are the reason to prefer
it over a core-with-a-gate implementation:

| Action | Scope | Mutates | Purpose |
|---|---|---|---|
| `listDefinitions` | workspace | no | Every defined term with its summary. |
| `listUndefinedTerms` | document | no | `[[links]]` in this document that resolve to nothing — the glossary gap list. |
| `defineTerm` | workspace | yes | Create a definition document for a term. |

Handlers stay pure functions of `(input, ctx)` with no `db` import, per the
existing §18 invariant.

---

## 9. Slices

1. **Data and resolution.** `TagCategory: "system"`; `lib/definitions.ts` with
   `definitionPreview`; `isDefinition` + `preview` on `WikiLinkResolution`,
   filled in `buildWikiLinkResolutionMap`; alias title keys. Unit tests on the
   pure helpers. Nothing visible yet.
2. **The card, on read surfaces.** `DefinitionPreviewCard`, the `a` override
   reverse lookup in `MarkdownDocument`, the weight-only link style, the
   depth-zero guard. Works in Read mode, public pages, and embeds.
3. **Live-mode parity.** Per-target mark attributes, delegated hover, the same
   card anchored in `.cm-content`.
4. **Authoring.** `vault.dictionary` in `lib/extensions/catalog.ts`; the `run`
   contribution kind; `/def` with background creation and a background tab;
   `/term`; the default-folder preference.
5. **Agent actions.** The three above.

---

## 10. Known Risks

- **CodeMirror DOM recycling vs. a floating anchor.** A mark span can be
  replaced under the open card. Close on span detach; the `hoverTooltip`
  fallback exists if this proves fiddly.
- **Public payload growth.** Bounded `preview` (~600 chars, definitions only)
  is the mitigation. Worth measuring on a vault with many definitions before
  slice 2 ships.
- **Existing `definition` tags.** Anyone who already tags documents
  `definition` gets previews without asking. Arguably correct — they said it
  was a definition — but it is a behaviour change on existing data, not a
  purely additive feature.
- **First-paragraph extraction is a parser.** It must skip frontmatter,
  fences, directives, regions, and callouts. A preview that opens mid-fence is
  the failure mode to test for.
- **No stemming is a real limitation, accepted.** Terms with irregular
  inflections need an explicit alias. That is a smaller cost than a stemmer
  linking the wrong document confidently.
