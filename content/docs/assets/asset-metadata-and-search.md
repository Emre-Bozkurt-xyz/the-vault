---
title: Asset metadata and search
slug: asset-metadata-and-search
category: Assets
order: 15
public: true
---

# Asset metadata and search

Vault assets have searchable metadata separate from the stored file bytes.

Open **Assets**, select an asset, and edit its details in the configuration
panel.

## Editable fields

| Field | Notes |
| --- | --- |
| Display name | Required. Used in the library, gallery, copy-embed labels, and search. |
| Alt text | Used for image accessibility and fallback text. |
| Tags | Shared with document tags. Separate tags with spaces. |
| Description | Searchable notes for your library or public gallery entry. |
| Visibility | Private or public. |

Tags use the same normalization rules as document tags:

```txt
course_options diagrams final_project
```

Use underscores for multi-word tags.

## Searching your asset library

The asset library search accepts bare words and the shared search tokens:

```txt
diagram tag:architecture
kind:image
visibility:private
type:pdf final_project
```

Bare words match display name, description, alt text, MIME type, and tags.

The library also has dropdown filters for asset type, visibility, and sorting.
Those dropdowns are local library controls; `sort:score` and `sort:trending`
are for the public gallery.

## Searching public assets

Public assets appear in the gallery alongside public documents.

Useful gallery searches:

```txt
kind:image tag:diagram
type:pdf owner:@username
asset tag:course_options sort:trending
```

Public asset search can match:

- display name
- description
- alt text
- MIME type
- owner name or username
- tags

## Private asset safety

Private asset metadata does not show in public gallery search.

Private assets can render for:

- the asset owner
- users who can read a document linked to the asset

Publishing a document does not publish its embedded assets. If you want a
published document to show an image or PDF to logged-out readers, publish the
asset too.

## Good metadata habits

Use a clear display name before publishing an asset.

Add alt text for images that are important to understanding the document.

Use tags for durable organization:

```txt
project_name topic asset_type
```

Use the description for human-readable notes:

```txt
Architecture sketch for the June deployment notes.
```

That combination keeps the asset searchable without forcing long filenames.
