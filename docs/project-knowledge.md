# Vault — Project Knowledge

This file is the living source of truth for the **actual current codebase**.

Planning docs describe the intended system. This file describes what really exists right now.

Update this file whenever the codebase changes in a meaningful way.

---

## 1. Current Status Snapshot

Last updated: 2026-06-29

```txt
2026-06-29
```

Current phase:

```txt
Phase 10 - Workspace UI revamp; Phase 11 - Asset storage and library; Phase 12 - Extension registry foundation; Phase 13 - Settings modal and extension browser planning; Phase 14 - Metadata, tags, search, and popularity foundation
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
Vault currently has a runnable dark-first Next.js app shell, switchable theming, GitHub/Google Auth.js wiring, Dockerized Postgres, Markdown document editing with autosave and live preview modes, safe Markdown read-only/public rendering, direct and link-based document sharing, public publishing, friend requests, server-side permission helpers, admin moderation, official docs publishing, an Obsidian-like `/workspace` shell, health endpoints, GitHub Actions deployment wiring, production-confirmed Markdown/Y.Text collaboration, and private-by-default R2 asset storage with upload, library, gallery publishing, and controlled Markdown asset embed rendering.
```

Planned direction:

```txt
The Markdown-native pivot documented in `docs/09_MARKDOWN_PIVOT_PLAN.md` is active and production-confirmed. The workspace UI revamp documented in `docs/10_WORKSPACE_UI_REVAMP_PLAN.md` is active. Private-by-default uploaded asset storage and the asset library are implemented from `docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md`; remaining asset work should be follow-up polish rather than initial architecture. Extension architecture planning lives in `docs/12_EXTENSION_REGISTRY_PLAN.md`; LaTeX/math should remain a core editor feature, while optional capabilities such as stickers, drawings, calendars, and widgets should register through trusted built-in extension APIs. Initial registry types, live-block specs, and document extension state storage exist. The settings modal and extension browser path in `docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` is the prerequisite checkpoint before implementing the real stickers extension.
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

Object storage:
  - Private Cloudflare R2 storage for uploaded assets
  - `@aws-sdk/client-s3` and `file-type` dependencies are installed
  - `lib/storage/r2.ts` is server-only, lazily validates R2 env values, and exposes put/get/head/delete helpers
  - `POST /api/assets` uploads validated image/PDF bytes to private R2 and stores asset metadata in Postgres
  - `/api/assets/[assetId]` supports owner metadata reads, metadata/visibility updates, and soft delete
  - `/api/assets/[assetId]/content` streams bytes through Vault permission checks, including byte Range responses; raw R2 URLs are not inserted into Markdown
  - Document publish UI warns owners when linked private embeds will be hidden from anonymous public readers

Deployment:
  - Production Docker/Compose scaffolding
  - GitHub Actions workflow targeting a self-hosted mini-PC runner
  - Separate `vault-collab` container scaffold

Testing / UI verification:
  - `@playwright/test` dev dependency for local browser smoke tests and screenshots
```

Notes:

