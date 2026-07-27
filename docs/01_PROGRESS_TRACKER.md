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
| [x] | Revamp sharing modal and link access | Sharing moved to a modal with friend-prioritized user autocomplete, thinner access rows, and one stable revocable share link per document; anonymous-readable share links emit social preview metadata |

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
| [x] | Add crawler metadata | `/robots.txt` and `/sitemap.xml` advertise only public home/docs/terms/privacy/published-note routes and keep workspace/share/private surfaces out of indexing |

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
| [~] | Add specialized CM6 Live Preview layer | Plan added to `docs/05_EDITOR_AND_COLLAB.md`; asset groups, inactive callouts, standalone document embeds, and GFM tables now use syntax-aware detection plus direct `StateField` block widgets with source reveal; asset groups also expose an icon-triggered formatting panel |
| [x] | Add heading-scoped wiki links | `[[doc#heading]]` links navigate to rendered heading anchors; `![[doc#heading]]` embeds only the selected heading section |
| [x] | Add block and region-scoped wiki links | `[[doc#^block-id]]` targets hidden Obsidian-style block anchors; `[[doc#@region-id]]` targets hidden Vault regions; embeds render only the selected block/region |
| [x] | Add guide/public wiki namespaces | `guide:<slug>` links official docs; `public:<slug>` links published user docs and autocomplete shows publisher usernames |
| [x] | Flatten writing surfaces | Live editor and Preview/public reading modes now use seamless page surfaces instead of large card frames; Live mode hides line-number/fold gutters |
| [x] | Add uploaded document assets | Private R2 upload, permission-checked serving, library/gallery surfaces, editor insertion, asset autocomplete, controlled layout attributes, groups, cleanup, and user docs are implemented |

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
| [x] | Add privacy policy | `/privacy` renders `content/legal/privacy.md`; login and public landing page link the policy, and crawler metadata includes it |

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
| [x] | Add workspace document state sync | Document pages upsert themselves into the client workspace snapshot, and editor title changes patch open tabs plus workspace document panels immediately instead of waiting for a route switch or refresh |
| [x] | Add real search and gallery side panels | Workspace search quick-opens owned, shared, public, and guide pages; the gallery side panel filters public docs inline and links to the full gallery |
| [x] | Add workspace public reader | Signed-in gallery/search public-document opens now route to `/workspace/public/[slug]`, a read-only workspace-native view; `/public/[slug]` remains the canonical external public page |
| [~] | Final workspace visual pass | Document editor route now uses a centered Obsidian-like editor column with Read/Live/Source modes, a compact hover/focus icon stack for mode switching, and live-mode typography/list/callout styling closer to Read mode; new tab is a raw greeting/search/recent surface; workspace shell has independent scroll domains for center/side panels and hydration-safe persisted chrome state; gallery uses rendered document preview cards; mobile tabs scroll with minimum widths and mobile drawer controls expose left/right panels; archived documents close their workspace tabs and select the nearest remaining tab; remaining routes need a final consistency pass |

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
| [x] | Add asset schema and migrations | Migration `0011_tiresome_ultimates.sql` adds user quota fields, `assets`, and `document_assets` |
| [x] | Add private upload API | `POST /api/assets` authenticates, checks document edit access, validates file signatures, reserves quota, uploads to private R2, stores metadata, and links to the document |
| [x] | Add private serving API | Permission-checked `/api/assets/:assetId/content` streams from private R2; private linked assets require a signed-in readable document context |
| [x] | Render Markdown asset embeds | `![[asset:id|label]]` resolves through server-provided asset maps; image embeds support controlled layout/align/width/caption/alt attributes and first-pass `:::assets` grid groups in Read mode and inactive Live mode, PDF/file embeds render as compact cards, and selected-embed editor controls exist; public document pages only resolve explicitly public assets |
| [x] | Add editor upload and paste flows | Toolbar file picker, clipboard paste, and drag/drop upload supported through the same asset API |
| [x] | Add asset library page | `/assets` workspace page has a masonry-style owned asset grid, search/filter/sort controls, details/config panel, metadata editing, delete, and copy embed |
| [x] | Add explicit asset publishing | `/assets` can toggle owned assets public/private; publishing documents still does not publish embedded assets, and the owner publish control warns when linked private embeds will be hidden publicly |
| [x] | Integrate public assets into gallery | `/gallery` lists explicitly public assets alongside public documents |
| [x] | Add cleanup and reconciliation tools | Document saves/collab stores remove stale document-asset links; `assets:audit`, `assets:repair-quota`, `assets:delete-orphans`, and `assets:export` cover unused asset detection, object cleanup, quota repair, and R2 export |
| [x] | Add asset user guides | Repo-backed docs now cover the asset library, privacy/sharing rules, autocomplete, embed syntax, image layout attributes, asset groups, PDF/file cards, and rendered examples |

