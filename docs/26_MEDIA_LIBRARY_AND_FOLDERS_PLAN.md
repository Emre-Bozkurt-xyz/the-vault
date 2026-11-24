# Vault — Media Library, Folders, Bin and Share Links

Date: 2026-11-23. Tracker: Phase 28. Builds on
`docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md` (storage, access model, embeds),
which stays authoritative for everything this plan does not change.

**Status: plan agreed 2026-11-23; all seven slices implemented 2026-11-23 — see §12. Not yet exercised against real R2 or deployed.**

## 1. Goal

Turn `/assets` from a flat upload list into a small, Drive-like media library
that is pleasant to browse and hard to break:

- Clean navigation and viewing: a full-screen viewer with keyboard and swipe,
  selection that behaves like a file manager, and several view formats with the
  masonry grid as the default.
- Folders you can go into, e.g. dump a camera card from an event into one.
- Share a folder, or a single item, by link to someone who has never heard of
  Vault, on a stripped-down page with only what they need.
- A Bin: deleting is reversible for 30 days, after which the bytes are really
  removed from R2 and the quota is really freed.
- Everything above safe by construction, and tested.

## 2. Decisions (agreed 2026-11-23)

| Decision | Choice | Why |
|---|---|---|
| Folder model | **Separate media tree** (`asset_folders`), shown only in Media | Document folders carry a permission cascade, default tags, MCP folder tools and their own Bin. Mixing files into that tree changes all of them. A separate tree can be unified later; un-mixing could not |
| Share-link audience | **Anyone with the link**; revocable, optional expiry, download toggle, never listed in the gallery | The event use case is "send the link to people who aren't on Vault". Members-only links can be added later as a column without migrating anything |
| Bin semantics | A new asset **status** `trashed`, not a nullable column | ~25 queries already gate on `status = 'ready'`. A new status makes every existing read path exclude binned items automatically (fail-closed); a `trashed_at` filter would have to be remembered everywhere |
| Bin retention | Fixed **30 days**, deployment-wide (`ASSET_LIMITS.binRetentionDays`) | Bytes cost money. The document Bin's per-user "never" option does not carry over to media |
| Quota while binned | **Counts** until purge, like Drive | The bytes still exist in R2. "Delete forever" and "Empty Bin" free it immediately |
| Asset ⇄ folder | One parent folder (nullable = root) | Drive semantics; no hard links |
| What a link viewer sees | Display renditions (EXIF-stripped), originals only if downloads are allowed | Camera originals carry GPS; renditions are also far cheaper to serve |

## 3. Findings this plan responds to

Measured in the code on 2026-11-23:

1. **Delete was immediate.** `softDeleteAssetForUser` released quota and deleted
   the R2 object at once; only the row lingered 30 days. (Fixed in slice 1.)
2. **No video.** Uploads are sniffed against PNG/JPEG/WebP/GIF/PDF; MP4/MOV are
   rejected unless the uploader holds the any-file grant, and then they are
   plain downloads.
3. **No thumbnails.** The masonry grid loads every original; 200 camera JPEGs
   is gigabytes per page view.
4. **The orphan sweep deletes any object under `users/` that no live row
   references.** Any new object kind (thumbnails, renditions, posters) must be
   taught to `server/asset-maintenance.ts` before it is written, or the nightly
   run will delete it.
5. **Defaults block event dumps.** New users get 50 MiB and images cap at
   10 MiB. Both are admin settings (Admin → Assets); the library should show
   the limits plainly when an upload is refused.
6. **The library loads every asset in one request.** Fine for dozens, not for
   thousands; folders bound this naturally but listing needs a cursor.

## 4. Data model

### 4.1 Asset lifecycle

```txt
pending ──► ready ◄──► trashed ──► deleted ──(30 d)──► row hard-deleted
   │                                  ▲
   └──► failed ──(30 d)──► row hard-deleted
                     (Delete forever, Empty Bin, or 30 days in the Bin)
```

- `ready → trashed`: owner moves it to the Bin. Sets `trashed_at`. Bytes,
  quota, tags, `document_assets` links and stored visibility are kept, so a
  restore puts everything back exactly.
- `trashed → ready`: restore. Clears `trashed_at`. No quota change.
- `trashed → deleted`: Delete forever / Empty Bin / purge. Sets `deleted_at`,
  forces `visibility = private`, removes document links, releases quota,
  deletes the R2 object (best effort; the orphan sweep retries).
- `ready → deleted` directly: **admin moderation only** (`adminDeleteAsset`).
- Every transition is one conditional `UPDATE … WHERE status = <from>
  RETURNING`, so double clicks, two tabs and the purge job racing a restore
  can never double-release quota or resurrect a purged row.
