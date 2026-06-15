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
| [x] | Create GitHub repo | Remote exists at `https://github.com/Emre-Bozkurt-xyz/the-vault.git` |
| [x] | Create Next.js app | TypeScript + App Router |
| [x] | Install Tailwind | Tailwind v4 from create-next-app/shadcn |
| [x] | Install shadcn/ui | Added Button, Card, Dialog, Input, Dropdown Menu, Avatar, Badge, Textarea |
| [x] | Add Docker Compose Postgres | Local dev database via `docker-compose.yml` |
| [x] | Add Drizzle ORM | Config, DB client, schema, and migrations exist |
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
| [x] | Create GitHub OAuth app | Production OAuth verified |
| [x] | Add Auth.js | NextAuth v5 route at `/api/auth/[...nextauth]` |
| [x] | Add Drizzle/Auth adapter | Auth tables migrated locally |
| [x] | Add login page | GitHub and Google buttons added; require real OAuth env values |
| [x] | Add Google OAuth | Auth.js Google provider added; no schema migration required |
| [x] | Add logout button | Dashboard sign-out form added |
| [x] | Protect dashboard route | Server-side redirect to `/login` |
| [x] | Add session helper | `auth()` exported from `auth.ts` and `lib/auth.ts` |
| [x] | Add user profile display | Dashboard shows email/name from session |
| [x] | Add profile completion gate | Users choose unique username plus free-form nickname after login |
| [x] | Add settings profile editing | Nickname and username can be changed; username availability is checked live |

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
| [x] | Add autosave | Debounced editor autosave plus manual save status |
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
| [x] | Add share dialog UI | Smart user search by nickname, username, or email plus role selector |
| [x] | Add collaborator list | Show current collaborators |
| [x] | Add remove collaborator action | Owner only |
| [x] | Add role update action | Owner only |
| [x] | Add shared-with-me dashboard tab | Query permission table |
| [x] | Revamp sharing modal and link access | Sharing moved to a modal with friend-prioritized user autocomplete, thinner access rows, and one active revocable share link per document |

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
| [x] | Add user search | Exact registered email lookup for friend requests |
| [x] | Send friend request | Prevents self, duplicates, existing friendship |
| [x] | Accept friend request | Creates friendship |
| [x] | Reject friend request | Updates request |
| [x] | List friends | `/dashboard/friends` |
| [x] | Use friends in share dialog | Friend selector added to document sharing |
| [x] | Add remove friend action | Optional MVP completed |
| [x] | Add username/nickname friend search suggestions | Autocomplete searches nickname, username, and email |

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
| [x] | Credit published-note owners | Public pages show owner nickname/name, username, and avatar without exposing email |
| [x] | Add public share previews | `/public/[slug]` emits per-document OpenGraph/Twitter metadata and a generated social-card image |

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
| [x] | Add production env file | Verified on server |
| [x] | Run production migration | Verified through deployment |
| [x] | Configure FRP port mapping | Verified live deployment |
| [x] | Configure Caddy route | `vault.ems-place.com` verified |
| [x] | Configure Cloudflare DNS | Domain verified |
| [x] | Update OAuth callback URLs | Production auth verified |
| [x] | Verify HTTPS | `vault.ems-place.com` verified |
| [x] | Verify WebSocket compatibility | Markdown collab deployed and user-confirmed working in production |
| [x] | Add health check monitoring | `/healthz` for liveness; `/api/health` for database readiness |
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
| [x] | Add Yjs packages | `yjs`, Hocuspocus, CodeMirror/Y.Text binding |
| [x] | Create collab service | `scripts/collab-server.mjs` |
| [x] | Add room authorization | Short-lived signed token plus DB permission re-check |
| [x] | Connect editor to Yjs | Owner/editor sessions connect when `NEXT_PUBLIC_COLLAB_URL` is set |
| [x] | Add awareness/presence | Collaboration caret user names/colors |
| [x] | Persist Yjs updates | Collab server stores Markdown text back to `documents.markdown` and persists binary Yjs state in `document_collab_states` |
| [x] | Allow link editors into collaboration | Active members-editor share links can join the normal Yjs room without creating permanent collaborator rows; editor header shows live collaborator avatars |
| [x] | Add collab service to Docker Compose | `vault-collab` container on host port `18211` |
| [x] | Route WebSocket through Caddy/FRP | Production WebSocket path user-confirmed working |
| [x] | Test two browsers/two users | Markdown collaboration user-confirmed working |

Exit criteria:

```txt
Two authorized editors can edit the same document live.
Unauthorized users cannot connect.
```

---

## Phase 8 - Markdown Backbone Pivot

