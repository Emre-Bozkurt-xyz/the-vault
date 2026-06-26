---
title: Asset library
slug: asset-library
category: Assets
order: 10
public: true
---

# Asset library

Vault assets are uploaded images and PDFs that belong to your account. They are
private by default and are stored outside the document body.

Use the asset library when you want to browse, rename, describe, publish, or
delete uploaded content.

## Opening the library

Open **Assets** from the workspace rail or go to:

```txt
/assets
```

The library shows your uploaded images and PDFs in a browsing grid. Selecting an
asset opens its details and configuration panel.

## What you can edit

Each asset has metadata separate from the original object bytes:

| Field | Purpose |
| --- | --- |
| Display name | The human-friendly name shown in the library, gallery, and autocomplete. |
| Alt text | Fallback text for image embeds and accessibility. |
| Tags | Shared document/asset tags used by library search and the public gallery. |
| Description | Notes about the asset for your library or public gallery entry. |
| Visibility | Private or public. |

See [[guide:asset-metadata-and-search|Asset metadata and search]] for the full
search syntax and tag rules.

## Private and public assets

Assets start private.

A private asset can render for:

- the asset owner
- signed-in users who can read a document linked to that asset

A public asset can render for anyone and appears in the public gallery.

Publishing a document does not publish its embedded assets. This is intentional.
If a public document embeds a private asset, logged-out readers see a private or
unavailable placeholder for that asset until you publish the asset separately.

## Reusing public gallery assets

Global public assets do not appear in editor autocomplete. This keeps private
editing predictable and avoids showing mystery assets while typing.

To reuse a public asset:

1. Open the gallery.
2. Select the public asset card.
3. Copy its embed or asset ID from the details panel.
4. Paste the embed into your document.

## Deleting assets

Deleting an owned asset removes it from normal library and gallery views and
removes the stored object. Documents that still contain its Markdown reference
will render an unavailable placeholder.

## Render examples

A private missing asset reference renders as a small placeholder instead of a
broken raw storage URL:

![[asset:00000000-0000-0000-0000-000000000000|Private diagram]]

A PDF asset renders as a compact file card when the asset can be resolved:

```md
![[asset:<pdf-asset-id>|Design brief.pdf]]
```

The actual rendered card shows the file name, file type, size, and an open
action. It opens Vault's permission-checked asset route in a new tab.
