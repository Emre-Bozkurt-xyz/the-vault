# Vault — Project Knowledge

This file is the living source of truth for the **actual current codebase**.

Planning docs describe the intended system. This file describes what really exists right now.

Update this file whenever the codebase changes in a meaningful way.

---

## 1. Current Status Snapshot

Last updated:

```txt
2026-06-06
```

Current phase:

```txt
Phase 9 - Admin moderation and official documentation
```

Current deployment status:

```txt
GitHub Actions deploy workflow works on the production server, the production domain works, OAuth works, document create/edit works, and Postgres data persists across redeploys.
```

Current MVP status:

```txt
In progress
```

One-sentence current reality:

```txt
Vault currently has a runnable dark-first Next.js app shell, switchable theming, GitHub/Google Auth.js wiring, Dockerized Postgres, Markdown document editing with autosave and live preview modes, safe Markdown read-only/public rendering, document sharing, public publishing, friend requests, server-side permission helpers, admin moderation, official docs publishing, a protected dashboard, health endpoints, GitHub Actions deployment wiring, and production-confirmed Markdown/Y.Text collaboration.
```

Planned direction:

```txt
The Markdown-native pivot documented in `docs/09_MARKDOWN_PIVOT_PLAN.md` is active and production-confirmed. The next useful slice is writing the first official docs content for Markdown, snippets, HTML filtering, and safe embeds.
```

---

## 2. Tech Stack Actually Used

Update this as dependencies are added.

```txt
Frontend:
  - Next.js 16 App Router
  - React 19
  - TypeScript
  - Tailwind CSS v4
  - shadcn/ui
  - next-themes

Backend:
  - Next.js Route Handlers

Database:
  - PostgreSQL 16 via Docker Compose

ORM:
  - Drizzle ORM with schema and migrations

Auth:
  - Auth.js / NextAuth v5 beta
  - GitHub OAuth provider configured
  - Google OAuth provider configured
  - Drizzle adapter with database sessions
  - First-run profile completion for username/nickname

Editor:
  - CodeMirror Markdown editor on document pages
  - Markdown text stored in `documents.markdown`
  - Debounced autosave plus manual save

Realtime collaboration:
  - Yjs + Hocuspocus service for owner/editor Markdown live editing
  - CodeMirror remote cursor/selection awareness through `y-codemirror.next`
  - Markdown `Y.Text` persistence back to `documents.markdown`

Deployment:
  - Production Docker/Compose scaffolding
  - GitHub Actions workflow targeting a self-hosted mini-PC runner
  - Separate `vault-collab` container scaffold
```

Notes:

```txt
- `next.config.ts` enables standalone output for the future production Dockerfile.
- `shadcn@4.8.0` initialized with the default Base/Nova preset, which uses Base UI primitives. Its Button does not support `asChild`; use `buttonVariants()` for styled links.
- Theme behavior is dark-first and switchable. `next-themes` controls the root `class`; page styling should use shadcn/Tailwind theme tokens instead of hard-coded light/dark colors.
- Auth uses `next-auth@5.0.0-beta.31` because the current App Router API exposes `auth`, `handlers`, `signIn`, and `signOut` from the root `auth.ts`.
```

---

## 3. Repo Structure

Current important directories/files:

```txt
vault/
  app/
    api/auth/[...nextauth]/
    api/health/
    dashboard/
      admin/
      friends/
      settings/
    banned/
    terms/
    docs/
      guides/[slug]/
    docs/[docId]/
    healthz/
    login/
    public/[slug]/
  components/
    markdown/
    theme-provider.tsx
    theme-toggle.tsx
    ui/
  db/
  lib/
  server/
  docs/
  public/
  content/
  scripts/
  .github/workflows/
```

Add notes as real files appear:

| Path | Purpose |
|---|---|
| `app/` | Next.js routes |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js route handlers |
| `app/api/health/route.ts` | App/database health check route |
| `app/dashboard/page.tsx` | Server-protected dashboard with owned/shared/public document sections |
| `app/dashboard/admin/page.tsx` | Admin-only user moderation page with user search, role changes, bans, and unbans |
| `app/dashboard/admin/docs/page.tsx` | Admin-only official docs list/create page |
| `app/dashboard/admin/docs/[docId]/page.tsx` | Admin-only manual official docs editor |
| `app/dashboard/friends/page.tsx` | Protected friend request/friend list page |
| `app/dashboard/settings/page.tsx` | Protected account/settings page |
| `app/banned/page.tsx` | Logged-in banned-account explanation and sign-out page |
| `app/terms/page.tsx` | Public Terms and Conditions route rendered from repo Markdown |
| `app/docs/page.tsx` | Public official documentation index |
| `app/docs/guides/[slug]/page.tsx` | Public official documentation guide route |
| `app/onboarding/page.tsx` | First-run profile completion page for username and nickname |
| `app/docs/[docId]/page.tsx` | Protected document edit/view route |
| `app/healthz/route.ts` | Lightweight app-only health route |
| `app/login/page.tsx` | GitHub/Google OAuth sign-in page |
| `app/public/[slug]/page.tsx` | Anonymous public read-only document route |
| `app/api/users/search/route.ts` | Authenticated user search API for friend/profile lookup |
| `app/api/users/username-availability/route.ts` | Authenticated username validation/uniqueness API for settings |
| `.github/workflows/deploy.yml` | Production deploy workflow for the self-hosted mini-PC runner |
| `app/loading.tsx` | Global loading skeleton |
| `app/not-found.tsx` | Global not-found page for missing/private/unpublished docs |
| `app/error.tsx` | Global recoverable error page |
| `components/` | Shared UI components |
| `components/copy-public-link.tsx` | Client-side copy public URL button |
| `components/markdown/MarkdownEditor.tsx` | CodeMirror Markdown source editor with autosave, source/split/preview modes, and optional Yjs collaboration |
| `components/markdown/OfficialDocEditor.tsx` | CodeMirror-based manual-save Markdown editor for official docs; no collaboration |
| `components/markdown/MarkdownToolbar.tsx` | Toolbar that inserts Markdown syntax |
| `components/markdown/MarkdownDocument.tsx` | Safe GFM Markdown renderer with sanitized raw HTML allowlist |
| `components/theme-provider.tsx` | Root client theme provider using `next-themes` |
| `components/theme-toggle.tsx` | Dark/light icon toggle |
| `components/profile-settings-form.tsx` | Settings form for nickname and username changes with live availability status |
| `components/user-search-field.tsx` | Reusable user search/autocomplete field with avatar/name/username/email suggestions |
| `components/document-workspace.tsx` | Client wrapper for the document editor workspace and collapsible right-side action panel |
| `components/ui/` | shadcn/ui components |
| `db/` | Database client/schema/migrations |
| `db/index.ts` | Drizzle/Postgres client |
| `db/schema.ts` | Auth, document, and document permission schema |
| `lib/` | Shared helpers |
| `lib/auth.ts` | Re-export of auth helpers for app imports |
| `lib/collab-token.ts` | Signed room token creation/verification for collaboration |
| `lib/markdown.ts` | Shared Markdown limits |
| `lib/repo-docs.ts` | Filesystem loader for repo-backed docs and legal Markdown content |
| `lib/permissions.ts` | Server-side document access helpers |
| `lib/slug.ts` | Public slug generation helper |
| `lib/utils.ts` | shadcn utility for class merging |
| `server/documents.ts` | Document server actions and queries |
| `server/admin.ts` | Admin user listing/search, role changes, bans, and unbans |
| `server/authz.ts` | DB-backed active-user and admin guards; active bans redirect to `/banned` |
| `server/dev-auth.ts` | Dev-only local sign-in action that creates Auth.js database sessions |
| `server/official-docs.ts` | Official documentation queries and admin save/create actions |
| `content/docs/` | Repo-backed canonical user documentation rendered with the same docs UI as DB docs |
| `content/legal/terms.md` | Repo-backed Terms and Conditions copy shown on `/terms` |
| `server/friends.ts` | Friend request and friendship server actions/queries |
| `server/profile.ts` | Profile completion, profile gate, and user search helpers |
| `auth.ts` | Auth.js configuration, Drizzle adapter, GitHub provider, session callback |
| `scripts/collab-server.mjs` | Hocuspocus/Yjs collaboration websocket service |
| `docs/` | Planning and project knowledge |
| `docs/09_MARKDOWN_PIVOT_PLAN.md` | Structured plan and status notes for the Markdown backbone pivot |
| `docker-compose.yml` | Local Postgres service |
| `docker-compose.production.yml` | Production web/postgres/migration compose file with `/healthz` container liveness healthcheck |
| `Dockerfile` | Production standalone Next.js image |
| `Dockerfile.collab` | Production collaboration service image |
| `scripts/backup-db.sh` | Bash Postgres backup script |
| `scripts/backup-db.ps1` | PowerShell Postgres backup script |
| `scripts/restore-db.sh` | Bash Postgres restore script |
| `scripts/restore-db.ps1` | PowerShell Postgres restore script |
| `.env.example` | Committed placeholder environment values |