| Status | Task | Notes |
|---|---|---|
| [x] | Write Markdown pivot plan | `docs/09_MARKDOWN_PIVOT_PLAN.md` |
| [x] | Add transitional markdown column | `documents.markdown TEXT NOT NULL DEFAULT ''`; migration applied locally |
| [x] | Make new documents write initial Markdown | Legacy JSON remains active editor/rendering format |
| [x] | Deploy latest Markdown schema migration | Markdown schema deployed and user-confirmed working |
| [x] | Add Markdown renderer | `MarkdownDocument` renders GFM Markdown with sanitized raw HTML, constrained inline styles, and explicit safe media iframe embeds |
| [x] | Add Obsidian-style callouts | `> [!type] Title` callouts render with default Obsidian types/aliases and snippet-ready `.callout[data-callout="..."]` hooks |
| [x] | Add Markdown editor | CodeMirror editor saves `documents.markdown` with Markdown toolbar, autosave, Read/Live/Source modes, and mobile layout pass |
| [x] | Move collaboration to Y.Text | Hocuspocus loads/stores `documents.markdown` via `Y.Text`; CodeMirror binding production-confirmed |
| [x] | Add live preview | Live mode is default; Read shows the fully rendered document, Source shows raw Markdown, and multi-line raw HTML stays source in Live while rendering in Read |
| [x] | Remove legacy Tiptap/ProseMirror code | Tiptap packages, editor components, ProseMirror helpers, and `documents.content` fallback code removed; migration `0005_high_captain_midlands.sql` drops the legacy column |
| [x] | Add document update history | `document_versions` stores batched Markdown checkpoints, manual restore points, and before-restore/before-archive safety snapshots |
| [x] | Add wiki-link rendering slice | Preview/view/public render `[[doc:id|label]]`, unambiguous `[[Title]]`, unresolved states, and external image `![[https://...]]` syntax |
| [x] | Add wiki-link autocomplete | CodeMirror autocomplete refreshes readable documents from `/api/documents/wiki-links` for `[[...]]` links and `![[...]]` embeds |
| [x] | Add source-mode HTML autocomplete | Markdown CodeMirror keeps HTML tag completion available in source/split/live modes alongside wiki-link completion |
| [x] | Add live wiki-link styling | Live mode hides inactive wiki-link markers and styles the visible label |
| [x] | Add document transclusion embeds | Standalone `![[doc]]` embeds render permission-aware document previews in Preview/view/public and Live mode |
| [x] | Add heading-scoped wiki links | `[[doc#heading]]` links navigate to rendered heading anchors; `![[doc#heading]]` embeds only the selected heading section |
| [x] | Add block and region-scoped wiki links | `[[doc#^block-id]]` targets hidden Obsidian-style block anchors; `[[doc#@region-id]]` targets hidden Vault regions; embeds render only the selected block/region |
| [x] | Add guide/public wiki namespaces | `guide:<slug>` links official docs; `public:<slug>` links published user docs and autocomplete shows publisher usernames |
| [x] | Flatten writing surfaces | Live editor and Preview/public reading modes now use seamless page surfaces instead of large card frames; Live mode hides line-number/fold gutters |
| [~] | Add uploaded document assets | Planning moved to `docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md`; implementation not started |

Exit criteria:

```txt
Markdown is the canonical document source.
Users can edit Markdown with collaboration and live preview.
Legacy ProseMirror JSON is no longer required.
```

---

## Phase 9 - Admin and Official Docs

| Status | Task | Notes |
|---|---|---|
| [x] | Add account roles | `users.role` supports `user` and `admin` |
| [x] | Add ban moderation fields | `users.banned_at`, `users.banned_until`, `users.ban_reason` |
| [x] | Add active-user/admin helpers | `server/authz.ts` gates bans and DB-backed admin role checks |
| [x] | Add admin user moderation UI | `/dashboard/admin` lists/searches users, sets roles, bans/unbans |
| [x] | Add official docs schema | `official_docs` stores admin-authored Markdown guides |
| [x] | Add public docs routes | `/docs` and `/docs/guides/[slug]` render published official docs |
| [x] | Add admin official docs editor | `/dashboard/admin/docs` and `/dashboard/admin/docs/[docId]`, CodeMirror source/split/preview editing, manual saves, no collaboration |
| [x] | Add docs categories and sidebar navigation | `category` and `sort_order` drive readthedocs-style public docs grouping |
| [x] | Add repo-backed canonical docs | `content/docs/**/*.md` merges into the same public/admin docs lists as read-only canonical docs |
| [x] | Seed first official user docs | Added Markdown basics, wiki links/embeds, callouts, snippets, safe HTML/embeds, and sharing/permissions |
| [x] | Add terms page and login acceptance copy | `/terms` renders `content/legal/terms.md`; login links terms before OAuth/dev sign-in |

Exit criteria:

```txt
Admins can moderate accounts and publish official user-facing docs.
```

---

## Phase 10 - Workspace UI Revamp

