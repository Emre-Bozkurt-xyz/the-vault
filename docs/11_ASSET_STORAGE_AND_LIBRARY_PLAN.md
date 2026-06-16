# Vault Asset Storage and Library Plan

## 1. Goal

Add first-class user-uploaded content to Vault without weakening the private
document model.

The first complete product slice is:

```txt
An authenticated user can upload or paste an image into a Markdown document.
Vault stores the file bytes in private R2 object storage.
Vault stores ownership, quota, metadata, and document links in Postgres.
The editor inserts a stable asset embed, not a raw storage URL.
Readers only see the asset when the server confirms they are allowed to read it.
The user can browse their own uploaded assets in a masonry-style asset library.
The user can explicitly publish individual assets to the public gallery.
Publishing a document does not automatically publish its embedded assets.
```

This plan supersedes any older idea of direct public R2 URLs for uploaded
document assets.

---

## 2. Non-Negotiable Decisions

### R2 Is Private Byte Storage

Cloudflare R2 is the object store, but it is not the authorization layer.

Rules:

- Keep the R2 bucket private.
- Disable the public `r2.dev` URL.
- Do not connect a public custom domain for private asset reads.
- Do not expose R2 credentials to the browser.
- Do not insert raw R2 URLs into documents.
- Do not depend on object key secrecy as the permission model.

Vault owns reads and writes through server routes. R2 stores bytes only.

### Postgres Is The Source Of Truth

Postgres owns:

- Asset ownership.
- Uploader identity.
- Asset visibility.
- Object keys.
- MIME type and detected file type.
- Original and display filename.
- Byte size.
- Width and height for images.
- Document-to-asset links.
- Quota usage.
- Upload status.
- Soft deletion.
- Public gallery metadata.

R2 owns:

- Original object bytes.
- Later generated thumbnails/previews, if added.

### Assets Are Private By Default

New assets default to `private`.

An asset becomes public only when the asset owner explicitly publishes that
asset from the asset library or asset configuration UI.

Important:

```txt
Publishing a document does not publish its embedded assets.
```

If a public document embeds a private asset, anonymous/public viewers should see
a controlled placeholder rather than the asset bytes. The owner should see a
publish warning before or after publishing the document.

### Markdown Stores Stable Asset References

Documents should embed uploaded assets using Vault references:

```md
![[asset:<asset-id>|optional display label]]
```

Do not store this as the primary representation:

```md
![label](https://...)
```

The renderer resolves `asset:<id>` at read time according to the viewer's
current permissions and the asset's current visibility.

---

## 3. Product Surfaces

### Document Editor

Add two insertion flows:

```txt
toolbar upload -> POST /api/assets -> insert ![[asset:id|filename]]
clipboard paste -> POST /api/assets -> insert ![[asset:id|filename]]
```

The editor must insert the returned Markdown through the active CodeMirror
transaction. In collaborative mode this must go through the Yjs-bound editor
state so collaborators receive the insertion normally.

### Asset Library

Add a signed-in workspace page:

```txt
/assets
```

Purpose:

- Show content owned by the current user.
- Use a masonry-style grid for images.
- Show useful previews for PDFs and later file types.
- Let the user search, filter, inspect, rename, delete, and publish assets.
- Let the user copy an embed reference.
- Let the user see where an asset is used.

Initial asset library views:

```txt
All
Images
PDFs
Public
Private
Recently uploaded
Largest files
Used in documents
Unused
```

The asset library should feel like an editor workspace panel/page, not a
marketing gallery. It should use compact controls, dense masonry content, and a
right-side detail/configuration panel on desktop. On mobile, the detail panel
becomes a drawer.

### Public Gallery

`/gallery` should eventually browse both published documents and explicitly
published assets.

Public asset gallery items are independent of document publishing. A public
document can embed a private asset, and a public asset can exist without any
public document.

Initial gallery behavior after assets:

```txt
/gallery
  content type filter:
    all
    documents
    images
    pdfs

  search:
    title
    filename
    owner display name
    owner username
    description
```

Tags, scoring, ratings, collections, and moderation workflows are later slices.

---