---

## 4. Environment Variables

### Local

```env
DATABASE_URL=postgres://vault:vault@localhost:5432/vault
AUTH_SECRET=replace-with-a-generated-secret
NEXTAUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=replace-with-github-oauth-client-id
GITHUB_CLIENT_SECRET=replace-with-github-oauth-client-secret
GOOGLE_CLIENT_ID=replace-with-google-oauth-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-oauth-client-secret
NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234
COLLAB_PORT=1234
ENABLE_DEV_LOGIN=true
```

### Production

```env
# Add production env vars here, but never commit real secret values
```

Rules:

- Do not store real secrets in this file.
- Use placeholder values only.
- Record what each variable is for.

| Variable | Required? | Used by | Purpose |
|---|---:|---|---|
| `DATABASE_URL` | Yes | App/Drizzle | PostgreSQL connection |
| `AUTH_SECRET` | Yes | Auth.js | Session/auth secret |
| `NEXTAUTH_URL` | Yes | Auth.js | Public app URL |
| `GITHUB_CLIENT_ID` | Yes | Auth.js | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | Yes | Auth.js | GitHub OAuth secret |
| `GOOGLE_CLIENT_ID` | Yes | Auth.js | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Yes | Auth.js | Google OAuth secret |
| `NEXT_PUBLIC_COLLAB_URL` | Optional | Editor | WebSocket URL for live collaboration; when absent, editor falls back to normal autosave |
| `COLLAB_PORT` | Optional | Collab service | Internal Hocuspocus listen port, default `1234` |
| `ENABLE_DEV_LOGIN` | Optional | Login page | Enables dev-only local Auth.js database-session login when not production; defaults enabled outside production unless set to `false` |

---

## 5. Database State

Current database engine:

```txt
PostgreSQL 16 via `docker compose up -d postgres`
```

Current ORM:

```txt
Drizzle ORM configured
```

Current tables:

| Table | Exists? | Purpose |
|---|---:|---|
| `users` | Yes | Auth users |
| `accounts` | Yes | OAuth accounts |
| `sessions` | Yes | Auth sessions |
| `verification_tokens` | Yes | Email login tokens |
| `documents` | Yes | Documents/notes |
| `document_permissions` | Yes | Per-document access |
| `document_versions` | Yes | Batched Markdown restore checkpoints |
| `friend_requests` | Yes | Friend request workflow |
| `friendships` | Yes | Accepted friendships |
| `official_docs` | Yes | Admin-authored public user documentation |

Current migrations:

| Migration | Purpose | Applied locally? | Applied production? |
|---|---|---:|---:|
| `0000_closed_jackal.sql` | Auth.js users/accounts/sessions/verification_tokens | Yes | No |
| `0001_black_barracuda.sql` | Documents and document_permissions | Yes | No |
| `0002_sturdy_archangel.sql` | Friend requests and friendships | Yes | No |
| `0003_slimy_puppet_master.sql` | Adds transitional `documents.markdown` column | Yes | No |
| `0004_goofy_kylun.sql` | Adds `users.profile_completed_at` and `users_name_idx` | Yes | No |
| `0005_high_captain_midlands.sql` | Drops legacy `documents.content` JSONB column | Yes | No |
| `0006_chilly_quasimodo.sql` | Adds `document_versions` restore checkpoint table | Yes | No |
| `0007_special_morbius.sql` | Adds user role/ban fields and `official_docs` | Generated | No |
| `0008_overrated_radioactive_man.sql` | Adds `official_docs.category`, `official_docs.sort_order`, and category/order index | Generated | No |

Schema notes:

```txt
- `db/schema.ts` currently defines Auth.js tables, documents, document_permissions, document_versions, friend_requests, friendships, and official_docs.
- `users.name` is used as the free-form nickname; `users.username` is unique and normalized lowercase; `users.profile_completed_at` records onboarding completion; `users.role` supports `user`/`admin`.
- `users.banned_at`, `users.banned_until`, and `users.ban_reason` store moderation state. `banned_at` with no `banned_until` is treated as permanent.
- Friendships, document ownership, document permissions, sessions, and accounts all reference `users.id`, not `username`, so username changes do not migrate relationship rows.
- `documents.markdown` is the canonical editor/viewer/public rendering source.
- `documents.content` has been removed from the Drizzle schema and will be dropped by migration `0005_high_captain_midlands.sql`.
- `document_versions` stores full Markdown checkpoints for recovery. Automatic checkpoints are batched to at most one every 10 minutes per document unless a save changes the body size by at least 2,000 characters or 25%.
- `official_docs` stores admin-authored Markdown docs with `draft`, `published`, and `archived` statuses. Public docs routes only read published rows.
- `official_docs.category` and `official_docs.sort_order` drive the public docs sidebar grouping and order. Published docs sort by category, sort order, then title.
- `content/docs/**/*.md` stores repo-backed canonical docs with frontmatter (`title`, `slug`, `category`, `order`, `public`). Repo docs are merged with DB docs in the public/admin docs UI.
- Repo docs own their slugs. DB docs with a slug collision are hidden from public docs and cannot be saved until the slug changes.
- Owners are stored both as `documents.owner_id` and as an owner row in `document_permissions`.
- `/api/health` uses `select 1` and does not require any application tables.
- Wiki-link metadata is derived from document Markdown at read time. Resolved wiki maps include headings, Obsidian-style block anchors (`^block-id`), and hidden Vault regions (`<!-- vault-region id="..." -->`), so links and embeds can target a specific heading, block, or region without schema changes. Vault regions marked `foldable` render as collapsible disclosure blocks; `collapsed` makes them initially closed.
- Wiki links support explicit namespaces: `doc:<uuid>` for readable app documents, `guide:<slug>` for official documentation pages, and `public:<slug>` for published user documents. The authenticated completion API merges readable documents, official guides, and published documents; public-document suggestions show the publisher username.
```

---

## 6. Auth Implementation

Current auth status:

```txt
Implemented structurally; real GitHub/Google login still requires OAuth credentials in `.env.local`.
```

Provider(s):

```txt
GitHub
Google
```

Important files:

| Path | Purpose |
|---|---|
| `auth.ts` | Auth.js config, provider, adapter, session callback |
| `app/api/auth/[...nextauth]/route.ts` | GET/POST route handlers |
| `app/login/page.tsx` | Sign-in UI and GitHub/Google sign-in actions |
| `app/banned/page.tsx` | Active-ban landing page for signed-in banned users |
| `server/dev-auth.ts` | Dev-only local sign-in action |
| `server/authz.ts` | Shared active-user/admin gates backed by the current database row |
| `app/dashboard/page.tsx` | Protected route and sign-out action |
| `types/next-auth.d.ts` | Adds `session.user.id` to TypeScript session type |