Exit criteria:

```txt
Users can upload/paste images into private docs, browse owned assets, and publish
individual assets to the gallery without making private document assets public by
default.
```

---

## Phase 12 - Extension Registry

Reference plan: `docs/12_EXTENSION_REGISTRY_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write extension registry plan | Separates core editor features from trusted built-in extensions, covers Markdown blocks, document overlay state, workspace contributions, asset-backed extensions, and a future verified plugin path |
| [x] | Add registry types | Added `lib/extensions/types.ts` for trusted built-in extension manifests, Markdown contributions, document-state overlays, workspace contributions, and permissions |
| [x] | Refactor Live blocks into specs | Asset groups, callouts, document embeds, and GFM tables now flow through internal `LiveBlockSpec`s without changing the rendered behavior |
| [x] | Add document extension state schema | Added migration `0012_tiny_tana_nile.sql`, `document_extension_states`, and permission-checked server helpers for non-Markdown extension data such as stickers and overlays |
| [x] | Add document overlay host | Added `DocumentOverlayHost` around the editor column with a pointer-safe absolute overlay layer for future trusted extension visuals |
| [x] | Flesh out registry groundwork | `docs/12_EXTENSION_REGISTRY_PLAN.md` now defines the next registry runtime, LiveBlockSpec migration, core math slice, extension state runtime, overlay mounting, workspace contribution slots, and prototype order |
| [x] | Add core math rendering | `remark-math` and `rehype-katex` now run in the shared Markdown pipeline; Live mode renders inactive `$$...$$` block math through the Live block registry, active block math previews underneath source, and active inline math tooltips |
| [~] | Move Live block specs into registry | Added `lib/extensions/registry.ts` and route current core LiveBlockSpecs through a `VaultExtension`; splitting specs into separate registry-owned modules remains |
| [x] | Add extension state runtime API | Added permission-checked server actions and a debounced client hook for object-shaped document extension state |
| [x] | Prototype stickers extension | `vault.stickers` extension: `ContentPickerDialog` reusable asset picker (debounced search, kind tabs, persisted "include public" toggle), `StickerLayer` overlay with pointer-capture drag and delete, sticker button injected via `MarkdownToolbar.extensionItems`, `stickersEnabled` fetched from `userExtensionSettings` at doc load |
| [~] | Prototype calendar extension | `vault.calendar` block built end-to-end: `lib/calendar.ts` fence/day-math helpers, `calendarStateSchema`, `server/calendar-state.ts` public prefetch, `CalendarBlock` widget, Live-mode `CalendarBlockWidget`, and a toolbar insert (`CalendarToolbarGroup` → `applyFormat("calendar")`) that drops a `:::calendar{id=…}` block with a fresh id. Doc page now fetches `vault.calendar` settings and wires `calendarEnabled`/`weekStartsOn`/`visibility` so the gated toolbar button actually renders. Remaining: command-palette/slash execution of the declared `vault.calendar.insert` command |

Exit criteria:

```txt
Optional Vault features can register editor blocks, workspace UI, and document
overlay state without becoming hardcoded core editor branches.
```

---

## Phase 13 - Settings Modal and Extension Browser

Reference plan: `docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write settings and extension browser plan | Defines the modal settings UX, user settings storage, extension settings storage, registry metadata additions, extension browser, runtime gating, and stickers-ready checkpoint |
| [x] | Extract existing settings UI | Account/profile/OAuth content now lives in reusable settings components; future sections can be added independently |
| [x] | Add settings modal shell | The workspace settings rail opens a large sectioned modal over the current tab; `/dashboard/settings` remains a direct route that opens the same modal |
| [x] | Add user settings persistence | Migration `0013_majestic_fabian_cortez.sql` adds `user_settings`; server helpers/actions plus modal sections now persist appearance, workspace, editor, files/assets, hotkeys, core features, and advanced preferences |
| [x] | Add named theme runtime | Theme provider supports dark, light, midnight, graphite, paper, and system through `data-theme`, dark-class compatibility, localStorage first-paint mirror, and server persistence |
| [~] | Extend extension registry metadata | Registry types now include descriptions, categories, default enablement, settings metadata, command metadata, contribution selectors, and enabled-extension filtering; remaining work is moving all runtime contribution consumers onto the selectors |
| [x] | Add user extension settings persistence | Migration `0013_majestic_fabian_cortez.sql` adds `user_extension_settings`; server helpers and actions persist per-user enablement/settings, validate extension ids against the local catalog, and validate settings through registered schemas |
| [~] | Add local extension browser | Settings modal lists local built-ins, permissions, contribution types, current setting values, enable/disable, reset, and installed extensions; generated editable forms still remain |
| [~] | Gate runtime contributions by enablement | Registry has enabled-extension selectors; workspace panels, document overlays, and command consumers still need to consume them |
| [~] | Add stickers preflight manifest | Disabled-by-default `vault.stickers` local built-in is registered with settings, permissions, commands, and overlay metadata; placeholder gated overlay still remains |