## 4. Access Model

### Asset Visibility

Supported v1 visibility values:

```txt
private
public
```

Later possible values:

```txt
unlisted
restricted
workspace
```

### Read Rules

A user can read an asset if any rule is true:

```txt
asset.visibility = public
OR asset.owner_id = current_user.id
OR asset is linked to a document that current_user can read
```

Anonymous users can read an asset only if:

```txt
asset.visibility = public
```

Public document access alone does not make private embedded assets readable for
anonymous users. If the embedded asset is private, render a placeholder.

### Write And Manage Rules

Asset owner can:

- Rename.
- Edit description/alt text.
- Publish/unpublish the asset.
- Delete the asset.
- View usage.

Document editors can:

- Upload an asset into a document if they can edit that document.
- Link their own existing assets into that document.
- Remove an asset embed from document Markdown.

Document owners can:

- Remove a document-to-asset association for their document.
- Remove asset embed text from their document.

Document owners should not automatically gain delete rights over assets owned by
another user. This avoids one collaborator destroying another user's library
content. Later, add clearer document-owned asset transfer rules if needed.

### Upload Ownership And Quota

V1 rule:

```txt
The uploader owns the asset and pays quota.
```

Rationale:

- The asset library is "content that belongs to that user."
- The uploader controls public/private status.
- Quota accounting is simple and user-centered.

When an editor uploads into someone else's document, document readers can read
that asset through the document link while the association remains. If that
collaborator is removed from the document later, the asset can still render for
remaining document readers because the document has an explicit asset
association. The document owner can remove the association from the document,
but cannot delete the uploader's underlying asset from the uploader's library.

This is more predictable than silently transferring uploaded files to the
document owner.

---

## 5. Storage Architecture

### Request Flow: Upload Into Document

```txt
Browser
  -> POST /api/assets with multipart form data
     - file
     - optional documentId
     - optional shareLinkId
  -> route authenticates active user
  -> route checks document edit permission when documentId is present
  -> route validates file size and file type
  -> route creates pending asset metadata in Postgres
  -> route reserves user quota with a race-safe SQL update
  -> route writes object bytes to private R2
  -> route marks asset ready
  -> route links asset to document when documentId is present
  -> route returns asset id, serving URL, and Markdown embed
  -> editor inserts ![[asset:id|filename]]
```

### Request Flow: Read Asset

```txt
Browser requests /api/assets/:assetId/content?doc=:documentId
  |
Next.js route authenticates if a session exists
  |
Route checks:
  - public asset, OR
  - asset owner, OR
  - readable linked document
  |
If allowed:
  stream object from R2
Else:
  404 for private inaccessible assets
```

Use `404` for inaccessible private assets to avoid confirming the asset exists.

### Why Include documentId On Private Reads

Private asset reads should usually include the document context:

```txt
/api/assets/:assetId/content?doc=:documentId
```

This lets the server prove that the asset is being read through a specific
document the viewer can read, without scanning every document the asset might
be linked to.

Owner library reads can omit `doc`.

Public asset reads can omit `doc`.

### Serving Through Vault

Because R2 stays private, asset bytes flow through the Vault app in v1.

Tradeoff:

- Pro: strong permission checks, simple mental model, no public bucket.
- Con: image/PDF bandwidth goes through the home server and FRP path.

This is acceptable for the private-first version. If bandwidth becomes a real
problem, add a later Cloudflare Worker or signed edge route that checks Vault
authorization before serving from R2. Do not move to public bucket URLs as a
shortcut for private assets.

---

## 6. Object Key Strategy

Object keys must be opaque and unguessable, but authorization must not depend on
that secrecy.

Use keys like:

```txt
assets/<assetId>/<randomToken>-<safeFilename>
```

Example:

```txt
assets/5a0f0af1-5a7e-4b39-9c33-58b657d4021a/9f4d8e9a...-lecture-diagram.png
```

Rules:

- Do not include user IDs in object keys.
- Do not include document IDs in object keys.
- Do not use sequential names.
- Sanitize filenames.
- Preserve a useful file extension derived from detected type.
- Include a strong random token.
- Keep the object key stable after upload.

