# Vault — MCP Integration Plan (AI document read/edit)

Status: **In progress** (Phase 1 underway)
Owner: Emre
Created: 2026-06-29

Goal: let external AI assistants (Claude, ChatGPT, etc.) read and edit a user's
Vault documents directly, the way they edit files in a coding workspace — without
building or being listed as an "official connector," and without conflicting with
the live collaborative editor.

The mechanism is a **remote MCP (Model Context Protocol) server** hosted inside this
Next.js app at `/api/mcp`, authenticated with our own OAuth, exposing document
tools that reuse the existing `server/documents.ts` permission-checked functions
for reads and the **Yjs/Hocuspocus collaboration layer** for writes.

---

## Why MCP (and not the alternatives)

- **Official connectors** (ChatGPT apps / Claude directory connectors) are the same
  underlying tech as MCP plus a gated review/listing process. We don't need public
  discoverability, so we skip the directory.
- **Local stdio server + personal access token** was rejected: it pushes setup work
  onto the user (install a script, paste a token) and the token system would be
  throwaway once hosted.
- **Remote MCP with OAuth** (this plan) gives a "paste a URL, sign in" experience,
  works for multiple users, and reuses identity we already have.

The big leverage: **the hard parts already exist.** Per-user permissions live in
`server/documents.ts` / `lib/permissions.ts`; collaborative, conflict-free editing
and all persistence (markdown column, version snapshots, asset reconcile, metadata
sync) live in `scripts/collab-server.mjs`. MCP is mostly glue over both.

---

## Settled design decisions

