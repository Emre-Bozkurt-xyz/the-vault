# Vault — Data Model

This file defines the MVP database model.

Recommended:

```txt
PostgreSQL + Drizzle ORM
```

---

## 1. Core Tables

### users

Auth.js may generate some of this depending on adapter setup.

```txt
users
  id UUID PRIMARY KEY
  name TEXT
  email TEXT UNIQUE
  email_verified TIMESTAMP
  image TEXT
  username TEXT UNIQUE
  role TEXT NOT NULL DEFAULT 'user'
  banned_at TIMESTAMP
  banned_until TIMESTAMP
  ban_reason TEXT
  profile_completed_at TIMESTAMP
  created_at TIMESTAMP
  updated_at TIMESTAMP
```

Notes:

- `email` may be nullable depending on OAuth provider.
- Add `username` for nicer search/share UX.
- `name` is currently used as the free-form non-unique nickname.
- `profile_completed_at` gates first-run onboarding after OAuth/dev login.
- `username` is searchable and user-editable; relational data must keep using `users.id` as the stable key.
- `role` currently supports `user` and `admin`.
- `banned_at`, `banned_until`, and `ban_reason` are moderation fields. A row with `banned_at` and no `banned_until` is a permanent ban.
- Do not expose raw internal user IDs publicly unless needed.

---

### accounts

Used by Auth.js.

```txt
accounts
  user_id UUID REFERENCES users(id)
  type TEXT
  provider TEXT
  provider_account_id TEXT
  refresh_token TEXT
  access_token TEXT
  expires_at INTEGER
  token_type TEXT
  scope TEXT
  id_token TEXT
  session_state TEXT
```

---

### sessions

Used by Auth.js if using database sessions.

```txt
sessions
  session_token TEXT PRIMARY KEY
  user_id UUID REFERENCES users(id)
  expires TIMESTAMP
```

---

### verification_tokens

Used for email login later.

```txt
verification_tokens
  identifier TEXT
  token TEXT
  expires TIMESTAMP
```

---

### user_settings

User-level preferences that apply across the workspace. These settings are for
the app shell, editor defaults, appearance, and other per-user preferences. Do
not use `document_extension_states` for this kind of data.

```txt
user_settings
  id UUID PRIMARY KEY
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  namespace TEXT NOT NULL
  key TEXT NOT NULL
  value JSONB NOT NULL
  created_at TIMESTAMP NOT NULL DEFAULT now()
  updated_at TIMESTAMP NOT NULL DEFAULT now()

  UNIQUE(user_id, namespace, key)
```

Initial namespaces accepted by server helpers:

```txt
appearance
editor
workspace
files-assets
hotkeys
advanced
```

Rules:

- Use `server/user-settings.ts` for all reads and writes.
- Unknown namespaces are rejected server-side.
- Values are object-shaped JSON only.
- LocalStorage can still mirror selected settings for first-paint behavior, but
  signed-in user preferences should persist here.

### user_extension_settings

Per-user enablement and configuration for trusted built-in extensions.

```txt
user_extension_settings
  id UUID PRIMARY KEY
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  extension_id TEXT NOT NULL
  enabled BOOLEAN NOT NULL DEFAULT false
  settings JSONB NOT NULL DEFAULT '{}'
  version INTEGER NOT NULL DEFAULT 1
  created_at TIMESTAMP NOT NULL DEFAULT now()
  updated_at TIMESTAMP NOT NULL DEFAULT now()

  UNIQUE(user_id, extension_id)
```

Rules:

- Use `server/user-settings.ts` for all reads and writes.
- Extension ids are normalized and validated server-side.
- The registry will become the source of allowed extension ids and settings
  schemas as the extension browser work continues.
- Disabling an extension does not delete its document-scoped
  `document_extension_states`.

Implemented schema additions in migration
`0013_majestic_fabian_cortez.sql`.

---

## 2. Documents

### documents

```txt
documents
  id UUID PRIMARY KEY
  owner_id UUID NOT NULL REFERENCES users(id)

  title TEXT NOT NULL
  markdown TEXT NOT NULL DEFAULT ''

  visibility TEXT NOT NULL DEFAULT 'private'
  public_slug TEXT UNIQUE

  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
  deleted_at TIMESTAMP
```

