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
it, other pages, or the network.

## Creating a snippet

1. Open **Settings → Snippets**.
2. Give the snippet a name and click **Create**.
3. Click **Edit CSS**, write your CSS, and watch the live preview. The preview
   shows exactly what viewers will see — including any rules that were dropped.
4. Click **Save**.

## Attaching a snippet to a document

Open the document you own, then in the right-hand context panel find the
**Styling** card and attach any of your snippets. Detach them the same way. A
document can have up to five snippets; they apply in the order listed.

Viewers see a small **Custom styling** pill and can turn your styling off for
their view. Signed-in users can also disable all author styling globally from
**Settings → Snippets**.

## What you can target

Snippets are automatically scoped to the document body, so you write plain
selectors and Vault confines them for you. Target the stable content classes:

```css
.vault-md-h1 { font-family: Georgia, serif; letter-spacing: -0.01em; }
.vault-md-blockquote { border-left-color: rebeccapurple; }
.callout[data-callout="tip"] { --callout-color: 120, 82, 238; }
```

You can also add your own hook classes in raw HTML using a `snip-` prefix:

```md
<div class="snip-hero">

# A styled hero

</div>
```

```css
.snip-hero { padding: 2rem; background: linear-gradient(120deg, #1e293b, #0f172a); }
```

Theme variables are readable, and you can define your own `--snip-*` variables:

```css
.vault-md-h2 { --snip-accent: oklch(0.7 0.15 250); color: var(--snip-accent); }
```

See the full list of targetable classes in the app's document-content contract.

## What is not allowed

For everyone's safety, the compiler removes anything that could load a resource
or escape the document. If you use one of these, it is dropped (the editor tells
you which rule and why):

- **No network:** `url()`, `image-set()`, `@import`, `@font-face`, web fonts, or
  external images. Gradients are fine (they load nothing).
- **No breaking out:** `position: fixed` / `sticky`, and targeting `:root`,
  `html`, or `body`.
- **No scripting:** `expression()`, behaviors, or anything non-declarative.

Animations and transitions are allowed, but they are automatically paused for
viewers who prefer reduced motion.

## Previewing your styling

As the document owner you edit in **Live** mode, which does not apply snippets
while you type. To see your styling in place, switch the editor to **Read** mode
(the mode switch is above the editor) — Read mode renders the document exactly
as viewers see it, with your attached snippets applied. The public page, share
links, and other viewers' document view also show them.