Session shape:

```ts
session.user.id: string
session.user.email?: string | null
session.user.name?: string | null
session.user.image?: string | null
```

Known auth caveats:

```txt
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, and `NEXTAUTH_URL` must be set in `.env.local` before all real sign-in providers will work.
- GitHub OAuth app callback for local dev must be `http://localhost:3000/api/auth/callback/github`.
- Google OAuth app callback for local dev must be `http://localhost:3000/api/auth/callback/google`.
- The provider config uses placeholder fallback strings only so builds succeed before secrets are configured; those are not valid credentials.
- Provider-account linking is conservative; do not enable automatic cross-provider email linking without a security review.
- `/dashboard/settings` shows connected OAuth providers and lets an already signed-in user connect a missing provider. This uses Auth.js' safe link path, where the OAuth account is linked to the current authenticated `users.id`.
- If a signed-out user tries an unlinked OAuth provider with an email already used by another provider, Auth.js redirects to `/login?error=OAuthAccountNotLinked`; the login page explains that the user should sign in with the original provider and connect the new provider from settings.
- `auth.ts` uses a development-only fallback `AUTH_SECRET` so logged-out auth routes can run locally before `.env.local` exists. Production must provide a real `AUTH_SECRET`.
- In non-production, `/login` shows dev-only database-session login buttons for `dev.owner@vault.local` and `dev.collaborator@vault.local`; set `ENABLE_DEV_LOGIN=false` to hide them.
- After login, users without `profile_completed_at`, `username`, or nickname are redirected to `/onboarding`.
- `/dashboard/settings` lets users change nickname and username. Username availability is checked through `/api/users/username-availability`, rechecked by `updateProfileAction()`, and finally enforced by the database unique constraint.
- `requireActiveUser()` reads the current `users` row and redirects active bans to `/banned`; document, friend, profile, and official-doc mutations use this gate or `requireAdmin()`.
- `requireAdmin()` reads `users.role` from the database on each request. Admin role changes do not depend on session refresh.
- Admins cannot ban themselves or demote their own account through the admin UI actions.
- `/login` states that signing in accepts the Terms and Conditions and links to `/terms`, which renders `content/legal/terms.md`.
```

Manual auth tests performed:

| Test | Result | Date |
|---|---|---|
| Logged-out `/dashboard` redirects to `/login` | Passed | 2026-05-26 |
| `/login` renders | Passed | 2026-05-26 |
| `/api/auth/session` returns `null` when logged out | Passed | 2026-05-26 |
| Auth tables exist after migration | Passed | 2026-05-26 |
| Dev login creates normal database session | Pending manual browser check | 2026-05-31 |

---

## 7. Permission Model Implementation

Current permission status:

```txt
Implemented for document read/edit/share/delete/publish checks.
```

Roles currently supported:

```txt
owner
editor
viewer
```

Important files:

| Path | Purpose |
|---|---|
| `lib/permissions.ts` | Permission helpers, once created |

Current permission helpers:

```txt
getDocumentAccess(userId, documentId)
canReadDocument(userId, documentId)
canEditDocument(userId, documentId)
canShareDocument(userId, documentId)
canDeleteDocument(userId, documentId)
canPublishDocument(userId, documentId)
```

Rules currently enforced:

| Rule | Enforced? | Where |
|---|---:|---|
| Owner can read own document | Yes | `lib/permissions.ts`, `server/documents.ts` |
| Owner can edit own document | Yes | `lib/permissions.ts`, `server/documents.ts` |
| Editor can edit shared document | Yes | `lib/permissions.ts`, `server/documents.ts` |
| Viewer can only read shared document | Yes | `lib/permissions.ts`, document route renders read-only |
| Unauthorized users cannot read private docs | Yes | `getDocumentForUser()` returns null and route calls `notFound()` |
| Only owner can share | Yes | `shareDocumentAction()`, role update/remove actions |
| Only owner can publish | Yes | `publishDocumentAction()`, `unpublishDocumentAction()` |

Known permission caveats:

```txt
-
```

Manual permission tests performed:

| Test | Result | Date |
|---|---|---|
|  |  |  |

---

## 8. Document System

Current document status:

```txt
Basic private document CRUD, sharing, and public publishing are implemented.
```

Document storage format:

```txt
Markdown text in `documents.markdown`
```

Important files:

| Path | Purpose |
|---|---|
| `db/schema.ts` | `documents` and `document_permissions` tables |
| `server/documents.ts` | Create, update, archive, history, sharing, list, and fetch document functions |
| `app/dashboard/page.tsx` | Owned document list and create form |
| `app/docs/[docId]/page.tsx` | Protected editor/viewer route |
| `lib/markdown.ts` | Shared Markdown limits |

Current document actions:

```txt
createDocumentAction()
saveMarkdownDocumentAction()
saveDocumentTitleAction()
createManualDocumentVersionAction()
restoreDocumentVersionAction()
archiveDocumentAction()
shareDocumentAction()
shareDocumentWithFriendAction()
updateCollaboratorRoleAction()
removeCollaboratorAction()
publishDocumentAction()
unpublishDocumentAction()
listDocumentsForUser()
listSharedDocumentsForUser()
listPublicDocuments()
listDocumentVersionsForUser()
getDocumentForUser()
getPublicDocumentBySlug()
```

History behavior:

```txt
- Automatic history stores the previous document state before an overwrite.
- Normal saves and title saves create batched `reason = auto` checkpoints.
- Collaboration persistence creates batched `reason = collab` checkpoints.
- Users with edit access can create manual restore points from the document action panel.
- Restoring a version creates `reason = before_restore` first, then writes the selected title/Markdown back to `documents`.
- Archiving creates `reason = before_archive` before soft delete.
- The document page lists only recent checkpoint metadata/previews; restore loads the full Markdown server-side by version id.
```

Sharing behavior:

```txt
- `shareDocumentAction()` accepts the reusable smart user search field: selected suggestions submit `users.id`, while manual entry falls back to exact username or email lookup.
- Sharing still checks `canShareDocument()` server-side and stores collaborator relationships by `users.id`, not username/email.
- The document page action rail is collapsible on desktop editable/viewable document pages. When collapsed on desktop, the editor workspace recenters and a compact reopen button remains available. On mobile, the same actions render in a modal dialog opened from the top of the editor area instead of appearing below the editor.
```

Current routes:

| Route | Status | Purpose |
|---|---|---|
| `/` | Implemented | Public homepage/app shell |
| `/login` | Implemented | GitHub/Google OAuth sign-in |
| `/api/auth/[...nextauth]` | Implemented | Auth.js handlers |
| `/api/health` | Implemented | App and database health check |
| `/healthz` | Implemented | App-only lightweight health check |
| `/dashboard` | Protected placeholder | Server-side auth guard redirects logged-out users to `/login` |
| `/dashboard/friends` | Implemented | Friend request and friend list page |
| `/dashboard/settings` | Implemented | Account/settings page |
| `/docs/[docId]` | Implemented | Protected document editor/viewer |
| `/public/[slug]` | Implemented | Public read-only document page |

Known document caveats:

```txt
-
```

---

## 9. Editor Implementation

Current editor status:

```txt
Markdown editor implemented with CodeMirror, debounced autosave, manual save, toolbar syntax insertion, source/split/preview modes, and production-confirmed Y.Text collaboration.
```

Editor library:

```txt
CodeMirror 6 through `@uiw/react-codemirror`
```

Important files:

| Path | Purpose |
|---|---|
| `app/docs/[docId]/page.tsx` | Protected editor/viewer route |
| `components/markdown/MarkdownEditor.tsx` | Editable Markdown document component |
| `components/markdown/MarkdownToolbar.tsx` | Markdown syntax toolbar |
| `components/markdown/MarkdownDocument.tsx` | Read-only renderer for viewer/public pages |
| `lib/markdown.ts` | Shared Markdown limits |
| `lib/wiki-links.ts` | Obsidian-style wiki-link parsing/rendering helpers |

Supported editor features:

| Feature | Supported? |
|---|---:|
| Paragraph | Yes |
| Heading | Yes |
| Bold | Yes |
| Italic | Yes |
| Bullet list | Yes |
| Ordered list | Yes |
| Code block | Yes |
| Blockquote | Yes |
| Link | Partial |
| Wiki document links | Preview/view/public rendering slice |
| External image wiki embeds | Yes, `![[https://...]]` in renderer |
| Obsidian-style callouts | Yes |
| Read-only mode | Yes |
| Save status | Saved/saving/unsaved/error status |
| Autosave | Yes |
| Source/live/split/preview modes | Yes |

Known editor caveats:

```txt
- Autosave is debounced and writes through the same server-side permission checks as manual save.
- Markdown toolbar buttons insert syntax into CodeMirror source, not rich-text nodes.
- Inline toolbar buttons now toggle matching Markdown syntax off when the selected text is already wrapped.
- Bold, italic, inline-code, and link toolbar actions are object-aware: if the cursor or partial selection is inside an existing formatted Markdown object, the whole object is unwrapped; with no selection on plain text, the current word is wrapped.
- New italic formatting uses underscores so it does not collide with bold double-asterisk markers.
- Heading/list/blockquote toolbar buttons now remove or replace existing line prefixes instead of blindly stacking prefixes. Ordered-list insertion computes visible source numbers from the previous ordered item instead of always inserting `1. `.
- CodeMirror owns common formatting shortcuts in the Markdown editor: `Mod-B` bold, `Mod-I` italic, `Mod-E` inline code, `Mod-K` link, `Mod-Alt-1/2/3` headings, `Mod-Shift-8` bullet list, `Mod-Shift-7` ordered list, `Mod-Shift-9` blockquote, and `Mod-Alt-C` code fence. Toolbar button `title` text includes the matching shortcut when one exists.
- CodeMirror autocomplete is a direct dependency. `Tab` accepts the active autocomplete option before falling back to indentation behavior.
- Live mode keeps CodeMirror active and uses decorations to hide/style inactive Markdown syntax. Inline marks reveal source when the cursor is inside that object; structural blocks reveal the relevant line/block. Hidden Markdown markers use CodeMirror replacement decorations, inactive inline/block HTML renders as sanitized preview widgets, and live-mode syntax-highlight spans are neutralized so heading hash markers do not resize or overlap while typing. Inline live HTML currently covers `a`, `abbr`, `b`, `cite`, `code`, `data`, `del`, `em`, `i`, `ins`, `kbd`, `mark`, `q`, `s`, `samp`, `small`, `span`, `strong`, `sub`, `sup`, `time`, `u`, and `var`.
- Live mode suppresses source reveal while the user is mouse-dragging a text selection, and rendered live widgets are non-selectable/non-interactive so drag selection stays owned by CodeMirror instead of rendered previews jittering between source and render.
- Live mode protects inline code spans before applying bold/italic/link decorations, so Markdown inside backticks stays code instead of receiving nested preview styling. Code fence lines are also excluded from inline styling.
- CodeMirror autocomplete/tooltips are styled with Vault theme tokens in both the editor theme and global editor CSS so HTML completion popups match the dark-first UI. HTML tag completion is explicitly registered alongside Vault's custom wiki-link completion so it works in editable Source, Split, and Live modes.
- Preview/view/public Markdown rendering supports Obsidian-style wiki links through server-provided resolution maps. Canonical links use `[[doc:<uuid>|Label]]`; convenience title links like `[[Title]]` resolve only when exactly one readable document has that title. Heading fragments such as `[[doc:<uuid>#heading|Label]]`, `[[doc:<uuid>|Label#heading]]`, and `[[Title#heading]]` append rendered heading anchors to resolved document routes. Title-based heading links use the last `#` as the heading separator; document titles are not currently restricted from containing `#`, so canonical `doc:id` links are preferred when a title could be ambiguous. Ambiguous/private/unresolved links render as non-clickable styled spans. Public rendering only resolves links to `/public/[slug]` and does not expose private document IDs/routes.
- CodeMirror wiki autocomplete fetches the current readable document map from `/api/documents/wiki-links` when completion starts in either `[[...]]` links or `![[...]]` document embeds, and inserts canonical `doc:id|title` targets. Arrow keys navigate suggestions, Tab/Enter accept, Escape closes the popup, and mouse selection applies the completion. The completion is bracket-aware and fills inside an existing auto-paired `[[|]]` field without adding duplicate closing brackets; when it has to insert closing brackets itself, it leaves the cursor before `]]` so the user can keep typing a heading fragment. Typing `#` inside a wiki field explicitly starts heading autocomplete, including after an accepted canonical `doc:id|title` completion. Heading completion filters and replaces only the text after `#`, so UUID-backed canonical links still show heading suggestions. Live mode hides inactive wiki-link markers and styles the visible label; placing the cursor inside the link reveals source.
- External image wiki embeds use `![[https://...]]`; Preview/view/public translate them to standard Markdown image rendering before the sanitized Markdown pipeline, and live mode renders inactive embeds as stable image preview frames.
- Standalone document transclusions use `![[doc:id|label]]` or unambiguous `![[Title]]` syntax. Preview/view/public split those lines into recursive `MarkdownDocument` embeds styled with `.vault-md-document-embed`; Live mode replaces the single source line with a React-backed CodeMirror widget that reuses `MarkdownDocument`. Heading fragments on document embeds render only the selected heading's owned section, from that heading until the next heading of equal or higher level. Embeds are permission-aware, public pages only include public document Markdown, and recursive embeds are capped.
- Markdown image rendering uses a stable responsive frame so slow or broken image loads do not repeatedly change document layout height.
- Document titles are intentionally not unique; document identity remains `documents.id`, and public route identity remains `public_slug`.
- Raw HTML in read-only/public rendering is parsed through `rehype-raw` and sanitized with an explicit `rehype-sanitize` allowlist. Scripts, event handlers, forms, unsafe URL protocols, and unsafe CSS values are not allowed; a constrained inline `style` allowlist supports common presentation styles. HTML inside fenced code blocks still displays as code.
- Iframes are allowed only for explicit HTTPS embed sources in `MarkdownDocument`: YouTube/YouTube nocookie, Spotify, TIDAL, Vimeo, SoundCloud, Apple Music, and Bandcamp. The renderer normalizes iframe `sandbox`, `allow`, `allowFullScreen`, `loading`, and `referrerPolicy` attributes instead of trusting arbitrary author-provided iframe permissions. Self-closing iframe syntax is normalized to a closing-tag iframe before Markdown HTML parsing.
- `MarkdownDocument` renders Obsidian-style blockquote callouts from `> [!type] Title` or tight `>[!type] Title` syntax. Supported default types/aliases follow Obsidian's documented set: note, abstract/summary/tldr, info, todo, tip/hint/important, success/check/done, question/help/faq, warning/caution/attention, failure/fail/missing, danger/error, bug, example, quote/cite. Fold markers `+` and `-` render as open/collapsed details.
- Rendered callouts expose `.callout`, `.callout-title`, `.callout-icon`, `.callout-content`, `data-callout`, `data-callout-resolved`, and CSS variables such as `--callout-color` and `--callout-icon` so future snippet support can override default styles.
- Rendered callouts preserve normal Markdown inline rendering in the body, including links, bold, italic, and code, even when the body starts in the same blockquote paragraph as the `[!type] Title` marker.
- Live callouts intentionally stay source-preserving instead of replacing multi-line source with a rendered widget. Inactive callout lines are styled as one continuous block, the callout marker becomes an icon on the title line, body lines receive an equal-width spacer so title/body text align, trailing quote-only continuation lines are excluded from the rendered callout block, and the full source is revealed when the cursor enters the callout block.
- Live callout lines also expose `.callout`, `data-callout`, `data-callout-resolved`, and `data-callout-fold` when present, so callout CSS variables from future snippets can affect Preview and Live mode. Live mode uses a stronger CodeMirror translation layer plus classes such as `.vault-cm-callout-first`, `.vault-cm-callout-body-line`, and `.vault-cm-callout-marker` so generic `.callout` snippet/card styling does not turn each editor line into a separate card.
- Live preview allows the same iframe block tags and applies the same source allowlist plus normalized iframe permissions before rendering the inactive block preview.
- Live preview renders inline HTML and single-line sanitized raw HTML blocks. Multi-line raw HTML intentionally remains source in live mode for now because CodeMirror plugin decorations cannot cleanly replace/collapse multi-line blocks; full Preview/Split still render multi-line HTML through the sanitized Markdown pipeline. Code fences remain source/code preview, not rendered HTML.
- GFM task-list checkboxes render without bullet markers and use custom theme-token checkbox styling instead of default browser controls. Live mode replaces inactive `- [ ]` / `- [x]` markers with the same styled checkbox widget.
- `MarkdownDocument` emits stable `.vault-md-*` classes for future document themes and user CSS snippets.
- Mobile document editing uses an edge-to-edge editor surface, separate padding for title/status controls, horizontally scrollable mode/format controls, and `.vault-markdown-editor` CodeMirror overrides. The mobile fold gutter is hidden and the line-number gutter is constrained so the writing area stays wide on phone screens.
- Document edit pages use a wider responsive workspace (`max-w-[1720px]`) with a collapsible desktop side rail. When the rail is open, the editor shifts left to leave room for visibility/sharing controls; when collapsed, the editor recenters to reduce distractions. On mobile, visibility/sharing controls open in a modal so they do not sit below the editor or affect editor width.
- User has confirmed Markdown editing works in production.
- Uploaded document assets are not implemented yet. Future uploaded assets should use document-owned metadata and permission-checked serving, not raw public storage URLs.
```

---

## 10. Collaboration Implementation

Current collaboration status:

```txt
Markdown collaboration is deployed and user-confirmed working. Owner/editor sessions receive signed Hocuspocus room tokens, CodeMirror binds to `Y.Text`, and the collab service persists text to `documents.markdown`.
```

Important files:

| Path | Purpose |
|---|---|
| `scripts/collab-server.mjs` | Hocuspocus websocket service |
| `lib/collab-token.ts` | Signed room token helper |
| `components/markdown/MarkdownEditor.tsx` | Creates Hocuspocus provider and CodeMirror/Yjs binding |
| `Dockerfile.collab` | Production collab service image |
| `docker-compose.production.yml` | Adds `collab` service on `127.0.0.1:18211` |

Current behavior:

```txt
- Only owner/editor document sessions receive a collaboration token.
- Token includes document id, user id, role, display identity, expiry, and HMAC signature.
- Collab service validates the token and re-checks current database edit permission before room access.
- Hocuspocus loads existing `documents.markdown` into a `Y.Text` named `markdown`.
- Hocuspocus stores collaborative document state back to `documents.markdown`.
- Before collaborative persistence overwrites Markdown, the collab service uses the same batched checkpoint policy and writes `document_versions.reason = 'collab'` when a checkpoint is due.
- The Markdown editor starts in normal local-autosave mode and only attaches the CodeMirror/Yjs binding after the Hocuspocus provider reports sync. This prevents a blank editor, lost body saves when `ws://localhost:1234` is unavailable, and duplicate full-document inserts from binding local text into an unsynced empty `Y.Text`.
- In collaborative mode, CodeMirror state should be updated through the `y-codemirror.next` binding and the editor `onChange` callback. Do not add a separate `Y.Text.observe()` path that calls `setMarkdownValue()`: `@uiw/react-codemirror` treats `value` prop changes as external document replacements, and those replacements can be echoed back into `Y.Text` as local edits.
- In collaborative mode, CodeMirror receives a one-time initial Markdown value after the first provider sync for that session, then Yjs owns further document updates. Do not bind the `value` prop directly to `Y.Text.toString()` across renders or refresh the initial value on every reconnect/sync event; that can re-present full-document text to CodeMirror while `yCollab` is also applying Yjs updates.
- When switching from full Preview back to Source/Live/Split in collaborative mode, CodeMirror is remounted with the current `Y.Text` snapshot as its mount seed. This prevents the editor from showing the first synced body while Preview still shows the latest React/Yjs markdown state.
- Do not add server-side "deduplication" logic that rewrites repeated document bodies. Repeated content can be intentional user content, so duplication prevention must happen at the collaboration/source-of-truth boundary rather than by guessing after the fact.
- After collaboration is synced, the normal server action saves title changes only so it does not overwrite the live Yjs body.
- Viewer/public routes remain read-only and do not connect to the collaboration service.
```

Known collaboration caveats:

```txt
- If Firefox reports `ws://localhost:1234` connection refused, the local collab server is not running or failed to start. Run `npm run collab` in a separate terminal.
- Title editing is still saved through the normal document autosave path, not collaborative Yjs state.
- Yjs update-history tables are not implemented; current persistence stores compact Markdown text.
```

---

## 11. Friend System

Current friend system status:

```txt
Implemented with profile search suggestions, accept/reject, friend list, remove friend, and friend-aware document sharing.
```

Important files:

| Path | Purpose |
|---|---|
| `db/schema.ts` | `friend_requests` and `friendships` tables |
| `server/friends.ts` | Friend request and friendship actions/queries |
| `app/dashboard/friends/page.tsx` | Friend management UI |

Current friend actions:

```txt
sendFriendRequestAction()
acceptFriendRequestAction()
rejectFriendRequestAction()
removeFriendAction()
listFriendPageData()
listFriendsForUser()
```

Known friend system caveats:

```txt
- Friend and document sharing search matches nickname, username, and email through `/api/users/search`.
- User-search inputs suppress browser autofill/autocomplete (`new-password`, no autocorrect/capitalize/spellcheck) so Firefox/Chrome contact suggestions do not cover Vault's custom suggestion popover.
- Manual friend request and document sharing submit fall back to exact username/email when no suggestion is selected.
- Friend-based document sharing verifies friendship server-side before granting access.
```

---

## 12. Public Notes

Current public notes status:

```txt
Implemented for owner-published documents.
```

Public route:

```txt
/public/[slug]
```

Current behavior:

```txt
- Owner can publish/unpublish a document from the document page.
- Publishing generates a stable `public_slug` if one does not already exist.
- Unpublishing keeps the slug reserved and sets visibility back to private.
- `/public/[slug]` selects title/content/updated_at plus owner nickname/username/avatar for public, non-deleted documents.
- The dashboard Public Notes tab lists all published documents globally, not only the current user's own published documents.
- Public Notes cards link to `/public/[slug]` and show owner nickname/username only, not owner email.
- Published note pages credit the owner under the title with nickname/name, username when available, avatar/fallback, and update date.
- Published note pages emit per-document OpenGraph/Twitter metadata with title, Markdown-derived snippet, owner author metadata, canonical URL, and a generated rendered-document preview image at `/public/[slug]/og`.
- Published note pages use very tight mobile gutters and a `vault-public-markdown` class with narrower mobile list/callout/blockquote spacing so public docs do not feel squeezed on phones.
- Public documents show a badge in dashboard/editor views.
- Published documents expose a copy-link button in the editor.
```

Known public note caveats:

```txt
-
```

---

## 13. Admin and Official Docs

Current admin/docs status:

```txt
Implemented as a first vertical slice with DB-backed admin checks, user moderation, and manual official docs publishing.
```

Admin routes:

```txt
/dashboard/admin
/dashboard/admin/docs
/dashboard/admin/docs/[docId]
```

Public official docs routes:

```txt
/docs
/docs/guides/[slug]
```

Important files:

| Path | Purpose |
|---|---|
| `server/authz.ts` | `requireActiveUser()`, `requireAdmin()`, active ban detection |
| `server/admin.ts` | Admin user list/search, role changes, ban/unban actions |
| `server/official-docs.ts` | Official docs list/read/create/save actions |
| `app/dashboard/admin/page.tsx` | User moderation UI |
| `app/dashboard/admin/docs/page.tsx` | Official docs admin list/create UI |
| `app/dashboard/admin/docs/[docId]/page.tsx` | Official docs manual editor route |
| `components/markdown/OfficialDocEditor.tsx` | Manual-save Markdown editor for official docs |
| `app/banned/page.tsx` | Active-ban explanation page |
| `app/docs/page.tsx` | Public official docs index |
| `app/docs/guides/[slug]/page.tsx` | Public official guide renderer |

Current moderation behavior:

```txt
- Admin role lives in `users.role`.
- Active bans are rows with `banned_at` and either no `banned_until` or a future `banned_until`.
- `requireActiveUser()` redirects active bans to `/banned`.
- `requireAdmin()` checks `users.role = 'admin'` from the database.
- Document, friend, profile, admin, and official-doc mutations use active-user/admin gates.
- Admins cannot ban themselves or demote themselves.
```

Current official docs behavior:

```txt
- Official docs are separate from collaborative user documents.
- Repo-backed docs live under `content/docs/**/*.md`, are canonical, and appear read-only in `/dashboard/admin/docs`.
- DB-backed docs live in `official_docs`, are editable from `/dashboard/admin/docs/[docId]`, and are useful for quick admin-authored pages.
- Admin editor uses CodeMirror with manual save, source/split/preview modes, and HTML tag autocomplete.
- Admin editor exposes category and sort order metadata.
- No Yjs collaboration token or room is created for official docs.
- Public official docs render repo docs plus DB docs with `status = 'published'`.
- `/docs` and `/docs/guides/[slug]` use a documentation-site layout with a left sidebar grouped by category.
- `/docs` and `/docs/guides/[slug]` are dynamic DB-backed routes so production builds do not require the target DB schema to exist at build time.
- Repo doc slugs win collisions. DB docs that collide with repo slugs are hidden publicly and blocked from saving until their slug changes.
```

Known admin/docs caveats:

```txt
- There is no seeded first admin yet; set `users.role = 'admin'` manually for the first trusted account after migration.
- There is no audit log table yet for moderation actions.
- Initial repo docs exist for Markdown basics, wiki links/embeds, callouts, CSS snippets, safe HTML/embeds, and sharing/permissions.
```

---

## 14. Deployment Knowledge

Current deployment status:

```txt
GitHub Actions deploy workflow works on the mini-PC runner and runs the repo `scripts/deploy.sh` after resetting `/opt/apps/vault/repo` to `origin/master`.
```

Production domain:

```txt
https://vault.ems-place.com
```

Current services:

| Service | Location | Port | Status |
|---|---|---:|---|
| `vault-web` | local dev / mini-PC Docker | 3000 in container, `127.0.0.1:18210` host bind | Runs with `npm run dev`; production image builds |
| `vault-postgres` | local Docker / mini-PC Docker | 5432 internal | Created for local dev and production compose |
| `vault-migrate` | mini-PC Docker | n/a | Production compose profile for `npm run db:migrate` |
| `vault-collab` | mini-PC Docker | 1234 in container, `127.0.0.1:18211` host bind | Hocuspocus/Yjs websocket service |
| `vault-redis` | mini-PC Docker | 6379 | Post-MVP |

FRP mapping:

```txt
Not configured yet
```

Caddy route:

```caddy
# Not configured yet
```

Cloudflare DNS:

```txt
Not configured yet
```

Migration command:

```bash
docker compose -f docker-compose.production.yml --profile migrate run --rm migrate
```

Backup command:

```bash
bash scripts/backup-db.sh
```

Windows local backup command:

```powershell
$env:COMPOSE_FILE="docker-compose.yml"
$env:POSTGRES_SERVICE_NAME="postgres"
.\scripts\backup-db.ps1
```

Known deployment caveats:

```txt
- `.env.production` is intentionally not committed. Create it on the deployment host.
- `.github/workflows/deploy.yml` calls `/opt/apps/vault/repo/scripts/deploy.sh`; because the workflow resets the repo to `origin/master`, that script must stay committed.
- The deploy script explicitly builds `web`, `collab`, and the profile-gated `migrate` image, then runs migrations with `--build` before starting `web`. This is required because profile-gated services may otherwise use stale images missing new migration files.
- Bash backup scripts need Docker available in the shell environment. On this Windows machine, WSL Bash could not see Docker Desktop; the PowerShell backup script works locally.
```

---

## 15. Testing / Verification

Current test setup:

```txt
No automated tests yet; lint and production build are configured.
```

Manual checks:

| Area | Check | Status | Date |
|---|---|---|---|
| Build | `npm run build` succeeds | Passed | 2026-05-26 |
| Lint | `npm run lint` succeeds | Passed | 2026-05-26 |
| Health | `/api/health` returns OK with database `ok` | Passed | 2026-05-26 |
| Auth | Logged-out `/dashboard` redirects to `/login` | Passed | 2026-05-26 |
| Auth | `/api/auth/providers` returns GitHub provider | Passed | 2026-05-26 |
| Auth | GitHub login works with real OAuth credentials | Not tested |  |
| Documents | Document tables migrated locally | Passed | 2026-05-26 |
| Documents | Create/edit/save/reopen document through browser | Passed | 2026-05-26 |
| Permissions | Logged-out dashboard blocked | Passed | 2026-05-26 |
| Permissions | Unauthorized user blocked from another private doc | Passed | 2026-05-26 |
| Public notes | Public slug works logged out | Passed | 2026-05-26 |
| Public notes | Unknown public slug returns 404 | Passed | 2026-05-26 |
| Public notes | Public badge/copy-link UI builds | Passed | 2026-05-26 |
| Public notes | Dashboard public tab uses global published-document query | Passed | 2026-06-02 |
| Friends | Friend tables migrated locally | Passed | 2026-05-26 |
| Friends | Logged-out `/dashboard/friends` redirects to `/login` | Passed | 2026-05-26 |
| Dashboard | Sidebar items are real anchors/routes, not noop labels | Passed | 2026-05-26 |
| Settings | `/dashboard/settings` loads for signed-in user | Passed | 2026-05-26 |
| Deployment | `docker compose -f docker-compose.production.yml config` validates with placeholder `POSTGRES_PASSWORD` | Passed | 2026-05-26 |
| Deployment | `docker build --target runner -t vault:test .` succeeds | Passed | 2026-05-26 |
| Backups | `scripts/backup-db.ps1` creates a local Postgres dump | Passed | 2026-05-26 |
| Editor | Autosave implementation builds and lints | Passed | 2026-05-31 |
| Deployment | Production domain loads | Passed, user-reported | 2026-05-31 |
| Deployment | GitHub Actions deploy workflow runs on server | Passed, user-reported | 2026-05-31 |
| Deployment | Postgres persists across redeploy | Passed, user-reported | 2026-05-31 |
| Auth | Production GitHub OAuth works | Passed, user-reported | 2026-05-31 |
| Auth | Google login provider renders/builds | Passed | 2026-06-02 |
| Auth | Connected-account Settings UI builds | Passed | 2026-06-02 |
| Documents | Production document create/edit works | Passed, user-reported | 2026-05-31 |
| Collaboration | `npm run build` succeeds with collaboration code | Passed | 2026-05-31 |
| Collaboration | `npm run lint` succeeds with collaboration code | Passed | 2026-05-31 |
| Collaboration | `node --check scripts/collab-server.mjs` succeeds | Passed | 2026-05-31 |
| Collaboration | `node scripts/collab-server.mjs` starts locally with env values | Passed | 2026-05-31 |
| Collaboration | Two-browser/two-user live editing | Passed, user-reported | 2026-06-04 |
| Markdown pivot | `documents.markdown` migration applied locally | Passed | 2026-06-01 |
| Markdown pivot | `npm run lint` succeeds with Markdown editor/renderer | Passed | 2026-06-01 |
| Markdown pivot | `npm run build` succeeds with Markdown editor/renderer | Passed | 2026-06-01 |
| Markdown pivot | Browser check for create/edit/reopen/source/split/preview | Passed, user-reported | 2026-06-04 |
| Mobile UI | `npm run lint` and `npm run build` succeed after mobile editor layout pass | Passed | 2026-06-01 |
| Mobile UI | `npm run lint` and `npm run build` succeed after edge-to-edge editor/gutter pass | Passed | 2026-06-02 |
| Profile | `users.profile_completed_at` migration applied locally | Passed | 2026-06-01 |
| Profile | Settings username/nickname update builds and lints | Passed | 2026-06-01 |
| Markdown collaboration | `node --check scripts/collab-server.mjs` succeeds after Y.Text migration | Passed | 2026-06-01 |
| Markdown collaboration | `npm run build` succeeds with CodeMirror/Yjs binding | Passed | 2026-06-01 |
| Markdown collaboration | Two-browser owner/editor live Markdown editing | Passed, user-reported | 2026-06-04 |
| Legacy cleanup | `npm run db:migrate` applies `0005_high_captain_midlands.sql` locally | Passed | 2026-06-04 |
| Document history | `npm run db:migrate` applies `0006_chilly_quasimodo.sql` locally | Passed | 2026-06-04 |
| Admin/docs schema | `npm run db:generate` creates `0007_special_morbius.sql` | Passed | 2026-06-06 |
| Admin/docs implementation | `npm run lint` succeeds | Passed | 2026-06-06 |
| Admin/docs implementation | `npm run build` succeeds | Passed | 2026-06-06 |
| Official docs metadata | `npm run db:generate` creates `0008_overrated_radioactive_man.sql` | Passed | 2026-06-06 |
| Official docs layout | `npm run lint` succeeds | Passed | 2026-06-06 |
| Official docs layout | `npm run build` succeeds | Passed | 2026-06-06 |
| Hybrid official docs | `npm run lint` succeeds after repo-doc merge and terms route | Passed | 2026-06-06 |
| Hybrid official docs | `npm run build` succeeds after repo-doc merge and terms route | Passed | 2026-06-06 |

---

## 16. Known Bugs / Issues

| Status | Issue | Impact | Notes |
|---|---|---|---|
|  |  |  |  |

---

## 17. Important Decisions Made

| Date | Decision | Reason | Files affected |
|---|---|---|---|
| 2026-05-26 | Use Next.js App Router | One deployable full-stack app | `app/`, `package.json` |
| 2026-05-26 | Use Postgres | Reliable self-hosted relational storage | `docker-compose.yml`, `.env.example` |
| 2026-05-26 | Use Drizzle with an empty schema placeholder for Phase 0 | Avoid fake tables before the first real auth/document migration | `db/index.ts`, `db/schema.ts`, `drizzle.config.ts` |
| 2026-05-26 | Keep UI dark-first with switchable themes | User prefers dark mode now, with room for additional themes later | `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `app/layout.tsx`, `app/page.tsx`, `app/dashboard/page.tsx` |
| 2026-05-26 | Use database sessions with Auth.js | Server-side permission checks need stable `session.user.id` from Postgres-backed users | `auth.ts`, `db/schema.ts` |
| 2026-05-26 | Delay Yjs until post-MVP | Prevent complexity before permissions work | docs |

---

## 18. Things Future Agents Should Not Break

Add invariants here as they emerge.

Current invariants:

```txt
- Document access must be checked server-side.
- Private documents must not be exposed through public routes.
- Real-time collaboration should not be added before core auth/document permissions are stable.
- Secrets must not be committed.
- Admin-only routes/actions must use `requireAdmin()` and must not rely on client-hidden UI controls.
- Active bans must be enforced server-side through `requireActiveUser()` or stronger guards on protected mutations.
- New UI should use theme tokens (`background`, `foreground`, `card`, `border`, `muted`) rather than hard-coded one-off colors unless there is a deliberate design reason.
```

---

## 19. Next Best Tasks

Keep this short and current.

```txt
1. Run migrations through `0008_overrated_radioactive_man.sql` and promote the first trusted account with `update users set role = 'admin' where email = '<email>';`.
2. Browser-test `/dashboard/admin`, ban/unban behavior, and `/banned` with disposable accounts.
3. Browser-test `/docs`, `/docs/guides/markdown-basics`, `/terms`, and `/dashboard/admin/docs` after deployment.
4. Consider adding moderation audit logs before expanding admin tools further.
```

---

## 20. Changelog

Use this as a compact implementation log.

| Date | Change | Notes |
|---|---|---|
| 2026-05-26 | Bootstrapped Next.js app shell | Added TypeScript, Tailwind, shadcn/ui, homepage, dashboard placeholder, health route, Docker Postgres, Drizzle config, env example |
| 2026-05-26 | Initialized local Git repository | Remote GitHub repo still needs to be created separately |
| 2026-05-26 | Added dark-first switchable theming | Added `next-themes`, root provider, theme toggle, and converted current pages to theme tokens |
| 2026-05-26 | Removed temporary scaffold issue | User deleted `vault-scaffold/`; known issue cleared |
| 2026-05-26 | Added Auth.js foundation | Added NextAuth v5 beta, Drizzle adapter, auth tables/migration, login page, protected dashboard, sign-out action, and session typing |
| 2026-05-26 | Added basic private document persistence | Added document schema/migration, permission helpers, document server actions, dashboard document list/create, and protected document edit route |
| 2026-05-26 | Added Tiptap editor and read-only renderer | Replaced textarea with Tiptap, toolbar, JSON save, viewer/public renderer, and editor styling |
| 2026-05-26 | Added basic document sharing | Added owner-only share by email, role update/remove, collaborator list, and shared-with-me dashboard list |
| 2026-05-26 | Added public document publishing | Added publish/unpublish actions, stable public slugs, and `/public/[slug]` read-only route |
| 2026-05-26 | Added friend system | Added friend request/friendship schema, server actions, protected friends dashboard page, accept/reject/remove flows |
| 2026-05-26 | Integrated friends into sharing | Added friend selector for document sharing and server-side friendship verification before granting access |
| 2026-05-26 | Added production deployment scaffolding | Added Dockerfile, production compose, migration profile, README deployment notes, and backup/restore scripts |
| 2026-05-26 | Verified Windows backup path | PowerShell backup script created a local Postgres dump; Bash script needs Docker-visible shell environment |
| 2026-05-26 | Added public-note and route polish | Added public badges, copy-public-link button, global loading state, not-found page, and error page |
| 2026-05-26 | Removed dashboard noop controls | Sidebar labels are now anchors/routes, Public Notes has real data, and Settings is a real protected page |
| 2026-05-31 | Added editor autosave and portfolio docs polish | Debounced autosave uses server-side permission checks; README now documents architecture, security, deployment, and resume positioning |
| 2026-05-31 | Clarified healthcheck split | Docker healthcheck uses `/healthz` for liveness; `/api/health` remains the database readiness endpoint |
| 2026-05-31 | Added first collaborative editing slice | Added Yjs/Hocuspocus dependencies, collab room tokens, `vault-collab` service, Tiptap collaboration/caret wiring, and Postgres JSON persistence |
| 2026-06-01 | Added Markdown pivot plan | Documented staged path from ProseMirror JSON/Tiptap to Markdown source of truth with CodeMirror, Y.Text collaboration, migration safety, and live preview |
| 2026-06-01 | Started Markdown schema prep | Added additive `documents.markdown` column, generated/applied local migration, and made new documents write initial Markdown |
| 2026-06-01 | Added local Markdown editor and renderer | Added CodeMirror source editing, Markdown toolbar syntax insertion, safe GFM rendering, dashboard previews, and source/split/preview modes backed by `documents.markdown` |
| 2026-06-01 | Migrated collaboration path to Markdown text | Collab service now loads/stores `documents.markdown` as `Y.Text`; Markdown editor binds CodeMirror to Hocuspocus/Yjs when a collab URL is configured |
| 2026-06-01 | Added profile completion and friend search | Added username/nickname onboarding, profile completion gate, authenticated user search API, friend autocomplete, and profile migration |
| 2026-06-01 | Added settings profile editing | Users can update nickname and username from settings; username availability is checked live and relationships remain stable because references use `users.id` |
| 2026-06-01 | Tightened mobile editor layout | Reduced nested mobile padding, made editor toolbars horizontally scrollable, and added CodeMirror phone-width overrides |
| 2026-06-02 | Expanded mobile editor width | Made document editor pages edge-to-edge on phones, reduced toolbar density, hid mobile CodeMirror fold gutter, and narrowed the line-number gutter |
| 2026-06-02 | Added smart sharing and responsive document panel | Document sharing now uses the reusable user search field; the action rail collapses on desktop and opens as a modal on mobile |
| 2026-06-02 | Fixed collaborative refresh duplication race | Removed the independent `Y.Text.observe()` React state update path so CodeMirror/Yjs changes do not echo full-document replacements back into collaboration state |
| 2026-06-02 | Added safe media iframe embeds | Markdown rendering now allows explicit HTTPS iframe embeds for YouTube, Spotify, TIDAL, Vimeo, SoundCloud, Apple Music, and Bandcamp with normalized iframe permissions |
| 2026-06-02 | Fixed iframe rendering in preview/live modes | Added `iframe` to the sanitizer tag allowlist, normalized self-closing iframe syntax, and allowed safe iframe blocks in live preview |
| 2026-06-02 | Added Google OAuth provider | Auth.js now offers GitHub and Google sign-in buttons; Google requires local/prod OAuth credentials and callback URL configuration |
| 2026-06-02 | Added OAuth account connection flow | Settings now lists GitHub/Google connection state and lets signed-in users safely link a missing OAuth provider; login explains `OAuthAccountNotLinked` email clashes |
| 2026-06-02 | Fixed public dashboard visibility for new users | Public Notes now lists all published documents globally and links to public slugs instead of only showing the current user's own public docs |
| 2026-06-02 | Reverted multi-line HTML live preview | Multi-line HTML stays as source in live mode due to CodeMirror decoration constraints; Preview/Split remain the rendering path for those blocks |
| 2026-06-04 | Removed legacy Tiptap/ProseMirror stack | Removed Tiptap packages, legacy editor components, ProseMirror conversion helpers, legacy `documents.content` read/write paths, and generated migration `0005_high_captain_midlands.sql` to drop the column |
| 2026-06-04 | Added document update history | Added `document_versions`, batched automatic checkpoints, collaboration checkpoints, manual restore points, restore action, archive safety snapshots, and the document History panel |
| 2026-06-06 | Tightened live callout rendering | Live-mode callouts now preserve source lines while styling them as one continuous callout block, active callout blocks reveal source, callout backgrounds are stronger, and inline code spans are protected from nested bold/italic/link preview styling |
| 2026-06-06 | Hardened collaboration duplication path | Collaborative CodeMirror uses a one-time initial value instead of binding `value` to `Y.Text.toString()` across renders or reconnect sync events; removed unsafe server-side repeated-body rewriting |
| 2026-06-06 | Added admin moderation and official docs | Added user roles/bans, DB-backed active/admin gates, `/dashboard/admin`, `/banned`, `official_docs`, public `/docs` routes, and a manual official docs editor |
| 2026-06-06 | Reworked public official docs layout | Added category/order metadata for official docs and changed `/docs` plus `/docs/guides/[slug]` to a sidebar-based documentation layout |
| 2026-06-06 | Added hybrid repo and database docs | Repo-backed `content/docs/**/*.md` docs now merge with DB docs, repo slugs win collisions, admin docs show repo entries as read-only, and `/terms` renders repo-backed terms linked from login |
| 2026-06-06 | Fixed collaborative preview-to-live remount state | Returning from full Preview now remounts CodeMirror from the current Y.Text/current Markdown snapshot instead of the initial collaboration sync snapshot |
| 2026-06-06 | Added public note owner credits | Published note pages now show the owner nickname/name, username, avatar/fallback, and update date under the title without exposing email |
| 2026-06-06 | Added public note share previews | Public note routes now generate per-document OpenGraph/Twitter metadata and a 1200x630 social-card image that mimics a cropped rendered document preview |
| 2026-06-06 | Fixed callout body links | Preview/public callout rendering now preserves inline Markdown nodes inside callout bodies, and live callout body spacer lines no longer repeat the title icon |
| 2026-06-06 | Tightened public mobile gutters | Public note pages now use much smaller mobile page/card padding and narrower public Markdown list/callout/blockquote spacing |
| 2026-06-06 | Added wiki-link rendering slice | Added permission-aware Preview/view/public rendering for `[[doc:id|label]]`, unambiguous `[[Title]]`, unresolved/private/ambiguous states, and external `![[https://...]]` image embeds |
| 2026-06-06 | Added live external wiki image previews | Live mode now renders inactive `![[https://...]]` image embeds in stable frames, and Markdown images use stable responsive frames to avoid broken-image layout jitter |
| 2026-06-07 | Added wiki-link editor integration | CodeMirror now autocompletes readable documents after `[[` into canonical `[[doc:id|title]]` links, refreshes suggestions through `/api/documents/wiki-links`, and live mode styles inactive wiki links |
| 2026-06-08 | Added document transclusion embeds | Standalone `![[doc]]` wiki embeds now render permission-aware document previews in Preview/view/public and Live mode with recursion guards |
| 2026-06-08 | Added block and region wiki targets | Wiki links and document embeds can now target hidden `^block-id` anchors and hidden `@region-id` Vault regions; autocomplete suggests headings, blocks, and regions after `#` |
| 2026-06-09 | Added foldable region rendering and insertion | `foldable` Vault regions now render as collapsible blocks with `collapsed` initial state; the editor toolbar and `Ctrl/Cmd+Alt+R` insert a region scaffold |
| 2026-06-09 | Styled block anchor markers | End-of-line `^block-id` markers are slightly smaller and muted in editable modes; inline `^text` with trailing content remains normal text |
| 2026-06-09 | Added guide/public wiki namespaces | Wiki links now resolve `guide:<slug>` official docs and `public:<slug>` published documents; autocomplete shows publisher usernames for public docs |
| 2026-06-09 | Fixed namespace wiki resolution in editor | Document editor pages now preload guide/public wiki maps, and namespace targets are slug-normalized so typed titles such as `public:Course Options` resolve to public slugs |
| 2026-06-09 | Flattened writing and reading surfaces | Live mode hides CodeMirror line/fold gutters and uses a transparent centered writing surface; editor Preview and public note pages no longer sit inside a large rounded card |
