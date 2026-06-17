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

Published user documents can also be linked explicitly by public slug:

```md
[[public:course-options|Course Options]]
![[public:course-options|Course Options]]
```

Type `public:` inside a wiki field to search published documents. The suggestion list shows the publisher's username next to the document title so similarly named public documents are easier to tell apart.

Public wiki links use the public route, so they keep working for logged-out readers.
Namespace targets are slug-normalized, so `public:Course Options` and `public:course-options` point to the same public slug when that slug exists.

## Official guides

Official Vault documentation has its own wiki namespace:

```md
[[guide:wiki-links-and-embeds|Wiki links and embeds]]
![[guide:wiki-links-and-embeds|Wiki links and embeds]]
```

Type `guide:` inside a wiki field to search official guide pages. Guide links resolve on public pages and can be embedded just like normal documents.
Guide targets are also slug-normalized, so `guide:Wiki links and embeds` resolves the same way as `guide:wiki-links-and-embeds`.

## Linking to headings

Add `#heading text` at the end of a wiki link to point to a specific heading inside the target document:

```md
[[Project plan#Milestones]]
[[Project plan#Milestones|Milestone notes]]
```

For stable links, use the canonical document form:

```md
[[doc:document-id|Project plan#Milestones]]
[[doc:document-id#milestones|Project plan]]
```

When rendered, the link points to the matching heading on the target document page.

Heading matching uses the same generated heading IDs that Vault adds to rendered Markdown headings. For example:

```md
## Milestones
```

becomes a heading target like:

```txt
#milestones
```

If the same heading text appears more than once, later headings get a numeric suffix:

```txt
#milestones
#milestones-1
#milestones-2
```

## Embedding a heading section

Heading fragments also work with document embeds:

```md
![[Project plan#Milestones]]
![[doc:document-id|Project plan#Milestones]]
```

When an embed points to a heading, Vault embeds only the section owned by that heading. The section starts at the selected heading and continues until the next heading of the same or higher level.

For example, if the target document contains:

```md
# Project plan

Intro text.

## Milestones

Owned by Milestones.

### Detail

Also owned by Milestones.

## Risks

Not owned by Milestones.
```

then this embed:

```md
![[Project plan#Milestones]]
```

renders the `## Milestones` section, its body, and its nested `### Detail` section, but stops before `## Risks`.

## Heading autocomplete

After typing `#` inside a wiki field, Vault can suggest headings from the matching document.

Examples:

```md
[[Project plan#
![[Project plan#
[[doc:document-id|Project plan#
```

Document-title autocomplete still works before the `#`. Heading autocomplete works best after choosing a canonical `doc:...` suggestion or typing enough of the document title for Vault to identify the intended document.

## Block anchors

Vault also supports Obsidian-style block anchors for linking to one specific block of text.

Add a block ID at the end of a paragraph or list item:

```md
This paragraph can be linked directly. ^requirements
```

Or put the block ID on its own line immediately after a block:

```md
This paragraph can be linked directly.
^requirements
```

The `^requirements` marker is hidden in Preview and public rendering, but it becomes a wiki-link target:

```md
[[Project plan#^requirements]]
![[Project plan#^requirements]]
```

Normal links jump to that block. Embeds render only that block.

Block IDs may use letters, numbers, underscores, and hyphens. Vault normalizes IDs to lowercase.

Vault only treats `^block-id` as a block anchor when it is the last thing on the line, or when it sits alone on the line after a block. Text such as `paragraph ^maybe more words` stays normal text.

## Vault regions

Vault regions are hidden named ranges for embedding or jumping to a larger hand-picked section of a document.

Use hidden HTML comments:

```md
<!-- vault-region id="requirements" title="Requirements" -->
## Requirements

This whole section is part of the region.

- Lists work.
- Markdown works.
<!-- /vault-region -->
```

The region comments do not render in Preview or public documents. They only define the target.

Link or embed a region with `#@region-id`:

```md
[[Project plan#@requirements]]
![[Project plan#@requirements]]
```

Normal links jump to the top of the region. Embeds render only the Markdown between the region markers.

Regions can also include future-facing flags:

```md
<!-- vault-region id="requirements" title="Requirements" foldable collapsed -->
...
<!-- /vault-region -->
```

`foldable` renders the region as a collapsible block in Preview, public pages, and embedded documents. Add `collapsed` when the region should start closed.

To insert a region without typing the comments by hand, use the Region toolbar button or press `Ctrl/Cmd + Alt + R`. If text is selected, Vault wraps that text in a foldable collapsed region scaffold. If nothing is selected, Vault inserts a ready-to-edit scaffold and places the cursor on `region-id`.

## Fragment autocomplete

After choosing or typing a document, type `#` to search all known targets inside it:

```md
[[Project plan#
![[doc:document-id|Project plan#
```

Suggestions can include:

- Headings such as `Milestones`
- Block anchors such as `^requirements`
- Regions such as `@requirements`

Autocomplete inserts the stable target ID after `#`.

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

## Uploaded assets

For images and PDFs uploaded to Vault, use asset embeds:

```md
![[asset:<asset-id>|Image label]]
![[asset:<pdf-asset-id>|Lecture notes.pdf]]
```

Type `![[asset:` to autocomplete assets you own and assets already linked to
the current document.

See the asset guides for layout attributes, grouped image grids, and public
asset behavior:

- [[guide:asset-library|Asset library]]
- [[guide:asset-embeds-and-layout|Asset embeds and layout]]

## External images

Vault also supports Obsidian-style external image embeds when you want to
reference a normal public image URL:

```md
![[https://example.com/image.png]]
![[https://example.com/image.png|Image description]]
```

The first value is the image URL. The optional value after `|` becomes the image alt text.

Only external `http` and `https` image URLs are supported for external image
embeds. Uploaded files should use `asset:` embeds instead of raw R2 or storage
URLs.

## Best practices

Use autocomplete for important document links. It inserts stable `doc:...` links and avoids title ambiguity.

Use title links for quick drafts when you know the target title is unique.

Before publishing a document, preview any links or embeds that point to private
notes or private assets. Public rendering hides private destinations, and
readers only get clickable document links or rendered assets when those targets
are public too.

Use document embeds for short reference notes, reusable explanations, checklists, or public documentation snippets. Avoid embedding very large documents inside many other documents until Vault has more advanced embed performance controls.
