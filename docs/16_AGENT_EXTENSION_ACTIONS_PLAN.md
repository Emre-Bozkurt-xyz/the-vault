# Agent Extension Actions Plan

## 1. Goal

Let agents (Claude via MCP, and later cowork) interact with extension content —
including extension data that lives purely in the database, not in the document
markdown — without adding bespoke MCP tooling per extension.

The target checkpoint is:

```txt
Any enabled extension can expose named, schema-described "agent actions" from its
manifest, and an agent can discover and invoke them through two generic MCP tools
— with no extension-specific MCP code, ready for user-toggled and future
hub-sourced extensions.
```

This plan builds on:

```txt
docs/12_EXTENSION_REGISTRY_PLAN.md
docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md
db.document_extension_states
lib/extensions/*
server/document-extensions.ts
lib/mcp/* (document + write tools, OAuth user resolution)
```

## 2. Why not a tool per extension

Extensions are variable: enabled/disabled per user, and eventually pulled from
external codebases via an extension hub. A static MCP tool per extension does not
scale and cannot describe extensions the server has never seen. Instead we lean
on what already exists:

- A **uniform state store** — `document_extension_states`, keyed by
  `(documentId, extensionId, stateKey)` — is where extension data (including
  DB-only data) already lives, behind permission-checked functions.
- A **declarative manifest** (`VaultExtension`) the registry already enumerates.

So agents talk to the extension-state substrate through a small fixed set of
dispatcher tools, and the manifest describes what is available.

## 3. The contract

Each extension declares `agent.actions` in its manifest
(`lib/extensions/types.ts` → `VaultExtensionAgentAction`):

```txt
id          globally unique, namespaced under the extension id
title       short label
description shown to the model
scope       "document" (needs a documentId) | "workspace"
mutates     whether it writes; document-scoped mutating actions need edit access
permissions subset of the extension's own permissions; gates ctx surfaces
input       a Zod schema — validated server-side AND surfaced as JSON Schema
handler     (input, ctx) => Promise<{ data?, message? }>
```

### Invariant: handlers are pure functions of `(input, ctx)`

Handlers must **not** import `db` or any server-only module. Every capability
arrives via the sandboxed `ctx` the server injects. This keeps `catalog.ts`
client-importable (its Zod schemas are used by client components) and makes
third-party/hub handlers sandboxed by construction.

The registry asserts the invariants at module load
(`assertAgentActionInvariants`): ids are namespaced + unique, and an action never
requests a permission its extension hasn't declared.

### The sandbox (`ExtensionAgentActionContext`)

For `scope: "document"` actions the server builds `ctx.document` after resolving
document access:

```txt
ctx.document.state   ExtensionAgentStateApi — get/set/list/delete, PRE-BOUND to
                     the action's own extensionId + the target documentId. A
                     handler physically cannot name another extension's state.
ctx.document.markdown.read   present with `document:read`
ctx.document.assets          present with `asset:read` (surface not yet wired)
ctx.document.canEdit
```

Permission/access enforcement is layered: the bound state API delegates to the
existing permission-checked functions in `server/document-extensions.ts`
(canRead for reads, canEdit for writes), and the dispatcher additionally
front-loads a clear error when a `mutates` action lacks edit access.

## 4. Dispatch + discovery

`server/extensions.ts` (framework-agnostic — MCP, server actions, and a future
cowork UI all call through it):

- `resolveEnabledExtensionsForUser(userId)` — core extensions always, plus
  built-ins the user enabled (or `defaultEnabled` with no explicit row).
- `listAgentActionsForUser(userId)` — actions from enabled extensions only, each
  with `z.toJSONSchema(input, { io: "input" })` so the model gets the exact input
  shape (defaulted fields optional).
- `runAgentActionForUser({ userId, actionId, documentId?, input })` — resolve →
  enabled check → unsupported-permission guard → validate input → scope/access
  gating → build sandboxed ctx → run handler.

`lib/mcp/extension-tools.ts` registers two dispatcher tools (wired in
`app/api/mcp/[transport]/route.ts`):

- `list_extension_actions` — discovery; the model is told to call it first.
- `run_extension_action` — `{ actionId, documentId?, input }`; `input` is a
  generic object on the MCP boundary because the real schema is per-action and
  discovered via `list_extension_actions`.

This is the "static tool list, runtime-discovered targets" pattern: the tool set
is fixed, but what they dispatch to is the user's live enabled set.

## 5. Reference implementation

`vault.calendar` exposes two actions, validating document scope, multi-instance
handles (`calendar:<calendarId>` state keys), and state read/write through the
sandbox:

- `vault.calendar.listEntries` — read (`document:read`); with a `calendarId`
  returns that calendar's entries, otherwise lists calendars + entry counts.
- `vault.calendar.addEntry` — mutate (`document:write-extension-state`); appends a
  task/event to a calendar instance on a given day.

## 6. MVP scope cuts (next increments)

- **Markdown mutation surface.** `ctx.document` exposes `markdown.read` only.
  Actions that need to insert/edit document markdown (e.g. *create a new calendar
  instance in a new doc* = live block + state row) require a write surface over
  `withLiveDocumentText` (`lib/mcp/collab-write.ts`). Deferred until an action
  needs it; `supportedActionPermissions` in `server/extensions.ts` is the guard
  that fails such actions clearly until then.
- **Asset surface.** `asset:read` is accepted by the guard but `ctx.document.assets`
  is not yet populated; no reference action needs it.
- **Workspace-scoped actions.** The shape exists (`scope: "workspace"`, no
  `ctx.document`) but has no reference action or account-level capability surface
  yet.
- **Hub / external manifests.** The contract is intentionally frozen-friendly now,
  while there is one built-in consumer, before the extension hub loads
  third-party manifests against it.