- The pure transition table lives in `lib/asset-lifecycle.ts` and is
  unit-tested; server code asks it rather than hard-coding statuses.

Readers of a `trashed` asset: **the owner only** (so the Bin can show
previews), always with `Cache-Control: private` even if the stored visibility
is public. Everyone else gets the same 404 as a missing asset.

### 4.2 `asset_folders` (slice 3)

As shipped in slice 3 (migration `0034`):

```txt
id uuid pk
owner_id uuid → users (cascade)
parent_id uuid → asset_folders (cascade) null = root
name text (1–120 chars, trimmed, no `/` `\` or control characters)
status text 'active' | 'trashed'
trashed_at timestamptz
trashed_via_folder_id uuid → asset_folders (set null)  -- binned along with
created_at, updated_at
unique (owner_id, coalesce(parent_id, nil), lower(name)) where status = 'active'
```

- `assets.folder_id` and `assets.trashed_via_folder_id`, both `→ asset_folders
  (set null)`.
- **Trashing a folder trashes its subtree eagerly**: every descendant folder and
  asset moves to `trashed` with `trashed_via_folder_id = <top folder>`. Only
  the top folder is listed in the Bin; restoring it restores exactly the rows
  carrying its marker, so items binned individually before stay binned. This
  keeps the fail-closed property: nothing inside a binned folder is `ready`.
- Every tree mutation (create, rename, move, bin, restore, delete) runs in a
  transaction holding a per-user `pg_advisory_xact_lock` and re-checks the
  pure rules in `lib/asset-folders.ts` (`checkFolderMove`: no cycles, depth
  ≤ 32, no sibling name clash) against the tree as it is inside the lock.
  Moves are all or nothing.
- A binned folder keeps its `parent_id`, so restore goes back there if that
  folder is still live, else to the root, taking a "(2)" suffix if its name was
  reused meanwhile. An asset restored on its own, or an upload finishing, into
  a folder that is no longer live lands at the root (`liveFolderOrRoot`), so
  nothing `ready` ever sits inside a binned folder.
- Deleting a folder for good (or its purge) deletes the assets binned with it
  first, then the folder rows; anything binned on its own inside it keeps its
  Bin entry and moves to the root.

### 4.3 `asset_share_links` (slice 6)

As shipped (migration `0037`):

```txt
id uuid pk
owner_id uuid → users (cascade)
folder_id uuid → asset_folders (cascade)  -- exactly one of folder_id / asset_id (check)
asset_id uuid → assets (cascade)
allow_download boolean default true
expires_at timestamptz
revoked_at timestamptz
created_at, updated_at, last_viewed_at
unique (folder_id) where revoked_at is null; unique (asset_id) likewise
```

**Changed from the plan: no token is stored.** The URL token is the row id
plus a truncated HMAC-SHA256 of it under `AUTH_SECRET` (`lib/share-token.ts`,
44 URL-safe characters, canonical spelling enforced). The owner can copy the
same link again at any time, a database dump alone can't forge one, and
rotating `AUTH_SECRET` invalidates every media link. A folder link reaches the
folder's **live** subtree at request time: items added later appear, items
binned or moved out disappear. One live link per target; "New link" revokes
and recreates.

### 4.4 Renditions (slice 2)

As shipped in slice 2 (migration `0033`): `assets.rendition_status`
(`none|ready|failed`) and `assets.rendition_version`; `width`/`height` are now
filled with the displayed (EXIF-oriented) size. `taken_at` (EXIF date, slice 4)
and `duration_ms` (video, slice 5) are still to come. Objects live beside the
original, versioned so a format change regenerates rather than migrates:

```txt
users/<uid>/assets/<assetId>.<ext>                 original
users/<uid>/renditions/<assetId>/v<N>/thumb.webp     ≤640×1920, grids
users/<uid>/renditions/<assetId>/v<N>/display.webp   ≤2048×2048, panel/viewer
users/<uid>/renditions/<assetId>/v<N>/poster.webp    video poster (slice 5)
```

A rendition key is referenced only while its asset is `ready`, `pending` or
`trashed`, owned by the user in the path, and records that exact version as
`ready` (`isReferencedRenditionKey` in `lib/asset-renditions.ts`, tested);
everything else is swept. Deleting an asset for good deletes its renditions.
Renditions do not count toward quota. They are served by the original's
content route with `?r=thumb|display&v=<N>`, behind the same permission check,
and render on first request if the upload-time render has not happened.

## 5. Bin (slice 1)

- **Move to Bin** from the card menu, right-click, details panel, bulk bar and
  `Delete` key. No confirmation (it is reversible); a toast with **Undo**.
- **Bin view** at `/assets?view=bin`, linked from the Media side panel with a
  count. Cards show "Deletes in N days". Actions: Restore, Delete forever;
  header action: Empty Bin (confirmation states how much storage it frees).
