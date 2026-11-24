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

## Folders

Folders organise the library the way a file manager does. They are separate
from the folders in your document file browser.

- **New folder** (the folder-plus button in the toolbar) creates one inside the
  folder you are in. Names must be unique within a folder.
- Click a folder to open it; the path at the top (`Content › Events › Lisbon`)
  takes you back up, and so does your browser's Back button.
- **Upload** puts files in the open folder. **Upload a folder**, or dropping a
  folder from your computer onto the page (a camera card's `DCIM`, say),
  recreates its folders and uploads everything into them.
- Move things with **Move to…** in a file's or folder's `…` menu, or drag a
  file or folder onto another folder or onto a part of the path at the top.
- Searching or filtering looks through every folder, and each result shows
  which folder it is in. **Show in folder** jumps there.
- The **Folders** list in the Assets side panel shows the whole tree.

Moving a folder to the Bin takes everything inside it along, as one Bin entry.
Restoring it brings back exactly what was in it.

## Viewing and selecting

- **Views**: the four buttons next to the sort menu switch between masonry
  (the default), a square grid, a compact list, and a details table whose
  column headers sort. Vault remembers your choice.
- **Sort by Date taken** to see an event in the order the photos were shot
  (from the camera's own clock; files without one use their upload date).
- **Select** like a file manager: click one, Ctrl/⌘-click to add or remove,
  Shift-click for a range, Ctrl/⌘+A for everything here, Esc to clear. The
  round tick on each card also adds it, which is handy on a touchscreen. With
  several selected, a bar at the bottom offers **Move to…** and **Move to
  Bin**; dragging any selected item moves them all.
- **View full screen** with a double-click, Enter, or **View**. Use ←/→ (or
  swipe) to step through the folder, `i` for details, `d` to download, and `z`
  or a double-click to zoom to the original's full size. Esc or Back closes it.

## Deleting assets and the Bin

**Move to Bin** (from an asset's `…` menu, right-click, the details panel, or
the `Delete` key) hides the asset everywhere: the library, the gallery, search,
and every document that embeds it, which shows an unavailable placeholder
instead. A toast offers **Undo** for a few seconds.

Open the Bin from the trash button in the library toolbar or **Bin** in the
Assets side panel. Each item shows how long it has left:

- **Restore** puts it back exactly as it was: same link, visibility, tags and
  document embeds.
- **Delete forever** removes it from storage straight away.
- **Empty Bin** deletes everything in the Bin for good and says how much space
  that frees before you confirm.

Anything left in the Bin is deleted for good **30 days** after you moved it
there. Items in the Bin still count toward your storage until then; deleting
them for good is what frees the space.

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
