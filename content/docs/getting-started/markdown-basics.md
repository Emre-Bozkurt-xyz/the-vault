---
title: Markdown basics
slug: markdown-basics
category: Getting started
order: 10
public: true
---

# Markdown basics

Vault stores documents as Markdown. The editor adds buttons and live preview on top, but the saved content is plain Markdown text.

## Slash commands

Type `/` at the start of a line (or after a space) to open the slash command menu, then keep typing to filter it. Press **Enter** or **Tab** to insert the highlighted block; the `/query` text you typed is replaced by the block.

The menu inserts the same blocks as the toolbar — headings, bullet/numbered/task lists, quotes, code blocks, tables, callouts, math blocks, dividers, foldable regions, image uploads, asset groups, and wiki links — plus any blocks added by your enabled extensions (for example, a calendar). Enabled extensions appear automatically.

The slash menu never triggers inside a code block, inside inline `code`, in the document's Properties/frontmatter, or in the middle of a word — so `either/or` and `https://` in ordinary text are left alone.

To turn the menu off, open **Settings → Editor → Slash command menu**.

## Headings

Use one or more `#` characters at the start of a line.

```md
# Heading 1
## Heading 2
### Heading 3
```

Rendered example:

## Heading 2

### Heading 3

## Emphasis

```md
**bold**
*italic*
`inline code`
```

Rendered example:

**bold**

*italic*

`inline code`

Inline code is treated as literal text. Formatting markers inside inline code should not become bold, italic, or links.

## Lists

```md
- Unordered item
- Another item

1. Ordered item
2. Another item

- [ ] Task
- [x] Done task
```

Rendered example:

- Unordered item
- Another item
- [ ] Task
- [x] Done task

## Links

```md
[Vault](https://vault.ems-place.com)
```

Rendered example:

[Vault](https://vault.ems-place.com)

Links are clickable in preview and public pages. In dashboard previews, links are disabled so document cards stay easy to click.

## Code blocks

Use triple backticks for code blocks.

````md
```ts
const message = "Hello";
```
````

## Tables

```md
| Feature | Supported |
| --- | --- |
| Markdown | Yes |
| Collaboration | Yes |
```

Rendered example:

| Feature | Supported |
| --- | --- |
| Markdown | Yes |
| Collaboration | Yes |

Tables render in preview and public pages with horizontal scrolling on narrow screens.
