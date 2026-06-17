---
title: Callouts
slug: callouts
category: Customization
order: 10
public: true
---

# Callouts

Vault supports Obsidian-style callouts in blockquotes.

```md
> [!note] Title
> Body text goes here.
```

Rendered example:

> [!note] Title
> Body text goes here.

## Default callout types

These callout IDs have predefined icons and colors:

```txt
note
abstract
info
todo
tip
success
question
warning
failure
danger
bug
example
quote
```

Some aliases resolve to the same visual type. For example, `summary` and `tldr` resolve to `abstract`, while `hint` and `important` resolve to `tip`.

## Fold markers

Vault recognizes Obsidian's fold metadata:

```md
> [!note]+ Open by default
> This starts expanded.

> [!note]- Closed by default
> This starts collapsed.
```

Rendered examples:

> [!note]+ Open by default
> This starts expanded.

> [!note]- Closed by default
> This starts collapsed.

## Styling hooks

Rendered callouts expose snippet-friendly attributes:

```html
<div class="callout" data-callout="note" data-callout-resolved="note">
```

The original callout ID is stored in `data-callout`. The resolved/default visual type is stored in `data-callout-resolved`.
