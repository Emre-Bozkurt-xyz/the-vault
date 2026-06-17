---
title: Asset embeds and layout
slug: asset-embeds-and-layout
category: Assets
order: 20
public: true
---

# Asset embeds and layout

Asset embeds use stable Vault asset IDs instead of raw R2 URLs.

```md
![[asset:<asset-id>|Image label]]
```

The optional label after `|` is used as fallback text and display text when the
asset cannot be resolved.

## Autocomplete

Type `![[asset:` in the editor to search assets you own and assets already
linked to the current document.

Selecting an autocomplete result inserts a stable embed and links that asset to
the document so collaborators can render it through their document access.

Public gallery assets are not included in autocomplete. Copy those from the
gallery details panel instead.

## Image attributes

Images support controlled layout attributes:

```md
![[asset:<asset-id>|Diagram]]{layout=block align=center width=large caption="System diagram" alt="Diagram showing request flow"}
```

Supported attributes:

| Attribute | Values |
| --- | --- |
| `layout` | `block`, `wrap`, `inline` |
| `align` | `left`, `center`, `right` |
| `width` | `small`, `medium`, `large`, `full`, pixels such as `320`, or percentages such as `45%` |
| `caption` | Short caption shown under block and wrap images |
| `alt` | Image alt text |

Unknown attributes are ignored. Arbitrary CSS is not accepted in asset syntax.

## Block image

Use a block image for normal figures:

```md
![[asset:<asset-id>|Architecture sketch]]{layout=block align=center width=large caption="Figure 1. Architecture sketch"}
```

Rendered shape:

> The image appears as a centered figure in the document flow.
>
> A caption appears under it when `caption` is set.

## Wrapped image

Use wrapping when the image should sit beside text:

```md
![[asset:<asset-id>|Portrait]]{layout=wrap align=right width=30% caption="Profile photo"}

This paragraph flows beside the image when there is enough horizontal space.
On narrow screens, the image returns to the normal document flow.
```

Rendered shape:

> The image floats to the selected side.
>
> Nearby text wraps beside it on desktop and stacks below it on mobile.

## Inline image

Use inline layout for small icons or symbols inside a sentence:

```md
Use ![[asset:<asset-id>|Status icon]]{layout=inline width=small alt="Passed"} beside short labels.
```

Rendered shape:

Use **[small image]** beside short labels.

## Image groups

Use an asset group when multiple assets should act as one centered figure:

```md
:::assets {layout=grid align=center width=full gap=medium columns=2 caption="Before and after"}
![[asset:<left-image-id>|Before]]
![[asset:<right-image-id>|After]]
:::
```

Supported group attributes:

| Attribute | Values |
| --- | --- |
| `layout` | `grid` |
| `align` | `left`, `center`, `right` |
| `width` | `medium`, `large`, `full` |
| `gap` | `small`, `medium`, `large` |
| `columns` | `auto`, `2`, `3`, `4` |
| `caption` | Shared caption under the group |

Rendered shape:

:::assets {layout=grid align=center width=full gap=medium columns=2 caption="Example grouped assets"}
![[asset:00000000-0000-0000-0000-000000000000|Left image]]
![[asset:00000000-0000-0000-0000-000000000001|Right image]]
:::

The example above uses placeholder IDs, so the rendered group shows unavailable
asset placeholders. With real readable image IDs, those placeholders become the
two images in a grid.

## PDF embeds

PDFs use the same embed syntax:

```md
![[asset:<pdf-asset-id>|Lecture notes.pdf]]
```

Rendered shape:

> A compact file card with the PDF label, file size, and an open action.
>
> The file opens through Vault's permission-checked asset route.

## Public documents and private assets

Public documents only resolve public assets for logged-out readers. If you want
an embedded image or PDF to render on a public page, publish that asset from the
asset library too.

The document publish control warns when the document contains private linked
asset embeds.
