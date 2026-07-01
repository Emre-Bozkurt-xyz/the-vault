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
output      optional Zod schema — surfaced as JSON Schema; dispatcher validates
            the handler's `data` against it
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
ctx.document.state        ExtensionAgentStateApi — get/set/list/delete, PRE-BOUND
                          to the action's own extensionId + the target documentId.
                          A handler physically cannot name another extension's state.
ctx.document.markdown.read                 present with `document:read`
ctx.document.markdown.append/insertAtHeading/edit
                          present with `document:write` — go through the collab
                          session (`withLiveDocumentText`), so they merge
                          conflict-free and reuse the human edit/version pipeline.
ctx.document.assets.get   present with `asset:read` — async, owner-scoped lookup
                          via `getAssetForUser`; null when not the user's ready asset.
ctx.document.canEdit
```

For `scope: "workspace"` actions the server builds `ctx.workspace` instead (no
document):

```txt
ctx.workspace.state.listAcrossDocuments   present with `document:read` — returns
                          the acting extension's state rows across every document
                          the user OWNS (owner-scoped, so no per-doc access check),
                          each tagged with documentId + title. Bound to the
                          extension: it can't read another extension's state.
```

Permission/access enforcement is layered: the bound state APIs delegate to the
permission-checked functions in `server/document-extensions.ts` (canRead for
reads, canEdit for writes), and the dispatcher additionally front-loads a clear
error when a `mutates` action lacks edit access.

## 4. Dispatch + discovery

`server/extensions.ts` (framework-agnostic — MCP, server actions, and a future
cowork UI all call through it):

- `resolveEnabledExtensionsForUser(userId)` — core extensions always, plus
  built-ins the user enabled (or `defaultEnabled` with no explicit row).
- `listAgentActionsForUser(userId, documentId?)` — actions from enabled
  extensions only, each with `z.toJSONSchema(input, { io: "input" })` (and the
  output schema when declared) so the model gets the exact shapes. When a
  `documentId` is passed, document-scoped actions are annotated with
  `documentInstanceCount` (how many of that extension's state rows exist there)
  and `runnableInDocument` (given the user's access), plus a top-level `document`
  access summary — so the model doesn't try actions that can't apply.
- `runAgentActionForUser({ userId, actionId, documentId?, input })` — resolve →
  enabled check → unsupported-permission guard → validate input → scope/access
  gating → build sandboxed ctx → run handler → validate output against the
  action's `output` schema (if any).

`lib/mcp/extension-tools.ts` registers two dispatcher tools (wired in
`app/api/mcp/[transport]/route.ts`):

- `list_extension_actions` — discovery (optional `documentId` to scope it); the
  model is told to call it first.
- `run_extension_action` — `{ actionId, documentId?, input }`; `input` is a
  generic object on the MCP boundary because the real schema is per-action and
  discovered via `list_extension_actions`.

This is the "static tool list, runtime-discovered targets" pattern: the tool set
is fixed, but what they dispatch to is the user's live enabled set.

## 5. Reference implementations

`vault.calendar` — validates document scope, multi-instance handles
(`calendar:<calendarId>` state keys via `calendarStateKey`), markdown mutation,
and workspace scope:

- `vault.calendar.listEntries` — read (`document:read`); with a `calendarId`
  returns that calendar's entries, otherwise lists calendars + entry counts.
- `vault.calendar.addEntry` — mutate (`document:write-extension-state`); appends a
  task/event to a calendar instance on a given day. `day` is validated as a real
  calendar date (`dayKeySchema`/`isValidDayKey`), not just the `YYYY-MM-DD` shape.
- `vault.calendar.setEntryDone` — mutate (`document:write-extension-state`); marks
  a task done/not-done (events rejected), enabling the recurring todo workflow.
- `vault.calendar.insertCalendar` — mutate (`document:write`); creates a new,
  empty calendar by writing a `:::calendar{id=…}` block (`formatCalendarFence`)
  into the markdown via `ctx.document.markdown`, returning the new `calendarId`.
  This is instance *creation* (block + future state), the piece that turns
  editing-existing-data into authoring.
- `vault.calendar.listUpcomingTasks` — **workspace** read (`document:read`); scans
  the user's calendars across all owned documents for tasks (optional day range,
  excludes done by default) — the daily-digest use case. Declares an `output` schema.

`vault.stickers` — validates the single-`layout`-key shape and the `asset:read`
surface:

- `vault.stickers.listStickers` — read (`document:read`).
- `vault.stickers.addSticker` — mutate (`document:write-extension-state` +
  `asset:read`); validates the asset is the user's own image via
  `ctx.document.assets.get` before placing it.
- `vault.stickers.removeSticker` — mutate (`document:write-extension-state`).

## 6. Remaining scope cuts (next increments)

- **Writable account-level state.** Workspace actions can *read* an extension's
  state across owned documents, but there is no account-scoped *writable* store
  (state not tied to any document). Adding one means a new
  `user_extension_states` table (keyed `(userId, extensionId, stateKey)`) mirroring
  `document_extension_states`, plus a `ctx.workspace.state.get/set`. Deliberately
  deferred — no consumer needs it yet, and it is a durable schema commitment.
- **Cross-document scope beyond owned.** `listAcrossDocuments` is owner-scoped;
  shared documents are not included. Revisit if a workspace action needs them
  (requires per-document access filtering rather than an owner join).
- **Hub / external manifests.** The contract is intentionally frozen-friendly now,
  while there is one built-in consumer, before the extension hub loads
  third-party manifests against it.