Exit criteria:

```txt
The settings modal and extension browser can enable and configure trusted
built-in extensions, and a no-op stickers extension can be toggled without
hardcoded settings or overlay wiring.
```

---

## Phase 14 - Metadata, Tags, Search, and Popularity

Reference plan: `docs/14_METADATA_TAGS_SEARCH_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write metadata/search plan | Documents use frontmatter properties, assets use the same tag vocabulary, tags are global canonical records, tag input is space-separated with underscore multi-word tags, and public content gets likes/views/trending |
| [x] | Add metadata schema | Migration `0014_real_lizard.sql` adds tags, aliases, document/asset tag joins, document metadata, content likes, and content views |
| [x] | Add frontmatter/tag parser | `lib/content-metadata.ts` extracts indexed fields and normalizes space-separated tags |
| [x] | Sync document metadata on saves | Normal saves, restores, and collaboration stores sync frontmatter metadata and document tags |
| [x] | Sync asset tags | Server/API accept optional asset tag arrays, sync `asset_tags`, return asset tag lists, and expose a tag editor in the asset library |
| [x] | Add document Properties UI | Compact Obsidian-style top block rewrites YAML frontmatter for tags, aliases, summary, status, and project |
| [x] | Add tag autocomplete API/UI | `/api/tags/completions?q=&scope=mine|public` returns scoped tag suggestions and counts without leaking private tags; document Properties and asset metadata editors use the shared autocomplete input |
| [x] | Add tag admin management | Admins can create/edit canonical tags, add/remove aliases, see document/asset usage counts, filter unused tags, bulk delete safe unused orphans, and manage tags from `/dashboard/admin/tags` |
| [x] | Replace gallery search backend | Shared parser supports bare mixed search plus `tags:`, `kind:`, `owner:`, `visibility:`, and `sort:` tokens; public document/asset gallery searches push metadata filters into SQL and rank by title/tag/summary/owner relevance when text terms are present |
| [x] | Add likes/views UI and actions | Signed-in like toggle, daily unique-ish view records, public document/asset counts, all-time `sort:score`, and seven-day `sort:trending` gallery ordering are wired |
| [x] | Add Ctrl+K content search | `Ctrl/Cmd+K` opens a grouped keyboard-navigable command palette backed by `/api/content/search` for readable docs, shared docs, owned assets, public content, and official guides |
| [x] | Add metadata/search guide docs | Added repo-backed user guides for document Properties, shared tags, search tokens, asset metadata, and public/private search behavior |

Exit criteria:

```txt
Documents and assets share searchable tags/metadata, public content can be
ranked by score/trending, and Ctrl+K can search readable content without
leaking private metadata.
```

---

## Phase 15 - MCP Integration (AI document read/edit)

Reference plan: `docs/15_MCP_INTEGRATION_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write MCP integration plan | Settled decisions: snapshot reads / live edits, attribute AI edits to the user with an `assistant` version reason, self-hosted minimal OAuth AS |
| [x] | Phase 1 — read-only MCP server | `/api/mcp/mcp` via `mcp-handler`; tools `list_documents`/`search_documents`/`get_outline`/`read_document` delegate to `server/documents.ts`; dev auth via `MCP_DEV_USER_ID`; verified end-to-end over JSON-RPC |
| [x] | Phase 2 — collab-safe writes | `lib/mcp/collab-write.ts` connects a Node HocuspocusProvider with `createCollabToken`; `edit_document` (anchored search/replace deltas) + `append_to_document`/`insert_at_heading`; verified edit/append/insert persist through the collab pipeline |
| [x] | Phase 3 — self-hosted OAuth AS | Metadata (RFC 8414/9728) + DCR + `/oauth/authorize` (delegates to NextAuth session, PKCE consent) + `/oauth/token` (auth_code + refresh, S256); `mcp_clients`/`mcp_auth_codes`/`mcp_tokens` tables (migration 0017); `/api/mcp` wrapped with `withMcpAuth`; verified register→token→authed call→refresh |
| [x] | Document lifecycle tools | `create_document` (owner-permissioned, optional title/markdown, metadata synced) and `delete_document` (owner-only soft-delete with `before_archive` snapshot), via `createDocumentForUser`/`archiveDocumentForUser` |
| [x] | Metadata, versioning, and tag-search tools | `update_document` (title→DB, frontmatter→collab via `replaceYTextMinimal`+`updateDocumentMetadataFrontmatter`); `list_versions`/`read_version`/`restore_version`; `restore_document` (un-archive); tag/scope filtering in `search_documents` |
| [x] | Asset discovery + embedding tools | `search_assets` (text/tags/kind) and `embed_asset` (styled `![[asset:…]]{…}` embed via `formatAssetEmbedSource`, collab-safe placement + explicit `document_assets` link). 16 MCP tools total |
| [~] | Phase 4 — hardening | Done: per-op `assistant` version snapshots (granular undo), "via assistant" badge in history UI, retention cap (newest 30/doc via `pruneAssistantVersions`). Remaining: per-token rate limits, consent polish, observability, list_documents pagination/filters |

