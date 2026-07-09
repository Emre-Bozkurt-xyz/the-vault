---
title: CSS snippets
slug: css-snippets
category: Customization
order: 20
public: true
---

# CSS snippets

Snippets are small CSS stylesheets you write to restyle your documents. When you
attach a snippet to a document, **everyone who can view that document sees your
styling** — on the public page, a share link, or inside the workspace.

Snippets are sanitized on the server before anyone sees them, so they can only
ever change the look of *your document's body*. They cannot touch the app around
it, other pages, other documents, or the network. You write plain selectors;
Vault confines them for you.

---

## Quick start

1. Open **Settings → Snippets**, give a snippet a name, and click **Create**.
2. Click **Edit CSS**, write your CSS, and watch the live preview. The preview
   shows exactly what viewers see — including a note for any rule that was
   dropped and why.
3. Click **Save**.
4. Open a document you own, and in the right-hand **Styling** card attach the
   snippet. A document can hold up to five snippets; they apply in listed order.

Viewers get a **Custom styling** pill to turn your styling off for their view,
and signed-in users can disable all author styling globally from
**Settings → Snippets**.

---

## Where snippets apply

| Surface | Applies? |
|---|---|
| Read / preview mode (editor) | Yes — full styling |
| Live & Source editing (editor) | Yes — on rendered blocks (callouts, tables, math, embeds); raw source lines pick up callout **colors** only |
| Public page, share link, workspace document view | Yes — full styling |
| App chrome, sidebar, other documents | Never (by design) |

> Editing in **Live** mode now shows your styling on the rendered blocks as you
> work. To see the document exactly as a viewer will — every element, full
> layout — switch the editor to **Read** mode (the mode switch is above the
> editor).

---

## How scoping works

Every selector you write is automatically rewritten to live **inside your
document's body only**. Concretely, Vault prefixes each selector with a
per-document scope:

```css
/* you write */
.vault-md-h1 { letter-spacing: -0.01em; }

/* Vault compiles it to (conceptually) */
[data-vault-snippet-scope="<documentId>"] .vault-md-h1 { letter-spacing: -0.01em; }
```

Because of this you **cannot** target `:root`, `html`, or `body` (those are
rejected), and nothing you write can affect anything outside the document body.

---

## The class contract

These are the **stable, supported** class names on rendered document content.
Treat them as the public API — internal/editor classes (`.vault-cm-*`, `.cm-*`,
Tailwind utilities, workspace chrome) are **not** part of the contract and may
change or break at any time.

### Block text

| Class | Element |
|---|---|
| `.vault-md-h1` … `.vault-md-h6` | headings (each gets an auto `id` slug) |
| `.vault-md-p` | paragraphs |
| `.vault-md-ul` / `.vault-md-ol` / `.vault-md-li` | lists / list items |
| `.vault-md-blockquote` | blockquotes (non-callout) |
| `.vault-md-hr` | horizontal rules |
| `.vault-md-pre` / `.vault-md-code` | code block / inline & fenced code |

### Inline text

| Class | Element |
|---|---|
| `.vault-md-strong` / `.vault-md-em` | bold / italic |
| `.vault-md-link` | links |
| `.vault-md-mark` | `==highlight==` |
| `.vault-md-small` / `.vault-md-sub` / `.vault-md-sup` | small / subscript / superscript |
| `.vault-md-kbd` | keyboard keys |
| `.vault-md-abbr` | abbreviations |

### Tables & definition lists

| Class | Element |
|---|---|
| `.vault-md-table-wrap` | scroll wrapper around a table |
| `.vault-md-table` | the `<table>` |
| `.vault-md-th` / `.vault-md-td` | header / body cells |
| `.vault-md-dl` / `.vault-md-dt` / `.vault-md-dd` | definition list / term / description |

### Media

| Class | Element |
|---|---|
| `.vault-md-figure` / `.vault-md-figcaption` | figure / caption |
| `.vault-md-image-frame` | responsive frame around an image |
| `.vault-md-img` | the `<img>` |
| `.vault-md-iframe` | allowed embeds (YouTube, Spotify, Vimeo, …) |