- **Purge**: the daily asset maintenance run first permanently deletes items
  binned more than 30 days ago, then does its existing row purge and orphan
  sweep. Admin → Assets → Run now runs the same thing.
- API:
  - `DELETE /api/assets/:id` → move to Bin (was: permanent delete).
  - `DELETE /api/assets/:id?permanent=1` → delete forever; only from the Bin.
  - `POST /api/assets/:id/restore`.
  - `POST /api/assets/bulk {action: trash|restore|delete, assetIds[≤500]}` →
    `{ affected: string[] }`; ids that were not in the expected state are
    silently skipped (idempotent).
  - `DELETE /api/assets/bin` → Empty Bin.
  - `GET /api/assets?view=bin` → binned items with `trashedAt`/`purgeAt`.

## 6. Folders and navigation (slice 3)

- URL is the state: `/assets?folder=<id>`; root has no param. Breadcrumbs
  (`Media / Events / Lisbon 2026`) are links and drop targets.
- Folders render as a compact row of folder tiles above the files, in every
  view format.
- New folder (toolbar, right-click on background, `Shift+N`), rename (F2),
  move (dialog with a folder tree, or drag onto a folder/breadcrumb), Move to
  Bin.
- Uploads go into the folder you are in. Dropping files from the OS anywhere on
  the page uploads them there; dropping a **folder** (e.g. `DCIM/100CANON`)
  recreates it as a subfolder, using `webkitGetAsEntry` with a flat fallback.
- Side panel: "Media" root, a lazily expanded folder tree, Bin, storage meter.
  The existing kind/visibility filters stay as filters, not places.

## 7. Viewing (slice 4)

- **View formats**, remembered per user (`files-assets/defaults.mediaView`):
  1. *Masonry* (default) — today's look, now fed by thumbnails.
  2. *Grid* — uniform square tiles, denser, good for big dumps.
  3. *List* — compact rows: icon, name, type, size, date.
  4. *Details* — larger thumbnail rows with all columns, sortable headers.
- **Selection**: click selects and shows details in the right panel;
  Ctrl/Cmd-click toggles; Shift-click ranges; Ctrl+A; Esc clears; a bulk bar
  (Move, Download, Share, Move to Bin) appears with 2+ selected.
  *Redesigned 2026-11-23:* a click only highlights; Details is a toggle (`I`)
  that follows the selection; actions are one context-aware right-click menu;
  folders sit first inside each view; photo views show names on hover; the
  left panel is places (All files, Shared, Bin) + folders + storage. See the
  2026-11-23 "Redesigned the asset library workspace" changelog entry.
- **Viewer** (as shipped): double-click, Enter, "View" in a menu, or the
  panel preview opens a full-screen viewer at `?open=<id>` (`?view=` was
  already the Bin's), pushed so Back closes it. ←/→/Home/End and swipe step
  through the current folder in its sort order, neighbours preloaded at
  display size; Esc closes, `i` toggles details (taken, dimensions, folder),
  `d` downloads, `z` or double-click zooms to the original with drag-to-pan.
  PDFs and other files show a card with Open/Download. Videos come in slice 5.
- **Date taken**: renders read EXIF `DateTimeOriginal` (`lib/exif-date.ts`)
  into `assets.taken_at` (`RENDITION_VERSION` 2 re-renders existing images to
  fill it); "Date taken" sorts oldest first, falling back to upload time.
- **Large folders** (changed 2026-11-23): instead of a server cursor, the
  page keeps loading the library's metadata in one request and renders
  progressively — 150 items, then more as you scroll. Search and filters stay
  instant and span every folder without a search endpoint. Revisit with
  server pagination if a single library passes ~10,000 files (the metadata
  payload is ~0.5 KB per file).

## 8. Media types (slices 2 and 5)

- Thumbnails/renditions with `sharp` (made a direct dependency): `.rotate()`
  for EXIF orientation, metadata stripped, `limitInputPixels` to refuse
  decompression bombs, one generation queue per process (concurrency 2).
  Generated after upload completes; generated lazily on first request for
  older assets; failures mark `thumb_status = failed` and fall back to an icon
  tile, never to the original.
- Video (as shipped, slice 5): `video/mp4`, `video/x-m4v`, `video/quicktime`
  and `video/webm` are sniffed as a `video` kind with its own admin cap
  (`video_max_upload_bytes`, default 2 GiB; migration `0036`), played inline
  through the Range-capable content route. The uploader's browser captures a
  poster (`lib/video-poster.ts`: blob URL → `<video>` → canvas, ≤1280 px) and
  `POST`s it to `/api/assets/:id/poster` (owner, sniffed WebP/JPEG/PNG ≤ 2 MiB,
  re-encoded through the rendition pipeline) with the duration and size
  (clamped; `assets.duration_ms`). If capture didn't happen (busy machine,
  closed tab), the owner's viewer captures one from the playing video. Video
  renditions are served at the version stored (`servableRenditionVersion`),
  since a version bump can't regenerate a poster server-side. Codecs the
  browser can't decode get a "can't play — download" card. No server ffmpeg.