Exit criteria:

```txt
External AI clients can authenticate via OAuth and read/edit a user's documents
through the collaborative editor without conflicting with live editors.
```

---

## Phase 17 - Polish, Hardening, and CSS Snippets

Reference plan: `docs/17_POLISH_AND_CSS_SNIPPETS_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write audit + snippets plan | 2026-07-02 review: no CSP/security headers, `className`-on-`*` sanitize hole (app-class borrowing → viewer UI spoofing), no tests over the sanitize pipeline, globals.css monolith, undocumented `vault-md-*` contract, duplicated render pipelines |
| [x] | Phase 0 — hardening blockers | Done: `proxy.ts` CSP (enforced + report-only nonce) + security headers; `className` lockdown via `lib/html-class.ts` + extracted `lib/markdown/sanitize.ts`; vitest suite (48 tests); `globals.css` split into `app/styles/*`; `DocumentCanvas` + containment; `lib/rate-limit.ts`; `docs/CSS_CONTRACT.md` |
| [x] | Phase 1 — schema + compiler | Migration `0018`; `lib/snippets/compile.ts` (css-tree: allowlists, scope rewrite under `[data-vault-snippet-scope]`, keyframe rename, no url()/network, AST re-serialize, reduced-motion reset) + golden unit corpus; `server/snippets.ts` + `server/snippets-actions.ts` CRUD/attach/compile |
| [~] | Phase 2 — manager + editor UX | Done: Settings→Snippets section with list/create/delete + CodeMirror CSS editor (draft-compile preview + diagnostics) + global opt-out. Editor is in-modal (not a full workspace tab); palette/tab registration deferred |
| [x] | Phase 3 — viewer application | Scoped nonce'd `<style>` on all four read surfaces via `DocumentStyling`; containment; per-view pill; `appearance/snippets` global opt-out; owner "Styling" card (`DocumentSnippetsPanel`). Playwright smoke deferred |
| [ ] | Phase 4 — editor live mode + polish | Live-mode scope, authoring guide, compile cache/dedupe, same-origin asset url() |

Exit criteria:

```txt
Owners can author, validate, and attach CSS snippets; every viewer sees them
applied only inside the document body, can disable them, and no snippet can
affect app chrome, other pages, or the network.
```

---

## Phase 18 - Editor Slash Commands

Reference plan: `docs/18_EDITOR_SLASH_COMMANDS_PLAN.md`

| Status | Task | Notes |
|---|---|---|
| [x] | Write editor slash commands plan | Two-surface rule: markdown insertions → editor slash menu, non-markdown operations → workspace command bar; calendar is dual-surface, stickers stay bar-only |
| [x] | Slice 1 — core slash completion source | Done 2026-07-11: `components/markdown/slash-commands.ts` registered as a 4th `autocompletion` override in `MarkdownEditor`; 15 core items reuse `applyFormat`/`insertBlock`; triggers only at line start/after whitespace, excluded in frontmatter/fenced/inline code; uses CodeMirror's native filter (token+keywords in `label`, human name in `displayLabel`, `validFor`) so Enter/Tab accept via the existing `acceptCompletion` binding; `apply` deletes the `/query` then inserts. 10-test vitest (`slash-commands.test.ts`) covers the exit criteria |
| [x] | Slice 2 — extension slash contributions | Done 2026-07-11: `SlashCommandContribution` type + `markdown.slashCommands` manifest field (markdown-only, no `MarkdownFormat` coupling; factory `insert.markdown` for per-insert ids); registry `getSlashCommandContributions()`; `vault.calendar` declares its slash item in the catalog; editor builds enabled items from the registry filtered by a new `enabledExtensionIds` prop (client-side, since the `insert` factory can't cross the RSC boundary) and passes them to the source. Calendar now appears in the slash menu only when enabled; 3 added tests |
| [x] | Ranking pass (both surfaces) | Done 2026-07-11: slash menu no longer sets a CodeMirror completion `section` (sections were ordered by array position, burying a fully typed `/calendar` under "Blocks"); ranking is now pure fuzzy score. Command palette command-mode gained `components/workspace/command-ranking.ts` (`rankCommands`: exact > token-prefix > word-boundary > substring > keyword tiers + whole-query prefix bonus) and renders a flat ranked list while querying, grouped browse only when empty. Tested (`command-ranking.test.ts`) |
| [x] | Slice 3 — polish | Done 2026-07-11: `editor/defaults.slashMenu` toggle (Settings → Editor, default on) wired through `buildPreferences` → `slashMenuEnabled` editor prop → conditional source registration; tooltip glyph icons per item via CodeMirror `type` + `.cm-completionIcon-vault-*` CSS in `components.css`; `content/docs/getting-started/markdown-basics.md` gains a Slash commands section. No grouping (per decision). Deferred: none |
| [x] | Command palette navigation commands | Done 2026-07-11: added Friends (all users) and Admin (gated on new `useWorkspaceIsAdmin` from `WorkspaceChrome`) navigation commands to `/` command mode. Decision (2026-07-11): app-section navigation lives behind `/` only — a brief experiment that also injected nav commands into plain-text content search was reverted because it conflated "find content" with "go to a section" (VS Code–style separation: `/` = commands/navigation, plain text = content search) |

Exit criteria:

```txt
Typing "/" in an editable document opens a filtered insert menu at the cursor;
picking an item replaces the "/query" text with the block; extension items
appear only when the extension is enabled; literal slashes in prose and URLs
never trigger the menu.
```

---

## Phase 19 - PWA and Mobile Safe-Area

| Status | Task | Notes |
|---|---|---|
| [x] | Web app manifest + icons | Done 2026-07-23: `app/manifest.ts` (`display: standalone`, `start_url: /workspace`, dark theme/background, `any`+`maskable` icons); grayscale "vault door" icons generated with `sharp` (`app/icon.svg`, `app/apple-icon.png`, `public/icons/icon-{192,512}.png`) |
| [x] | Standalone display + iOS/Android meta | Done 2026-07-23: `viewport` export with `viewportFit: "cover"` + dark/light `themeColor`; `appleWebApp`/`applicationName`/`formatDetection` metadata; Next 16 emits `mobile-web-app-capable` and iOS 16.4+ uses the manifest `display` |
| [x] | Update-safe service worker + registration | Done 2026-07-23: `public/sw.js` network-first for navigations/HTML, cache-first only for fingerprinted immutable assets, `skipWaiting`+`clients.claim`; registered production-only via `components/pwa/ServiceWorkerRegistrar.tsx` (`updateViaCache: "none"`, reload once on `controllerchange`) |
| [x] | Safe-area insets (notch / home indicator) | Done 2026-07-23: `.pt-safe`/`.pb-safe`/`.pl-safe`/`.pr-safe` utilities applied to `VaultWorkspaceShell` container + both mobile drawers so chrome/scroll content clears the notch, iOS home indicator, and landscape cutouts (0 in browser/non-notched — no visual change). Bottom-center tap targets already avoided (fixed bottom buttons are desktop-only) |
| [~] | Manual on-device visual pass (iPhone + Android) | Build/head-tag/manifest verified; real-device install + standalone look + safe-area feel on physical iPhone/Android still worth a manual check |

Exit criteria:

```txt
On mobile, "Add to Home Screen" installs Vault; launching it shows the app
without browser UI (standalone), with the workspace chrome and content clearing
the notch and home indicator; deployments appear without a stale-content delay.
```

---

## Phase 20 - Den Embed Bridge

Reference plan: `docs/DEN_EMBED_BRIDGE.md`

| Status | Task | Notes |
|---|---|---|
| [x] | §A — Identity | `GET /api/me` (bearer via `resolveAccessToken`) returns `{ userId, name, image }`. §A.2 was verification-only: `/oauth/authorize` already names the requesting client and lists the granted scope via existing dynamic registration (`/oauth/register`); no change needed |
| [x] | §B — Read APIs | `GET /api/embed/documents/:id/metadata` (`{ id, title, ownerName, snippet, updatedAt, canEdit }`, permission-checked, 404 on unreadable) and `GET /api/embed/documents/:id/rendered` (`{ html, assets }` via `renderToStaticMarkup(<MarkdownDocument/>)` over the existing sanitize pipeline, Node runtime) |
| [x] | §C.5/6 — Editor portal + boot-session exchange | `POST /api/embed/editor-session` (rate-limited, `canEditDocument`-gated) mints a single-use boot token; `app/embed/editor/[docId]/page.tsx` (outside `(workspace)`) resolves the acting user from the boot token only (no session cookie), re-derives role via `getDocumentAccess`, and mints a normal `createCollabToken` room token — the embed editor is a stock Hocuspocus client, no markdown-overwrite side path. New `lib/embed-boot-token.ts`, `server/embed.ts`, `embed_boot_token_uses` table (migration `0019`) |
| [x] | CSP/XFO carve-out for `/embed/...` | `proxy.ts` omits `X-Frame-Options` and `lib/security/csp.ts` swaps `frame-ancestors` to `EMBED_FRAME_ANCESTORS` (env-configured, defaults to `https://den.ems-place.com`, never degrades to `*`) only under `/embed/`; every other route unchanged (verified via `git stash` lint/test baseline comparison). New tests in `lib/security/csp.test.ts` |
| [x] | Embed editor cookie-dependent requests fix | Follow-up bugfix: the framed embed editor never had a Vault session cookie, so saving/private-asset-images/asset-completions/asset-link/upload/wiki-links all failed. Fixed with a new multi-use embed session bearer token (`lib/embed-session-token.ts`, minted by the embed page once edit access is confirmed), a new `POST /api/embed/documents/[id]/content` route (re-checks `getDocumentAccess`/`canEdit` on every call, delegates to shared `saveMarkdownDocumentCore`/`saveDocumentTitleCore` extracted from `server/documents.ts`), a `MarkdownEditor` `embedSessionToken` prop wired into `saveDocument` + the asset/wiki-link fetches, and a cookie-first/bearer-fallback identity resolver on the asset content/completions/link/upload routes and `/api/documents/wiki-links`. `/rendered`'s cached-HTML private-asset limitation is unchanged (different problem, out of scope). See `docs/project-knowledge.md` 2026-07-27 changelog entry |
| [x] | Ban-bypass fix on the embed bridge | The token-authenticated entry points (`editor-session`, the embed page, `documents/[id]/content`) skipped the ban check, since `requireActiveUser()` redirects and can't be used from a token route — a banned account could keep editing through the embed portal for its tokens' lifetime. Added `isUserActiveById` to `server/authz.ts` (non-redirecting, id-based, reuses `isUserBanActive`) and called it in all three; banned users now get the same opaque 404 as any other unreadable case |
| [x] | §C.7 — Group ownership (`groups`/`group_members`/`documents.owning_group_id`) | Migration `0020`. `getDocumentAccess` (`lib/permissions.ts`) gains group membership as a third "at most editor" source (`isMemberOfGroup`), alongside direct permissions and folder inheritance; structural rights (share/delete/publish) stay tied to document ownership, unchanged. Mirrored into the hand-maintained SQL twin in `scripts/collab-server.mjs` `onAuthenticate` (a `group_members` `EXISTS` clause alongside the existing folder-chain CTE) — this is what makes revocation work at all: a removed member loses edit on their next collab reconnect, not just at room-token expiry |
| [x] | §C.8 — Services + service principal / service tokens | New `services`/`group_members`/`groups`/`service_tokens` tables (migration `0020`). `services.principalUserId` uses `onDelete: "restrict"` (not `cascade`, unlike every other `users.id` FK in the schema) so deleting the principal is blocked outright rather than silently cascade-deleting every group doc it owns. `lib/service-tokens.ts` (pure hash/generate, tested) + `server/services.ts` `resolveServiceBearerToken` (hash lookup, checks both token and service `revokedAt`, best-effort `last_used_at` bump) mirror `resolveAccessToken` in `lib/mcp/oauth.ts` |
| [x] | §C.9 — Group + membership API | `POST /api/embed/groups` (`{ name }` → `{ groupId }`), `POST /api/embed/groups/:id/members` (`{ vaultUserId }`, idempotent add), `DELETE /api/embed/groups/:id/members/:vaultUserId` (idempotent remove) — all service-bearer-authenticated. Every group-scoped route re-verifies `groups.serviceId` matches the caller's own service (`getServiceOwnedGroup`) before touching it, so one integrating service can never read/write another's groups. Membership stays read-only in Vault's own UI (below) |
| [x] | §C.10 — `POST /api/embed/documents` (create + clone) | Single route branches on presence of `sourceDocumentId` in the body. Create: `{ title, groupId }` → `{ documentId }`. Clone: `{ sourceDocumentId, groupId, title? }` → `{ documentId }`, checks read access against the **service principal** (the caller is authenticated as the service, not a particular Vault user), copies `markdown` and every `document_assets` link row unstripped (those rows are themselves access grants — `server/assets.ts` `getReadableAsset` — so group members inherit private asset access for free). No Vault-side confirmation-warning UI was built for clone: the route is a machine-to-machine owner op with no Vault UI entry point, so that concern (mentioned in the settled-design block) belongs to Den's own UI, not this codebase |
| [x] | Group docs in the workspace file browser | `server/services.ts` `listServiceGroupsForUser()` (inner-joins `group_members` → `groups` → `services`, so a plain/non-service group — `serviceId` null — is naturally excluded), wired into `getWorkspaceData()` and a new `ServicesSection` in `components/workspace/WorkspaceFileBrowser.tsx`. Iterates `services` rows generically — no "Den" string anywhere in the component. Section is hidden entirely when the user has no service-group memberships (the common case). Read-only: no leave/join controls |
| [x] | Seed script: service registration + principal bootstrap | `scripts/seed-service.mjs` (`npm run seed:service -- --slug den --name Den [--icon 💬]`). Idempotent by `slug`; creates the `services` row, a principal `users` row, and prints an initial `service_token` plaintext once. The principal's email uses the RFC 2606 `.invalid` TLD (guaranteed unresolvable/unissuable, so no OAuth provider can ever vouch for it as verified) and **no `accounts` row is created for it**. Verified against `auth.ts`: session strategy is `"database"`, and the codebase sets no `allowDangerousEmailAccountLinking` anywhere (confirmed via grep and `docs/04_AUTH_AND_PERMISSIONS.md` §4's explicit warning against enabling it), so even the hypothetical of an OAuth provider presenting a matching email would fail closed at Auth.js's account-linking step rather than silently sign the principal in |
| [ ] | **Future work:** `/dashboard/admin/services` admin page | Deferred by owner decision 2026-07-27 in favour of the seed script for v1. Would follow the established `app/dashboard/admin/` pattern (users/docs/tags): promote a registered `mcp_clients` row into a service, mint/rotate/revoke `service_tokens`, show `last_used_at`. Until it exists, rotating or revoking a service token requires a server-side script run — worth building once a second service actually integrates |
| [x] | Clone made user-delegated (contract revision) | Clone previously checked source read-access against the **service principal**, making a user's own private document unclonable — the primary case create-or-clone exists for. `POST /api/embed/documents` (clone form only) now takes two credentials: the service token in `Authorization` authorizes writing into the group, and the acting user's existing OAuth access token in `X-Vault-Acting-User-Token` authorizes reading the source. Also requires the acting user to be unbanned and **a member of the destination group** — the service can already read that user's docs, but cloning re-exposes the content to other people, so the destination must be a circle the user is already in. Create form (`{ title, groupId }`) unchanged, still service-only. **§4 contract revised — Den needs the matching change; see the "Contract revision 2026-07-27" block in `docs/DEN_EMBED_BRIDGE.md` §4 for the request shape, the ordered check table, and the Den-side checklist** |
| [ ] | **Future work:** immediate collab revocation on member removal | Deferred by owner decision 2026-07-27. Revocation is connect-time only: the collab server re-resolves membership from the DB on connect, so a removed member loses edit on their next reconnect/reload but **an already-open socket keeps editing until then**. Closing this needs the membership API to actively disconnect that user's sockets — a new admin channel into the Hocuspocus service plus its own auth. Note this is a weaker guarantee than §5's wording reads at first glance |

Exit criteria:

```txt
Den can complete authorize -> token -> /api/me end to end; fetch permission-
correct metadata/rendered HTML for a doc it can read (private docs 404, not
403); and open a working Live-mode collaborative editor in an iframe via a
short-lived single-use boot token, with framing locked to the configured
origin and every non-embed route unaffected. A group can own a document, a
group_members row grants edit through getDocumentAccess (and the collab
connect-time re-check), adding/removing a member grants/revokes edit, and the
owner-op APIs (groups, membership, create/clone) are idempotent under repeat
calls. All implemented and type-checked/tested; not yet exercised against a
real database or a real Den client (see the 2026-07-27 "Group ownership"
changelog entry in docs/project-knowledge.md for what still needs manual
verification).
```

---

## Bugs / Issues

| Status | Issue | Priority | Notes |
|---|---|---:|---|
| [x] | Command palette arrow keys didn't scroll the results container | Med | Fixed 2026-07-10: keyboard-driven selection now `scrollIntoView({ block: "nearest" })`s the selected row; mouse-hover selection intentionally never scrolls |
| [ ] |  |  |  |

---

## Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-05-26 | Use Next.js App Router | One deployable app, strong resume value |
| 2026-05-26 | Use Postgres | Reliable, self-hostable, strong data model |
| 2026-05-26 | Use Drizzle | SQL-like, lightweight, good for showing DB skill |
| 2026-05-26 | Delay Yjs until post-MVP | Avoid drowning in collaboration complexity |
| 2026-07-11 | Command palette: `/` for commands/navigation, plain text for content search only | Injecting section-navigation commands into content search conflated "find content" with "go to a section" and confused testing; VS Code–style separation is clearer. Don't re-add nav commands to search mode |
| 2026-07-23 | PWA service worker is network-first for HTML, cache-first only for fingerprinted assets | Keeps the installed PWA from ever showing a stale build — new deploys appear immediately — while still satisfying installability and offering offline fallback. Do not precache HTML/navigations |

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
