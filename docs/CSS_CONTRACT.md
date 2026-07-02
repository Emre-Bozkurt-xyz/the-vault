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

The classes here are exactly what the raw-HTML class allowlist
(`lib/html-class.ts`) and the snippet compiler's selector policy permit content
to reference. Keep the three in sync.

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

## Author hook classes

Raw HTML in a document may use `class="snip-*"` for author-defined styling
hooks (e.g. `<div class="snip-hero">`). `snip-*` is the only free-form class
prefix content may introduce; everything else is stripped by
`lib/html-class.ts`.

## Not part of the contract (internal — do not rely on)

- App chrome / layout: `.vault-doc-*` (preview cards), workspace shell classes,
  any Tailwind utility class.
- Editor internals: `.vault-cm-*`, `.vault-markdown-editor*`, anything under
  `.cm-*`.
- Extension widgets: `.vault-calendar*`, sticker overlay classes.
- Design tokens and theme variables in `app/styles/tokens.css` are readable by
  snippets (`var(--muted-foreground)` etc.) but their names are not guaranteed.

These are excluded from the raw-HTML allowlist and cannot be targeted by content
class attributes; snippet CSS can technically write selectors against editor
classes but they are unsupported and may break.