### Wiki links, regions, embeds

| Class | Element |
|---|---|
| `.vault-md-wiki-link` (+ `-ambiguous` / `-private`) | `[[wiki links]]` |
| `.vault-md-hidden-anchor` | heading anchor targets |
| `.vault-md-region` (+ `-foldable` / `-static`) | region blocks |
| `.vault-md-document-embed` (+ header/title/body/message parts) | embedded documents |

### Asset embeds

| Class | Element |
|---|---|
| `.vault-asset-embed` (+ `--image` / `--file` / `--missing`) | a single embed |
| `.vault-asset-embed-image` / `.vault-asset-embed-caption` | embedded image / caption |
| `.vault-asset-file-icon` / `-body` / `-title` / `-meta` / `-action` | file-card parts |
| `.vault-asset-group` / `-grid` / `-item` / `-caption` | grouped gallery `:::assets` |

Layout modifiers (set from the embed's attribute block, not usually restyled):
`.vault-asset-width-*`, `.vault-asset-align-*`, `.vault-asset-layout-*`, and for
groups `.vault-asset-group-columns-N`, `-gap-*`, `-align-*`, `-width-*`.

---

## Callouts

Callouts are the richest styling target. A callout renders as:

```html
<div class="callout" data-callout="tip" data-callout-resolved="tip">
  <div class="callout-title">
    <span class="callout-icon">…svg…</span>
    <span class="callout-title-inner">Title</span>
  </div>
  <div class="callout-content">…body…</div>
</div>
```

A foldable callout (`> [!tip]+` / `-`) is a `<details class="callout">` with a
`.callout-summary` in place of `.callout-title`, and carries `data-callout-fold`.

### Callout parts

| Class / attribute | What it is |
|---|---|
| `.callout` | the container |
| `.callout-title` / `.callout-summary` | title row (summary = foldable) |
| `.callout-icon` | icon wrapper (contains an inline `<svg>`) |
| `.callout-title-inner` | the title text |
| `.callout-content` | the body |
| `[data-callout="<input>"]` | the type **as you typed it** (e.g. `tldr`) |
| `[data-callout-resolved="<type>"]` | the **canonical** type (e.g. `abstract`) |
| `[data-callout-fold]` | present on foldable callouts (`+` open / `-` closed) |

### The `--callout-color` variable (read this carefully)

Each callout type sets `--callout-color` as an **RGB triple** — three numbers,
**not** a hex or named color. It is consumed as `rgb(var(--callout-color))` and
`rgba(var(--callout-color), <alpha>)`, which is how one value drives the text,
icon, border, and tinted background together.

```css
/* ✅ correct — a triple */
.callout[data-callout-resolved="tip"] { --callout-color: 120, 82, 238; }

/* ❌ wrong — breaks every rgb()/rgba() that reads it */
.callout[data-callout-resolved="tip"] { --callout-color: #7852ee; }
```

Recolor by resolved type, or override one raw alias, or restyle the container
directly:

```css
/* retint the whole "tip" family */
.callout[data-callout-resolved="tip"] { --callout-color: 16, 185, 129; }

/* only when someone typed [!important] specifically */
.callout[data-callout="important"] { --callout-color: 244, 63, 94; }

/* change the shape without touching the color system */
.callout { border-radius: 14px; border-left-width: 4px; }
```

### Built-in callout types and their colors

Aliases resolve to one of these canonical types (shown in
`data-callout-resolved`); target the resolved type to catch all aliases.

| Resolved type | Default `--callout-color` | Aliases you can type |
|---|---|---|
| `note` | `83, 112, 255` | *(default)* |
| `abstract` | `86, 148, 159` | `summary`, `tldr` |
| `info` | `8, 109, 221` | — |
| `todo` | `8, 109, 221` | — |
| `tip` | `0, 191, 188` | `hint`, `important` |
| `success` | `8, 185, 78` | `check`, `done` |
| `question` | `236, 117, 0` | `help`, `faq` |
| `warning` | `236, 117, 0` | `caution`, `attention` |
| `failure` | `233, 49, 71` | `fail`, `missing` |
| `danger` | `233, 49, 71` | `error` |
| `bug` | `233, 49, 71` | — |
| `example` | `120, 82, 238` | — |
| `quote` | `158, 158, 158` | `cite` |

### Changing the icon with `--callout-icon`

Set `--callout-icon` to a [Lucide](https://lucide.dev/icons) icon ID prefixed
with `lucide-`, exactly like Obsidian. Vault reads the variable and swaps the
icon in:

```css
.callout[data-callout-resolved="tip"] { --callout-icon: lucide-rocket; }
```

- The value is a Lucide icon ID from [lucide.dev/icons](https://lucide.dev/icons)
  with a `lucide-` prefix (e.g. `lucide-shield`, `lucide-target`,
  `lucide-code`). Unknown names are ignored and the built-in icon stays.
- Unlike Obsidian, a raw `<svg>…</svg>` value is **not** supported — the
  compiler strips any value containing `<` or `>`. Use a Lucide ID.
- The icon inherits `--callout-color`, so recolor with the color variable.

You can still style the icon element directly:

```css
.callout-icon svg { width: 1.25rem; height: 1.25rem; }  /* resize */
.callout-icon { color: rgb(158, 158, 158); }             /* recolor just the icon */
.callout[data-callout-resolved="note"] .callout-icon { display: none; } /* hide it */
```

### Custom callout types

Any `[!type]` you invent works — it renders with the `note` fallback styling and
gets a `data-callout="<your-type>"` hook you can target. Combine a color and an
icon to define a brand-new callout. For a game design doc:

````md
> [!defence] Defence
> Reduces incoming damage by the shown percentage.
````

```css
.callout[data-callout="defence"] {
  --callout-color: 59, 130, 246;   /* RGB triple */
  --callout-icon: lucide-shield;   /* any lucide.dev icon */
}
```

---

## Variables

### Your own `--snip-*` variables

Define and reuse your own variables freely:

```css
.vault-md-h2 {
  --snip-accent: oklch(0.7 0.15 250);
  color: var(--snip-accent);
  border-bottom: 2px solid var(--snip-accent);
}
```

### Theme tokens (readable, but names not guaranteed)

You may *read* the app's theme tokens so your styling adapts to light/dark mode.
These are convenient but **not part of the stable contract** — names can change:

| Token | Meaning |
|---|---|
| `var(--foreground)` / `var(--background)` | body text / page background |
| `var(--muted-foreground)` | secondary text |
| `var(--card)` / `var(--card-foreground)` | surface / text on surface |
| `var(--border)` | hairline border color |
| `var(--primary)` / `var(--accent)` | brand / accent |
| `var(--font-sans)` / `var(--font-mono)` | UI / mono font stacks |
| `var(--radius)` | base corner radius |

Using them keeps a snippet theme-aware:

```css
.vault-md-blockquote {
  border-left: 3px solid var(--border);
  color: var(--muted-foreground);
}
```

---

## Author hook classes (`snip-*`)

Need a target that isn't a standard element? Add your own class in raw HTML —
but **only** the `snip-` prefix survives sanitizing (every other author-supplied
class is stripped):

````md
<div class="snip-hero">

# A styled hero

</div>
````

```css
.snip-hero {
  padding: 2rem;
  border-radius: var(--radius);
  background: linear-gradient(120deg, #1e293b, #0f172a);
}
```

---

## What CSS is allowed

Snippets are declarative CSS only. The compiler keeps what's safe and drops the
rest, telling you which rule and why.

### At-rules

| Allowed | Dropped |
|---|---|
| `@media`, `@supports`, `@container`, `@layer`, `@keyframes` | `@import`, `@font-face`, and any other at-rule |

### Properties (by category — most common CSS works)

- **Typography:** `color`, `font*`, `line-height`, `letter-spacing`,
  `text-*`, `white-space`, `word-break`, `list-style*`, `content`, `quotes`,
  counters, `-webkit-line-clamp`, `-webkit-background-clip`, …
- **Color & background:** `background*` (including gradients), `opacity`,
  `mix-blend-mode`, `accent-color`, `caret-color`, `color-scheme`.
- **Box model:** `margin*`, `padding*`, `border*`, `border-radius`, `outline*`,
  `box-shadow`, `box-sizing`, `width`/`height` (+ min/max, logical sizes),
  `aspect-ratio`, `gap`.
- **Layout:** `display`, `position` (see limit below), `top/right/bottom/left`,
  `inset*`, `float`, `clear`, `z-index`, `overflow*`, `visibility`,
  `object-fit`, full **flexbox** and **grid**, multi-column.
- **Effects & motion:** `transform*`, `perspective`, `transition*`,
  `animation*`, `filter`, `backdrop-filter`, `clip-path`, `mix-blend-mode`.
- **Interaction:** `cursor`, `pointer-events`, `user-select`, `scroll-behavior`,
  `resize`, `isolation`.

Any property not on the allowlist (e.g. performance/containment escape hatches)
is dropped silently-with-a-warning.

### What is blocked, and why

| Blocked | Reason |
|---|---|
| `url()`, `image-set()`, `image()`, `cross-fade()`, `element()`, `-webkit-canvas()` | no network / external resource loading |
| `@import`, `@font-face`, web fonts | no network |
| `position: fixed` and `position: sticky` | could escape the document body |
| Selectors `:root`, `html`, `body`, `:host`, `:host-context` | could reach outside the document |
| `expression()`, `-moz-binding`, `behavior:`, `javascript:` | no scripting |
| `<` or `>` anywhere in a value | no markup injection |
| Unknown `animation-name` (one that isn't your own `@keyframes`) | can't hijack app animations |

Gradients are fine (they load nothing). Animations and transitions are allowed
but **automatically paused** for viewers who prefer reduced motion.

---

## Limits

| Limit | Value |
|---|---|
| Max source size per snippet | 50 KB |
| Max compiled size per snippet | 75 KB |
| Max style rules per snippet | 1000 |
| Max selector depth (descendant chain) | 10 |
| Max snippets per user | 50 |
| Max snippets attached per document | 5 |
| Compile/preview rate limit | 30 per minute |

---

## Recipes

**Serif headings with tighter tracking**

```css
.vault-md-h1, .vault-md-h2 {
  font-family: Georgia, "Times New Roman", serif;
  letter-spacing: -0.015em;
}
```

**Softer, rounder callouts with a custom "tip" color**

```css
.callout { border-radius: 14px; }
.callout[data-callout-resolved="tip"] { --callout-color: 16, 185, 129; }
```

**Zebra-striped tables**

```css
.vault-md-table tr:nth-child(even) .vault-md-td {
  background: color-mix(in oklab, var(--foreground) 5%, transparent);
}
```

**A callout-style hero block via a hook class**

```css
.snip-hero {
  padding: 2rem;
  border-radius: var(--radius);
  color: var(--card-foreground);
  background: linear-gradient(120deg, var(--card), color-mix(in oklab, var(--accent) 40%, var(--card)));
}
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A rule "disappeared" | It used a blocked property/value/at-rule — check the editor's dropped-rule notes. |
| Callout colors look wrong or unstyled | `--callout-color` was set as hex/named instead of an `R, G, B` triple. |
| Custom icon didn't apply | Use a valid `lucide-<id>` from [lucide.dev/icons](https://lucide.dev/icons); raw `<svg>` values are stripped. On public pages the built-in icon shows first, then swaps once the page loads. |
| Nothing changes in the editor while typing | Live mode styles rendered blocks only; switch to **Read** mode for the full result. |
| Styling works for you but not a viewer | The viewer turned off the **Custom styling** pill, or disabled author styling globally. |
| A web font / background image won't load | External resources are blocked. Use system/theme fonts and gradients. |