```txt
- `next.config.ts` enables standalone output for the future production Dockerfile.
- `shadcn@4.8.0` initialized with the default Base/Nova preset, which uses Base UI primitives. Its Button does not support `asChild`; use `buttonVariants()` for styled links.
- Theme behavior is dark-first and switchable. `components/theme-provider.tsx` owns localStorage-backed named themes using the `theme` key, applies `data-theme`, and keeps `.dark` compatibility for dark-like themes; workspace routes mirror the signed-in server preference back to localStorage for first paint.
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
    gallery/
    workspace/
    banned/
    terms/
    docs/
      guides/[slug]/
    docs/[docId]/
    healthz/
    login/
    privacy/
    public/[slug]/
    robots.txt
    share/[token]/
    sitemap.xml
  components/
    markdown/
    theme-provider.tsx
    theme-toggle.tsx
    ui/
  db/
  lib/
    storage/
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
| `app/robots.ts` | Generated `robots.txt`; allows public home/docs/guides/published-note routes and public asset content fetches while disallowing workspace, dashboard, asset-library, auth/onboarding, health, share-link, and general API crawling |
| `app/sitemap.ts` | Dynamic `sitemap.xml`; lists the homepage, official docs index, terms/privacy pages, published official guide pages, and user-published `/public/[slug]` documents only |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js route handlers |
| `app/api/health/route.ts` | App/database health check route |
| `app/api/assets/route.ts` | Authenticated asset list/upload API; upload validates file signatures, reserves quota, writes private R2 bytes, stores metadata, and optionally links to a document |
| `app/api/assets/completions/route.ts` | Authenticated editor autocomplete API for assets owned by the user or already linked to the current editable document |
| `app/api/assets/[assetId]/route.ts` | Owner-only asset metadata reads, metadata updates, public/private visibility updates, and soft delete |
| `app/api/assets/[assetId]/link/route.ts` | Authenticated route that links an owned or already document-linked asset to the current editable document before editor insertion |
| `app/api/assets/[assetId]/content/route.ts` | Permission-checked private asset content stream from R2 with `GET`, `HEAD`, and byte Range support; returns 404 for inaccessible private assets |
| `app/api/content/search/route.ts` | Authenticated Ctrl/Cmd+K content search API for readable docs, shared docs, owned assets, public content, and official guides using the shared metadata query parser |
| `app/api/content/like/route.ts` | Authenticated public document/asset like toggle API |
| `app/api/content/view/route.ts` | Public document/asset daily unique-ish view recording API |
| `app/dashboard/page.tsx` | Compatibility route that redirects to `/workspace` |
| `app/dashboard/admin/page.tsx` | Workspace-native admin-only user moderation page with user search, role changes, bans, and unbans |
| `app/dashboard/admin/docs/page.tsx` | Workspace-native admin-only official docs list/create page |
| `app/dashboard/admin/docs/[docId]/page.tsx` | Admin-only manual official docs editor |
| `app/dashboard/admin/tags/page.tsx` | Admin-only canonical tag management page for authoring tags, aliases, usage review, unused filtering, bulk safe orphan cleanup, and per-tag management |
| `app/dashboard/friends/page.tsx` | Workspace-native protected friend request/friend list page |
| `app/dashboard/settings/page.tsx` | Workspace-native protected settings route that opens the shared settings modal for direct navigation and OAuth/profile redirects |
| `app/banned/page.tsx` | Logged-in banned-account explanation and sign-out page |
| `app/terms/page.tsx` | Public Terms and Conditions route rendered from repo Markdown |
| `app/docs/page.tsx` | Official documentation index; signed-in users see it inside the workspace shell, anonymous users see the public docs layout |
| `app/docs/guides/[slug]/page.tsx` | Official documentation guide route; signed-in users see it inside the workspace shell, anonymous users see the public docs layout |
| `app/onboarding/page.tsx` | First-run profile completion page for username and nickname |
| `app/docs/[docId]/page.tsx` | Protected document edit/view route rendered inside the workspace shell with file browser tabs, an editor-first canvas, and a workspace right context panel for document actions; route-level permission checks and collaboration token creation remain server-side |
| `app/gallery/page.tsx` | Workspace gallery page that lists and searches public documents/assets with metadata-aware query parsing, public stats, and score/trending sort aliases |
| `app/assets/page.tsx` | Workspace asset library page for browsing owned uploads, editing metadata, copying embeds, and toggling public/private visibility |
| `app/healthz/route.ts` | Lightweight app-only health route |
| `app/login/page.tsx` | GitHub/Google OAuth sign-in page |
| `app/privacy/page.tsx` | Public Privacy Policy route rendered from repo Markdown |
| `app/public/[slug]/page.tsx` | Anonymous public read-only document route |
| `app/share/[token]/page.tsx` | Copyable document share-link route with read-only anonymous access and signed-in member edit handoff |
| `app/workspace/page.tsx` | Protected Obsidian-like workspace new-tab route with persistent tabs and file browser |
| `app/workspace/public/[slug]/page.tsx` | Protected workspace-native read-only view for published user documents opened from signed-in gallery/search surfaces |
| `app/api/users/search/route.ts` | Authenticated user search API for friend/profile lookup |
| `app/api/users/username-availability/route.ts` | Authenticated username validation/uniqueness API for settings |
| `.github/workflows/deploy.yml` | Production deploy workflow for the self-hosted mini-PC runner |
| `app/not-found.tsx` | Global not-found page for missing/private/unpublished docs |
| `app/error.tsx` | Global recoverable error page |
| `components/` | Shared UI components |
| `components/assets/AssetLibraryClient.tsx` | Client-side asset library masonry grid, search/filter/sort controls, owner configuration panel, tag editor/search, copy embed, and delete action |
| `components/assets/PublicAssetGallery.tsx` | Client-side public gallery asset grid and details panel with open, copy embed, and copy asset ID actions |
| `components/content-interaction-control.tsx` | Client-side like/view counter control for public documents and assets; records views when requested and only shows an active like button when signed in |
| `components/tag-autocomplete-input.tsx` | Shared cursor-aware space-separated tag input with scoped `/api/tags/completions` suggestions, keyboard navigation, and document/asset usage counts |
| `components/copy-public-link.tsx` | Client-side copy public URL button |
| `components/document-publish-control.tsx` | Client-side publish confirmation gate that warns when publishing a document with linked private asset embeds |
| `components/document-archive-form.tsx` | Client-side archive form wrapper that notifies workspace chrome to remove archived document tabs/lists before the server action redirect completes |
| `components/document-share-dialog.tsx` | Document sharing modal with direct user sharing, friend-prioritized autocomplete, thin access rows, and link-sharing controls |
| `components/settings/SettingsModal.tsx` | Large workspace settings modal shell with section navigation for account, workspace, editor, appearance, files/assets, hotkeys, core features, extension browser, installed extensions, and advanced settings |
| `components/settings/SettingsModalController.tsx` | Client controller mounted by workspace shells; listens for workspace settings-open events and opens the settings modal over the current tab |
| `components/settings/WorkspaceSettingsModalMount.tsx` | Server component that assembles account settings, preference sections, extension browser sections, and installed-extension sections for workspace shells |
| `components/settings/AccountSettingsSection.tsx` | Reusable account settings section containing the existing profile, OAuth provider, theme toggle, sign-out, and privacy model controls |
| `components/settings/PreferenceSettingsSections.tsx` | Obsidian-style modal preference sections for appearance, workspace, editor, files/assets, hotkeys, core features, commands, and advanced settings; controls autosave on change through `user_settings` server actions |
| `components/settings/ExtensionBrowserSection.tsx` | Server-rendered local extension browser/installed-extension section with permissions, contribution metadata, enable/disable, reset, and current settings display |
| `components/extensions/DocumentOverlayHost.tsx` | Pointer-safe document overlay host and overlay item primitive for trusted document-state extensions such as stickers or page annotations |
| `components/extensions/use-document-extension-state.ts` | Client hook for authenticated workspace extensions to load object-shaped document extension state and debounce writes through server actions |
| `components/markdown/MarkdownEditor.tsx` | CodeMirror Markdown editor with live-mode-first UI, autosave, Markdown toolbar, Live-mode Properties/frontmatter controls, toolbar/paste/drop asset upload insertion, and optional Yjs collaboration |
| `components/markdown/live-blocks.ts` | Syntax-aware CodeMirror Live Preview block scanner and direct decoration field; detects `:::assets` groups, Obsidian-style callouts, standalone document embeds, GFM tables, and display math through registered core `LiveBlockSpec`s while ignoring fenced code blocks, renders inactive blocks through `StateField<DecorationSet>` widgets, and reveals literal source when the cursor enters the block |
| `components/markdown/OfficialDocEditor.tsx` | CodeMirror-based manual-save Markdown editor for official docs; no collaboration |
| `components/markdown/MarkdownToolbar.tsx` | Toolbar that inserts Markdown syntax, opens the asset upload picker, and can create/wrap `:::assets` groups |
| `components/markdown/MarkdownDocument.tsx` | Safe GFM Markdown renderer with sanitized raw HTML allowlist, frontmatter stripping, and permission-resolved asset embed rendering, including controlled image layout attributes |
| `components/theme-provider.tsx` | Root client theme provider using localStorage-backed named themes, `data-theme`, and dark-class compatibility |
| `components/theme-toggle.tsx` | Dark/light icon toggle |
| `components/profile-settings-form.tsx` | Settings form for nickname and username changes with live availability status |
| `components/user-search-field.tsx` | Reusable user search/autocomplete field with avatar/name/username/email suggestions |
| `components/document-workspace.tsx` | Client wrapper for the document editor workspace and collapsible right-side action panel |
| `components/workspace/` | Workspace shell, draggable tab bar, Ctrl/Cmd+K command palette, icon rail, file browser, docs panel, utility panels, resizable/collapsible side panels, document-state sync helpers, and new-tab components for Phase 10; settings is modal-only and no longer has a utility sidebar |
| `components/workspace/WorkspaceCommandPalette.tsx` | Workspace-wide Ctrl/Cmd+K modal with grouped results, arrow-key navigation, and quick-open search for documents, public content, assets, and official guides. Typing a leading `/` flips it into command mode: navigation/create/theme/settings/account commands plus document-scoped actions (share, publish/unpublish, copy link, save/open restore points, insert calendar, insert sticker, archive) gated on the active document's capabilities + enabled extensions via `useActiveDocumentCommand` from `WorkspaceChrome`. Actions that live in other components are reached through `lib/document-command-events.ts` (a retained command bus + `requestOpenRightPanel`): the palette opens the context panel and the share dialog / restore-points (`DocumentRestorePoints`) / editor claim the pending command on mount or via live subscription. An empty search field shows recently opened pages (last-opened order, tracked in `WorkspaceChrome` and read via `useRecentWorkspacePages`); command rows render the canonical `/slug` token alongside the descriptive label |
| `components/ui/` | shadcn/ui components |
| `db/` | Database client/schema/migrations |
| `db/index.ts` | Drizzle/Postgres client |
| `db/schema.ts` | Auth, document, permission, collaboration, friend, official docs, uploaded asset, document extension state, user settings, metadata/tag, and public interaction schema |
| `lib/` | Shared helpers |
| `lib/extensions/types.ts` | Trusted built-in extension registry types for Markdown live blocks, renderer/preprocessor hooks, document state overlays, workspace contributions, permissions, command metadata, categories, and generated settings metadata |
| `lib/extensions/registry.ts` | Shared registry helper that stores ordered Vault extensions and exposes Markdown, document-state, workspace, command, settings, and enabled-extension selectors |
| `lib/extensions/catalog.ts` | Server-safe local built-in extension catalog; currently includes disabled-by-default `vault.stickers` preflight metadata and settings schema |
| `lib/auth.ts` | Re-export of auth helpers for app imports |
| `lib/collab-token.ts` | Signed room token creation/verification for collaboration |
| `lib/content-metadata.ts` | Frontmatter and space-separated tag parsing helpers for document/asset metadata indexing |
| `lib/content-search-query.ts` | Shared content search parser/matcher for bare mixed search plus `tags:`, `kind:`, `owner:`, `visibility:`, and `sort:` tokens |
| `lib/markdown.ts` | Shared Markdown limits |
| `lib/site-url.ts` | Shared canonical site-origin helper used by metadata, robots, and sitemap generation; prefers `NEXTAUTH_URL`, then `NEXT_PUBLIC_APP_URL`, then production `https://vault.ems-place.com` |
| `lib/repo-docs.ts` | Filesystem loader for repo-backed docs and legal Markdown content |
| `lib/permissions.ts` | Server-side document access helpers |
| `lib/slug.ts` | Public slug generation helper |
| `lib/asset-embeds.ts` | Markdown asset embed parser/renderer for `![[asset:id|label]]` references, controlled `{layout align width caption alt}` image attributes, PDF/file cards, and first-pass `:::assets` grid groups |
| `lib/storage/r2.ts` | Server-only private R2/S3-compatible object helper for uploaded asset storage; exposes put/get/head/delete helpers and validates env lazily |
| `lib/utils.ts` | shadcn utility for class merging |
| `server/documents.ts` | Document server actions and queries |
| `server/assets.ts` | Uploaded asset domain helpers for auth, file validation, quota accounting, R2 upload, metadata queries, editor autocomplete, explicit document linking, publish-warning analysis, stale document-link cleanup, public asset listing, owner metadata updates, document links, and read authorization |
| `server/content-metadata.ts` | Metadata sync helpers that mirror document frontmatter into `document_metadata`/`document_tags`, asset tags into `asset_tags`, and scoped tag suggestions for autocomplete |
| `server/tags-admin.ts` | Admin-only canonical tag and alias actions plus tag usage listing and safe orphan deletion helpers |
| `server/content-interactions.ts` | Public document/asset likes, daily unique-ish views, count aggregation, viewer-like state, and simple score calculation |
| `server/content-viewer.ts` | Server-side viewer identity helper for signed-in user ids or hashed anonymous view identifiers |
| `server/document-extensions.ts` | Permission-checked CRUD helpers for `document_extension_states`; editors can write, readers can read public extension state, explicit collaborators can read private state, and editor-only state requires edit access |
| `server/document-extension-actions.ts` | Server actions that expose sanitized extension-state records to authenticated workspace clients without leaking raw database rows |
| `server/user-settings.ts` | Validated server helpers for `user_settings` and `user_extension_settings`, including per-user extension enablement/reset helpers |
| `server/user-settings-actions.ts` | Server actions for modal preferences, extension enablement, reset, and schema-validated extension settings writes |
| `server/admin.ts` | Admin user listing/search, role changes, bans, and unbans |
| `server/authz.ts` | DB-backed active-user and admin guards; active bans redirect to `/banned` |
| `server/dev-auth.ts` | Dev-only local sign-in action that creates Auth.js database sessions |
| `server/official-docs.ts` | Official documentation queries and admin save/create actions |
| `content/docs/` | Repo-backed canonical user documentation rendered with the same docs UI as DB docs; includes getting started, collaboration, customization, security, and asset guides |
| `content/legal/terms.md` | Repo-backed Terms and Conditions copy shown on `/terms` |
| `content/legal/privacy.md` | Repo-backed Privacy Policy copy shown on `/privacy` |
| `server/friends.ts` | Friend request and friendship server actions/queries |
| `server/profile.ts` | Profile completion, profile gate, and user search helpers |
| `server/workspace.ts` | Authenticated workspace data loader for the shell and sidebar document lists |
| `auth.ts` | Auth.js configuration, Drizzle adapter, GitHub provider, session callback |
| `scripts/collab-server.mjs` | Hocuspocus/Yjs collaboration websocket service |
| `scripts/reconcile-assets.mjs` | Asset maintenance script for quota drift, unused private assets, missing objects, orphaned R2 objects, quota repair, and orphan deletion |
| `scripts/export-assets.mjs` | Exports asset metadata plus active R2 object bytes to a local backup directory |
| `docs/` | Planning and project knowledge |
| `docs/09_MARKDOWN_PIVOT_PLAN.md` | Structured plan and status notes for the Markdown backbone pivot |
| `docs/10_WORKSPACE_UI_REVAMP_PLAN.md` | Structured plan for replacing the dashboard-centric UI with an Obsidian-like workspace shell |
| `docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md` | Private-by-default uploaded asset storage, asset library, explicit asset publishing, and gallery integration plan |
| `docs/12_EXTENSION_REGISTRY_PLAN.md` | Trusted built-in extension registry, document extension state, overlay, and future verified plugin plan |
| `docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` | Settings modal, user settings storage, extension settings, local extension browser, runtime enablement, and stickers-ready checkpoint plan |
| `docs/14_METADATA_TAGS_SEARCH_PLAN.md` | Shared document/asset metadata, tags, gallery search, Ctrl+K search, likes, views, and trending implementation plan |
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
ASSET_STORAGE_DRIVER=r2
R2_BUCKET=vault-assets
R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=replace-with-r2-access-key-id
R2_SECRET_ACCESS_KEY=replace-with-r2-secret-access-key
ASSET_ROUTE_BASE_PATH=/api/assets
# Optional overrides; defaults live in lib/config/asset-limits.ts
# MAX_IMAGE_UPLOAD_BYTES=10485760
# MAX_PDF_UPLOAD_BYTES=26214400
ASSET_PRIVATE_CACHE_SECONDS=0
ASSET_PUBLIC_CACHE_SECONDS=3600
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
| `ASSET_STORAGE_DRIVER` | Optional | Asset planning | Storage backend selector; current implementation is R2 only |
| `R2_BUCKET` | Required for uploads | Asset storage helper | Private R2 bucket name for uploaded asset bytes |
| `R2_ENDPOINT` | Required for uploads | Asset storage helper | Account-level R2 S3 API endpoint, `https://<cloudflare-account-id>.r2.cloudflarestorage.com`, without bucket suffix |
| `R2_ACCESS_KEY_ID` | Required for uploads | Asset storage helper | Server-only R2 S3-compatible access key |
| `R2_SECRET_ACCESS_KEY` | Required for uploads | Asset storage helper | Server-only R2 S3-compatible secret key |
| `ASSET_ROUTE_BASE_PATH` | Optional | Asset renderer/API | Vault route prefix for permission-checked asset reads, default `/api/assets` |
| `MAX_IMAGE_UPLOAD_BYTES` | Optional override | Asset upload validation | Per-upload image cap; default (10 MiB) in `lib/config/asset-limits.ts` |
| `MAX_PDF_UPLOAD_BYTES` | Optional override | Asset upload validation | Per-upload PDF cap; default (25 MiB) in `lib/config/asset-limits.ts` |
| `ASSET_PRIVATE_CACHE_SECONDS` | Optional | Asset content route | Cache seconds for private asset responses; current default is `0` |
| `ASSET_PUBLIC_CACHE_SECONDS` | Optional | Asset content route | Cache seconds for explicitly public asset responses; current default is `3600` |

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
| `document_share_links` | Yes | Revocable copyable document share links |
| `document_collab_states` | Yes | Durable Yjs CRDT snapshots for collaboration room reload/reconnect safety |
| `document_extension_states` | Yes | Permission-scoped JSON state for trusted built-in document extensions |
| `user_settings` | Yes | Per-user workspace, editor, appearance, files/assets, hotkey, and advanced settings JSON |
| `user_extension_settings` | Yes | Per-user trusted built-in extension enablement and settings JSON |
| `document_versions` | Yes | Batched Markdown restore checkpoints |
| `friend_requests` | Yes | Friend request workflow |
| `friendships` | Yes | Accepted friendships |
| `official_docs` | Yes | Admin-authored public user documentation |
| `assets` | Yes | Uploaded asset metadata for private R2-backed images and PDFs |
| `document_assets` | Yes | Links between documents and embedded uploaded assets |
| `tags` | Yes | Global canonical tag vocabulary for documents and assets |
| `tag_aliases` | Yes | Admin-managed aliases that point alternate slugs at canonical tags |
| `document_metadata` | Yes | Frontmatter-derived indexed metadata for documents |
| `document_tags` | Yes | Many-to-many document/tag links |
| `asset_tags` | Yes | Many-to-many asset/tag links |
| `content_likes` | Yes | Signed-in likes for public documents/assets |
| `content_views` | Yes | Daily unique-ish view events for public documents/assets |

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
| `0009_simple_korvac.sql` | Adds `document_share_links` for copyable document access links | Generated | No |
| `0010_fast_phantom_reporter.sql` | Adds `document_collab_states` for durable Yjs room state | Generated | No |
| `0011_tiresome_ultimates.sql` | Adds user storage quota fields, `assets`, and `document_assets` for private uploaded asset metadata | Generated | No |
| `0012_tiny_tana_nile.sql` | Adds `document_extension_states` for trusted extension state keyed by document, extension, and state key | Generated | No |
| `0013_majestic_fabian_cortez.sql` | Adds `user_settings` and `user_extension_settings` for modal preferences and per-user extension enablement/configuration | Generated | No |
| `0014_real_lizard.sql` | Adds shared metadata/tag/search foundation tables plus public content likes/views | Generated | No |