Recommended visibility values:

```txt
private
public
```

Later:

```txt
unlisted
workspace
```

Current primary content format:

```txt
documents.markdown TEXT
```

Markdown is the canonical editor/viewer/public rendering source. The legacy Tiptap/ProseMirror `documents.content` JSONB column was removed by migration `0005_high_captain_midlands.sql` after Markdown editing and collaboration were production-confirmed.

Document titles are intentionally not unique. Document identity stays on
`documents.id`; public URL identity stays on `documents.public_slug`. Wiki links
should use stable document IDs internally when possible, while title-only wiki
links are a convenience layer that may become ambiguous.

---

## 3. Document Permissions

### document_permissions

```txt
document_permissions
  id UUID PRIMARY KEY
  document_id UUID NOT NULL REFERENCES documents(id)
  user_id UUID NOT NULL REFERENCES users(id)
  role TEXT NOT NULL

  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL

  UNIQUE(document_id, user_id)
```

Allowed roles:

```txt
owner
editor
viewer
```

Important:

The owner should exist both as `documents.owner_id` and as a permission row with role `owner`, or you can compute owner from `documents.owner_id`.

My recommendation:

- Keep `owner_id` on documents.
- Also create an owner permission row.

This makes permission queries easier and consistent.

### document_share_links

Document share links grant temporary access through a copyable URL. They are
separate from `document_permissions`: using a link does not create a permanent
collaborator row.

```txt
document_share_links
  id UUID PRIMARY KEY
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
  token_hash TEXT NOT NULL
  scope TEXT NOT NULL DEFAULT 'members'
  role TEXT NOT NULL DEFAULT 'viewer'
  enabled INTEGER NOT NULL DEFAULT 1
  expires_at TIMESTAMP
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
```

Allowed scopes:

```txt
anyone
members
```

Allowed roles:

```txt
viewer
editor
```

V1 keeps one stable share-link row per document. Saving link settings updates
that row's scope, role, and enabled state instead of rotating the URL. Disabling
the link turns access off, and re-enabling it reuses the same URL. `anyone`
links are read-only. `members` links can be viewer or editor; editor links only
grant edit access to signed-in Vault users while the link is enabled. Signed-in
users with an active members-editor link may also join the normal Yjs
collaboration room, but this is still dynamic link access and does not create a
`document_permissions` row.

---

## 4. Document Collaboration State

### document_collab_states

Collaboration needs to persist Yjs CRDT state, not only rendered Markdown text.
If the Hocuspocus room reloads from plain Markdown every time, existing browser
clients can reconnect with older Yjs item identities and Yjs will merge both
copies of the same visible text. That is the root cause class behind repeated
full-document duplication.

```txt
document_collab_states
  document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE
  yjs_state BYTEA NOT NULL
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
```

Rules:

- `documents.markdown` remains the canonical readable/exportable document body.
- `document_collab_states.yjs_state` is the durable CRDT snapshot used only by
  the collaboration service.
- The collab service loads `yjs_state` first. If no state exists yet, it seeds a
  Y.Doc from `documents.markdown` and immediately stores that first state.
- Collab stores update both `documents.markdown` and `document_collab_states`.
- Non-collab full Markdown writes, such as normal autosave without collab or
  restoring a checkpoint, delete the collab state so the next room load reseeds
  from the latest Markdown.

---

## 5. Document Extension State

### document_extension_states

Trusted built-in extensions may need document-scoped state that should not live
inside Markdown. Examples include page stickers, canvas overlays, calendar
metadata, drawing state, and widget configuration.

```txt
document_extension_states
  id UUID PRIMARY KEY
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
  extension_id TEXT NOT NULL
  state_key TEXT NOT NULL DEFAULT 'default'
  state JSONB NOT NULL
  version INTEGER NOT NULL DEFAULT 1
  visibility TEXT NOT NULL DEFAULT 'private'
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
  deleted_at TIMESTAMP

  UNIQUE(document_id, extension_id, state_key)
```

