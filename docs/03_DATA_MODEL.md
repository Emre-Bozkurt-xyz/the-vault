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

---

## 4. Friend System

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

## 5. Public Shares

MVP can use fields directly on `documents`:

```txt
documents.visibility
documents.public_slug
```

Later, if you want multiple share links:

```txt
public_share_links
  id UUID PRIMARY KEY
  document_id UUID REFERENCES documents(id)
  slug TEXT UNIQUE
  enabled BOOLEAN
  expires_at TIMESTAMP
  created_at TIMESTAMP
```

Not needed for MVP.

---

## 6. Document Versions

Not MVP, but useful later.

```txt
document_versions
  id UUID PRIMARY KEY
  document_id UUID REFERENCES documents(id)
  created_by UUID REFERENCES users(id)
  title TEXT
  markdown TEXT
  reason TEXT
  created_at TIMESTAMP
```

Useful for:

- History.
- Restore.
- Safer autosave.
- Resume bragging rights.

Do not snapshot every keystroke. Prefer explicit restore points plus time-bucketed autosave checkpoints, e.g. create a version after a meaningful idle window, before destructive operations, or when a collaborative session is compacted.

---

## 7. Audit Logs

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

## 8. Important Indexes

Add indexes for common access patterns.

```txt
documents.owner_id
documents.public_slug
documents.visibility
documents.updated_at

document_permissions.user_id
document_permissions.document_id
document_permissions.document_id + document_permissions.user_id

friend_requests.recipient_id
friend_requests.requester_id
friend_requests.status

friendships.user_low_id
friendships.user_high_id
```

---

## 9. Permission Query Patterns

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

## 10. Drizzle Schema Sketch

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

## 11. Seed Data for Local Dev

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

## 12. Data Model MVP Checklist

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
| [x] | migrations run locally |
| [~] | latest cleanup migration applied locally; pending production deploy |
| [x] | indexes added |