Schema notes:

```txt
- `db/schema.ts` currently defines Auth.js tables, documents, document_permissions, document_share_links, document_collab_states, document_extension_states, user_settings, user_extension_settings, document_versions, friend_requests, friendships, official_docs, assets, document_assets, tags, tag_aliases, document_metadata, document_tags, asset_tags, content_likes, and content_views.
- `users.name` is used as the free-form nickname; `users.username` is unique and normalized lowercase; `users.profile_completed_at` records onboarding completion; `users.role` supports `user`/`admin`.
- `users.banned_at`, `users.banned_until`, and `users.ban_reason` store moderation state. `banned_at` with no `banned_until` is treated as permanent.
- Friendships, document ownership, document permissions, sessions, and accounts all reference `users.id`, not `username`, so username changes do not migrate relationship rows.
- `documents.markdown` is the canonical editor/viewer/public rendering source.
- Document frontmatter metadata is parsed by `lib/content-metadata.ts` and mirrored into `document_metadata` plus `document_tags` by `server/content-metadata.ts`. Supported indexed fields are `tags`, `aliases`, `summary`, `status`, and `project`; unknown YAML frontmatter keys stay in Markdown but are not indexed in V1. Live mode exposes these fields through a compact Properties block that rewrites YAML frontmatter and hides the leading frontmatter block, Source mode keeps raw frontmatter editable for advanced/unknown keys, and `MarkdownDocument` strips frontmatter from rendered output.
- Tags are global canonical records. Tag input is space-separated (`forest research pine_forest`), and multi-word tags use underscores. V1 categories are `general`, `topic`, `person`, `place`, `project`, and `technical`; aliases are stored in `tag_aliases` for admin-managed future merge/alias tools.
- `documents.content` has been removed from the Drizzle schema and will be dropped by migration `0005_high_captain_midlands.sql`.
- `document_collab_states.yjs_state` stores compact binary Yjs state for collaboration rooms. The collab service loads this before falling back to `documents.markdown`, which prevents reconnects from merging identical plain text as separate CRDT items and duplicating the document.
- Non-collab Markdown overwrites and restores delete the corresponding `document_collab_states` row so future collab sessions reseed from the latest Markdown instead of stale Yjs state.
- `document_extension_states` stores non-Markdown trusted extension state keyed by `(document_id, extension_id, state_key)`. State rows are JSONB with `private`, `public`, or `editor-only` visibility. Use `server/document-extensions.ts` for permission checks; do not query these rows directly from UI routes.
- `user_settings` stores signed-in user app preferences by `(user_id, namespace, key)`. Accepted namespaces are `appearance`, `editor`, `workspace`, `files-assets`, `hotkeys`, and `advanced`; values are object-shaped JSON and must go through `server/user-settings.ts`.
- Current modal preference keys are `appearance/theme`, `workspace/defaults`, `editor/defaults`, `files-assets/defaults`, `hotkeys/defaults`, `workspace/core-features`, and `advanced/defaults`.
- `user_extension_settings` stores per-user trusted built-in extension enablement and settings by `(user_id, extension_id)`. Extension ids are validated server-side; registry-backed schema validation will be added with the extension browser.
- `server/user-settings-actions.ts` validates local extension ids against `lib/extensions/catalog.ts` and validates extension settings through the registered schema before writes.
- Authenticated client extensions should use `components/extensions/use-document-extension-state.ts`, which reads through `server/document-extension-actions.ts` and debounces object-shaped JSON writes. The first runtime is non-realtime; future collaborative extension state should use an explicit Yjs-owned design instead of ad hoc polling.
- `MarkdownEditor` wraps the editor column in `DocumentOverlayHost`, giving trusted document-state extensions a stable absolute-positioned overlay layer while keeping the Markdown editor and toolbar layout unchanged.
- `document_versions` stores full Markdown checkpoints for recovery. Automatic checkpoints are batched to at most one every 10 minutes per document unless a save changes the body size by at least 2,000 characters or 25%.
- `official_docs` stores admin-authored Markdown docs with `draft`, `published`, and `archived` statuses. Public docs routes only read published rows.
- `official_docs.category` and `official_docs.sort_order` drive the public docs sidebar grouping and order. Published docs sort by category, sort order, then title.
- `content/docs/**/*.md` stores repo-backed canonical docs with frontmatter (`title`, `slug`, `category`, `order`, `public`). Repo docs are merged with DB docs in the public/admin docs UI. The Assets category currently includes asset library, asset metadata/search, and asset embed/layout docs; guide examples intentionally include rendered Markdown snippets so the docs show both source syntax and output shape.
- Repo docs own their slugs. DB docs with a slug collision are hidden from public docs and cannot be saved until the slug changes.
- Owners are stored both as `documents.owner_id` and as an owner row in `document_permissions`.
- `document_share_links` stores one stable revocable share link per document. Link access is dynamic and does not create a `document_permissions` row. Updating link settings reuses the same URL while changing enabled/scope/role access. `anyone` links are read-only; `members` links may be viewer or editor, but editor access requires a signed-in Vault account and does not grant sharing/publishing/deleting rights.
- `/api/health` uses `select 1` and does not require any application tables.
- Wiki-link metadata is derived from document Markdown at read time. Resolved wiki maps include headings, Obsidian-style block anchors (`^block-id`), and hidden Vault regions (`<!-- vault-region id="..." -->`), so links and embeds can target a specific heading, block, or region without schema changes. Vault regions marked `foldable` render as collapsible disclosure blocks; `collapsed` makes them initially closed.
- Wiki links support explicit namespaces: `doc:<uuid>` for readable app documents, `guide:<slug>` for official documentation pages, and `public:<slug>` for published user documents. The authenticated completion API merges readable documents, official guides, and published documents; public-document suggestions show the publisher username.
- `users.storage_used_bytes` and `users.storage_quota_bytes` track uploaded asset quota. The new-user quota default is sourced from `lib/config/asset-limits.ts` (`defaultUserStorageQuotaBytes`, 50 MiB) via the schema column default; migration `0016_flawless_betty_ross.sql` set it (was 256 MiB in `0011`). Existing rows keep their stored quota.
- `assets` stores private-by-default uploaded object metadata, ownership, R2 bucket/key, MIME detection data, size, checksum, visibility, and upload status. R2 stores bytes; Postgres owns identity, quota, and authorization metadata.
- `document_assets` links assets to documents without duplicating object bytes. The current upload route creates this link when uploading from a document editor; document saves and collaboration stores remove links for assets no longer embedded in the Markdown source.
- `asset_tags` links assets into the same global tag vocabulary as documents. The asset PATCH route accepts optional tag arrays and syncs them through `server/content-metadata.ts`; the asset library can edit tags and includes tags in local library filtering.
- Search query parsing lives in `lib/content-search-query.ts`. Bare words are ANDed across searchable text fields and exact tag matches, while `tags:`/`tag:` consumes a space-separated tag run until another known token. Current known tokens are `tags:`, `tag:`, `kind:`, `type:`, `owner:`, `visibility:`, and `sort:`.
- `/api/tags/completions?q=&scope=mine|public` returns tag suggestions with asset/document counts. `scope=public` only counts public docs/assets. `scope=mine` requires auth and counts owned assets plus owned/shared readable docs. Normal autocomplete hides zero-use canonical tags so stale spam is not encouraged. `components/tag-autocomplete-input.tsx` powers both document Properties tags and asset metadata tags with cursor-local space-separated insertion.
- `/dashboard/admin/tags` lets admins create/edit canonical tags, add/remove aliases, review document/asset counts, filter deletable unused tags, bulk delete unused tags, and delete tags only when they have no document links, asset links, or aliases.
- `/api/content/search?q=` backs the workspace Ctrl/Cmd+K palette. It requires an active user, searches owned docs, shared docs, public docs, owned assets, and official guides, and uses the same parser/matcher as gallery and asset-library search. Result priority is owned docs, shared docs, guides, owned assets, then public docs.
- Public gallery search passes parsed metadata filters into `listPublicDocuments` and `listPublicAssets`, which push public visibility, owner, kind, title/body, frontmatter, and tag checks into SQL before stats are hydrated.
- Public content interactions live in `content_likes` and `content_views`. Likes require a signed-in user and only attach to public documents/assets. Views are daily unique-ish by signed-in user id or hashed anonymous request headers. `server/content-interactions.ts` scores all-time content as `likes * 4 + views` and trending content as seven-day `recent_likes * 5 + recent_views`; `sort:score` and `sort:trending` use those separate stats.
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
| `app/dashboard/page.tsx` | Compatibility redirect to `/workspace` |
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
- `/login` states that signing in accepts the Terms and Conditions, links to `/terms`, and points to `/privacy`; legal pages render `content/legal/terms.md` and `content/legal/privacy.md`.
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
| Share links grant dynamic read/edit access | Yes | `getDocumentByShareLink()`, `/share/[token]`, optional `shareLinkId` save checks |
| Only owner can publish | Yes | `publishDocumentAction()`, `unpublishDocumentAction()` |

Known permission caveats:

```txt
- No current share-link permission caveat. Temporary members-editor link access is dynamic and works for both normal saves and Yjs collaboration while the link is active.
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
| `app/workspace/page.tsx` and `components/workspace/WorkspaceFileBrowser.tsx` | Workspace new-tab page, compact document list, and create form |
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
updateDocumentShareLinkAction()
publishDocumentAction()
unpublishDocumentAction()
listDocumentsForUser()
listSharedDocumentsForUser()
listPublicDocuments()
listDocumentVersionsForUser()
getDocumentForUser()
getDocumentForUserWithOptionalShareLink()
getDocumentByShareLink()
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
- Sharing now opens from a modal on the document page instead of the older right-side share panel.
- `shareDocumentAction()` accepts the reusable smart user search field: selected suggestions submit `users.id`, while manual entry falls back to exact username or email lookup.
- The share user picker can prioritize existing friends while still searching all registered users.
- Reusable user-search suggestions only render while the input is focused, so stale suggestion popovers do not cover the share modal after focus moves elsewhere.
- Sharing still checks `canShareDocument()` server-side and stores collaborator relationships by `users.id`, not username/email.
- Collaborators are displayed as compact thin access rows in the share modal. Owner rows cannot be removed or downgraded.
- `updateDocumentShareLinkAction()` lets owners enable, disable, or change the access level of one stable copyable link. Modes are off, anyone-viewer, members-viewer, and members-editor.
- Link setting updates revalidate the document route without redirecting, so the share modal can stay open after saving link settings.
- `/share/[token]` renders read-only access for anonymous visitors when allowed and emits OpenGraph/Twitter metadata plus `/share/[token]/og` preview images for anonymous-readable links. Signed-in Vault members opening a members-editor link are redirected into `/docs/[docId]?share=...`, where saves and collaboration room access are authorized by the share link instead of a permanent permission row. Sign-in-only viewer links keep generic metadata to avoid leaking private document titles/snippets.
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
| `/share/[token]` | Implemented | Copyable document share-link route |

