# Vault — Auth and Permissions Plan

## 1. Auth Goal

The MVP should support OAuth login and protected document access.

Start with:

```txt
GitHub OAuth
```

Add later:

```txt
Google OAuth
Email magic links
Passkeys
```

---

## 2. Auth.js Setup

Use Auth.js/NextAuth with the Next.js App Router.

Recommended files:

```txt
lib/auth.ts
app/api/auth/[...nextauth]/route.ts
middleware.ts
```

Basic responsibilities:

```txt
lib/auth.ts
  - providers
  - adapter
  - callbacks
  - session shape

middleware.ts
  - protect dashboard and docs routes, if desired
```

---

## 3. Required Environment Variables

```env
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

DATABASE_URL=postgres://vault:vault@localhost:5432/vault
```

Production:

```env
NEXTAUTH_URL=https://vault.ems-place.com
AUTH_SECRET=<strong secret>
GITHUB_CLIENT_ID=<prod github oauth app id>
GITHUB_CLIENT_SECRET=<prod github oauth app secret>
DATABASE_URL=postgres://...
```

Use a different OAuth app or at least separate callback URLs for production.

Local development can also use the dev-only login buttons on `/login`. Those
buttons are disabled in production and create normal database-backed Auth.js
sessions for local test users, avoiding GitHub OAuth callback churn while still
exercising the real permission model.

---

## 4. OAuth Callback URLs

Local:

```txt
http://localhost:3000/api/auth/callback/github
```

Production:

```txt
https://vault.ems-place.com/api/auth/callback/github
```

---

## 5. Session Shape

Make sure the session exposes:

```ts
session.user.id
session.user.email
session.user.name
session.user.image
```

The server needs `user.id` for permission checks.

---

## 6. Route Protection

Protected routes:

```txt
/dashboard
/dashboard/*
/docs/*
/settings
```

Public routes:

```txt
/
/login
/public/*
/api/health
/api/auth/*
```

Important:

Do not rely only on middleware. Every server action that touches documents must check permissions.

---

## 7. Permission Roles

```txt
owner
editor
viewer
```

### Owner

Can:

- Read document.
- Edit document.
- Delete/archive document.
- Share document.
- Remove collaborators.
- Change collaborator roles.
- Publish/unpublish.

### Editor

Can:

- Read document.
- Edit content.
- Edit title.

Cannot:

- Delete document.
- Share document.
- Publish document.
- Change permissions.

### Viewer

Can:

- Read document.

Cannot:

- Edit.
- Share.
- Delete.
- Publish.

---

## 8. Permission Helper Functions

Recommended file:

```txt
lib/permissions.ts
```

Functions:

```ts
getDocumentAccess(userId: string, documentId: string)

canReadDocument(userId: string | null, documentId: string)
canEditDocument(userId: string, documentId: string)
canShareDocument(userId: string, documentId: string)
canDeleteDocument(userId: string, documentId: string)
canPublishDocument(userId: string, documentId: string)
```

Return shape:

```ts
type DocumentAccess = {
  canRead: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  role: "owner" | "editor" | "viewer" | null;
};
```

---

## 9. Authorization Pattern

Every document action should look conceptually like this:

```ts
export async function updateDocument(documentId: string, input: UpdateDocumentInput) {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const allowed = await canEditDocument(session.user.id, documentId);

  if (!allowed) {
    throw new Error("Forbidden");
  }

  // Validate input
  // Update database
}
```

---

## 10. Private Document Behavior

For private docs, prefer:

```txt
404 Not Found
```

instead of:

```txt
403 Forbidden
```

Reason:

A 403 confirms the document exists. A 404 leaks less.

For app UI, it is okay to show a friendly "You do not have access" page, but the server-side default should be conservative.

---

## 11. Public Document Behavior

For `/public/:slug`:

Allowed if:

```txt
document.visibility = public
document.deleted_at IS NULL
document.public_slug = slug
```

No auth required.

Public route should not expose:

- Collaborators.
- Owner email.
- Internal document ID, unless intentionally included.
- Permission rows.

---

## 12. Sharing Flow

### Share with existing user

```txt
Owner opens share modal
  |
Search user by email/username
  |
Select role viewer/editor
  |
Server checks owner permission
  |
Insert or update document_permissions row
```

### Share with friend

Same as above, but user picker defaults to friend list.

For MVP:

- Allow sharing with any registered user.
- Prefer showing friends first.

---

## 13. Friend Request Security

Rules:

- User cannot friend themselves.
- User cannot send duplicate pending request.
- If friendship already exists, do not create request.
- Only recipient can accept/reject.
- Accepting creates normalized friendship row.
- Rejecting does not create friendship row.

---

## 14. Public Publish Security

Only owner can publish.

Publishing should:

```txt
Set visibility = public
Generate public_slug if missing
```

Unpublishing should:

```txt
Set visibility = private
Keep public_slug reserved
```

Keeping the slug reserved avoids old links being immediately reused by another document.

---

## 15. MVP Auth/Permission Tests

Manual tests:

| Test | Expected |
|---|---|
| Logged-out user visits `/dashboard` | Redirect to login |
| Logged-out user visits private `/docs/:id` | Redirect or 404 |
| User B visits User A private doc | 404/access denied |
| User A shares doc with User B as viewer | User B can view |
| Viewer tries to edit | Blocked |
| User A changes User B to editor | User B can edit |
| User A removes User B | User B loses access |
| Public doc accessed logged out | Works |
| Private doc public slug route | 404 |

---

## 16. Security Checklist

| Status | Item |
|---|---|
| [x] | Auth secret set in production |
| [x] | OAuth callback URL is correct |
| [x] | Session includes user ID |
| [x] | Server actions check auth |
| [x] | Server actions check role |
| [x] | Private docs do not leak |
| [x] | Public route only renders public docs |
| [x] | Share action owner-only |
| [x] | Publish action owner-only |
| [x] | Email addresses not exposed publicly |
