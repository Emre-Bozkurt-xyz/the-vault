# Den Embed Bridge (Vault side)

**Status:** §A (both items), §B (both items), §C.5/6, and §C.7–10 (group ownership, service principal, group/membership API, `POST /api/embed/documents`) are all implemented (2026-07-27). A same-day follow-up fixed the embed editor's cookie-dependent requests (saving, private asset images, asset completions/link/upload, wiki-link lookups) with a second multi-use embed session bearer token (`lib/embed-session-token.ts`) and a new `POST /api/embed/documents/[id]/content` route — see §C.5/6 below and the 2026-07-27 "Fixed the embed editor's cookie-dependent requests" changelog entry in `docs/project-knowledge.md`. Group ownership (migration `0020`, `getDocumentAccess`'s new group-membership branch, its SQL twin in `scripts/collab-server.mjs`, the service-token owner-op APIs, the workspace "Services" section, and `scripts/seed-service.mjs`) is implemented but **not yet exercised against a real database or a real Den client** — see the 2026-07-27 "Implemented Den embed bridge group ownership §C.7-10" changelog entry in `docs/project-knowledge.md` for the full write-up, and `docs/01_PROGRESS_TRACKER.md` Phase 20 for status. `/dashboard/admin/services` and immediate collab disconnect-on-removal remain deferred future work (unchanged from the settled design). Paired with `den/docs/EMBEDS.md`; the two share the **§4 Contract** — implement both against it and they converge ("build both, it just works").
**Read before acting (per CLAUDE.md / AGENTS.md):** `docs/04_AUTH_AND_PERMISSIONS.md`, `docs/05_EDITOR_AND_COLLAB.md`, `docs/03_DATA_MODEL.md`, and `docs/project-knowledge.md` for current reality. After acting, update `project-knowledge.md` (dated changelog) and any diverging planning doc. House checks: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` for larger changes.

---

## 1. What Vault is providing

Den (`den.ems-place.com`, a private chat app; separate owner-run codebase) wants to (a) embed Vault documents as rich cards, (b) render them read-only inside Den, and (c) let linked users **edit a Vault doc live from inside Den via a Vault-served editor iframe** — full markdown fidelity (callouts, `![[asset]]`, math, wiki links, Live-mode, presence) with **no editor re-implementation on Den's side.**

**Design stance:** everything Vault adds here is a **generic, public-facing capability**, not a Den-specific feature. Den is just one OAuth client + one allowed frame origin. Vault gains an embeddable editor route, a render API, a userinfo endpoint, **native group ownership of documents**, a service-principal pattern, and a **group-membership API** — all things any first-party consumer could use. The *only* Den-specific values anywhere are the allow-listed frame origin (`den.ems-place.com`) and (optionally) a pre-seeded `client_id`.

**Why the iframe and not "give Den the markdown":** Vault owns a large, evolving markdown dialect (wiki links, asset embeds, `:::assets`, regions, callouts, KaTeX, GFM, Live-preview block system). Re-rendering it elsewhere would duplicate and drift. Serving Vault's own editor in an iframe keeps all of it here, and Den inherits every future editor feature for free.

**This is safe because it reuses machinery you already shipped:**
- OAuth 2.0 AS with PKCE-S256 + dynamic registration (`lib/mcp/oauth.ts`, `lib/mcp/oauth-metadata.ts`).
- `createCollabToken` (`lib/collab-token.ts`) — HMAC `v1.<payload>.<sig>` room tokens off `AUTH_SECRET`.
- `withLiveDocumentText` (`lib/mcp/collab-write.ts`) — the proven CRDT-safe "edit exactly like a browser editor" pattern; the embed editor is its interactive sibling.
- `/public/[slug]` — precedent for rendering a document **without the dashboard/editor shell**.

---

## 2. Non-negotiables

- **Every server action still checks DB permissions** (`canReadDocument`/`canEditDocument`, AGENTS.md §Auth) — the bridge adds callers, never bypasses the check. The collab server's connect-time re-check (docs/05 §9) stays authoritative for editing.
- **Private docs 404, not 403** (docs/04 §10) — the metadata/render endpoints follow this.
- **Collab writes go through the Y.Doc, never a plain-markdown overwrite while a room is live** (docs/03 §4, the duplication root-cause). The embed editor is a normal Hocuspocus client, so this holds by construction — do not add a markdown-overwrite side path.
- **CSP `frame-ancestors` is exactly Den's origin**, never `*` — else any site could frame the editor with a leaked boot token.
- **Boot tokens are short-lived + single-use** and bound to `{ documentId, vaultUserId }`.
- New planning doc obligations (AGENTS.md §5/§6): changelog + `project-knowledge.md` on implementation.

---

## 3. Work, phase-aligned with Den

### §A — Identity (Den Phase 2)
1. **Userinfo endpoint:** `GET /api/me` (bearer, OAuth-protected like the MCP route) → `{ userId, name, image }`. Resolve the acting user from the bearer via `resolveAccessToken` (same as `app/api/mcp/[transport]/route.ts`'s `verifyToken`). This is the only thing Den needs post-authorize to record `vault_user_id`. **Implemented** at `app/api/me/route.ts` via a shared `lib/embed-auth.ts` bearer-parsing helper reused by every route below.
2. **OAuth client for Den:** either accept Den via existing **dynamic registration** (`/oauth/register`) or pre-seed a `client_id` row. Confirm the authorize page renders a clear consent ("Den wants access to your Vault documents") — this is a real user-facing grant. Scope stays `vault.documents`. `token_endpoint_auth_methods_supported: ["none"]` (public client + PKCE) already fits Den's server-side-with-PKCE flow; keep the `code_verifier` server-side on Den. **Verified, no change needed:** `app/oauth/authorize/page.tsx` already names the requesting client (`{appName} wants to read and edit your Vault documents on your behalf as {email}`) and lists what's granted; `/oauth/register` already accepts dynamic registration generically.

### §B — Read APIs (Den Phase 3)
3. **Metadata:** `GET /api/embed/documents/:id/metadata` (bearer) → `{ id, title, ownerName, snippet, updatedAt, canEdit }`. Permission-checked; unreadable → 404. `snippet` = first ~200 chars of rendered/plain text, frontmatter stripped. `canEdit` lets Den decide whether to offer the portal. **Implemented** at `app/api/embed/documents/[id]/metadata/route.ts` (`getDocumentAccess` chokepoint, `stripDocumentFrontmatter` + `createMarkdownExcerpt(…, 200)`).
4. **Rendered HTML:** `GET /api/embed/documents/:id/rendered` (bearer) → `{ html, assets }`. Run the **existing `MarkdownDocument` sanitization pipeline** server-side (the same one behind `/public/[slug]` and viewer mode — sanitized raw HTML, callouts, wiki-link resolution via permission-aware maps, `![[asset]]` → permission-resolved `/api/assets/<id>/content` URLs, KaTeX, GFM). No dashboard shell. Reuse the permission-aware resolution maps already built for wiki links/assets so private references don't leak. Den caches this snapshot; it does not call Vault per view.
   - Keep this a *read* render (Read mode output), not Live mode — Den's read view is static.
   - **Implemented** at `app/api/embed/documents/[id]/rendered/route.ts` (`runtime = "nodejs"`) via `renderToStaticMarkup(<MarkdownDocument …/>)` over `listWikiLinkResolutionsForUser` + `listOfficialDocWikiLinkResolutions` + `listPublicWikiLinkResolutions` + `listAssetResolutionsForDocument` — the exact maps `app/(workspace)/docs/[docId]/page.tsx` uses. `assets` is `Object.values(assetLinks)`.
   - **Build hazard found, not in the original plan:** Next 16/Turbopack refuses to bundle a bare `react-dom/server` import inside a Route Handler ("importing a component that imports react-dom/server... render... as a Server Component instead"), even though this route legitimately needs the Node-runtime static renderer. Fixed by importing from the `react-dom/server.node` subpath *and* adding `serverExternalPackages: ["react-dom"]` to `next.config.ts` — neither alone was sufficient.
   - **Known limitation, not solved here:** `/api/assets/[assetId]/content` (the URL private asset embeds resolve to) authorizes via the Vault session cookie by default, so private asset images in this route's cached, Den-origin-served HTML snapshot will not load for Den's cross-origin viewers — only public assets render end-to-end in `/rendered`'s output. This is a different problem than the live embed editor's cookie issue (fixed below): a short-lived bearer token embedded in cached HTML would expire before the cache is read, so it needs a different design (e.g. an ETag/conditional re-render, or Den re-fetching per view) rather than the embed session token. Out of scope here; see `docs/project-knowledge.md` §16 Known Bugs/Issues. (The content route itself *does* now accept an embed session bearer as a query-param identity assertion — see §C.5 — which is what makes private asset images work inside the live `/embed/editor/[docId]` iframe, just not in this cached `/rendered` snapshot.)
   - **Known limitation, per the hazard note below:** calendar-block live state and sticker overlays are omitted from the render rather than forked into a second pipeline — both need client hydration a static snapshot never gets.

### §C — Editor portal, group ownership, membership API (Den Phase 4)
5. **Embed editor route:** `app/embed/editor/[docId]/page.tsx` (or route group) rendering **only** `MarkdownEditor` in **Live mode + a slim toolbar**, no dashboard/sidebar shell — same "don't load the full shell" move as `/public/[slug]`. It binds to Hocuspocus/`Y.Text` exactly like the normal editable document page (mint the room token with `createCollabToken`, connect `y-codemirror.next`). Accept `?theme=` and honor it (surface/accent/dark) so it visually matches the host; optionally accept `postMessage` theme updates.
   - **Auth:** the route is reached only with a valid `?boot=` token (below). It does **not** rely on the Vault session cookie — Den frames it cross-origin and iOS Safari blocks third-party cookies. Resolve the acting user from the boot token, then mint the room token for that user with their real `canEditDocument` role.
   - **CSP:** this route sets `Content-Security-Policy: frame-ancestors https://den.ems-place.com`. All other routes stay unframeable (`frame-ancestors 'none'` / `DENY` as today).
   - **Implemented** at `app/embed/editor/[docId]/page.tsx`, outside `(workspace)` so only the root layout applies (no sidebar/tabs/command palette). `MarkdownEditor` is reused as-is (its built-in toolbar serves as the "slim toolbar" — it already defaults to Live mode and is a stock Hocuspocus client, so no fork of the editor was needed). `?theme=` is honored via `components/embed/EmbedThemeSync.tsx` (a client component calling the existing `useVaultTheme().setTheme`). Role is re-derived from `getDocumentAccess` at render time, never trusted from the boot token. A missing/invalid/expired/replayed boot token renders a non-crashing "this embed session expired, reopen it from Den" view instead of throwing (see hazard 3 note); a doc where edit access was revoked between session-mint and render renders a distinct "No longer editable" view. **Divergence from the plan text above:** the actual `frame-ancestors` mechanism lives centrally in `proxy.ts` + `lib/security/csp.ts` (matched by the `/embed/` path prefix, env-configurable via `EMBED_FRAME_ANCESTORS`), not as a route-local header — this covers the whole `/embed/...` family generically rather than hardcoding it per-route. Non-embed routes keep `frame-ancestors 'self'` (the existing baseline), not `'none'`/`DENY` as this paragraph originally said — that was already the pre-existing default and was not changed.
   - **Follow-up fix, 2026-07-27 (not in the original plan text, discovered because the editor was framed cross-origin and so had no Vault session cookie for *any* of its own requests, not just the initial render):** every cookie-dependent fetch the rendered `MarkdownEditor` makes — `saveMarkdownDocumentAction`/`saveDocumentTitleAction` (save), `/api/assets/[assetId]/content` (`<img>` for private embeds), `/api/assets/completions`, `/api/assets/[id]/link`, `POST /api/assets` (upload), `/api/documents/wiki-links` — failed the same way the page render itself would have without the boot token. Fixed with a second, **multi-use** bearer token: `lib/embed-session-token.ts` (sibling of `lib/embed-boot-token.ts`, same HMAC shape, payload `{ documentId, vaultUserId, expiresAt }`, 4-hour TTL, no replay table since it authorizes a whole session's worth of requests rather than one page render). The embed page mints it once `access.canEdit` is confirmed and passes it to `MarkdownEditor` as `embedSessionToken`; `MarkdownEditor` attaches it as `Authorization: Bearer` on save (routed to a new `POST /api/embed/documents/[id]/content` instead of the server actions) and on the four fetches above, and threads it into `buildAssetContentUrl`'s new `?embed=` query param for the private-asset `<img>` case. Every accepting route re-runs its real DB permission check against the token's `vaultUserId` — the token is an identity assertion only, exactly like the boot token's `vaultUserId` is for the initial render.
6. **Boot-session exchange:** `POST /api/embed/editor-session` (bearer = the acting user's OAuth token) `{ documentId }` → `{ embedUrl }`. Steps: resolve user → `canEditDocument` (404/forbidden if not) → mint a **boot token** (reuse the `collab-token.ts` HMAC scheme: `v1.<payload>.<sig>` off `AUTH_SECRET`, TTL ≤60s, single-use, payload `{ documentId, vaultUserId }`) → return `https://vault.ems-place.com/embed/editor/<documentId>?boot=<token>`. Single-use: record a used-jti (short-lived table or cache) so replay fails.
   - **Implemented** at `app/api/embed/editor-session/route.ts`, rate-limited via `lib/rate-limit.ts` (20 requests/60s per user). The boot token is a new sibling module `lib/embed-boot-token.ts` (not an extension of `CollabTokenPayload`, per instruction) plus `server/embed.ts`'s `consumeEmbedBootToken`, which verifies the signature/expiry then inserts the token's `jti` into a new `embed_boot_token_uses` table (`onConflictDoNothing`) — a replay or a page refresh both fail closed. A doc that doesn't exist and a doc the caller can't edit return the identical 404 (never 403), consistent with the private-doc non-negotiable.
7. **Group ownership (the core new primitive).** Add a first-class group that can own documents. **Thread edit access through the one chokepoint:** `getDocumentAccess` / `canEditDocument` in `lib/permissions.ts` returns `editor` when the acting user is a member of the doc's `owning_group_id`. Every downstream consumer inherits it unchanged — `createCollabToken`'s role, the collab connect-time re-check (docs/05 §9), `withLiveDocumentText`, and the embed editor route. ⚠️ **The collab connect-time re-check must resolve group membership from the DB, not trust the room-token role** — else a user removed from the group mid-session keeps editing until the token expires.
8. **Service principal:** a normal `users` row (e.g. `den-system`) that acts as the registered service's principal. Den authenticates as it for group + doc-create ops. Keep it generic, not Den-named in the schema.

> **Design settled 2026-07-27 (owner decisions — these supersede the "recommended shape" sketches above).** The discussion resolved every open question in §6; what follows is the design to build, not a proposal.
>
> **Services are a first-class concept; Den is a row, not a branch.** The agnosticism requirement in §1 is met by making the integrating service itself data. Vault already has an identity primitive for "who is contacting us" — `mcp_clients`, populated by the existing dynamic registration at `/oauth/register`. A new `services` table ties that OAuth identity to a principal user and display metadata:
>
> ```txt
> services        id, slug, display_name, icon,
>                 oauth_client_id → mcp_clients, principal_user_id → users,
>                 created_at, revoked_at
> groups          id, name, service_id → services (NULLABLE), created_at, deleted_at
> group_members   group_id, user_id, created_at        [unique (group_id, user_id)]
> service_tokens  token_hash (pk), service_id → services, label,
>                 created_at, last_used_at, revoked_at
> documents       + owning_group_id → groups (nullable)
> ```
>
> No Den string appears in code. The only Den-specific values anywhere remain `EMBED_FRAME_ANCESTORS` and the seeded rows. A second consumer integrates by registering, being approved, and appearing automatically. `groups.service_id` is **nullable** on purpose: a group with no service is a plain user-created group — the reusable `workspace`-visibility direction §6 already anticipated — and costs nothing to allow now.
>
> **Two-tier trust.** Self-service registration must not be enough to obtain a service principal:
>
> | Tier | How obtained | Capability |
> |---|---|---|
> | Registered OAuth client | Self-service via `/oauth/register` (open, as today) | Act *as a user*, with consent, strictly within that user's own permissions. All per-user flows (§A, §B, §C.5/6). |
> | Approved service | An admin promotes a registered client into a `services` row and issues a `service_token` | Create groups, own documents, manage membership (§C.9/10). Never self-service. |
>
> **`documents.ownerId` for a group doc = the service principal.** Forced by the schema: `ownerId` is `NOT NULL` and `onDelete: "cascade"` to `users` (`db/schema.ts:228-230`). Pointing it at the creating user would mean that user deleting their account **cascade-deletes the chat's document**, defeating the durability this primitive exists to provide — and would leave them holding share/delete/publish over a chatroom's doc forever. Using the principal costs no constraint change and no cascade risk. Consequences: add a nullable `created_by` if authorship display is wanted, and `GET /api/embed/documents/:id/metadata` must fall back to the **group name** for `ownerName` (it `innerJoin`s `users` today and would otherwise report `den-system`).
>
> **Group membership grants `editor`, capped.** Share/delete/publish stay tied to document ownership, exactly mirroring the folder-inheritance decision already documented at `lib/permissions.ts:82-85`. Because the owner is the service principal, the owner branch never fires for a human on a group doc — members top out at editor by construction, with no special-casing. Den, acting as the service principal, does hold full owner rights for lifecycle ops. The resulting rule in `getDocumentAccess` — groups become a *third* "at most editor" source alongside direct permissions and folder inheritance:
>
> ```ts
> const groupRole = doc.owningGroupId && isMemberOf(userId, doc.owningGroupId) ? "editor" : null;
> const canEdit = directRole === "owner" || directRole === "editor"
>              || inheritedFolderRole === "editor"
>              || groupRole === "editor";
> const isDocOwner = directRole === "owner";   // structural rights unchanged
> ```
>
> **Revocation is connect-time only, and that gap is deliberate.** The collab server re-resolves membership from the DB on connect, so a removed member loses edit on their next reconnect/reload — but **an already-open socket keeps editing until then**. Truly immediate revocation would need the membership API to actively disconnect that user's sockets, which means a new admin channel into the Hocuspocus service plus its own auth. Out of scope for v1; document the gap rather than implying it doesn't exist. Note this is a weaker guarantee than §5's wording ("loses edit at the collab connect re-check") reads at first glance.
>
> **Group docs surface in Vault's own UI**, under a generic `Services` section in the workspace file browser, nesting Service → Group → Documents:
>
> ```txt
> Documents            personal
> Folders
> Services             enumerates `services` rows
>   Den                display_name + icon from the row
>     Design chat      a group (named by Den — it's the chat name)
>       Meeting notes
> ```
>
> Rendered by iterating rows; no service-specific code path. `server/workspace.ts` `getWorkspaceData()` is the existing single aggregation point to extend. Two things fall out for free: opening a group doc at `/docs/[docId]` already works (membership grants editor through `getDocumentAccess`), and group docs correctly stay out of personal document lists because the owner is the principal — which is exactly why this section is needed. **Membership is read-only in Vault** for service-managed groups: if a user could leave a Den group from Vault's sidebar, Den's reconciliation sweep would re-add them next pass. Vault displays membership; the owning service owns it.
>
> **Approval surface: seed script now, admin page later.** v1 approves services and creates the principal row via an idempotent script in `scripts/` (needed regardless to bootstrap `den-system`). The script must create a `users` row that can never sign in — sentinel email, no linked `accounts` row — and this should be verified against the auth path, not assumed. A `/dashboard/admin/services` page (promote a registered client, mint/rotate/revoke tokens, show `last_used_at`) follows the established `app/dashboard/admin/` pattern and is **tracked as future work**; until it exists, rotating or revoking a service token is a server-side script run.
>
> **Cloning (Den's actual usage model).** Den does not adopt a user's existing documents; it either creates a new group-owned doc or clones one. Clone (`{ sourceDocumentId, groupId }`) checks the caller can read the source, copies `markdown`, and copies the `document_assets` rows — those link rows are themselves access grants (`server/assets.ts:919-936`), so group members inherit asset access without stripping or duplicating anything. Because that does expose the original author's private assets to the group, clone needs a confirmation warning modeled on the existing publish gate (`listPrivateEmbeddedAssetsForPublish` + `components/document-publish-control.tsx`). Do **not** strip private images at clone time: it is lossy, surprising, and solves a problem the existing grant mechanism already handles.
9. **Group + membership API (owner ops, service bearer):**
   - `POST /api/embed/groups { name }` → `{ groupId }` — create a group (Den makes one per chat, lazily).
   - `POST /api/embed/groups/:id/members { vaultUserId }` → add a member. **Idempotent** — re-adding is a no-op.
   - `DELETE /api/embed/groups/:id/members/:vaultUserId` → remove a member. **Idempotent** — removing an absent member is a no-op.
   These back Den's four mirror triggers: the two the owner called out — **(1) a new user joins a Den chat, (2) an existing chat member links their account** — plus the two removals (leaves chat / unlinks). Idempotency is required because Den re-runs a reconciliation sweep as its backstop against a missed event or a failed call.
10. **Document create (owner op):** `POST /api/embed/documents { title, groupId }` (service bearer) → `{ documentId }`. Creates a `documents` row with `owning_group_id = groupId`. Reuse the existing create path (`lib/mcp/document-write-tools.ts`) plus the group linkage.

**Implementation notes (2026-07-27, §C.7-10 slice — divergences from the text above, not from the settled design's intent):**
- The clone confirmation-warning UI mentioned above was **not built in Vault**. `POST /api/embed/documents` is a machine-to-machine owner op authenticated by a service bearer with no Vault UI entry point at all (unlike the publish gate, which is a user clicking a button in Vault's own UI) — so that concern belongs to Den's own confirmation UX, not this codebase. The route still enforces everything server-side (read-checks the source, copies assets unstripped); only the human-facing warning dialog is out of scope here.
- Document create/clone reuse the *shape* of `createDocumentForUser` (`server/documents.ts`) — title trim/default, empty initial body, an `owner` `document_permissions` row — via new small dedicated functions in `server/services.ts` (`createGroupOwnedDocument`/`cloneDocumentIntoGroup`), rather than literally calling `lib/mcp/document-write-tools.ts` (which only registers MCP tool handlers) or bolting an optional `owningGroupId` parameter onto the general-purpose personal-document creation path used throughout the rest of the app.
- Clone's "caller can read the source" check resolves against the **service principal's** own `getDocumentAccess`, not a Vault user id — the caller is authenticated as the service (bearer token), not as a particular person. This naturally covers cloning between a service's own groups (the principal owns every document any of its groups already created) while correctly keeping an arbitrary stranger's private document out of reach.

---

## 4. Contract (identical in both plan docs — the convergence surface)

Origins: Den `den.ems-place.com`, Vault `vault.ems-place.com`, collab `NEXT_PUBLIC_COLLAB_URL`. All calls server-to-server with a bearer (acting-user OAuth token, or service-account token for owner ops).

**A. Identity**
- OAuth AS: issuer `https://vault.ems-place.com`, `/oauth/authorize` · `/oauth/token` · `/oauth/register`, PKCE-S256, scope `vault.documents` (existing).
- `GET /api/me` (bearer) → `{ userId, name, image }`.

**B. Read**
- `GET /api/embed/documents/:id/metadata` (bearer) → `{ id, title, ownerName, snippet, updatedAt, canEdit }`; unreadable → 404.
- `GET /api/embed/documents/:id/rendered` (bearer) → `{ html, assets }` (sanitized, permission-resolved, no shell).

**C. Edit / portal / ownership**
- `GET /api/embed/documents` (acting-user bearer) `?query=&scope=&limit=` → `{ documents: [{ id, title, folderPath, ownerName, visibility, updatedAt, snippet }] }` — clone-picker source list; excludes group-owned docs. **Added 2026-07-27**, see the contract-addition block below.
- `POST /api/embed/editor-session` (bearer) `{ documentId }` → `{ embedUrl }` (short-lived single-use boot URL).
- Route `GET /embed/editor/:docId?boot=…` → boots Live-mode editor + slim toolbar; `CSP: frame-ancestors https://den.ems-place.com`.
- `POST /api/embed/groups` (service bearer) `{ name }` → `{ groupId }`.
- `POST /api/embed/groups/:id/members` (service bearer) `{ vaultUserId }` → add (idempotent); `DELETE /api/embed/groups/:id/members/:vaultUserId` → remove (idempotent).
- `POST /api/embed/documents` (service bearer) `{ title, groupId }` → `{ documentId }` (owned by the group).
- `POST /api/embed/documents` **(dual credential — see below)** `{ sourceDocumentId, groupId, title? }` → `{ documentId }` — clone an existing doc into the group, copying markdown and `document_assets` grants. **Added to the contract 2026-07-27**; Den's paired doc needs the same addition, since Den's usage model is create-or-clone rather than adopting a user's existing document in place.

> ### ⚠️ Contract revision 2026-07-27 — clone is user-delegated (Den-side change required)
>
> **What changed and why.** Clone was first built as a pure owner op: service bearer only, source read-access checked against the service principal. That made a user's **own private document unclonable** (the principal cannot read it) — i.e. exactly the case create-or-clone exists to serve. Clone now takes **two credentials**.
>
> **The create form is unchanged.** `{ title, groupId }` is still service-bearer-only — creating an empty document reads nothing.
>
> **Clone request:**
>
> ```http
> POST /api/embed/documents
> Authorization: Bearer <service_token>            # authorizes writing into the group
> X-Vault-Acting-User-Token: <user_oauth_token>    # authorizes READING the source
> Content-Type: application/json
>
> { "sourceDocumentId": "<uuid>", "groupId": "<uuid>", "title": "optional" }
> ```
>
> The acting-user value is the **same OAuth access token Den already holds** for that user (the one used for `/api/me`, `/api/embed/documents/:id/metadata`, and `/api/embed/editor-session`) — no new grant, no new scope, no second authorize round trip. It goes in a header rather than `Authorization` because `Authorization` stays the service token, consistent with every other owner-op route.
>
> **Checks performed, in order** — all failures are opaque, and a `404` never distinguishes its cause:
>
> | # | Check | Failure |
> |---|---|---|
> | 1 | Service token valid | `401` |
> | 2 | `X-Vault-Acting-User-Token` present | `400` |
> | 3 | Acting-user token valid / unexpired | `401` |
> | 4 | `groupId` exists, not soft-deleted, owned by *this* service | `404` |
> | 5 | Acting user is not banned | `404` |
> | 6 | **Acting user is a member of `groupId`** | `404` |
> | 7 | Acting user can read `sourceDocumentId` | `404` |
>
> **Why check 6 exists** (the non-obvious one): the service can already *read* the user's documents with their consented token, so the read itself is nothing new. But cloning **re-exposes that content to other people** — every member of the destination group. Requiring the acting user to belong to that group keeps the clone inside a circle they are already part of, and stops a service from copying one user's private documents into a group of strangers. Practically, for Den this is always true anyway: the user is cloning from a chat they're in.
>
> ### ⚠️ Contract addition 2026-07-27 — `GET /api/embed/documents` (clone-picker list)
>
> **Why it exists.** Den's clone modal needs "documents this user could bring into the chat", and nothing served that — the embed API had no list or search endpoint at all.
>
> **Why not MCP.** Vault's MCP server already exposes `list_documents`/`search_documents`, but those are JSON-RPC tools over a streamable HTTP transport at `/api/mcp/mcp`, with responses wrapped in content blocks — Den would be parsing JSON out of a text block to fill a picker. There is also nothing to reuse *at* that layer: the MCP tools are themselves thin wrappers over `listDocumentsForUser`/`listSharedDocumentsForUser` in `server/documents.ts`. This route calls the same two functions, so both surfaces stay wrappers over one source of truth and neither duplicates permission logic.
>
> ```http
> GET /api/embed/documents?query=&scope=owned|shared|all&limit=50
> Authorization: Bearer <user_oauth_token>     # the ACTING USER, not a service token
>
> → 200 { "documents": [
>          { "id": "<uuid>", "title": "Spec",
>            "folderPath": "Work/Specs" | null,
>            "ownerName": "Ada" | null,        # null when the user owns it
>            "visibility": "private" | "public",
>            "updatedAt": "<ISO 8601>",
>            "snippet": "first ~200 chars, frontmatter stripped" } ] }
> ```
>
> **Parameters.** All optional. `query` matches title and body, case-insensitive, max 200 chars. `scope` defaults to `all`. `limit` is 1–100, default 50. Invalid values → `400`. Rate limit 60/min per user → `429` with `Retry-After`.
>
> **Auth is the user's OAuth token, not the service token** — this returns what that user can see, so it is a user-delegated read like `/api/me`. An invalid or expired token → `401`. A banned user gets `200` with an empty list rather than an error, matching the "never confirm existence" posture elsewhere.
>
> **What it returns:** documents the user owns, documents shared with them directly, and documents reachable through a shared ancestor folder (the shared query walks the folder chain). Sorted most-recently-updated first, de-duplicated when a document arrives via more than one route.
>
> **What it deliberately excludes: group-owned documents** (owner decision 2026-07-27). The picker means "documents of yours you could bring into this chat", not everything readable. Note this makes the list **narrower than what clone will accept** — clone authorizes against `getDocumentAccess`, which does honor group membership. That asymmetry is intentional, not a bug: a document absent from the list can still be cloned by id if the user can genuinely read it.
>
> **Den-side checklist:**
> 1. Send the acting user's OAuth access token in `X-Vault-Acting-User-Token` on every clone call.
> 2. Ensure the group's membership has been mirrored (`POST /api/embed/groups/:id/members`) **before** the user's first clone into it — a clone by a not-yet-mirrored member returns `404`, which is indistinguishable from a missing group. Den's reconciliation sweep already covers this, but a fresh chat's first clone is the realistic race.
> 3. Refresh the user's OAuth token as normal; an expired one now yields `401` on clone rather than the previous `404`.
> 4. Cloning still exposes the source author's private assets to the destination group (asset link rows are access grants). Surfacing a confirmation before clone is **Den's UX call** — Vault enforces the permission boundary but has no UI entry point for this op.
- Doc edit access resolves via group membership through `getDocumentAccess` (the collab connect-time re-check included).
- Boot token: `v1.<payload>.<sig>` HMAC off `AUTH_SECRET`, TTL ≤60s, single-use, payload `{ documentId, vaultUserId }`.

---

## 5. Verification (definition of done)

- **§A:** `/api/me` returns the right user for a bearer; unknown/expired token → 401. Den can complete authorize→token→`/api/me` end to end.
- **§B:** metadata + rendered return sanitized, permission-correct output; a doc the caller can't read → 404 (no title/snippet leak); private wiki links / private assets do not resolve to content in the rendered HTML; frontmatter stripped from `snippet`.
- **§C:**
  - editor-session mints an `embedUrl` only when the caller can edit; boot token is single-use (replay → reject) and expires; a doc the user can't edit → forbidden/404.
  - The embed route boots a working Live-mode editor bound to the real Hocuspocus room; two clients (one in Den's iframe, one in Vault proper) co-edit with no duplication (CRDT identities preserved — the docs/03 §4 hazard does not recur).
  - `frame-ancestors` blocks framing from any origin other than `den.ems-place.com`; all non-embed routes remain unframeable.
  - **group ownership:** a group can own a doc; a `group_members` user gets edit via `getDocumentAccess`; adding/removing a member grants/revokes edit; **a member removed mid-session loses edit at the collab connect re-check, not just at token expiry** (the re-check reads group membership from the DB); group create + member add/remove are idempotent under repeat calls (Den's sweep).
- House checks green; `project-knowledge.md` changelog + section updates landed with the change.

---

## 6. Notes / decisions to confirm with owner

> **All §C.7–10 questions below were resolved with the owner on 2026-07-27** — see the "Design settled" block in §C. Kept here for the reasoning trail; the resolutions are authoritative.

- **Service-principal auth mechanism** (§C.8): ~~long-lived `mcpTokens` row vs. a dedicated service-token concept~~ → **resolved: a dedicated `service_tokens` table.** Lower-risk precisely because it doesn't overload user-OAuth tokens with a lifecycle they weren't designed for: `mcp_tokens` requires a `client_id` FK to `mcp_clients`, is issued at a 1h expiry with 30d refresh, and its existing rotate/expire logic doesn't expect a long-lived row. A dedicated table also makes rotation and audit (`last_used_at`, `revoked_at`) obvious.
- **Group ownership is now first-class Vault** (§C.7) — chosen over Den mirroring per-doc `document_permissions` because you can extend Vault cheaply, and a group collapses membership sync from per-doc to per-chat while making doc ownership durable. The one load-bearing spot is the `getDocumentAccess` chokepoint + the collab connect-time re-check reading group membership from the DB. This primitive is reusable beyond Den — it's the `workspace` visibility direction docs/03 §2 already reserves.
- **Rendered-HTML caching/expiry** is Den's concern; Vault just serves fresh render on request. If render cost matters later, add an ETag/`updatedAt` conditional — out of scope for v1.