Known document caveats:

```txt
-
```

---

## 9. Editor Implementation

Current editor status:

```txt
Markdown editor implemented with CodeMirror, debounced autosave, manual save, toolbar syntax insertion, Read/Live/Source modes, and production-confirmed Y.Text collaboration.
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
| Read/Live/Source modes | Yes |

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
- Standalone document transclusions use `![[doc:id|label]]` or unambiguous `![[Title]]` syntax. Preview/view/public split those lines into recursive `MarkdownDocument` embeds styled with `.vault-md-document-embed`; inactive Live mode now renders standalone transclusions through `components/markdown/live-blocks.ts` as direct `StateField` block widgets that reuse `MarkdownDocument` and reveal the raw source when the cursor enters the line. Heading fragments on document embeds render only the selected heading's owned section, from that heading until the next heading of equal or higher level. Embeds are permission-aware, public pages only include public document Markdown, and recursive embeds are capped.
- Uploaded image asset embeds use `![[asset:id|label]]` with optional controlled attributes such as `{layout=wrap align=right width=320 caption="Figure" alt="Description"}`. Read mode and inactive Live mode use the same parser. Supported image layout values are `block`, `wrap`, and `inline`; alignment is `left`, `center`, or `right`; width is `small`, `medium`, `large`, `full`, sanitized pixels, or sanitized percentages. Raw CSS is intentionally not accepted in asset embed syntax. PDF/file embeds render as compact cards that open `/api/assets/:id/content?doc=:docId` in a new tab when the asset is readable.
- Editor asset autocomplete activates inside `![[asset:...]]` and only suggests the current user's assets plus assets already linked to the open document. It does not query global public gallery assets. Choosing an existing asset calls `/api/assets/:assetId/link` before inserting the Markdown reference, which creates or preserves the `document_assets` row needed for collaborator read-through.
- The owner publish control preflights the current Markdown for linked private embedded assets. Publishing still only mutates document visibility/public slug; private assets remain private and anonymous public readers receive unresolved/private placeholders for those embeds.
- Asset groups use `:::assets {layout=grid align=center width=full gap=medium columns=2 caption="Comparison"}` fences containing one asset embed per line. Read mode renders them as responsive grids; inactive Live mode renders the group through `components/markdown/live-blocks.ts` as a direct `StateField` block widget, and cursor/selection entry reveals the literal Markdown source. The toolbar Asset group button inserts a scaffold or wraps selected standalone asset embed lines. Rendered Live groups expose an icon-only top-right configure button that opens a panel for columns, gap, alignment, width, and shared caption; edits rewrite only the opening fence line. Fixed `columns=2|3|4` collapse to one column on mobile. Group attributes are deliberately limited to grid layout, alignment, width, gap, columns, and shared caption.
- Inactive Live-mode callouts are now also owned by `components/markdown/live-blocks.ts`. They render through `MarkdownDocument`, the same renderer used by Read mode, so callout icons, colors, title/body parsing, and nested Markdown stay matched instead of relying on per-line CodeMirror styling. Moving the cursor or a selection into the callout reveals the raw blockquote source.
- Inactive Live-mode GFM tables are owned by `components/markdown/live-blocks.ts` as direct block widgets. They render through `MarkdownDocument`, matching Read-mode table styling, while cursor or selection entry reveals the raw table source. Table detection requires a header row followed by a valid delimiter row and ignores matching text inside fenced code or other higher-priority live blocks.
- Core math rendering uses `remark-math` and `rehype-katex` in `MarkdownDocument`. Read mode, public pages, official docs, share views, and document embeds support `$inline$` and `$$block$$` math without loading remote math scripts. Inactive Live-mode display math is a core LiveBlockSpec that renders through `MarkdownDocument`; when active, the raw TeX source remains editable and a measured KaTeX preview frame is inserted directly underneath the source. Inactive Live-mode inline math renders through a KaTeX inline widget, ignores escaped dollars and inline-code spans, and reveals the `$...$` source when the cursor enters the range. Active inline math shows a floating KaTeX tooltip preview without changing document layout.
- The Markdown editor shows a compact floating asset inspector when the cursor is inside an asset embed source. Layout, alignment, width, caption, and alt controls rewrite the embed's Markdown attribute block in place without changing document layout; no separate asset-layout table or hidden metadata exists.
- Markdown image rendering uses a stable responsive frame so slow or broken image loads do not repeatedly change document layout height.
- Document titles are intentionally not unique; document identity remains `documents.id`, and public route identity remains `public_slug`.
- Raw HTML in read-only/public rendering is parsed through `rehype-raw` and sanitized with an explicit `rehype-sanitize` allowlist. Scripts, event handlers, forms, unsafe URL protocols, and unsafe CSS values are not allowed; a constrained inline `style` allowlist supports common presentation styles. HTML inside fenced code blocks still displays as code.
- Iframes are allowed only for explicit HTTPS embed sources in `MarkdownDocument`: YouTube/YouTube nocookie, Spotify, TIDAL, Vimeo, SoundCloud, Apple Music, and Bandcamp. The renderer normalizes iframe `sandbox`, `allow`, `allowFullScreen`, `loading`, and `referrerPolicy` attributes instead of trusting arbitrary author-provided iframe permissions. Self-closing iframe syntax is normalized to a closing-tag iframe before Markdown HTML parsing.
- `MarkdownDocument` renders Obsidian-style blockquote callouts from `> [!type] Title` or tight `>[!type] Title` syntax. Supported default types/aliases follow Obsidian's documented set: note, abstract/summary/tldr, info, todo, tip/hint/important, success/check/done, question/help/faq, warning/caution/attention, failure/fail/missing, danger/error, bug, example, quote/cite. Fold markers `+` and `-` render as open/collapsed details.
- Rendered callouts expose `.callout`, `.callout-title`, `.callout-icon`, `.callout-content`, `data-callout`, `data-callout-resolved`, and CSS variables such as `--callout-color` and `--callout-icon` so future snippet support can override default styles.
- Rendered callouts preserve normal Markdown inline rendering in the body, including links, bold, italic, and code, even when the body starts in the same blockquote paragraph as the `[!type] Title` marker.
- Rendered callouts preserve source line breaks inside the callout body as separate body paragraphs instead of collapsing them into one paragraph. Live callouts intentionally stay source-preserving instead of replacing multi-line source with a rendered widget. Inactive callout lines are styled as one continuous block, the callout marker becomes an icon on the title line, body lines use a hanging indent so wrapped text stays aligned with the rendered callout body, trailing quote-only continuation lines are excluded from the rendered callout block, and the full source is revealed when the cursor enters the callout block.
- Live mode preserves the currently active structural block while mouse-drag selection starts from it, so dragging text inside an active callout does not immediately flip that callout back into its rendered inactive state.
- Live callout lines also expose `.callout`, `data-callout`, `data-callout-resolved`, and `data-callout-fold` when present, so callout CSS variables from future snippets can affect Preview and Live mode. Live mode uses a stronger CodeMirror translation layer plus classes such as `.vault-cm-callout-first`, `.vault-cm-callout-body-line`, and `.vault-cm-callout-marker` so generic `.callout` snippet/card styling does not turn each editor line into a separate card.
- Live preview allows the same iframe block tags and applies the same source allowlist plus normalized iframe permissions before rendering the inactive block preview.
- Live preview renders inline HTML and single-line sanitized raw HTML blocks. Multi-line raw HTML intentionally remains source in live mode; asset groups use the newer direct-decoration Live block layer. Full Read mode still renders all supported Markdown through the sanitized Markdown pipeline. Code fences remain source/code preview, not rendered HTML.
- The next Live Preview architecture is documented in `docs/05_EDITOR_AND_COLLAB.md`: syntax-aware `LiveBlock` scanning first, then direct-decoration `StateField<DecorationSet>` block widgets for vertical-layout-changing inactive previews. `components/markdown/live-blocks.ts` currently renders inactive asset groups, callouts, standalone document embeds, GFM tables, and display math while ignoring matching source text inside fenced code blocks. These specs now flow through a core `VaultExtension` registered with `lib/extensions/registry.ts`; splitting each spec into separate registry-owned modules remains follow-up work.
- Do not collapse or externally offset CodeMirror carrier-line geometry for rendered Live block widgets. Rules such as `line-height: 0` on `.cm-line` or `margin-block` on block widget containers break `posAtCoords()` and vertical cursor movement, causing clicks to land on the wrong line and arrow keys to skip or jump. Live block widgets should keep normal measurable line boxes, use internal padding for visual spacing, and `components/markdown/live-blocks.ts` handles adjacent-block ArrowUp/ArrowDown entry into source mode when CodeMirror's default visual movement would skip across a replaced block.
- GFM task-list checkboxes render without bullet markers and use custom theme-token checkbox styling instead of default browser controls. Live mode uses read-mode-style sans typography by default and replaces inactive list/task markers with rendered bullets, ordered numbers, or the same styled checkbox widget while preserving source syntax when the cursor enters the marker.
- Read/preview task-list items are a two-column grid (`1rem` checkbox + content). Non-checkbox children of `.vault-md-li:has(.vault-md-checkbox)` are pinned to the content column so nested `<ul>`/`<ol>` and loose-list `<p>` do not auto-flow into the narrow checkbox track (which previously rendered nested bullets one character per line).
- Live mode renders idle thematic breaks (`---`, `***`, `___`) as a horizontal rule (`HorizontalRuleWidget`) and styles single-line Setext headings (`Title` followed by `===`/`---`) as H1/H2 with the underline hidden; both reveal raw source when the cursor enters either line. `getFrontmatterEndLine()` is shared with the frontmatter-hiding extension so YAML `---` delimiters are never treated as rules, and a dash run directly under a paragraph stays a Setext underline (matching the remark renderer) rather than becoming a rule. Multi-line Setext paragraphs are intentionally left as source.
- Live mode decorates underscore emphasis (`_italic_`, `__bold__`) with CommonMark intra-word guards (`(?<![\w_])…(?![\w_])`, so `snake_case` stays literal) plus a link/URL/wiki-link guard so underscores inside destinations stay literal, and `~~strikethrough~~`. These previously rendered only in Read mode (remark-gfm); Live mode now matches.
- `MarkdownDocument` emits stable `.vault-md-*` classes for future document themes and user CSS snippets.
- Mobile document editing uses an edge-to-edge editor surface, separate padding for title/status controls, horizontally scrollable mode/format controls, and `.vault-markdown-editor` CodeMirror overrides. The mobile fold gutter is hidden and the line-number gutter is constrained so the writing area stays wide on phone screens.
- Document edit pages now use the workspace shell plus an editor-first canvas. The visible document surface is the Markdown toolbar, title, and live editor; the old route header and persistent bottom Save button are hidden. Manual save UI only appears when autosave/collaboration is in an error or disconnected state. Share, publish/unpublish, copy public link, restore points, and archive live in the workspace right context panel instead of inside the document canvas.
- `VaultWorkspaceShell` owns panel behavior. The left navigation panel and right context panel have draggable resize handles on desktop and persist widths/collapsed state in `localStorage`. The right panel is a contextual workspace service: routes provide its contents, but the shell owns the panel chrome, collapse button, width, and persistence.
- `WorkspaceTabBar` owns client-side tab ordering. Tabs are draggable with pointer/mouse drag-and-drop, and each reorder writes the new order back to `vault.workspace.tabs.v1` in `localStorage`. Document removal events close every open tab for that document; if the removed tab was active, navigation prefers the tab to its left, then the tab to its right, then `/workspace`.
- Workspace panel and tab state render server-safe defaults for hydration, then restore persisted `localStorage` state in a queued client callback. This avoids server/client markup mismatches while keeping the shared protected workspace layout mounted across grouped route transitions.
- The workspace route-group layout injects an inline history-restore guard before React hydration. It forces a normal reload when the browser restores a workspace page through back/forward cache or a `back_forward` document navigation after leaving the app. This must run outside React because broken restores can occur before client effects attach. Debug logs can be enabled with `localStorage.setItem("vault.debug.historyRestore", "true")`. Without this guard, returning from browser PDF viewers, address-bar searches, or external sites can restore stale React/RSC workspace state with missing content or default panel/tab state. In-workspace App Router history navigation is unaffected.
- User has confirmed Markdown editing works in production.
- Uploaded document assets have a working slice: schema/quota metadata, private R2 upload, permission-checked content serving, toolbar upload insertion, private/document-scoped editor autocomplete, Live/Read `![[asset:id|label]]` Markdown rendering, and asset library configuration are implemented. Assets remain user-owned and private by default. Public document pages only resolve explicitly public assets, so publishing a document does not publish embedded private assets.
- Public gallery lists explicitly published assets alongside public documents. Public asset cards open a floating details panel on click, with metadata plus copy embed/copy ID/open actions; no asset is selected by default, and public assets are intentionally copied from this panel rather than appearing in private editor autocomplete.
```