Rationale:

- Public gallery URLs and logs should not expose internal user IDs.
- Documents can be renamed, shared, or transferred later without moving object
  bytes.
- Assets can be linked to multiple documents without object duplication.

---

## 7. Environment Variables

Committed examples live in `.env.example`. Real values belong only in local
`.env.local` and server `.env.production`.

Required v1 variables:

```env
ASSET_STORAGE_DRIVER=r2

R2_BUCKET=vault-assets
R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=replace-with-r2-access-key-id
R2_SECRET_ACCESS_KEY=replace-with-r2-secret-access-key

ASSET_ROUTE_BASE_PATH=/api/assets
DEFAULT_USER_STORAGE_QUOTA_BYTES=268435456
MAX_IMAGE_UPLOAD_BYTES=10485760
MAX_PDF_UPLOAD_BYTES=26214400
ASSET_PRIVATE_CACHE_SECONDS=0
ASSET_PUBLIC_CACHE_SECONDS=3600
```

Do not use:

```env
ASSET_PUBLIC_BASE_URL=https://assets.vault.ems-place.com
```

That variable belonged to the raw public-R2 URL approach and should stay out of
the private-by-default model.

Cloudflare setup notes:

- The S3 API endpoint is account-level:
  `https://<cloudflare-account-id>.r2.cloudflarestorage.com`.
- Do not append `/vault-assets` to `R2_ENDPOINT`.
- Keep the bucket private.
- Disable public `r2.dev` access.
- Do not configure a public custom domain for this bucket in v1.

---

## 8. Database Model

### users additions

```txt
users
  storage_used_bytes BIGINT NOT NULL DEFAULT 0
  storage_quota_bytes BIGINT NOT NULL DEFAULT 268435456
```

Use `BIGINT`, not a 32-bit integer, for storage counters.

Quota reservation must be race-safe:

```sql
update users
set storage_used_bytes = storage_used_bytes + $fileSize
where id = $userId
  and storage_used_bytes + $fileSize <= storage_quota_bytes
returning storage_used_bytes, storage_quota_bytes;
```

If no row returns, reject the upload with `409 quota_exceeded`.

### assets

```txt
assets
  id UUID PRIMARY KEY

  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL

  storage_driver TEXT NOT NULL DEFAULT 'r2'
  storage_bucket TEXT NOT NULL
  storage_key TEXT NOT NULL UNIQUE

  original_filename TEXT NOT NULL
  display_name TEXT NOT NULL
  description TEXT
  alt_text TEXT

  mime_type TEXT NOT NULL
  detected_mime_type TEXT NOT NULL
  file_extension TEXT NOT NULL
  size_bytes BIGINT NOT NULL
  width INTEGER
  height INTEGER

  kind TEXT NOT NULL
  visibility TEXT NOT NULL DEFAULT 'private'
  status TEXT NOT NULL DEFAULT 'pending'

  checksum_sha256 TEXT

  created_at TIMESTAMP NOT NULL DEFAULT now()
  updated_at TIMESTAMP NOT NULL DEFAULT now()
  published_at TIMESTAMP
  deleted_at TIMESTAMP
```

Allowed `kind` values for v1:

```txt
image
pdf
```

Later:

```txt
file
audio
video
archive
```

Allowed `status` values:

```txt
pending
ready
failed
deleted
```

Allowed `visibility` values:

```txt
private
public
```

### document_assets

```txt
document_assets
  id UUID PRIMARY KEY
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE
  linked_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at TIMESTAMP NOT NULL DEFAULT now()

  UNIQUE(document_id, asset_id)
```

This table means:

- The asset is intentionally associated with the document.
- Users who can read the document can read the associated asset through that
  document context.
- Removing the embed from Markdown should eventually remove or mark stale the
  association.

### Optional later: asset_usages

For exact per-embed tracking, add:

```txt
asset_usages
  id UUID PRIMARY KEY
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
  embed_count INTEGER NOT NULL DEFAULT 1
  last_seen_at TIMESTAMP NOT NULL DEFAULT now()
```