Allowed visibility values:

```txt
private
public
editor-only
```

Rules:

- Use `server/document-extensions.ts` for all reads and writes. Do not query
  extension state directly from route/UI code.
- Editors can create, update, and soft-delete extension state.
- Public extension state can be read by anyone who can read the document.
- Private extension state can be read by explicit document collaborators and
  owners, but not by anonymous/public-only readers.
- Editor-only extension state requires edit access.
- `extension_id` identifies a trusted built-in extension. This table is not an
  arbitrary third-party plugin execution model.
- `state_key` lets one extension store multiple independent records for one
  document, such as `overlay`, `stickers`, or a widget instance id.
- `version` lets extension state schemas migrate independently from the main
  document schema.

---

## 6. Friend System

### friend_requests

```txt
friend_requests
  id UUID PRIMARY KEY
  requester_id UUID NOT NULL REFERENCES users(id)
  recipient_id UUID NOT NULL REFERENCES users(id)
  status TEXT NOT NULL

  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL

  UNIQUE(requester_id, recipient_id)
```

Allowed statuses:

```txt
pending
accepted
rejected
cancelled
```

### friendships

```txt
friendships
  id UUID PRIMARY KEY
  user_low_id UUID NOT NULL REFERENCES users(id)
  user_high_id UUID NOT NULL REFERENCES users(id)

  created_at TIMESTAMP NOT NULL

  UNIQUE(user_low_id, user_high_id)
```

Normalize pair ordering:

```txt
user_low_id = lexicographically smaller UUID
user_high_id = lexicographically larger UUID
```

This prevents duplicate friendship rows.

---

## 7. Official Documentation

Official documentation has two sources:

```txt
content/docs/**/*.md
official_docs
```

Repo-backed Markdown files are canonical and read-only in the admin UI. Database
docs are editable from the admin UI and can be used for quick docs, drafts, or
temporary help content.

### official_docs

Admin-authored public help/documentation pages. These are intentionally separate
from collaborative user documents: they have manual saves, publish states, and no
Yjs collaboration room.

```txt
official_docs
  id UUID PRIMARY KEY
  slug TEXT NOT NULL UNIQUE
  title TEXT NOT NULL
  category TEXT NOT NULL DEFAULT 'Guides'
  sort_order INTEGER NOT NULL DEFAULT 0
  markdown TEXT NOT NULL DEFAULT ''
  status TEXT NOT NULL DEFAULT 'draft'
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
  published_at TIMESTAMP
```

Allowed statuses:

```txt
draft
published
archived
```

Public routes only read `published` docs. Admin routes can read and edit all
statuses.

Docs navigation is grouped by `category` and ordered by `sort_order`, then
`title`. This keeps the public docs layout editable from the admin docs editor
instead of hard-coding sidebar sections in React.

Slug collision rule:

```txt
Repo docs win.
```

Database docs cannot be saved with a slug that belongs to a repo-backed doc.
Public routes filter out duplicate DB docs if a repo doc has the same slug.

---

## 8. Public Notes and Share Links

Public notes use fields directly on `documents`:

```txt
documents.visibility
documents.public_slug
```

Document share links use `document_share_links` and are private-link access,
not public publishing. Public publishing is indexed/discoverable inside Vault;
share links are copyable URL grants controlled by the document owner.

---

## 9. Document Versions

Not MVP, but useful later.

```txt
document_versions
  id UUID PRIMARY KEY
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
  title TEXT NOT NULL
  markdown TEXT NOT NULL
  reason TEXT NOT NULL DEFAULT 'auto'
  created_at TIMESTAMP NOT NULL DEFAULT now()
```

Useful for:

- History.
- Restore.
- Safer autosave.
- Resume bragging rights.

Current implementation:

- Automatic checkpoints store the previous document state before a new save overwrites it.
- Automatic checkpoints are batched to at most one every 10 minutes per document unless the incoming change is large.
- Large changes force an early checkpoint when the body size differs by at least 2,000 characters or 25%.
- Manual restore points can be created from the document history panel.
- Restoring a checkpoint first creates a `before_restore` checkpoint of the current state.
- Archiving creates a `before_archive` checkpoint.
- Collaboration persistence uses the same batching policy and records `reason = 'collab'`.