Reference plan: `docs/10_WORKSPACE_UI_REVAMP_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write workspace revamp plan | Defines Obsidian-like shell, URL philosophy, tabs, side panels, gallery direction, and phased implementation |
| [x] | Add workspace shell skeleton | `/workspace`, icon rail, collapsible left panel, draggable top tab bar with localStorage tabs, new-tab page; `/dashboard` redirects to `/workspace` |
| [x] | Add document file browser panel | Compact owned/shared/published/recent document lists in the left workspace panel |
| [x] | Move document editor into shell | `/docs/[docId]` now renders inside the workspace shell with persistent tabs/file browser and an editor-first canvas |
| [x] | Convert settings/guides/admin surfaces into workspace pages | Signed-in official docs, guide, settings, friends, admin users, admin docs list, and official-doc editor pages render inside the workspace model; anonymous docs routes still use the public docs layout |
| [x] | Add gallery v1 | `/gallery` renders inside the workspace shell and searches public documents by title, owner name, username, and slug; tags, assets, and richer filtering deferred |
| [x] | Move document context tools into right panel | Share, publish, restore points, and archive now live in the workspace right panel instead of the document canvas |
| [x] | Add resizable persistent panels | Left navigation and right context panel widths/collapse state are stored in localStorage and can be changed by dragging panel edges |
| [x] | Add shared protected workspace layout | Protected workspace routes under `/workspace`, `/docs/[docId]`, `/gallery`, and `/dashboard/*` now share `app/(workspace)/layout.tsx` so tab/panel chrome persists across those route changes |
| [x] | Add real search and gallery side panels | Workspace search quick-opens owned, shared, public, and guide pages; the gallery side panel filters public docs inline and links to the full gallery |
| [x] | Add workspace public reader | Signed-in gallery/search public-document opens now route to `/workspace/public/[slug]`, a read-only workspace-native view; `/public/[slug]` remains the canonical external public page |
| [~] | Final workspace visual pass | Document editor route now uses a centered Obsidian-like editor column with Read/Live/Source modes, a compact hover/focus icon stack for mode switching, and live-mode typography/list/callout styling closer to Read mode; new tab is a raw greeting/search/recent surface; workspace shell has independent scroll domains for center/side panels and hydration-safe persisted chrome state; gallery uses rendered document preview cards; mobile tabs scroll with minimum widths and mobile drawer controls expose left/right panels; remaining routes need a final consistency pass |

Exit criteria:

```txt
Vault opens into an editor/file-browser workspace instead of a dashboard.
Tabs and side panels are persistent workspace UI.
Existing deep links, public pages, share links, and collaboration still work.
```

---

## Phase 11 - Asset Storage and Library

Reference plan: `docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Decide private-by-default storage model | R2 remains private byte storage; Vault owns all asset read/write authorization |
| [x] | Write asset storage and library plan | Covers schema, upload route, private serving, editor insertion, asset library, explicit asset publishing, gallery integration, deployment, and tests |
| [x] | Prepare storage dependencies and env placeholders | `@aws-sdk/client-s3`, `file-type`, private R2 env placeholders, and server-only/lazy-env `lib/storage/r2.ts` helper exist |
| [ ] | Add asset schema and migrations | Add user quota fields, `assets`, and `document_assets` |
| [ ] | Add private upload API | `POST /api/assets` with auth, document edit checks, validation, quota, R2 upload, metadata, and document link |
| [ ] | Add private serving API | Permission-checked `/api/assets/:assetId/content`, including owner/public/document-context reads |
| [ ] | Render Markdown asset embeds | Resolve `![[asset:id|label]]` through server-provided asset maps; no raw R2 URLs in Markdown |
| [ ] | Add editor upload and paste flows | Toolbar file picker and clipboard image paste insert asset embeds through CodeMirror transactions |
| [ ] | Add asset library page | `/assets` workspace page with masonry grid, filters, details/config panel, metadata editing, and copy embed |
| [ ] | Add explicit asset publishing | Asset-level public/private toggle; publishing documents does not publish embedded assets |
| [ ] | Integrate public assets into gallery | `/gallery` lists explicitly public assets alongside public documents |
| [ ] | Add cleanup and reconciliation tools | Unused asset detection, object deletion, quota repair, and R2 backup/export notes |

Exit criteria:

```txt
Users can upload/paste images into private docs, browse owned assets, and publish
individual assets to the gallery without making private document assets public by
default.
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
| [x] | Production domain loads |
| [x] | OAuth production callback works |
| [x] | Private documents are private |
| [x] | Shared docs work |
| [x] | Viewer/editor roles work |
| [x] | Public notes work |
| [x] | Database survives container restart |
| [x] | Backup script tested |
| [x] | README has architecture diagram |
| [x] | Resume bullets drafted |