Do not start here unless the simple `document_assets` join proves insufficient.

---

## 9. File Validation

Start strict.

Allowed v1 types:

```txt
image/png
image/jpeg
image/webp
image/gif
application/pdf
```

Blocked v1 types:

```txt
image/svg+xml
text/html
text/javascript
application/javascript
application/zip
application/x-msdownload
video/*
unknown binary
```

Rules:

- Validate declared MIME type.
- Validate magic bytes with `file-type`.
- Reject if declared and detected type conflict in a risky way.
- Enforce `MAX_IMAGE_UPLOAD_BYTES` for images.
- Enforce `MAX_PDF_UPLOAD_BYTES` for PDFs.
- Sanitize filenames.
- Derive extension from detected type, not only original filename.
- Do not trust client-provided dimensions.

SVG is intentionally blocked. It can contain script, external references, and
other browser-sensitive behavior. Revisit SVG only with a separate sanitizer and
security review.

---

## 10. API Routes

Use route handlers for upload/serve APIs, not server actions.

Route handlers should return JSON status codes instead of redirects. Do not use
`requireActiveUser()` directly inside JSON APIs unless it is wrapped to return
`401` instead of redirecting.

### POST /api/assets

Upload one asset.

Request:

```txt
multipart/form-data
  file: File
  documentId?: UUID
  shareLinkId?: UUID
```

Response:

```json
{
  "assetId": "uuid",
  "kind": "image",
  "url": "/api/assets/uuid/content?doc=documentId",
  "markdown": "![[asset:uuid|diagram.png]]"
}
```

Statuses:

```txt
201 uploaded
400 malformed request
401 unauthenticated
403 no edit access
409 quota exceeded
413 file too large
415 unsupported file type
500 upload failed
```

### GET /api/assets

List assets owned by the current user for the asset library.

Query examples:

```txt
?kind=image
?visibility=public
?q=diagram
?sort=recent
```

### GET /api/assets/:assetId

Return metadata the current viewer is allowed to see.

Private metadata requires owner access or readable document context.

### GET /api/assets/:assetId/content

Stream the object from R2 after a permission check.

Required logic:

- Support `GET`.
- Support `HEAD`.
- Support `Range` before PDF preview work is considered done.
- Set `Content-Type` from trusted metadata.
- Set `Content-Length` when available.
- Set `Content-Disposition` to `inline` for images/PDFs.
- Set `X-Content-Type-Options: nosniff`.
- Private assets: `Cache-Control: private, no-store` initially.
- Public assets: `Cache-Control: public, max-age=<ASSET_PUBLIC_CACHE_SECONDS>`.

### PATCH /api/assets/:assetId

Update owner-controlled metadata:

```txt
display_name
description
alt_text
visibility
```

Publishing is just changing asset visibility to `public` and setting
`published_at` if it was empty.

Unpublishing changes visibility back to `private`. It does not remove the object
or document embeds.

### DELETE /api/assets/:assetId

Soft delete first.

Behavior:

- Owner only.
- Mark `deleted_at`.
- Mark status `deleted`.
- Remove from gallery.
- Hide from normal library views unless "deleted" view exists later.
- Decrement quota only after object deletion succeeds, or use a repair script
  to reconcile if deletion is async.

Hard deletion and retention policy can be a later cleanup job.

---

## 11. Server Helpers

### lib/storage/r2.ts

This file should own R2/S3 SDK details.

Rules:

- Add `import "server-only";`.
- Do not construct the S3 client in browser-reachable code.
- Prefer lazy environment validation so unrelated imports do not fail builds.
- Expose simple helpers:

```ts
putAssetObject(...)
getAssetObject(...)
headAssetObject(...)
deleteAssetObject(...)
```

Do not expose the raw S3 client outside the storage layer unless a specific
call site truly needs it.

### lib/storage/index.ts

Introduce a small storage-driver interface before the code spreads:

```ts
type AssetStorageDriver = {
  putObject(input): Promise<void>;
  getObject(input): Promise<ReadableStream | NodeJS.ReadableStream>;
  headObject(input): Promise<AssetObjectHead>;
  deleteObject(input): Promise<void>;
};
```