---

## 10. Collaboration Implementation

Current collaboration status:

```txt
Markdown collaboration is deployed and user-confirmed working. Owner/editor sessions and signed-in members using active members-editor share links receive signed Hocuspocus room tokens, CodeMirror binds to `Y.Text`, and the collab service persists text to `documents.markdown` plus binary Yjs state to `document_collab_states`.
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
- Owner/editor document sessions receive a collaboration token. Signed-in users with an active members-editor share link also receive a token while using `/docs/[docId]?share=...`.
- Token includes document id, user id, role, display identity, optional avatar URL, optional share link id, expiry, and HMAC signature.
- Collab service validates the token and re-checks current database edit permission before room access. If a token was granted by a share link, the service also re-checks that the link is enabled, unexpired, scoped to members, and configured for editor access on the same document.
- Link-editor collaboration does not create a `document_permissions` row and does not grant share, delete, or publish rights.
- Yjs awareness powers remote cursors/selections and lightweight toolbar-adjacent presence. The editor hides the presence cluster while solo editing; when more than one awareness user is in the room, it shows overlapping avatar circles using each user's cursor color. Hovering near the cluster expands the icons side-by-side, and hovering an icon shows the user's name/email details.
- Hocuspocus loads `document_collab_states.yjs_state` first. If no row exists, it seeds a Y.Doc from `documents.markdown` once and immediately stores that seeded Yjs state.
- Hocuspocus stores collaborative document text back to `documents.markdown` and the compact Yjs CRDT snapshot back to `document_collab_states`.
- Hocuspocus also reconciles `document_assets` during store by deleting stale links for assets no longer embedded in the persisted Markdown.
- Persisting Yjs state is required for reconnect safety. Reloading every room from plain Markdown creates new CRDT item identities for the same visible characters; a browser reconnecting with older Yjs state can merge both copies and duplicate the full document.
- Non-collab full Markdown writes and restores delete the `document_collab_states` row so the next collab session reseeds from the newest Markdown.
- Before collaborative persistence overwrites Markdown, the collab service uses the same batched checkpoint policy and writes `document_versions.reason = 'collab'` when a checkpoint is due.
- The Markdown editor starts in normal local-autosave mode and only attaches the CodeMirror/Yjs binding after the Hocuspocus provider reports sync. This prevents a blank editor, lost body saves when `ws://localhost:1234` is unavailable, and duplicate full-document inserts from binding local text into an unsynced empty `Y.Text`.
- In collaborative mode, CodeMirror state should be updated through the `y-codemirror.next` binding and the editor `onChange` callback. Do not add a separate `Y.Text.observe()` path that calls `setMarkdownValue()`: `@uiw/react-codemirror` treats `value` prop changes as external document replacements, and those replacements can be echoed back into `Y.Text` as local edits.
- In collaborative mode, CodeMirror receives a one-time initial Markdown value after the first provider sync for that session, then Yjs owns further document updates. Do not bind the `value` prop directly to `Y.Text.toString()` across renders or refresh the initial value on every reconnect/sync event; that can re-present full-document text to CodeMirror while `yCollab` is also applying Yjs updates.
- When switching from Read back to Source/Live in collaborative mode, CodeMirror is remounted with the current `Y.Text` snapshot as its mount seed. This prevents the editor from showing the first synced body while Read still shows the latest React/Yjs markdown state.
- Do not add server-side "deduplication" logic that rewrites repeated document bodies. Repeated content can be intentional user content, so duplication prevention must happen at the collaboration/source-of-truth boundary rather than by guessing after the fact.
- After collaboration is synced, the normal server action saves title changes only so it does not overwrite the live Yjs body.
- Viewer/public routes remain read-only and do not connect to the collaboration service.
```

Known collaboration caveats:

```txt
- If Firefox reports `ws://localhost:1234` connection refused, the local collab server is not running or failed to start. Run `npm run collab` in a separate terminal.
- Title editing is still saved through the normal document autosave path, not collaborative Yjs state.
- Append-only Yjs update-history tables are not implemented; current collaboration persistence stores the latest compact Yjs state snapshot plus Markdown text.
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
| `app/docs/page.tsx` | Hybrid official docs index: workspace shell when signed in, public docs layout when anonymous |
| `app/docs/guides/[slug]/page.tsx` | Hybrid official guide renderer: workspace shell when signed in, public docs layout when anonymous |

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

