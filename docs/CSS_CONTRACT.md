# Document-content CSS contract

This is the **stable selector API** for rendered document content. Two audiences
depend on it:

1. **CSS snippet authors** (see `docs/17_POLISH_AND_CSS_SNIPPETS_PLAN.md`) target
   these classes to style documents.
2. **Internal code** in `components/markdown/MarkdownDocument.tsx`,
   `lib/asset-embeds.ts`, and `lib/wiki-links.ts` emits them.

Because snippets and user raw HTML depend on these names, **treat them as a
public API**: renaming or removing a contract class is a breaking change and
needs a deprecation path. Non-contract classes (below) are internal and may
change freely.

Two related mechanisms are often confused with this contract. Neither is the
same thing:

- **`lib/html-class.ts`** governs what *authors* may put in a `class` attribute
  on raw HTML, so a shared document cannot borrow app chrome to spoof the UI. It
  is much narrower than this contract — `.vault-md-p` is contract but is not in
  that allowlist. Generated classes appear there only when a transform emits
  them as an HTML *string* that flows back through the sanitizer (asset embeds,
  wiki links). Classes applied by a React component in
  `createMarkdownComponents` are added after the rehype pipeline and never need
  an allowlist entry.
- **The snippet compiler** (`lib/snippets/compile.ts`) has **no class allowlist
  at all**. `selectorIsSafe` rejects only `html`/`body`/`:root`/`:host` and
  over-deep selectors; every other selector is scope-prefixed and allowed. So
  exposing new markup to snippet authors requires stable class names and an
  entry here — not a compiler change.

## Scope

All contract classes live inside the document body container
(`.vault-markdown`, and in a later phase `.vault-document-canvas`). Snippet CSS
is rewritten to be descendant-scoped under
`[data-vault-snippet-scope="<documentId>"]`, so contract selectors only ever
match inside one document's rendered body.

## Block text

| Class | Element |
|---|---|
| `.vault-md-h1` … `.vault-md-h6` | headings (auto-assigned `id` slugs) |
| `.vault-md-p` | paragraphs |
| `.vault-md-ul` / `.vault-md-ol` / `.vault-md-li` | lists / items |
| `.vault-md-blockquote` | blockquotes (non-callout) |
| `.vault-md-hr` | horizontal rules |
| `.vault-md-pre` / `.vault-md-code` | code block / inline & fenced code |

## Inline text

`.vault-md-strong`, `.vault-md-em`, `.vault-md-link`, `.vault-md-mark`,
`.vault-md-small`, `.vault-md-sub`, `.vault-md-sup`, `.vault-md-kbd`,
`.vault-md-abbr`.

## Tables & definition lists

`.vault-md-table-wrap`, `.vault-md-table`, `.vault-md-th`, `.vault-md-td`,
`.vault-md-dl`, `.vault-md-dt`, `.vault-md-dd`.

## Media

`.vault-md-image-frame`, `.vault-md-img`, `.vault-md-iframe`,
`.vault-md-figure`, `.vault-md-figcaption`.

## Callouts

Container `.callout`, with a resolved-type hook
`.callout[data-callout-resolved="<type>"]` where `<type>` ∈ `note`, `abstract`,
`info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`,
`bug`, `example`, `quote`. Parts: `.callout-title`, `.callout-icon`,
`.callout-title-inner`, `.callout-content`, `.callout-summary`. The raw input
type is also exposed as `[data-callout="<input>"]`.

Callout CSS variables are part of the contract: `--callout-color` (an **RGB
triple**, consumed via `rgb()/rgba()`) and `--callout-icon` (a `lucide-<id>`
value). `--callout-icon` is resolved by the client component
`components/markdown/CalloutIcon.tsx`, which reads the computed variable and
renders the named Lucide icon via `lucide-react/dynamic`; the built-in icon is
server-rendered as the fallback. Raw `<svg>` values cannot reach this path (the
snippet compiler bans `<`/`>`), so only the `lucide-<id>` form is supported.

## Asset embeds

`.vault-asset-embed` with modifiers `--image` / `--file` / `--missing`;
`.vault-asset-embed-image`, `.vault-asset-embed-caption`, and the file-card
parts `.vault-asset-file-icon` / `-body` / `-title` / `-meta` / `-action`.
Grouped galleries: `.vault-asset-group`, `.vault-asset-group-grid`,
`.vault-asset-group-item`, `.vault-asset-group-caption`, and the layout
modifiers `.vault-asset-group-columns-N`, `-gap-*`, `-align-*`, `-width-*`.
Single-embed layout modifiers: `.vault-asset-width-*`, `.vault-asset-align-*`,
`.vault-asset-layout-*`.

## Wiki links, regions, embeds

`.vault-md-wiki-link` (+ `-ambiguous` / `-private`), `.vault-md-hidden-anchor`,
`.vault-md-region` (+ `-foldable` / `-static`), `.vault-md-document-embed`
(+ header/title/body/message parts), `.vault-region`.

## Calc values

Inline computed values (`:calc[…]`) and `:::calc` blocks. See
`docs/19_CALC_EXTENSION_PLAN.md`.

| Class | Element |
|---|---|
| `.vault-calc` | inline value root |
| `.vault-calc-name` | the bound name, when shown |
| `.vault-calc-op` | the `=` separator |
| `.vault-calc-expr` | the source expression (`show=expr`, and error bodies) |
| `.vault-calc-value` | the formatted result |
| `.vault-calc-block` | a `:::calc` declarations block |
| `.vault-calc-block-body` / `-row` | the row grid and one declaration |
| `.vault-calc-block-summary` / `-title` / `-caret` | the `{collapsed}` fold header |

State is a data attribute rather than modifier classes, matching the callout
precedent: `.vault-calc[data-calc-state="<state>"]` where `<state>` ∈ `ok`,
`error`. The FX slice adds `converted` and `stale`; styling `[data-calc-state]`
generally is forward-compatible, so new states never need new contract classes.

`.vault-calc-block-foldable` marks a block rendered as `<details>`; use
`[open]` for the expanded state.

Every one of these is applied by `CalcValue`/`CalcBlock` after the rehype
pipeline, so none appear in `lib/html-class.ts` and authored raw HTML cannot
mint them.

## Author hook classes

Raw HTML in a document may use `class="snip-*"` for author-defined styling
hooks (e.g. `<div class="snip-hero">`). `snip-*` is the only free-form class
prefix content may introduce; everything else is stripped by
`lib/html-class.ts`.

## Not part of the contract (internal — do not rely on)

- App chrome / layout: `.vault-doc-*` (preview cards), workspace shell classes,
  the document outline (`.vault-outline*`, `.vault-reading-frame`,
  `.vault-reading-content`), any Tailwind utility class.
- Editor internals: `.vault-cm-*`, `.vault-markdown-editor*`, anything under
  `.cm-*`.
- Extension widgets: `.vault-calendar*`, sticker overlay classes.
- Design tokens and theme variables in `app/styles/tokens.css` are readable by
  snippets (`var(--muted-foreground)` etc.) but their names are not guaranteed.

These are excluded from the raw-HTML allowlist and cannot be targeted by content
class attributes; snippet CSS can technically write selectors against editor
classes but they are unsupported and may break.