R2 is the first implementation. S3 can be added later behind the same interface.

### server/assets.ts

Recommended domain module for asset logic:

```txt
server/assets.ts
  - createPendingAsset
  - reserveUserStorageQuota
  - releaseUserStorageQuota
  - markAssetReady
  - markAssetFailed
  - linkAssetToDocument
  - getAssetReadAccess
  - listUserAssets
  - updateAssetMetadata
  - publishAsset
  - unpublishAsset
  - softDeleteAsset
```

Keep business logic out of UI components and thin route handlers.

---

## 12. Markdown Rendering

### Asset Embed Syntax

Use:

```md
![[asset:<asset-id>|Alt text or title]]
```

V1 also supports a controlled attribute block immediately after the embed:

```md
![[asset:<asset-id>|Diagram]]{layout=block align=center width=large caption="Figure 1" alt="Diagram alt text"}
![[asset:<asset-id>|Side image]]{layout=wrap align=right width=320}
![[asset:<asset-id>|Inline icon]]{layout=inline width=small}
```

Supported attributes:

- `layout=block|wrap|inline`
- `align=left|center|right`
- `width=small|medium|large|full|<pixels>|<percent>`
- `caption="Text shown under the image"`
- `alt="Image alt text"`

Do not allow arbitrary CSS in asset embeds. Unknown attributes are ignored, and
custom width values are sanitized to pixels or percentages before rendering.

V1 also supports image groups for side-by-side assets:

```md
:::assets {layout=grid align=center width=full gap=medium columns=2 caption="Comparison"}
![[asset:<asset-id>|Left image]]
![[asset:<asset-id>|Right image]]
:::
```

Supported group attributes:

- `layout=grid`
- `align=left|center|right`
- `width=medium|large|full`
- `gap=small|medium|large`
- `columns=auto|2|3|4`
- `caption="Shared group caption"`

The first pass is intentionally grid-only. Fixed column counts collapse to one
column on mobile. Child embeds may still define their own `caption` and `alt`
attributes. Unknown group attributes are ignored.

Resolution should work similarly to document wiki embeds:

- Parse asset targets in Markdown.
- Resolve readable/public assets server-side.
- Pass a resolution map into `MarkdownDocument`.
- Render unresolved/private/missing assets as stable placeholders.

### Read/Preview Rendering

Images:

```txt
Render responsive image frame.
Use /api/assets/:id/content?doc=:docId as src when document context exists.
Use alt_text or embed label for alt.
```

PDFs:

```txt
Initial: render a file preview card with filename, size, and open/download link.
Later: add inline PDF preview once Range support and layout are verified.
```

Private placeholder:

```txt
This asset is private.
```

Do not reveal owner email, raw object key, or private document IDs in placeholder
text.

### Live Mode Rendering

Keep v1 simple:

- Upload inserts asset embed text.
- Read mode renders fully.
- Live mode can initially show a compact asset widget when inactive.
- If live widget complexity risks editor stability, defer live widgets and show
  source text until the read/preview route works.

Collaboration correctness is more important than visual live widgets.

---

## 13. Editor Upload UX

### Toolbar Upload

Add an image/file button to `MarkdownToolbar`.

Flow:

1. User clicks upload.
2. Hidden file input opens.
3. Client sends `POST /api/assets`.
4. Button shows upload progress/loading state.
5. On success, insert returned Markdown at current selection.
6. On failure, show an inline/toast error.

### Clipboard Paste

Add a paste handler to the CodeMirror editor DOM.

Rules:

- If clipboard contains image file(s), upload the first supported image in v1.
- Do not block normal text paste.
- Do not upload HTML fragments.
- Insert the returned asset embed through `view.dispatch`.
- In collaborative mode, rely on the Yjs CodeMirror binding to sync the change.

### Upload Placeholder

V1 can avoid complex placeholders:

```txt
upload first -> insert on success
```

Later:

```txt
insert temporary local placeholder -> replace after upload completes
```

Start with the simpler path to avoid collaboration edge cases.

---

## 14. Asset Library UX

### Route

Add:

```txt
app/(workspace)/assets/page.tsx
```

The page registers a workspace tab:

```txt
type: "assets"
title: "Assets"
href: "/assets"
```

Update workspace tab types and icon rail to include assets.

### Layout

Desktop:

```txt
workspace shell
  left panel: normal workspace navigation
  main: masonry asset grid
  right panel: selected asset details/configuration
```

Mobile:

```txt
main: responsive 2-column or 1-column grid
asset details: drawer
filters: compact sheet
```

### Masonry Grid

Use CSS columns or a masonry-like responsive grid first. Do not add a heavy
layout dependency unless the simple approach fails.

Card content:

- Image preview or file/PDF preview.
- Display name.
- Visibility badge.
- File type badge.
- Size.
- Used-in count.
- Uploaded date.

Card actions:

- Open details.
- Copy embed.
- Insert into current document later.
- Publish/unpublish.
- Delete.

### Details Panel

Editable fields:

- Display name.
- Description.
- Alt text.
- Visibility.

Read-only fields:

- MIME type.
- Size.
- Dimensions.
- Created date.
- Storage status.
- Used-in documents.

Visibility toggle must be explicit and labeled. Publishing an asset makes it
available in the public gallery.

### Empty States

Good empty states:

```txt
No assets yet.
Paste an image into a document or upload one here.
```

Do not make the asset page a landing page. It is a working library surface.

---

## 15. Public Gallery Integration

The gallery should eventually become a mixed public content browser.

Content types:

```txt
document
image
pdf
```

Public asset query:

```txt
assets.visibility = public
assets.status = ready
assets.deleted_at IS NULL
```

Public document query remains:

```txt
documents.visibility = public
documents.deleted_at IS NULL
```

Important:

- A public document does not make private assets public.
- A public asset appears in the gallery even if no document is public.
- Gallery cards should not expose private document usage.
- Owner display can show nickname/username/avatar, not email.

Later, when tags exist, assets and documents should use the same content tag
system rather than separate tag tables.

---

## 16. Deployment Notes

Production needs these server-only values in `.env.production`:

```env
ASSET_STORAGE_DRIVER=r2
R2_BUCKET=vault-assets
R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<production-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<production-r2-secret-access-key>
DEFAULT_USER_STORAGE_QUOTA_BYTES=268435456
MAX_IMAGE_UPLOAD_BYTES=10485760
MAX_PDF_UPLOAD_BYTES=26214400
ASSET_PRIVATE_CACHE_SECONDS=0
ASSET_PUBLIC_CACHE_SECONDS=3600
```

Production R2 checklist:

```txt
[ ] Bucket exists.
[ ] Bucket public r2.dev URL is disabled.
[ ] No public custom domain is connected for v1 private serving.
[ ] API token is scoped to the vault-assets bucket only.
[ ] API token can read/write/delete objects.
[ ] Production env has endpoint without bucket suffix.
[ ] Upload route works from production web container.
[ ] Private asset route returns 404 to unauthorized users.
[ ] Public asset route works only after explicit asset publish.
```

Backups:

- Postgres backups capture metadata, permissions, and quota.
- R2 bytes are not captured by Postgres backups.
- Add a future R2 inventory/backup/export script before relying on Vault as the
  only copy of important files.

---

## 17. Security Checklist

Every implementation slice must preserve:

```txt
[ ] No R2 credentials in client bundles.
[ ] No raw R2 object keys exposed in normal UI.
[ ] No raw R2 public URLs inserted into Markdown.
[ ] Upload route requires active signed-in user.
[ ] Upload into a document requires edit permission.
[ ] Read route checks owner/public/document access.
[ ] Private inaccessible assets return 404.
[ ] File type validation uses magic bytes.
[ ] SVG is blocked.
[ ] HTML/JS executable content is blocked.
[ ] Quota update is race-safe.
[ ] Failed uploads release reserved quota.
[ ] Deleted assets disappear from gallery and normal library views.
[ ] Public gallery only lists assets explicitly marked public.
[ ] Publishing a document does not publish assets.
```

---

## 18. Implementation Phases

### Phase 0 - Planning And Env

