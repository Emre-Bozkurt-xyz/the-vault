---
title: CSS snippets
slug: css-snippets
category: Customization
order: 20
public: true
---

# CSS snippets

Vault is designed to support Obsidian-like CSS snippets. Snippet upload and management are not public yet, but the renderer already exposes stable hooks for future customization.

## Callout hooks

Callouts can be targeted by ID:

```css
.callout[data-callout="int-stat"] {
  --callout-color: 105, 115, 215;
}
```

Vault keeps the user-written ID in `data-callout`, even when it resolves to a default visual type.

## Markdown hooks

The Markdown renderer uses stable classes such as:

```txt
vault-markdown
vault-md-h1
vault-md-p
vault-md-link
vault-md-code
vault-md-pre
vault-md-table
vault-md-iframe
```

These hooks are intended to stay more stable than internal component structure.

## Live mode caveat

Live mode is built inside CodeMirror, which has stricter rendering rules than normal preview pages. Snippet support should target both:

```css
.vault-markdown .callout { }
.vault-markdown-editor-live .vault-cm-callout-rendered .callout { }
```

The preview renderer is the canonical output. Inactive Live-mode callouts and
asset groups use rendered block widgets; entering the block reveals the Markdown
source for editing.
