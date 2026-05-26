# Vault — Progress Tracker

Use this as the living checklist. Keep it updated as you build.

Legend:

```txt
[ ] Not started
[~] In progress
[x] Done
[!] Blocked
```

---

## Phase 0 — Bootstrap

| Status | Task | Notes |
|---|---|---|
| [ ] | Create GitHub repo | `vault` |
| [x] | Create Next.js app | TypeScript + App Router |
| [x] | Install Tailwind | Tailwind v4 from create-next-app/shadcn |
| [x] | Install shadcn/ui | Added Button, Card, Dialog, Input, Dropdown Menu, Avatar, Badge, Textarea |
| [x] | Add Docker Compose Postgres | Local dev database via `docker-compose.yml` |
| [~] | Add Drizzle ORM | Config and DB client added; first real schema/migration still pending |
| [x] | Add `.env.example` | No real secrets |
| [x] | Add `/api/health` | Checks app and database connectivity |
| [x] | Add basic landing page | Public homepage |
| [x] | Add protected dashboard placeholder | Placeholder route added; auth protection comes in Phase 1 |

Exit criteria:

```txt
App runs locally.
Postgres runs locally.
Health endpoint returns OK.
```

---

## Phase 1 — Auth

| Status | Task | Notes |
|---|---|---|
| [~] | Create GitHub OAuth app | Local provider endpoint sees GitHub; real browser login still needs manual verification |
| [x] | Add Auth.js | NextAuth v5 route at `/api/auth/[...nextauth]` |
| [x] | Add Drizzle/Auth adapter | Auth tables migrated locally |
| [x] | Add login page | GitHub button added; requires real OAuth env values |
| [x] | Add logout button | Dashboard sign-out form added |
| [x] | Protect dashboard route | Server-side redirect to `/login` |
| [x] | Add session helper | `auth()` exported from `auth.ts` and `lib/auth.ts` |
| [x] | Add user profile display | Dashboard shows email/name from session |

Exit criteria:

```txt
GitHub login works.
Session persists.
Dashboard is protected.
```

---

## Phase 2 — Documents

| Status | Task | Notes |
|---|---|---|
| [x] | Create documents table | UUID id, owner_id, title, content JSONB |
| [x] | Create document server actions | create/update/archive/list/get |
| [x] | Add dashboard document list | Owned docs |
| [x] | Add `/docs/[docId]` route | Temporary textarea editor page |
| [x] | Add Tiptap editor | JSON storage |
| [x] | Add title editing | Save title |
| [x] | Add save button | Manual save first |
| [ ] | Add autosave | Optional after manual save |
| [x] | Add soft delete | `deleted_at` |
| [x] | Add empty state UI | Better polish |

Exit criteria:

```txt
User can create, edit, save, reopen, and delete own docs.
```

---

## Phase 3 — Permissions

| Status | Task | Notes |
|---|---|---|
| [x] | Create permission enum | owner/editor/viewer TypeScript union |
| [x] | Create document_permissions table | user_id + document_id |
| [x] | Add `canReadDocument()` | Server-side helper |
| [x] | Add `canEditDocument()` | Server-side helper |
| [x] | Block unauthorized access | Private inaccessible docs return `notFound()` |
| [x] | Add share dialog UI | Inline email/role form |
| [x] | Add collaborator list | Show current collaborators |
| [x] | Add remove collaborator action | Owner only |
| [x] | Add role update action | Owner only |
| [x] | Add shared-with-me dashboard tab | Query permission table |

Exit criteria:

```txt
Permissions are enforced server-side.
Owner/editor/viewer behavior works.
```

---

## Phase 4 — Friends

| Status | Task | Notes |
|---|---|---|
| [x] | Create friend_requests table | requester, recipient, status |
| [x] | Create friendships table | normalized pair |
| [~] | Add user search | Send request by exact registered email |
| [x] | Send friend request | Prevents self, duplicates, existing friendship |
| [x] | Accept friend request | Creates friendship |
| [x] | Reject friend request | Updates request |
| [x] | List friends | `/dashboard/friends` |
| [x] | Use friends in share dialog | Friend selector added to document sharing |
| [x] | Add remove friend action | Optional MVP completed |

Exit criteria:

```txt
Users can become friends and share docs with friends.
```

---

## Phase 5 — Public Notes

| Status | Task | Notes |
|---|---|---|
| [x] | Add document visibility | private/public |
| [x] | Add public slug | Unique, stable |
| [x] | Add publish toggle | Owner only |
| [x] | Add `/public/[slug]` route | Read-only renderer |
| [x] | Add unpublish action | Owner only |
| [x] | Add public badge | Dashboard/editor |
| [x] | Add copy public link button | Nice polish |

Exit criteria:

```txt
Published docs are public.
Private docs stay private.
Public page is read-only.
```

---

## Phase 6 — Deployment

| Status | Task | Notes |
|---|---|---|
| [x] | Add production Dockerfile | Next.js standalone output |
| [x] | Add production docker-compose | web + postgres + migrate profile |
| [x] | Add persistent Docker volumes | Postgres data |
| [ ] | Add production env file | On server only |
| [ ] | Run production migration | `drizzle-kit migrate` |
| [ ] | Configure FRP port mapping | VPS to mini-PC |
| [ ] | Configure Caddy route | `vault.ems-place.com` |
| [ ] | Configure Cloudflare DNS | subdomain to VPS |
| [ ] | Update OAuth callback URLs | production callback |
| [ ] | Verify HTTPS | Caddy certificate |
| [ ] | Verify WebSocket compatibility | Needed later for Yjs |
| [ ] | Add health check monitoring | `/api/health` |
| [x] | Add backup script | Bash and PowerShell Postgres dump scripts |

Exit criteria:

```txt
https://vault.ems-place.com works.
OAuth works in production.
Documents persist.
Backup works.
```

---

## Phase 7 — Real-Time Collaboration

| Status | Task | Notes |
|---|---|---|
| [ ] | Add Yjs packages | `yjs`, `y-websocket`, Tiptap collaboration |
| [ ] | Create collab service | Separate Node service |
| [ ] | Add room authorization | Token-based room access |
| [ ] | Connect editor to Yjs | Only for shared docs |
| [ ] | Add awareness/presence | User cursors/names |
| [ ] | Persist Yjs updates | Redis/Postgres |
| [ ] | Add collab service to Docker Compose | Separate container |
| [ ] | Route WebSocket through Caddy/FRP | Test production |
| [ ] | Test two browsers/two users | Core acceptance |

Exit criteria:

```txt
Two authorized editors can edit the same document live.
Unauthorized users cannot connect.
```

---

## Bugs / Issues

| Status | Issue | Priority | Notes |
|---|---|---:|---|
| [ ] |  |  |  |

---

## Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-05-26 | Use Next.js App Router | One deployable app, strong resume value |
| 2026-05-26 | Use Postgres | Reliable, self-hostable, strong data model |
| 2026-05-26 | Use Drizzle | SQL-like, lightweight, good for showing DB skill |
| 2026-05-26 | Delay Yjs until post-MVP | Avoid drowning in collaboration complexity |

---

## MVP Release Checklist

| Status | Requirement |
|---|---|
| [ ] | Production domain loads |
| [ ] | OAuth production callback works |
| [x] | Private documents are private |
| [x] | Shared docs work |
| [x] | Viewer/editor roles work |
| [x] | Public notes work |
| [ ] | Database survives container restart |
| [x] | Backup script tested |
| [ ] | README has architecture diagram |
| [ ] | Resume bullets drafted |