Status: complete.

Tasks:

- Record private-by-default asset architecture.
- Remove public asset URL assumptions from `.env.example`.
- Point existing docs to this plan.
- Keep R2/S3 endpoint placeholders generic.

Exit criteria:

```txt
Future agents have one source of truth for asset storage and gallery behavior.
```

Implementation status as of 2026-06-15:

- Phase 1 is implemented with migration `0011_tiresome_ultimates.sql`.
- Phase 2 is implemented for the R2 helper functions in `lib/storage/r2.ts`;
  a broader storage-driver interface can still be added when S3 is introduced.
- Phase 3 is implemented for toolbar/API uploads.
- Phase 4 is implemented for metadata reads, `GET`/`HEAD` content streaming,
  Range requests, and safe headers.
- Phase 5 is implemented for images, file links, unresolved placeholders, and
  conservative public rendering. Controlled image embed attributes are
  implemented for Read and Live modes. First-pass `:::assets` image groups are
  implemented for Read mode and inactive Live mode. Live uses the specialized
  CodeMirror block layer, not view-plugin replacement decorations, so cursoring
  into a group reveals the literal Markdown source without the previous
  multi-line decoration crash path; richer PDF cards remain future work.
- Phase 6 is implemented for toolbar upload, clipboard paste, and drag/drop;
  collaborative smoke testing remains manual.
- Phase 7 is implemented for `/assets` owned asset grid, search/filter/sort,
  details panel, metadata editing, delete, copy embed, and public/private toggle.
- Phase 8 is implemented for owner public/private toggling, and `/gallery`
  includes explicitly public assets.
- Asset autocomplete is implemented for `![[asset:...]]` in the editor, scoped
  to assets owned by the current user and assets already linked to the current
  document. It deliberately excludes the global public gallery. Selecting an
  existing private asset links it to the current document before inserting the
  Markdown reference.
- Public gallery asset cards now open a detail panel with metadata, open-link,
  copy-embed, and copy-id actions. Public asset reuse is therefore explicit
  from the gallery instead of mixed into private editor autocomplete.
- Phase 10 is implemented with `assets:audit`, `assets:repair-quota`,
  `assets:delete-orphans`, and `assets:export`.

### Phase 1 - Schema And Migrations

Tasks:

- Add user quota fields.
- Add `assets`.
- Add `document_assets`.
- Generate Drizzle migration.
- Update `docs/03_DATA_MODEL.md`.
- Update `docs/project-knowledge.md`.

Exit criteria:

```txt
npm run db:generate
npm run db:migrate
Schema supports private assets, ownership, quota, and document links.
```

### Phase 2 - Storage Driver

Tasks:

- Harden `lib/storage/r2.ts`.
- Add `server-only`.
- Use lazy env validation.
- Add `headAssetObject`.
- Add storage-driver interface if useful before route work spreads.
- Ensure no browser import path can reach AWS SDK code.

Exit criteria:

```txt
R2 helper can put/head/get/delete objects from server code only.
Build does not fail when asset routes are not used.
```

### Phase 3 - Upload API

Tasks:

- Add `POST /api/assets`.
- Parse multipart form data.
- Validate active user.
- Check document edit permission when `documentId` is present.
- Validate type and size.
- Reserve quota.
- Create pending asset.
- Upload to R2.
- Mark ready.
- Link to document.
- Return asset embed Markdown.

Exit criteria:

```txt
Authenticated user can upload an image into a document through the API.
Quota is enforced.
Metadata and object bytes both exist.
```

### Phase 4 - Private Serve API

Tasks:

- Add metadata route.
- Add content streaming route.
- Implement owner/public/document access checks.
- Add `HEAD`.
- Add `Range` support for PDFs.
- Set safe content headers.

Exit criteria:

```txt
Private assets render only for owners or readable linked document viewers.
Unauthorized private reads return 404.
```

### Phase 5 - Markdown Asset Rendering

Tasks:

- Parse `![[asset:id|label]]`.
- Build server-side asset resolution maps for document pages.
- Render images through `/api/assets/:id/content?doc=:docId`.
- Render PDFs as file preview cards.
- Render private/unresolved placeholders.
- Keep public document rendering conservative.