1. **Read freshness — snapshot for reads, live for edits.**
   `list_documents` / `search_documents` / `read_document` read the fast Postgres
   `documents.markdown` snapshot (can be ≤ ~1.5s stale during active editing, due to
   the collab server's 1.5s store debounce). `edit_document` resolves its anchors
   against the **live Y.Doc** it connects to anyway, so writes are never stale.

2. **Write attribution — as the user, reason `'assistant'`.**
   AI edits are an "on behalf of" action: the user prompted them and is accountable,
   so version snapshots are attributed to the authenticated user (real `created_by`
   FK), with `document_versions.reason = 'assistant'` so they remain distinguishable.
   History UI should surface that reason (e.g. "Emre · via assistant"). A distinct
   synthetic actor was rejected — it muddies accountability and fights the existing
   real-user FK. Revisit only if we add *autonomous* (no-human-in-loop) agents.

3. **OAuth — self-hosted minimal authorization server.**
   `/api/mcp` is protected by an OAuth 2.1 AS we run inside Next.js (~4-5 endpoints)
   that **delegates actual login to the existing NextAuth session**. This keeps a
   single identity system (our `users` table, existing Google/GitHub logins), no user
   migration, and no external dependency. A managed provider (WorkOS/Stytch/etc.) was
   rejected to avoid a second identity system to map against.

---

## Architecture / topology

```
Claude / ChatGPT ──OAuth──▶ Next.js  /api/mcp        (MCP protocol + auth + tools)
                                 │
                     read  ──────┼──────▶ Postgres snapshot (documents.markdown)
                     write ──────┘──────▶ Collab server as a Yjs client (ws)
                                              │
                                              └─ onStoreDocument →
                                                 documents.markdown, document_versions,
                                                 document_assets, document_metadata
```

Hard rule: **the MCP server never writes `documents.markdown` directly.** It joins
the document as a Yjs participant (exactly like a browser editor) so edits merge
conflict-free with anyone editing live, and the existing `onStoreDocument` pipeline
performs all persistence. We write zero new persistence logic.

### Document model recap (grounding the write path)

- Markdown is a flat `Y.Text` named `"markdown"` in each document's `Y.Doc`
  (`scripts/collab-server.mjs` `onLoadDocument`/`onStoreDocument`).
- Yjs state persists to `document_collab_states.yjs_state`; markdown snapshot to
  `documents.markdown`, written by `onStoreDocument` (debounced 1.5s).
- Collab auth is an HMAC token `v1.<base64url(payload)>.<sig>` over `AUTH_SECRET`,
  already minted by `lib/collab-token.ts` `createCollabToken({documentId, userId,
  role, name, email, image, shareLinkId})` and verified by the collab server's
  `onAuthenticate` (which independently re-checks DB permissions and requires
  `role ∈ {owner, editor}`).

Because markdown is a flat `Y.Text`, an edit is a minimal CRDT delta at an offset
(`ytext.delete(i, n); ytext.insert(i, s)`), which merges cleanly with concurrent
edits elsewhere in the doc.

---

## Tool catalog

| Tool | Backed by | Notes |
|---|---|---|
| `list_documents` | `listDocumentsForUser` + `listSharedDocumentsForUser` | owned + shared |
| `search_documents` | user-scoped variant of `listPublicDocuments` | reuse `buildPublicDocumentSearchWhere` |
| `get_outline` | `extractMarkdownHeadingOptions` (`lib/wiki-links.ts`) | cheap navigation, no full body |
| `read_document` | `getDocumentForUser` | supports `range` / `heading` slicing |
| `create_document` | `createDocumentAction` (adapted to return id, not redirect) | |
| `edit_document` | **new** collab-client write path | anchored search/replace, see below |
| `append_to_document` | **new** collab-client write path | anchorless insert at end |
| `insert_at_heading` | **new** collab-client write path | anchorless insert relative to a heading |

### Efficient editing contract (Copilot/Claude-style)

The agent must **never resend the whole document**. We use anchored
search-and-replace, the proven model-friendly pattern (Claude's own `str_replace`
editor; Aider SEARCH/REPLACE; Copilot patch-apply) — not line numbers (go stale on
any concurrent edit) and not whole-file rewrites (token-wasteful).

`edit_document(id, edits[])`, each edit `{ old_string, new_string }`:
- Server locates `old_string` in the live `Y.Text`, applies a minimal delete+insert
  delta. Multiple edits apply in **one Y transaction** → one atomic version snapshot.
- **Uniqueness rule:** `old_string` matching 0 times → `"anchor not found, re-read
  the section"`; matching >1 → `"ambiguous, add surrounding context"`. This doubles
  as the staleness guard: if a live editor changed that exact text, the anchor fails
  loudly and the agent recovers by re-reading instead of corrupting silently.

Reads stay cheap and navigable so context rarely holds the whole doc:
- `get_outline(id)` → headings (level/text/slug) with offsets.
- `read_document(id, { range?, heading? })` → full doc, a line range, or one section.
- Reads return a lightweight `version` token (`updatedAt` or a hash of the Y state
  vector). Edits may echo it; because the backend is a CRDT we **merge** rather than
  reject on mismatch — the token is advisory so the agent knows the doc moved.

Anchorless convenience writes (most common LLM operations, can't fail on staleness):
`append_to_document(id, markdown)`, `insert_at_heading(id, heading, markdown,
position)`.

Edit results are compact: `{ ok, applied, version }` — never echo the new document.

---

## OAuth (self-hosted minimal AS)

MCP remote clients require OAuth 2.1 + PKCE, metadata discovery, and **Dynamic
Client Registration** (RFC 7591) — the client (Claude) registers itself; we can't
pre-issue a `client_id`. NextAuth is an OAuth *client*, not a server, so we add a
thin AS that delegates the human login step to the existing NextAuth session.

Endpoints:
- `/.well-known/oauth-protected-resource` (RFC 9728) → points at our AS.
- `/.well-known/oauth-authorization-server` (RFC 8414) → AS metadata.
- `/oauth/register` — Dynamic Client Registration.
- `/oauth/authorize` — checks the NextAuth session cookie (redirect to `/login` if
  absent) → consent screen → issues an auth code bound to `users.id` (PKCE).
- `/oauth/token` — PKCE code/refresh exchange → **opaque** access token stored in a
  new `mcp_tokens` table (revocable; audience-bound to the MCP server, RFC 8707).

A `withMcpAuth` middleware on `/api/mcp` resolves bearer → `users.id`; every tool
then calls the existing permission-checked `server/documents.ts` functions.

### User-facing auth flow (both paths look the same to the user)
1. User pastes `https://vault.ems-place.com/api/mcp` into Claude's "add connector."
2. Claude discovers our OAuth endpoints, opens a browser to `vault.ems-place.com`.
3. If not already signed in, they see our normal `/login` (Google/GitHub).
4. Consent screen: "Claude wants to access your Vault documents — Allow / Deny."
5. Allow → window closes → connected.

---

## Phased rollout

- **Phase 1 — MCP skeleton, read-only, no OAuth.** Streamable HTTP transport at
  `/api/mcp` via `mcp-handler` over the installed `@modelcontextprotocol/sdk`. Tools:
  `list_documents`, `search_documents`, `read_document`, `get_outline`. Acting user
  resolved from a dev fallback (`MCP_DEV_USER_ID`) / NextAuth session so we can drive
  it from MCP Inspector / Claude Desktop before OAuth exists. Validates the protocol
  end-to-end.
- **Phase 2 — Collab-safe writes.** A HocuspocusProvider-based write client that mints
  a token via `createCollabToken`, connects to `NEXT_PUBLIC_COLLAB_URL`, applies
  deltas, flushes. Ship `edit_document` (anchored) + `append_to_document` /
  `insert_at_heading`. Iterates against the dev session — no OAuth needed yet.
- **Phase 3 — OAuth.** Self-hosted minimal AS + DCR + `mcp_tokens` + token middleware.
  Flip `/api/mcp` from dev-stub to real bearer auth. Gate to hosted / other users.
- **Phase 4 — Hardening.** Per-token rate limits, consent screen polish, `'assistant'`
  version reason surfaced in history UI, observability, decision on read-from-live vs
  snapshot while an edit session is hot.

---

## Schema additions (Phase 3)

- `mcp_clients` — dynamically registered OAuth clients (client_id, redirect_uris,
  metadata, created_at).
- `mcp_auth_codes` — short-lived authorization codes (code hash, client_id, user_id,
  PKCE challenge, redirect_uri, expires_at).
- `mcp_tokens` — issued access/refresh tokens (token hash, client_id, user_id, scope,
  audience, expires_at, revoked_at).

(No schema change for Phases 1–2; writes reuse existing tables via the collab server.)

---

## Open / deferred items

- **Read while hot:** reads use the snapshot; if an `edit` session is live we already
  resolve anchors against the live doc. Revisit whether `read_document` should
  optionally read live when a session is open (Phase 4).
- **Concurrency token format:** `updatedAt` vs Y state-vector hash — decide in Phase 2
  when the edit client is concrete.
- **Rate limiting / abuse:** per-token limits deferred to Phase 4.
- **Scopes:** start with a single `documents` scope; split read/write scopes later if
  needed.
```
