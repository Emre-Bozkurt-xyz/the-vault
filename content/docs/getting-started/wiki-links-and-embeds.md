---
title: Wiki links and embeds
slug: wiki-links-and-embeds
category: Getting started
order: 20
public: true
---

# Wiki links and embeds

Vault supports Obsidian-style wiki links for connecting documents inside your vault.

Use regular wiki links when you want to link to another document:

```md
[[Meeting notes]]
[[Meeting notes|Custom label]]
```

Use wiki embeds when you want another document to appear inside the current document:

```md
![[Meeting notes]]
```

## Autocomplete

Type `[[` to search your readable documents. The editor shows matching document titles and inserts a stable internal link when you choose one.

Type `![[` to use the same autocomplete for document embeds.

When you select a document from autocomplete, Vault inserts a canonical link target:

```md
[[doc:document-id|Document title]]
![[doc:document-id|Document title]]
```

The `doc:document-id` part keeps the link stable even if the document title changes later. The text after `|` is the displayed label.

## Title links

You can also type a title manually:

```md
[[Project plan]]
[[Project plan|Read the plan]]
![[Project plan]]
```

Title links resolve only when exactly one readable document has that title. If multiple readable documents share the same title, Vault marks the link as ambiguous. Use autocomplete to insert the canonical `doc:...` form when you want the most reliable link.

## Public documents

Public pages only resolve links that are safe to show publicly.

If a published document links to another public document, the link points to that document's public page.

If a published document links to a private or inaccessible document, Vault does not expose the private document ID or private app route. The link renders as non-clickable text instead.

This means you can keep private planning notes linked inside your own documents without accidentally leaking them on a public page.

## Document embeds

A document embed uses an exclamation mark before the wiki link:

```md
![[Release checklist]]
```

In Preview, Live mode, and public rendering, Vault renders the referenced document inline with a subtle left rail.

Embeds follow the same permission rules as normal wiki links:

- Private documents embed only for users who can read them.
- Public pages only embed public documents.
- Unresolved, private, ambiguous, or recursive embeds show a small fallback message instead of leaking hidden content.

## External images

Vault also supports Obsidian-style external image embeds:

```md
![[https://example.com/image.png]]
![[https://example.com/image.png|Image description]]
```

The first value is the image URL. The optional value after `|` becomes the image alt text.

Only external `http` and `https` image URLs are supported right now. Vault does not yet store uploaded image files itself.

## Best practices

Use autocomplete for important document links. It inserts stable `doc:...` links and avoids title ambiguity.

Use title links for quick drafts when you know the target title is unique.

Before publishing a document, preview any links or embeds that point to private notes. Public rendering will hide private destinations, but readers will only get clickable links for documents that are public too.

Use document embeds for short reference notes, reusable explanations, checklists, or public documentation snippets. Avoid embedding very large documents inside many other documents until Vault has more advanced embed performance controls.