- `taken_at` from EXIF `DateTimeOriginal` enables "Date taken" sorting, which
  is what an event dump wants.

## 9. Share links and the public page (slice 6)

- Share dialog (folder tile, current folder, or file menu — not the bulk bar):
  create/turn off, copy (automatically on create), allow downloads, expiry
  (never/1/7/30 days), "New link". Settings changes reuse the same `POST`
  (upsert, same URL); there is no separate PATCH. Shared folders and files
  carry a link badge in the library.
- `/s/<token>`: no workspace shell, no sign-in, `noindex`. Header with the
  folder name, item count and owner display name; the masonry grid (or a
  single item); the same viewer; subfolders navigable *inside* the shared
  subtree only (`/s/<token>?f=<id>`); "Download" per item and "Download all"
  (streamed zip) when downloads are allowed.
- Content and rendition requests on that page carry `?s=<token>`;
  authorization: link active and unexpired → target not trashed → asset
  `ready` → asset is the target or inside its subtree. Same 404 for every
  failure. Rate-limited per token and IP.
- Display renditions by default; originals only when downloading is allowed.
- Revoking or expiring a link takes effect on the next request (no long-lived
  public caching for link-served content: renditions `private, max-age=300`,
  originals `private, no-store`). A link also stops while its owner is banned.
- Without downloads, originals 404 except that a video may stream for
  playback (`download=1` still 404s); the viewer hides Download, Open original
  and zoom. "Download all" is a stored (uncompressed) zip streamed with yazl,
  one storage read at a time, ZIP64 when needed, at most 5,000 files, 10 per
  link and IP per hour. Pages are limited to 120 per minute per IP and content
  requests to 1,200 per minute per link and IP (in-process limiter: fine for
  the single app instance, needs a shared store if that changes).

## 10. Invariants (add to project-knowledge §18 as they ship)

1. Nothing that is not `ready` is readable by anyone but its owner, and only
   `trashed` is readable by the owner.
2. Quota counts `ready`, `trashed`, and `pending` with an upload row.
3. Every status transition is a conditional update; quota moves only by rows
   the update returned.
4. Every object key Vault writes under `users/` is recognised by the orphan
   sweep's reference rule before the first one is written.
5. A share link never reaches outside its target's live subtree, and never
   reaches a `trashed` row.
6. Folder trash is eager and marked; restore touches only marked rows.

## 11. Testing

The suite today is pure unit tests (vitest, no database). This plan adds:

- **Pure modules with unit tests** for every rule: lifecycle transitions and
  purge cutoffs (`lib/asset-lifecycle.ts`), orphan/rendition reference rules,
  folder name validation and cycle detection, share-link authorization
  decision, view/sort/cursor helpers, zip naming.
- **Database integration tests** behind `TEST_DATABASE_URL` (skipped when
  unset): trash/restore/delete-forever/purge with quota totals, races between
  restore and purge, folder trash/restore marker behaviour, share-link scope.
- **Browser passes** (as done): every slice was exercised in Chromium against
  a local MinIO bucket, including `/s/<token>` from a cookie-less context.
  These were run by hand through Playwright, not committed as a suite: the
  repo has no e2e harness (auth bootstrap, seeded storage). Adding one is the
  main remaining hardening item.

## 12. Slices

| # | Slice | Status |
|---|---|---|
| 1 | Bin: `trashed` status, API, purge in maintenance, Bin view, Undo | Implemented 2026-11-23 |
| 2 | Thumbnails and display renditions; sweep-aware keys | Implemented 2026-11-23 |
| 3 | Folders: schema, API, breadcrumbs, side-panel tree, move, upload into folder, folder drop | Implemented 2026-11-23 |
| 4 | View formats, selection and bulk bar, full-screen viewer, progressive rendering, date taken | Implemented 2026-11-23 |
| 5 | Video kind, posters, playback | Implemented 2026-11-23 |
| 6 | Share links, `/s/<token>` page, zip download | Implemented 2026-11-23 |
| 7 | Hardening: DB integration tests, rate limits, user guide | Implemented 2026-11-23 (no committed Playwright suite; see §11) |

## 13. Deferred

- Unifying the media and document trees.
- Members-only or password-protected links.
- HEIC/RAW decoding (needs a sharp build with libheif/libraw); stored as files.
- Server-side video transcoding.
- Shared folders with *edit* rights (others uploading into your folder).