## 13.1 Workspace UI Knowledge

Current workspace routes:

```txt
/workspace
/docs/[docId]
/docs
/docs/guides/[slug] when signed in
/dashboard/settings
/dashboard/friends
/dashboard/admin
/dashboard/admin/docs
/dashboard/admin/docs/[docId]
/gallery
```

Current workspace behavior:

```txt
- `app/(workspace)/layout.tsx` wraps protected workspace routes in a shared persistent shell. Navigating between grouped workspace routes keeps the tab bar, icon rail, side panel chrome, and resize/collapse client state mounted instead of recreating a full shell per page.
- `VaultWorkspaceShell` owns the icon rail, draggable page tabs, left panel, right context panel, and resizable/collapsible side panel state.
- `WorkspaceChrome` supplies shell data from `getWorkspaceData()` and pages use `WorkspacePageRegistration` to set the active tab title, optional right context panel, and current document item. It keeps a client-side workspace document snapshot that can be patched without waiting for the shared layout to rerender.
- `components/workspace/workspace-events.ts` exposes `dispatchWorkspaceDocumentChanged()` and the subscription helper used by `WorkspaceChrome`. The Markdown editor dispatches title/update events as the title changes and after saves, so open tabs plus file/search/gallery panels reflect the active document title immediately.
- Workspace tabs are client-side navigation state persisted in localStorage; deep links still use normal route URLs.
- The workspace shell is viewport-bound (`h-dvh`/`overflow-hidden`). The browser body should not scroll on workspace pages; the center `main` content area scrolls independently, and side panels own their own internal scroll regions.
- `/workspace` is a raw new-tab surface: greeting title, underline document search, New document action, and one list that shows recent documents until a search query filters owned/shared documents.
- Workspace tabs have a mobile-safe minimum width and live inside a horizontal scroll container rather than shrinking to fit. On mobile, the workspace exposes a Panel drawer with the same mode choices as the desktop icon rail, and document routes expose a Context drawer for right-panel actions.
- The left workspace panel has real modes for files, docs, search, gallery, settings, and admin. Files/docs/search/gallery use richer panels; settings/admin still use compact utility panels.
- `/dashboard/settings` now opens the reusable `SettingsModal` with the account section selected. The modal shell and account section are in place, but the icon rail still navigates to the settings route; the follow-up is to open the same modal over the current workspace tab without replacing it.
- The workspace search panel filters owned docs, shared docs, public docs, and official guides client-side and opens the matching route in the current tab stack.
- The workspace gallery panel filters public docs inline by title, owner display name, username, and public slug, with a link into the full `/gallery?q=...` route for the complete gallery view.
- The full `/gallery` workspace page uses a grid of rendered document preview cards via `WorkspaceDocumentPreviewCard`, reusing the `.vault-doc-preview-*` visual language from the old dashboard previews.
- Signed-in public-document browsing stays inside the workspace: gallery/search public document links route to `/workspace/public/[slug]`, which renders a read-only workspace-native page and context panel. The canonical anonymous/share route remains `/public/[slug]`.
- `/docs/[docId]` is the most complete editor-first route: the document canvas only contains toolbar, live presence, title, editor/preview surface, and fallback save state. Share, visibility, history, and archive controls live in the right context panel.
- Settings, friends, admin users, admin docs list, admin official-doc editor, gallery, and signed-in official docs routes now render inside the workspace shell with flatter workspace-native surfaces.
- `app/dashboard/admin/docs/[docId]/page.tsx` moved to `app/(workspace)/dashboard/admin/docs/[docId]/page.tsx`; it now registers its right context panel and uses a flatter `OfficialDocEditor` surface.
- `/gallery` lists public documents and public assets, filters through the shared metadata-aware search parser, supports tag/owner/kind/visibility filters, and supports `sort:score` plus `sort:trending` for public engagement ordering.
```

Known workspace caveats:

```txt
- Anonymous-capable `/docs` and `/docs/guides/[slug]` remain outside the protected route group so logged-out documentation keeps the public docs layout. Signed-in docs pages still manually wrap in the workspace shell and can be folded into a hybrid shared layout later if that becomes worth the added routing complexity.
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
- After a successful deploy, `scripts/deploy.sh` prunes stale Docker images older than 24 hours and build cache older than 7 days. It intentionally does not prune volumes, so `vault_postgres` is not removed.
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
| Workspace utility conversion | `npm run lint` succeeds after settings/friends/admin/gallery workspace conversion | Passed | 2026-06-14 |
| Workspace utility conversion | `npm run build` succeeds after settings/friends/admin/gallery workspace conversion | Passed | 2026-06-14 |
| Workspace search/gallery panels | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after real side-panel search/gallery tools | Passed | 2026-06-15 |
| Workspace search/gallery panels | Playwright smoke test signs in locally and verifies `/workspace`, `/docs`, and `/gallery` render inside workspace chrome | Passed | 2026-06-15 |
| Workspace scroll domains | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after viewport-bound shell layout changes | Passed | 2026-06-15 |
| Workspace scroll domains | Playwright smoke test on `/docs/[docId]` confirms body scroll height equals viewport height and center `main` owns vertical scrolling | Passed | 2026-06-15 |
| Workspace gallery preview grid | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after gallery preview-card conversion | Passed | 2026-06-15 |
| Workspace gallery preview grid | Playwright smoke test on `/gallery` confirms helper text is gone and rendered preview cards are present | Passed | 2026-06-15 |
| Workspace raw new tab | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after converting `/workspace` to greeting/search/recent surface | Passed | 2026-06-15 |
| Workspace raw new tab | Playwright smoke test confirms greeting title, underline search, New document action, and dynamic search-results heading | Passed | 2026-06-15 |
| Workspace mobile chrome | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after mobile tab/panel accessibility changes | Passed | 2026-06-15 |
| Workspace mobile chrome | Playwright mobile smoke test confirms tabs scroll with 144px minimum width, side-panel mode buttons are accessible, and document Context drawer appears | Passed | 2026-06-15 |
| Editor mode switch | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after adding Read/Live/Source document modes | Passed | 2026-06-15 |
| Editor mode switch polish | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after compacting the mode switch into a hover/focus icon stack and deferring workspace localStorage hydration | Passed | 2026-06-15 |
| Live mode typography polish | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after aligning live-mode body typography, list markers, and callout wrapping closer to read mode | Passed | 2026-06-15 |
| Callout render and selection polish | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after preserving callout body line breaks and keeping active callout source stable during mouse-drag selection | Passed | 2026-06-15 |
| Workspace public reader | `npm run lint`, `npx tsc --noEmit`, and `npm run build` succeed after adding `/workspace/public/[slug]` and routing signed-in gallery/search public docs there | Passed | 2026-06-15 |

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
- The workspace document editor should keep toolbar, live presence, title, editable surface, preview surface, and fallback save state inside one centered editor column. Avoid reintroducing independent max-width children that drift out of alignment.
- Workspace routes should keep shell chrome fixed in the viewport. Avoid replacing `h-dvh`, `min-h-0`, or region-level `overflow-y-auto` with page-level `min-h-screen` patterns that make the whole browser body scroll.
- Uploaded assets must stay private by default. Do not insert raw R2 URLs into Markdown, do not expose public R2 bucket/custom-domain reads for private assets, and do not make document publishing automatically publish embedded assets.
```