Exit criteria:

```txt
Read mode and public/viewer pages handle asset embeds without raw storage URLs.
```

### Phase 6 - Editor Upload And Paste

Tasks:

- Add toolbar upload button.
- Add hidden file input.
- Add paste handler for image files.
- Insert returned Markdown via CodeMirror transaction.
- Show useful upload errors.
- Verify collaborative insertion.

Exit criteria:

```txt
User can paste or upload an image into a document and see it render.
Collaborators receive the inserted asset embed.
```

### Phase 7 - Asset Library

Tasks:

- Add `/assets` workspace page.
- Add masonry grid.
- Add filters/search/sorting.
- Add selected asset detail panel.
- Add metadata editing.
- Add copy embed.
- Add soft delete.
- Add library empty states.

Exit criteria:

```txt
User can browse and manage all assets they own.
```

### Phase 8 - Explicit Asset Publishing

Tasks:

- Add publish/unpublish action.
- Add public visibility badge.
- Add gallery eligibility.
- Add warning when publishing documents with private embedded assets.
- Ensure document publish action never mutates asset visibility.

Exit criteria:

```txt
Assets become public only through explicit asset publish controls.
Public docs with private assets show placeholders publicly.
```

### Phase 9 - Gallery Integration

Tasks:

- Add asset cards to `/gallery`.
- Add content type filters.
- Add public asset search.
- Add public asset detail page if needed.
- Keep public gallery metadata email-safe.

Exit criteria:

```txt
Published images/PDFs appear in the gallery alongside public documents.
```

### Phase 10 - Cleanup And Maintenance

Tasks:

- Add unused asset detection.
- Add object deletion/reconciliation script.
- Add quota reconciliation script.
- Add R2 backup/export notes.
- Add admin moderation hooks later if public assets need review.

Exit criteria:

```txt
Storage usage remains auditable and repairable.
```

---

## 19. Manual Test Matrix

### Upload

```txt
[ ] Logged-out upload returns 401.
[ ] Viewer upload into document returns 403.
[ ] Editor upload into document succeeds.
[ ] Owner upload into document succeeds.
[ ] Oversized image returns 413.
[ ] SVG returns 415.
[ ] Renamed HTML file returns 415 by magic-byte detection.
[ ] Quota exceeded returns 409.
[ ] R2 failure releases quota.
```

### Read

```txt
[ ] Owner can read private asset from library.
[ ] Document collaborator can read linked private asset through document route.
[ ] Unrelated signed-in user gets 404 for private asset.
[ ] Logged-out user gets 404 for private asset.
[ ] Public asset can be read logged out.
[ ] Unpublished asset embedded in public doc renders placeholder logged out.
```

### Editor

```txt
[ ] Toolbar upload inserts ![[asset:id|name]].
[ ] Clipboard paste inserts ![[asset:id|name]].
[ ] Collaborative editor receives inserted asset reference.
[ ] Autosave stores the Markdown asset reference.
[ ] Reopening the document renders the asset.
```

### Library And Gallery

```txt
[ ] Asset appears in owner's /assets library.
[ ] Asset metadata can be edited by owner.
[ ] Asset can be published.
[ ] Published asset appears in /gallery.
[ ] Unpublished asset disappears from /gallery.
[ ] Publishing a document does not publish embedded private asset.
```

---

## 20. Open Questions

These should be answered during implementation, not left implicit:

1. Should document owners be allowed to force-unlink collaborator-owned assets
   from their document? Recommended: yes.
2. Should collaborator-owned assets remain readable through a document after the
   collaborator loses access? Recommended: yes while the document association
   remains, because the document owner controls the association.
3. Should assets have standalone public pages? Recommended: add after gallery
   cards exist; start with direct content preview/detail inside gallery.
4. Should PDF inline preview ship in the first asset slice? Recommended: no;
   ship a PDF card first, then add preview once Range support is tested.
5. Should public asset publishing require moderation? Recommended: no for v1,
   but keep status fields flexible enough for future moderation.