---

## 10. Future Document Assets

Detailed implementation plan:

```txt
docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md
```

Image/PDF uploads have a first implementation slice: private-by-default assets
backed by private R2 object storage and Postgres metadata. The asset library,
metadata editing, explicit asset publishing UI, and cleanup tools are still
future work.

Important rules:

- Store uploaded bytes in R2, not Postgres.
- Keep the R2 bucket private.
- Do not insert raw R2/public storage URLs into Markdown.
- Store stable Markdown references such as `![[asset:<asset-id>|label]]`.
- Route asset reads through Vault permission checks.
- Publishing a document does not automatically publish embedded assets.
- Individual assets can be explicitly published later for gallery visibility.

Implemented schema additions in migration `0011_tiresome_ultimates.sql`:

```txt
users
  storage_used_bytes BIGINT NOT NULL DEFAULT 0
  storage_quota_bytes BIGINT NOT NULL DEFAULT 268435456

assets
  id UUID PRIMARY KEY
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  uploader_id UUID REFERENCES users(id) ON DELETE SET NULL
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

document_assets
  id UUID PRIMARY KEY
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE
  linked_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at TIMESTAMP NOT NULL DEFAULT now()
  UNIQUE(document_id, asset_id)
```

Asset read access is allowed when:

```txt
asset.visibility = public
OR asset.owner_id = current_user.id
OR current_user is signed in and asset is linked to a document current_user can read
```

Anonymous public document reads must not make private linked assets public. A
published document can render an embedded asset for anonymous viewers only when
that asset is explicitly public.

---

## 11. Audit Logs

Not MVP, but good later.

```txt
audit_logs
  id UUID PRIMARY KEY
  actor_id UUID REFERENCES users(id)
  action TEXT NOT NULL
  resource_type TEXT NOT NULL
  resource_id UUID
  metadata JSONB
  created_at TIMESTAMP
```

Example actions:

```txt
document.created
document.updated
document.deleted
document.shared
document.published
friend.requested
friend.accepted
```

---

## 12. Important Indexes

Add indexes for common access patterns.

```txt
documents.owner_id
documents.public_slug
documents.visibility
documents.updated_at

document_permissions.user_id
document_permissions.document_id
document_permissions.document_id + document_permissions.user_id

document_versions.document_id + document_versions.created_at
document_versions.created_by

friend_requests.recipient_id
friend_requests.requester_id
friend_requests.status

friendships.user_low_id
friendships.user_high_id
```

---

## 13. Permission Query Patterns

### Can read document?

Allowed if:

```txt
document.visibility = public
OR document.owner_id = user.id
OR document_permissions has role owner/editor/viewer for user
```

### Can edit document?

Allowed if:

```txt
document.owner_id = user.id
OR document_permissions has role owner/editor for user
```

### Can share document?

Allowed if:

```txt
document.owner_id = user.id
OR document_permissions has role owner
```

MVP: only owner can share.

---

## 14. Drizzle Schema Sketch

This is not final copy-paste code, but the shape should look like this:

```ts
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  markdown: text("markdown").notNull().default(""),
  visibility: text("visibility").notNull().default("private"),
  publicSlug: text("public_slug").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
```

---

## 15. Seed Data for Local Dev

Create a local seed script later:

```txt
scripts/seed.ts
```

Useful seed data:

- User A.
- User B.
- Private doc.
- Shared doc.
- Public doc.
- Pending friend request.

---

## 16. Data Model MVP Checklist

| Status | Item |
|---|---|
| [x] | Auth.js tables created |
| [x] | users table confirmed |
| [x] | documents table created |
| [x] | document_permissions table created |
| [x] | friend_requests table created |
| [x] | friendships table created |
| [x] | transitional documents.markdown column generated |
| [x] | legacy documents.content column removed |
| [x] | document_versions history table generated |
| [x] | migrations run locally |
| [~] | latest history migration applied locally; pending production deploy |
| [x] | indexes added |