---

## 19. Next Best Tasks

Keep this short and current.

```txt
1. Work through `docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` until the settings modal, user settings storage, extension settings storage, local extension browser, runtime gating, and no-op stickers manifest are complete.
2. Add robust source reveal and drag-selection tests for Live block widgets.
3. Evaluate whether standalone asset embeds should move from the viewport plugin into the Live block registry after selected-asset formatting remains stable.
4. Add focused tests around asset privacy: owner, collaborator, public asset, private embedded asset in public document, and deleted asset cases.
5. Add richer gallery filters for public documents and public assets after tags/categories are designed.
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
| 2026-06-09 | Revamped document sharing | Sharing moved into a modal with friend-prioritized user autocomplete, thinner access rows, and revocable copyable share links for anyone-viewer, members-viewer, and members-editor access |
| 2026-06-09 | Persisted Yjs collaboration state | Added `document_collab_states` and changed the collab server to load/store binary Yjs snapshots so room unload/reconnect cycles do not recreate Markdown as new CRDT text and duplicate content |
| 2026-06-12 | Added share-link collaboration presence | Active members-editor links now authorize normal Yjs collaboration without permanent permission rows, and the editor header shows live collaborator avatars with cursor-color rings |
| 2026-06-14 | Planned workspace UI revamp | Added `docs/10_WORKSPACE_UI_REVAMP_PLAN.md` for an Obsidian-like workspace shell, tabs, side panels, gallery direction, URL rules, and phased rollout |
| 2026-06-14 | Added initial workspace shell | Added `/workspace`, persistent localStorage page tabs, icon rail, collapsible left file panel, compact owned/shared/published/recent document lists, `/gallery` v1, and `/dashboard` redirect compatibility |
| 2026-06-14 | Integrated official docs into workspace | Signed-in `/docs` and `/docs/guides/[slug]` now render inside the workspace shell with a docs navigation panel, while anonymous docs routes keep the public layout; workspace tabs now preserve order when returning to an existing tab |
| 2026-06-14 | Moved document editor route into workspace | `/docs/[docId]` now renders inside `VaultWorkspaceShell` with persistent tabs and file browser while preserving existing Markdown editor, collaboration, sharing, history, publish, and archive behavior |
| 2026-06-14 | Added Playwright browser verification setup | Added `@playwright/test` as a dev dependency and installed local Chromium browser bundles so workspace routes can be smoke-tested with Playwright |
| 2026-06-14 | Flattened document editor workspace view | Removed the old document route header/sidebar from `/docs/[docId]`, moved the Markdown toolbar above the title, aligned the live editor surface to the document column, and hid the bottom Save button unless autosave/collab fails |
| 2026-06-14 | Added workspace document context panel | Restored share, publish, restore-point, and archive controls as a narrow workspace right panel so the document canvas stays editor-only |
| 2026-06-14 | Added resizable workspace side panels | `VaultWorkspaceShell` now persists left navigation width, right context width, and right/left collapsed state, with draggable desktop panel edges |
| 2026-06-14 | Reduced workspace transition flicker | Workspace shell panels and tab bar now initialize from localStorage immediately instead of rendering defaults first and snapping after mount |
| 2026-06-14 | Restored lightweight live presence | Markdown editor now shows collaborator avatars beside the toolbar only when multiple Yjs awareness users are active, with cursor-color rings and hover identity details |
| 2026-06-14 | Centered workspace editor column | Toolbar, live presence, title, editor body, preview pane, and fallback save state now share one centered document column so the writing surface feels like an Obsidian tab instead of a nested page frame |
| 2026-06-14 | Added draggable workspace tabs | Workspace tabs can now be rearranged by dragging, and the reordered tab list persists in localStorage |
| 2026-06-14 | Added workspace utility panels | `VaultWorkspaceShell` now supports search, gallery, settings, and admin panel slots, with `WorkspaceUtilityPanel` providing real navigation for non-file modes |
| 2026-06-14 | Converted utility routes into workspace | Settings, friends, admin users, admin docs list, and gallery now render inside the workspace shell with flatter workspace-native surfaces; gallery search filters public docs by title, owner, username, and slug |
| 2026-06-15 | Added deploy image cleanup | Successful deploys now run conservative `docker image prune` and `docker builder prune` commands to remove stale images/cache without touching volumes |
| 2026-06-15 | Added shared protected workspace layout | Protected workspace routes moved under `app/(workspace)` and share `WorkspaceChrome`, so tab/panel chrome persists across `/workspace`, `/docs/[docId]`, `/gallery`, and `/dashboard/*` workspace navigation |
| 2026-06-15 | Converted official-doc editor to workspace | `/dashboard/admin/docs/[docId]` now uses the shared workspace shell, registers an admin context panel, and uses a flatter official-doc editor surface |
| 2026-06-15 | Added real workspace search and gallery panels | Search now quick-opens owned, shared, public, and guide pages from the side panel; gallery now filters public docs inline and links into the full gallery route |
| 2026-06-15 | Fixed workspace scroll domains | Workspace shell is now viewport-bound so document pages scroll only in the center content area while side panels stay fixed and scroll internally |
| 2026-06-15 | Added gallery preview grid | `/gallery` now shows public documents as rendered preview cards and workspace page helper copy was reduced across the shell |
| 2026-06-15 | Simplified workspace new tab | `/workspace` now uses a raw greeting, underline document search, New document action, and a recent/search result list instead of shortcut cards |
| 2026-06-15 | Improved mobile workspace chrome | Workspace tabs now scroll with a minimum tab width on mobile, the left panel drawer exposes all panel modes, and document pages expose a mobile context drawer |
| 2026-06-15 | Added Read/Live/Source editor modes | Normal document editing now exposes Read for fully rendered output, Live for the main decorated CodeMirror editing experience, and Source for raw Markdown |
| 2026-06-15 | Polished editor mode switch and hydration | The Read/Live/Source control is now a compact icon stack that expands on hover/focus; workspace panel/tab state restores after hydration; the root theme provider no longer renders the `next-themes` script |
| 2026-06-15 | Polished live-mode rendering | Live mode now uses read-mode-style body typography, inactive rendered list markers, and callout hanging indents so wrapped callout paragraphs stay aligned with their content |
| 2026-06-15 | Fixed callout line breaks and drag selection | Read mode now preserves callout body line breaks as separate paragraphs, and live mode keeps an active callout in source while dragging a selection from inside it |
| 2026-06-15 | Added workspace public reader | Signed-in gallery/search public-document links now open `/workspace/public/[slug]`, preserving workspace chrome while keeping `/public/[slug]` as the canonical external share page |
| 2026-06-15 | Planned private asset storage and library | Added `docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md`, changed storage env examples away from public R2 URLs, hardened `lib/storage/r2.ts`, and recorded that document publishing must not automatically publish embedded assets |
| 2026-06-15 | Added first private asset storage slice | Added asset/quota schema and migration, private R2 upload/list APIs, permission-checked asset content streaming, Markdown asset embed rendering, and toolbar upload insertion in the document editor |
| 2026-06-15 | Added asset library test surface | Added `/assets` workspace library with masonry-style owned asset browsing, metadata editing, copy embed, public/private toggles, and `/gallery` integration for explicitly public assets |
| 2026-06-15 | Completed asset workflow follow-up slice | Added editor clipboard/drop upload, asset library search/filter/sort/delete, metadata GET, byte Range content responses, and asset audit/repair/export scripts |
| 2026-06-16 | Added controlled asset embed attributes | `![[asset:id|label]]{layout align width caption alt}` now renders consistently in Read mode and inactive Live mode without allowing arbitrary embed CSS |
| 2026-06-16 | Added selected-asset formatting controls | Cursoring into an asset embed source now shows a floating inspector for layout, alignment, width, caption, and alt text that rewrites the Markdown attribute block |
| 2026-06-16 | Added first-pass asset groups | `:::assets` fences now render responsive grouped image grids in Read mode and inactive Live mode |
| 2026-06-16 | Started specialized CM6 Live Preview layer | Added the architecture plan and `components/markdown/live-blocks.ts`, a syntax-aware scanner/direct decoration field that renders inactive asset groups while ignoring fenced code |
| 2026-06-16 | Added asset group formatting control | Rendered Live-mode asset groups now expose an icon-only configure button that opens a group panel for columns, gap, alignment, width, and caption |
| 2026-06-16 | Added asset group toolbar insertion | The toolbar can insert a new `:::assets` scaffold or wrap selected standalone asset embed lines into a centered grid group |
| 2026-06-16 | Moved callouts into Live block widgets | Inactive Live-mode callouts now render through `MarkdownDocument` via the syntax-aware Live block layer, matching Read-mode icons and markup while preserving source reveal on cursor entry |
| 2026-06-16 | Added private asset autocomplete | Editor completion inside `![[asset:...]]` suggests owned/current-document assets only and links selected existing assets to the open document before insertion |
| 2026-06-16 | Added public asset gallery details | Public gallery asset cards now show a details panel with metadata plus copy embed, copy ID, and open asset actions |
| 2026-06-16 | Added workspace document state sync | Document pages upsert themselves into the workspace document snapshot, and Markdown title edits dispatch workspace events so tabs and document panels update immediately |
| 2026-06-17 | Refreshed README and asset guides | README is now a short repo landing page; repo-backed guides now cover asset library usage, embed syntax, layout attributes, asset groups, privacy/sharing behavior, PDF cards, and rendered examples |
| 2026-06-17 | Moved document embeds into Live block widgets | Standalone Live-mode document transclusions now render through the syntax-aware `live-blocks.ts` direct decoration field instead of the older viewport plugin widget path |
| 2026-06-22 | Added live table block rendering | Inactive Live-mode GFM tables now render through `MarkdownDocument` via the syntax-aware Live block layer and reveal raw source when active |
| 2026-06-22 | Refined extension and core math groundwork | `docs/12_EXTENSION_REGISTRY_PLAN.md` now separates core math work from optional extensions and defines the next registry/runtime slices before sticker or calendar prototypes |
| 2026-06-22 | Added extension registry runtime and core math | Added `lib/extensions/registry.ts`, routed current LiveBlockSpecs through a core extension contribution, installed `remark-math`/`rehype-katex`, and rendered inactive Live-mode display math through `MarkdownDocument` |
| 2026-06-22 | Added extension state runtime API | Added sanitized server actions and a debounced client hook for authenticated built-in extensions to read and write object-shaped document extension state |
| 2026-06-23 | Fixed Live block cursor geometry | Removed zero-height CodeMirror carrier-line styling and external block-widget margins for rendered Live block widgets, then added adjacent-block ArrowUp/ArrowDown source entry so math/table/block widgets do not break click mapping or vertical cursor navigation |
| 2026-06-23 | Added Live inline math rendering | Inactive Live-mode `$...$` spans now render with KaTeX inline widgets while preserving source reveal and skipping escaped dollars and inline code |
| 2026-06-23 | Added active Live math previews | Active `$$...$$` blocks now show a measured KaTeX preview frame under the editable source, and active `$...$` inline math shows a floating KaTeX tooltip |
| 2026-06-23 | Closed workspace tabs on archive | Archiving a document now dispatches a workspace removal event so sidebars and all open tabs for that document disappear immediately; active archived tabs move left-first |
| 2026-06-23 | Made share links persistent and previewable | Share-link settings now update one stable URL per document, and anonymous-readable `/share/:token` pages emit OpenGraph/Twitter metadata plus generated preview images |
| 2026-06-24 | Planned settings modal and extension browser checkpoint | Added `docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md` and tracker entries for modal settings, user settings persistence, extension settings, local extension browser, runtime gating, and no-op stickers preflight before real sticker placement |
| 2026-06-24 | Started settings modal implementation | Extracted reusable account settings UI and changed `/dashboard/settings` to open a large sectioned `SettingsModal`; remaining modal work is current-tab overlay opening and real persistence-backed sections |
| 2026-06-24 | Added settings persistence schema | Added migration `0013_majestic_fabian_cortez.sql`, `user_settings`, `user_extension_settings`, and `server/user-settings.ts` helpers for validated user preferences and per-user extension enablement/settings |
| 2026-06-24 | Added settings modal extension browser slice | Workspace settings icon now opens the modal over the current tab; local extension catalog, `vault.stickers` preflight manifest, extension settings actions, and modal extension browser/installed sections are wired with build-passing enable/disable/reset flows |
| 2026-06-24 | Made settings modal-only and added preference sections | Removed the old settings utility sidebar path, moved the workspace settings button to the bottom of the icon rail, added persisted modal sections for appearance/workspace/editor/files-assets/hotkeys/core-features/advanced settings, and added named theme runtime support |
| 2026-06-24 | Converted preferences to autosave rows | Replaced submit-form preference sections with vertical setting rows and right-aligned controls that autosave on change, matching mature editor settings patterns |
| 2026-06-24 | Adjusted docs rail and tab behavior | The workspace Docs rail button now only opens the docs sidebar instead of navigating to `/docs`, the docs panel header is no longer a link, and middle-clicking a workspace tab closes it |
| 2026-06-24 | Added crawler metadata | Added generated `robots.txt`, dynamic `sitemap.xml`, and a shared site URL helper so search engines discover only public home/docs/terms/privacy/published-note pages while private workspace/share/API surfaces stay unlisted or disallowed |
| 2026-06-24 | Added privacy policy | Added repo-backed `/privacy`, linked it from login/home/terms, included it in robots/sitemap, and updated legal docs so account sign-in points users to both terms and privacy information |
| 2026-06-24 | Started metadata/tag/search foundation | Added `docs/14_METADATA_TAGS_SEARCH_PLAN.md`, global tag/frontmatter schema in migration `0014_real_lizard.sql`, parser/sync helpers, document metadata sync on save/restore/collab store, and optional asset tag sync in the asset PATCH path |
| 2026-06-24 | Added metadata editing UI | Added document Properties controls that rewrite YAML frontmatter, stripped frontmatter from rendered Markdown, returned/editable asset tags in the asset library, and included asset tags in local library filtering |
| 2026-06-24 | Added metadata-aware search parser and tag suggestions | Added shared mixed-query parsing, updated asset library and gallery filtering to match bare words against text/tags and `tags:` runs, added public document tag hydration, and exposed scoped `/api/tags/completions` suggestions |
| 2026-06-24 | Added public content interactions slice | Added signed-in like toggles, daily unique-ish view recording, public document/asset stats, card/detail counters, and simple score-based gallery ordering for `sort:score`/`sort:trending` |
| 2026-06-24 | Added workspace command search | Added authenticated `/api/content/search` and a workspace Ctrl/Cmd+K command palette for quick-opening readable documents, public content, owned assets, and official guides |
| 2026-06-24 | Improved search ranking and command UX | Gallery public document/asset search now pushes metadata filters into SQL, `sort:trending` uses seven-day activity instead of all-time score, and Ctrl/Cmd+K has grouped keyboard-navigable results |
| 2026-06-24 | Added tag autocomplete UI | Document Properties and asset metadata editors now use a shared space-separated tag autocomplete input backed by `/api/tags/completions` suggestions and usage counts |
| 2026-06-24 | Added admin tag management | Added `/dashboard/admin/tags` plus admin actions for canonical tag authoring, aliases, usage counts, unused filtering, bulk safe orphan cleanup, and per-tag deletion |
| 2026-06-25 | Added metadata/search user guides | Added repo-backed docs for document Properties, shared tags, search tokens, asset metadata, public/private search behavior, and updated the asset library guide to mention tags |
| 2026-06-26 | Added rebindable keyboard shortcuts | New `lib/shortcuts/` registry (single source of truth for editor + global shortcuts), per-user overrides persisted in the `hotkeys` prefs (`keybindings` map, migrates the old `commandPaletteShortcut`), `KeybindingsProvider` context with `useKeybindings`/`useGlobalShortcuts`, a key-capture rebinding UI with conflict detection in the Hotkeys settings (replaces the dead placeholders), and live apply via the `vault:keybindings-changed` event. The editor keymap and the command palette now read bindings from the registry; toolbar tooltips reflect rebinds. Resolved the Ctrl+K palette vs. insert-link conflict (link default moved to Ctrl+Shift+K) |
| 2026-06-29 | Fixed nested lists under task items in rendered Markdown | `.vault-md-li:has(.vault-md-checkbox)` is a 2-column grid (checkbox + content); nested `<ul>`/`<ol>` and loose-list `<p>` were auto-flowing into the 1rem checkbox track and rendering one character per line in Read/preview mode. Added a rule in `app/globals.css` forcing non-checkbox children into the content column |
| 2026-06-29 | Added Live-mode horizontal rules and Setext headings | `components/markdown/MarkdownEditor.tsx` now renders idle `---`/`***`/`___` thematic breaks as a horizontal rule (`HorizontalRuleWidget`) and styles `Title`+`===`/`---` Setext headings as H1/H2 with the underline hidden, both revealing raw source on cursor entry. Shares `getFrontmatterEndLine()` with the frontmatter-hiding extension so YAML `---` delimiters are never mistaken for rules, and leaves dash runs under a paragraph as Setext underlines (matching the renderer) |
| 2026-06-29 | Added Live-mode underscore emphasis and strikethrough | Live preview now decorates `_italic_`/`__bold__` (CommonMark intra-word guards via `(?<![\w_])…(?![\w_])`, plus a link/URL/wiki-link guard so underscores in destinations stay literal) and `~~strikethrough~~`, closing the gap where these rendered in Read mode (remark-gfm) but not in Live mode |
| 2026-06-29 | Centralized asset limit defaults in repo config | Added `lib/config/asset-limits.ts` as the committed source of truth for per-upload image/PDF caps and the per-user storage quota default; `getAssetUploadLimits()` and the `users.storage_quota_bytes` schema default now read from it. Raised the new-user quota default to 50 MiB (migration `0016_flawless_betty_ross.sql`; existing rows unchanged), with `MAX_IMAGE_UPLOAD_BYTES`/`MAX_PDF_UPLOAD_BYTES` kept as optional env overrides. Removed the dead `DEFAULT_USER_STORAGE_QUOTA_BYTES` env var from `.env.example` and docs |
| 2026-06-29 | Added admin per-user quota editing and Assets sidebar tab | Admin asset storage page now has an inline per-user "Quota (MiB)" form backed by a new `updateUserQuotaAction` (`server/assets-admin.ts`, capped at 1 TiB) so admins can raise/lower individual quotas; `/dashboard/admin/assets` is now a first-class item in the admin utility-panel sidebar (`WorkspaceUtilityPanel`) instead of being reachable only from the main admin page |
| 2026-06-29 | Overhauled admin into a dashboard | Restructured the admin area around a shared `AdminShell` (header + `AdminNav` tab bar across Overview/Users/Assets/Tags/Docs) replacing the per-page headers and "Back to admin" buttons. `/dashboard/admin` is now a metrics Overview (user + storage KPIs, recent signups, quick links) via new `getAdminUserOverview`; user management moved to `/dashboard/admin/users` as a dense sortable/filterable/paginated table (`listUsersForAdmin` rewritten to take options and return storage/asset counts + total) with a per-user detail drawer (new `components/ui/sheet.tsx`) consolidating role, ban/unban, quota, recalc, and a cross-link to the user's assets. Added shared `lib/format.ts` `formatBytes` and `components/admin/metric-card.tsx` (`MetricCard` + `UsageBar`, the latter with a `showLabel` prop); the Assets and Tags pages now consume these shared components instead of their own local copies. The focused doc editor opts out of the shell. Sidebar/`WorkspaceChrome` updated for the Overview/Users split |
