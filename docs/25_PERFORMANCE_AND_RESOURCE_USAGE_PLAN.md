# Vault — Performance and Resource Usage Pass

Date: 2026-10-14. Tracker: Phase 27.

**Status: first implementation pass done 2026-10-14 (see §7); slice 4 and
parts of slices 1, 5, 6 and 7 remain.** The investigation below was made at
revision `eb9377a`; its numbers describe the code before §7's changes.

## 1. Goal and recommendation

Make opening Vault, switching documents, editing large notes, and leaving Vault
idle cheaper on both the browser and the home server. Start by reducing work and
data that a screen does not need, then optimize the remaining hot paths.

The first implementation pass should cover:

1. A repeatable production-mode baseline and request/query instrumentation.
2. Smaller workspace/document payloads and fewer repeated database reads.
3. Settings loaded on demand and one active instance of each visible panel.
4. Bounded idle runner polling, if the runner is enabled in the deployment.

Then tackle editor scans, task indexing, and asset thumbnails/pagination as
separate slices. Do not begin with a framework upgrade, a new cache service, or
a wholesale editor rewrite. No production latency, heap leak, or percentage
improvement has been established by this investigation.

## 2. Evidence collected

### 2.1 Production build and entry JavaScript

`npm run build` passed on Windows with Node `v22.16.0`, Next `16.2.6`, and
Turbopack. Compilation reported 27.0 seconds; TypeScript reported 19.0 seconds.
These are build phases on the development machine, not user-facing load times.

The table sums the unique `entryJSFiles` in each route's
`page_client-reference-manifest.js`, with each file compressed separately using
Node's default `gzipSync`. KiB means 1,024 bytes. This is the same manifest-based
approach used in plan 23. It excludes CSS, fonts, images, HTML/RSC data, and
subsequently loaded chunks. It is **not** a measured browser transfer total;
shared files are counted once per route, and route totals must not be added.

| Route | Entry files | Raw KiB | Gzip KiB |
|---|---:|---:|---:|
| `/workspace` | 22 | 2,330 | 690 |
| `/docs/[docId]` | 25 | 2,805 | 845 |
| `/assets` | 22 | 2,350 | 695 |
| `/gallery` | 22 | 2,336 | 691 |
| `/tasks` | 22 | 2,349 | 695 |
| `/public/[slug]` | 11 | 804 | 212 |
| `/share/[token]` | 11 | 797 | 210 |
| `/embed/editor/[docId]` | 21 | 2,500 | 753 |
| `/login` | 6 | 140 | 44 |

The ordinary workspace entry is about 82% of the document editor entry. Its
manifest includes `SnippetsSettingsSection`, which statically imports CodeMirror,
the CSS grammar, and `MarkdownDocument`. The latter imports the Markdown parser,
KaTeX, and code highlighting. Closed settings therefore provide a concrete eager
import path to investigate; the table does not attribute all 690 KiB to settings.
The public entry remains approximately at plan 23's final 212 KiB baseline.

Reproduce the bundle measurement after `npm run build`, using Node from the repo
root (save this snippet to a temporary `.cjs` file, or pipe it to `node`):

```js
const fs = require("node:fs");
const vm = require("node:vm");
const zlib = require("node:zlib");
const routes = [
  "(workspace)/workspace", "(workspace)/docs/[docId]", "(workspace)/assets",
  "(workspace)/gallery", "(workspace)/tasks", "public/[slug]", "share/[token]",
  "embed/editor/[docId]", "login",
];
for (const route of routes) {
  const context = {};
  vm.runInNewContext(fs.readFileSync(
    `.next/server/app/${route}/page_client-reference-manifest.js`, "utf8",
  ), context);
  const manifest = Object.values(context.__RSC_MANIFEST)[0];
  const files = [...new Set(Object.values(manifest.entryJSFiles).flat())];
  let raw = 0, gzip = 0;
  for (const file of files) {
    const bytes = fs.readFileSync(`.next/${file}`);
    raw += bytes.length;
    gzip += zlib.gzipSync(bytes).length;
  }
  console.log({ route, files: files.length, raw, gzip });
}
```

### 2.2 Synthetic server-side cost checks

Actual `buildWikiLinkResolutionMap` and `parseTasks` functions were bundled in
memory with the installed esbuild and run under Node `v22.16.0`. No database,
private document content, or production endpoint was used. Each case ran four
times; the first was discarded. The following are ranges of the three warm
samples. Serialization was outside the map-build timing.

| Fixture | Operation | Warm time | Serialized map size |
|---|---|---:|---:|
| 100 documents, 2,078,200 source bytes | Wiki map with embeds | 17–21 ms | 4,352,021 bytes |
| Same 100 documents | Wiki map without embeds | 16–17 ms | 57,621 bytes |
| 500 documents, 10,391,000 source bytes | Wiki map with embeds | 89–100 ms | 21,763,621 bytes |
| Same 500 documents | Wiki map without embeds | 83–88 ms | 291,621 bytes |
| 100 dated tasks | `parseTasks` | 9–14 ms | N/A |
| 1,000 dated tasks | `parseTasks` | 74–84 ms | N/A |
| 2,000 dated tasks, 64,889 source bytes | `parseTasks` | 159–189 ms | N/A |

The wiki map sizes are raw `JSON.stringify` output, **not RSC wire sizes**.
RSC can reuse references, and network compression changes transfer size. They
demonstrate the amount of content present in the object graph. Turning off
`includeEmbeds` alone does not remove body reads or heading/anchor parsing.

Reproduction fixtures:

```js
const body = "# A heading\n" + "A normal line of useful prose.\n".repeat(670);
const documents = Array.from({ length: count }, (_, i) => ({
  id: `doc-${i}`, title: `Document ${i}`, markdown: body,
  publicSlug: null, ownerUsername: "test",
}));
const tasks = Array.from({ length: count }, (_, i) =>
  `- [ ] Task ${i} :due[2026-10-14]`).join("\n");
buildWikiLinkResolutionMap(documents, d => `/docs/${d.id}`, { includeEmbeds });
parseTasks(tasks);
```

Bundle named exports from `lib/wiki-links.ts` and `lib/tasks/parse.ts` with
esbuild `{ bundle: true, write: false, platform: "node", format: "cjs" }`;
execute the returned CJS in memory. Time the map with `includeEmbeds` true/false
and task parsing separately using `performance.now()`.

### 2.3 Synthetic editor cost checks

Actual exported CodeMirror scanners and StateFields ran under Vitest's Node
environment: five warmups, 30 timed samples, pre-parsed Markdown syntax trees,
selection changes without document edits. Values below are median / p95 in ms
from the final run. They exclude browser DOM/layout, React, and the main inline
preview's additional scans, so must not be presented as end-to-end input latency.

| Operation | 100 lines | 1,000 lines | 5,000 lines |
|---|---:|---:|---:|
| Full Live-block scan, plain | 0.136 / 0.294 | 0.544 / 0.850 | 3.772 / 4.985 |
| Live-block selection transaction, plain | 0.094 / 0.348 | 0.628 / 0.811 | 4.251 / 7.957 |
| Full Live-block scan, callouts/tables | 0.138 / 0.269 | 1.035 / 1.771 | 12.459 / 16.205 |
| Calc selection transaction, plain | 0.076 / 0.114 | 0.211 / 0.380 | 0.961 / 1.395 |
| Calc selection transaction, 10% calc lines | 0.417 / 0.507 | 3.164 / 4.642 | 14.478 / 17.126 |

Reproduction: create `EditorState` with `markdown()` and optionally
`createLiveBlockDecorationExtension({ wikiLinks: {}, assetLinks: {} })` or
`createCalcLiveExtension({})`. Call `ensureSyntaxTree(state, state.doc.length,
30000)` before timing. Time `getMarkdownLiveBlocks(state)` or
`state = state.update({ selection: { anchor: ++cursor % text.length } }).state`.
Use the repo's existing server-action/server-only test stubs, the `@` alias, and
one Vitest worker; ensure CodeMirror packages resolve to one copy. Sort the
30 samples and take indices 15 and 28, as in this diagnostic run.

- Plain: `## Heading ${i}` every twentieth line, otherwise
  `Plain paragraph line ${i}, with some **bold** and a [[link]].`.
- Mixed: repeat ten-line groups of a heading, blank, `> [!note] Note`,
  `> A useful note`, blank, `| Name | Value |`, `| --- | --- |`,
  `| Item ${i} | 12 |`, blank, and `Plain paragraph.`.
- Calc: every tenth line is `:calc[${i} * 12 + 8]`, otherwise
  `Paragraph ${i} of text.`.

### 2.4 Measurements still needed

No authenticated browser trace, Core Web Vitals run, heap snapshot, database
query plan, deployed RSS/CPU sample, or network waterfall was captured. The
Chrome DevTools MCP connector was unavailable. The source and build results
are enough to choose initial targets, but do not establish a memory leak or
the fastest production fix. Synthetic timings are directional, and other local
work may have overlapped them. Section 4 defines the missing baseline.

## 3. Prioritized implementation slices

Priority reflects evidence, reach, and risk, not a claimed measured speedup.
Small means a contained change; medium means a coordinated change across several
files; large means multiple independently reviewable PRs. These are scope
estimates, not delivery commitments.

| Order | Slice | Main benefit | Scope / risk |
|---|---|---|---|
| 0 | Production-mode baseline | Establish comparable latency, CPU, memory, and bytes | Small–medium / low |
| 1 | Workspace and document data loading | Lower server allocations, DB work, RSC bytes, browser retained data | Large / medium |
| 2 | Settings and panel loading/lifetime | Less initial JS and hidden/duplicate work | Medium / medium |
| 3 | Runner idle backoff | Fewer idle HTTP requests and DB transactions | Small–medium / medium; conditional on enabled runner |
| 4 | Editor analysis reuse | Faster cursor movement and typing in large/rich notes | Large / high correctness risk |
| 5 | Task refresh/index work | Faster agenda and task queries, fewer duplicate parses/writes | Medium–large / high concurrency risk |
| 6 | Bounded lists and image variants | Lower asset/gallery transfer, decode memory, and DOM cost | Large / medium |
| 7 | Resource bounds and measured tuning | Stable long-session storage and server resource use | Several small/medium changes / variable |

### Slice 1 — Load only the data needed for the current screen

**Evidence**

- `server/workspace.ts:39` is an uncached bootstrap function. The workspace
  layout calls it, and `/workspace`, `/gallery`, and `/tasks` call it again.
  It reads preferences, purges expired archived documents, then starts ten
  independent loaders. `db/index.ts:9` limits the main pool to one connection,
  so `Promise.all` does not make those SQL operations execute concurrently.
- Owned/shared list loaders select bodies that the shell discards. Public
  document bodies are retained in `WorkspacePublicDocumentItem` and serialized
  by `server/workspace.ts:158`. Gallery/search side panels use metadata only.
- `app/(workspace)/docs/[docId]/page.tsx:115` loads readable, public, and guide
  wiki maps with embeds enabled by default. The readable/public loaders fetch
  every eligible body and build heading/anchor information, regardless of the
  links in the document being opened. The completion endpoint omits embed
  fields but still reads/parses bodies.
- The same page eagerly fetches sharing, friends, restore-point summaries, and
  owner snippet lists for its context panel, even if the panel is closed.
- `app/api/content/search/route.ts:26` loads whole document/asset/guide candidate
  sets, parses and filters in memory, then returns at most 24 results. A small
  response therefore does not imply a small query or allocation footprint.

**Changes, in separate PRs**

1. Introduce metadata-only document/sidebar DTOs and SQL projections. Keep
   bodies out of the shared shell. Move gallery preview loading to the gallery
   route and keep its sidebar listing bounded or searchable.
2. Share one request-scoped bootstrap result and reuse profile/preferences.
   Separate pure reads from purge side effects before memoizing; explicitly
   preserve the current Bin-retention behavior or move it to a documented,
   leased maintenance path. Do not put user-specific payloads in a global cache.
3. Split wiki completion metadata from render dependencies. Load bodies for
   actual transclusions/previews, with deduplicated IDs and bounded nested
   expansion. Retrieve anchor lists on demand or from a versioned derived
   index. Preserve aliases, title/slug precedence, heading/block anchors,
   dictionary previews, public/share/guide/embed surfaces, and permission checks.
4. Fetch sharing/history/snippet-management data when the relevant UI opens.
   Continue loading CSS and render data required to display the document.
5. Bound search work at data access, preserving ranking, multi-term matching,
   tags, and permission semantics. Profile representative queries before choosing
   an index. Reuse immutable repo-guide metadata per production build/process.

**Exit checks:** one bootstrap per request; no full Markdown in shell DTOs;
opening a plain note does not retrieve every readable body; query count, bytes,
and p95 open latency improve on the same fixtures. Exercise owner, collaborator,
share-link, public, and revoked-access cases. No cross-user cache reuse.

### Slice 2 — Defer settings and suspend hidden panels

**Evidence**

- `WorkspaceSettingsModalMount.tsx:17` builds every settings page before the
  initially closed controller renders. `buildSettingsPages.tsx:63` loads auth
  providers, extension/user settings, snippets, styling preference, and optional
  folder/document choices. `SnippetsSettingsSection.tsx:10` imports the editor
  and Markdown rendering stack eagerly; it is present in the workspace manifest.
- `VaultWorkspaceShell.tsx:283` collapses the left panel by setting width zero.
  Its desktop body also remains mounted under CSS hiding on mobile. The mobile
  sheet renders another `activePanel` at `:439`; right-panel bodies have the
  same duplication pattern at `:340` and `:484`.
- `WorkspaceTasksPanel.tsx:156` refreshes on mount, focus, document changes,
  and task changes. The Tasks page, home Today section, and document Tasks
  section have independent consumers. The assets sidebar and library also
  independently refresh the same list.

**Changes**

1. Keep a lightweight settings-open controller. Load the modal and each heavy
   section, including its data, when opened. Defer the snippet editor/preview
   separately. Reuse already available preferences without reading all settings
   again. Preserve deep links, OAuth feedback, keyboard access, and saved state.
2. Keep one active panel body per surface/viewport. Either unmount unused bodies
   or suspend their work explicitly. Preserve drafts and upload ownership when
   collapsing a panel; a visibility optimization must not cancel user work.
3. Deduplicate task/asset in-flight requests by user and query, coalesce events,
   mark hidden data dirty, and refresh on show. Keep cache bounds and invalidation
   explicit. Discard stale responses after navigation or query changes.

**Exit checks:** unopened settings performs no settings-only reads or snippet
chunk loads; non-editor workspace entries no longer inherit that editor import
path; mobile drawers do not duplicate panel fetches; hidden panels do not refresh
on focus/save; first-open latency and keyboard behavior remain acceptable.
Validate with a real waterfall as well as manifests: moving an import is not
proof of deferred loading. Next's documented server-to-client dynamic-import
limitations require the lazy boundary to be placed deliberately in the client
host ([Next.js lazy-loading guide](https://nextjs.org/docs/app/guides/lazy-loading)).

### Slice 3 — Make an enabled idle runner cheap

**Evidence:** `runner/worker.mjs:44` sets `IDLE_POLL_MS = 1000`; a 204 claim
response sleeps one second. Each claim runs `claimNextCodeJob`, including a
transaction, advisory lock, active-job count, and candidate lookup. The claim
route also invokes periodic queue cleanup. A continuously idle enabled worker
therefore approaches 86,400 HTTP claims/day before request-time drift. This is
an arithmetic projection from the loop, not observed production traffic.

Add bounded backoff with jitter after empty claims, resetting after work is
found. Select a cap using an explicit acceptable submission-to-start latency;
for example, compare 1/2/5-second polling before choosing. Decouple expiry/
retention sweeping from each worker's hot claim path where safe. Only consider
long polling or database notifications if the latency/backoff tradeoff requires
it; do not introduce Redis just for this.

**Exit checks:** count empty HTTP claims, SQL statements, CPU, and queue-start
p95 during idle and bursts. Preserve lease heartbeats, timeout/reclaim behavior,
two-worker exclusion, cancellation, and recovery after worker death. Do not slow
active-job heartbeats to save idle resources. Skip deployment changes if code
execution is disabled there.

### Slice 4 — Reuse editor analysis across selection and viewport changes

The Live block StateField rescans the document on selection changes. The inline
renderer performs another block scan, scans extension containers, and walks
code-fence syntax. Calc also relocates and evaluates expressions for selection-
only transactions. Specifically: `live-blocks.ts:303` rebuilds on selection;
`:1019` runs the scanners; `MarkdownEditor.tsx:3328` rebuilds inline preview and
`:3491` scans blocks again; `code-fences.ts:103` walks the syntax tree;
`extensions/calc/live.ts:447` rebuilds calc and `:363` locates/evaluates it.
The synthetic editor timings are in section 2.3.

Separate content-derived structure/results from selection-dependent source
reveal and decorations. Share one structural analysis per document revision
among Live blocks, inline rendering, code-fence exclusion, and extensions where
the SDK permits. Selection changes should recompute only active/revealed ranges;
scrolling should do viewport work. Invalidate analysis on actual document,
parser, extension configuration, or FX-data changes. Start with per-revision
caching before attempting incremental parsing or a worker.

Use interval lookup or a linear ordered sweep for occupied ranges instead of
testing every range for every line when profiles confirm that path. Avoid
rebuilding the whole React editor configuration for unrelated status changes.

Follow up on auxiliary derivation: `EditorOutline.tsx:69` derives headings/line
offsets on each Markdown change; asset-ID scanning occurs before its debounce
(`MarkdownEditor.tsx:583`), and Properties reparses metadata at `:2286`. Reuse
document analysis or debounce secondary UI snapshots while keeping canonical
editor/autosave text immediate. Do not destabilize the collaborative editor's
controlled-value binding.

**Exit checks:** demonstrate fewer full-document analyses on cursor movement;
record p50/p95 key/cursor transaction and browser interaction time. Exercise
nested callouts/tables, fenced code, source reveal, drag selection, search,
undo/redo, task checkboxes, calc dependencies/FX settings, extension toggles,
and concurrent Yjs edits. Document replacement and parser updates must never
reuse stale ranges. Keep the change within extension SDK boundaries.
Multiline replacement decorations must remain a direct StateField source;
moving them into viewport plugins would violate the existing layout invariant.

### Slice 5 — Bound task refresh and share task snapshots

`server/tasks-data.ts:32` bounds individual query batches to 25 documents, but
the read path drains all stale documents before returning. `reindexDocumentTasks`
parses before its advisory lock; its freshness check skips a *newer* index,
not an equal source stamp, so concurrent equal-version refreshes can repeat
parsing and replacement writes. Confirm the observed cost with SQL traces.
`extensions/tasks/TaskQueryBlock.tsx:143` also fetches a personal task snapshot
independently for each query block; document-scoped blocks parse the same text
independently.

First deduplicate concurrent reads and avoid equal-version replacement work
under the existing lock. Distinguish ordinary DB refresh from live-write
reindexing: equal timestamps may still accompany fresher live text before the
debounced store. Do not mechanically change `>` to `>=` without resolving that
case. Preserve Postgres timestamp precision.

Then add a total refresh budget or move invalidation/index updates closer to
successful persistence, with a recoverable dirty/version marker. Choose and
document freshness behavior before allowing stale task results; do not silently
omit tasks to meet a latency target. Share one task snapshot/analysis between
agenda, page, panels, and query blocks, keyed by viewer and query.

**Exit checks:** unchanged task reads do no parse/write work; concurrent reads
perform one effective refresh; cold indexes have bounded request work with an
explicit completion/freshness contract. Test save-vs-refresh races, recurring
successors, moved lines, deletion, owner scoping, and live writes before store.

### Slice 6 — Bound library/gallery results and avoid full images for thumbnails

`WorkspaceAssetsPanel.tsx:56` fetches the entire asset library to display counts
and eight recent entries. `server/assets.ts:607` returns all ready assets and
tags. Public asset/document loaders apply some limits after reading all rows.
The library/gallery grids mount every filtered item, and document gallery cards
render full Markdown previews. Visible image cards and 32px sidebar thumbnails
use the original asset URL despite `loading="lazy"`.

1. Add a compact counts/recent-assets response and database-side pagination,
   filtering, and stable ordering. Bound gallery preview text and item counts.
2. Generate bounded thumbnail/card variants and deliver them through the same
   authorization model. Keep original downloads and full previews available;
   account for variant cleanup/storage and animated-image policy.
3. Evaluate authorized ETag/conditional revalidation for assets. Authorization
   must run before a 304 response. Public-to-private transitions, revoked access,
   and deleted assets must not gain a longer exposure window.
4. Profile large list/tree rendering before adding virtualization. Fix linear
   grouping first: `WorkspaceFileBrowser.tsx:185` repeatedly copies bucket arrays;
   `WorkspaceChrome.tsx:366` maps/sorts lists on document-change events. Preserve
   unchanged row identity and avoid unnecessary sorts.

**Exit checks:** SQL row counts are bounded by the requested page; sidebar bytes
do not scale with the full library; thumbnails transfer/decode substantially
less than originals on the large-photo fixture. Check navigation, selection,
context menus, upload progress, filters, Range/HEAD/download, and permission
revocation. Virtualized lists must retain keyboard and screen-reader access.

### Slice 7 — Resource bounds and tuning after the main reductions

- **Database concurrency:** measure queue wait with main pool `max: 1` before
  choosing a small configurable increase. Budget connections across web
  processes, collab (`max: 5`), and the document write-lock pool (`max: 4`).
  Compare concurrency 1/5/20 on the target host. More connections may increase
  memory and contention; remove excess queries first. Use `EXPLAIN (ANALYZE,
  BUFFERS)` on safe SELECTs against fixtures before proposing indexes.
- **Asset cleanup peak memory:** `server/asset-maintenance.ts:59` materializes
  all R2 objects, then all live keys, then orphan candidates. Page the scan and
  reference lookups with bounded deletion concurrency if bucket size warrants.
  Preserve list-before-reference safety, pending uploads, six-hour grace,
  retention, and the lease; a streaming rewrite must not race a new upload.
- **Service-worker disk growth:** `public/sw.js` uses the fixed
  `vault-runtime-v1` cache and retains visited navigations plus hashed static
  assets. Old hashes remain under the same cache name across builds. Add an
  explicit bounded/versioned retention policy and audit offline-page scope and
  account/logout behavior. This concerns **CacheStorage disk usage**, not a
  demonstrated JS heap leak. Preserve deploy freshness and offline behavior
  deliberately; `/icons/` and the manifest are not fingerprinted like chunks.
- **Large single-request uploads:** browser uploads already switch to direct
  R2 multipart above 32 MiB. The server single-request path can still buffer up
  to its accepted ceiling. Measure concurrent near-threshold uploads before
  changing admission/concurrency or buffering. Do not regress direct upload,
  quota reservation, cancellation, or file validation.
- **MCP search scale:** inspect body-loading snapshots and JavaScript ranking
  in `lib/mcp/workspace-context.ts` / `workspace-index.ts` after interactive
  paths. Keep metadata-only tools cheap; measure query/payload cost before
  introducing a full-text index. Preserve current path/AND-search semantics.
- **Collaboration persistence:** `scripts/collab-server.mjs:151` encodes full
  Yjs state and reconciles derived metadata/tags on store. Measure SQL count,
  store duration, WAL bytes, and state size before skipping unchanged derived
  work. Keep durable Markdown/Yjs persistence and recovery ordering intact.
  This is lower priority than request-path reductions because it touches saves.
- **Enabled extension startup:** `ExtensionHostProvider.tsx:29` loads enabled
  authoring modules at workspace startup, including non-editor routes. Compare
  zero/all-enabled baselines before deferring these modules to editor/command
  use; preserve command discovery and content-driven rendering.
- **Read rendering:** consider shared Markdown analysis and a document-wide
  highlighting budget if rich-note traces show it matters. The current 128 KiB
  highlighting budget resets per rendered segment, a known limitation. Do not
  remove sanitization to improve a benchmark.
- **Packaging:** audit apparently unused runtime dependencies and image sizes
  separately. Source search found no runtime use of `@anthropic-ai/claude-code`
  or `y-websocket`; verify tooling/lockfile/standalone tracing before removal.
  An installed package is not evidence it contributes browser bytes or idle RSS.

## 4. Baseline protocol and completion gates

Use a production build on a disposable local/staging dataset. Development HMR,
the extension playground, and the build above are not production UI benchmarks.
Set `ASSET_MAINTENANCE=off` for a local profiling server using a shared bucket;
do not accidentally start cleanup against real storage. Preserve authentication
and exercise genuine permission helpers rather than bypassing them in runtime
code. Never put document bodies, cookies, or tokens in performance logs.

Record revision, browser/Node versions, CPU/RAM, network/CPU throttling, server
hardware, enabled extensions/runner, corpus size, and other host workload.
Production runner contention with the Minecraft server remains unmeasured.
Use five or more repeated runs for comparisons; report median/p95 and variation,
with cold and warm results separated.

| Scenario | Fixtures / actions | Record |
|---|---|---|
| Cold and warm workspace | 100 / 1,000 documents; open home, document, tasks, assets, gallery | TTFB, usable-editor time, HTML/RSC/JS bytes, parse/execute time, query count/rows/duration/pool wait |
| Small and large editor | 100 / 1,000 / 5,000 lines; prose, code/math, callouts/tables, calc, tasks; type, move cursor, select, scroll, switch Read/Live/Source | Interaction p50/p95, long tasks, React commits, analysis count/time, layout work |
| Idle foreground/background | 10 minutes each, panels open/closed; 1 and 5 browser tabs; runner on/off | CPU time, wakeups, HTTP/WebSocket messages, SQL/minute, RSS/heap, task refresh count |
| Memory lifecycle | Repeat 20 document opens/closes and drawer/settings cycles, then quiesce/GC for diagnosis | Retained heap, detached DOM, editor/Y.Doc/provider counts, listeners, sockets; web/collab RSS trend |
| Asset/gallery scale | 50 / 500 / 5,000 assets, representative 1–20 MB photos; 10 / 100 / 1,000 public docs | Rows/bytes, decode memory, DOM nodes, scroll/filter time, R2 reads, repeat-visit cost |
| Concurrency | 1 / 5 / 20 sessions, edits plus task queries; simultaneous cold indexes | Request p95, SQL wait/locks, event-loop delay, web/collab/Postgres memory |

Heap snapshots and allocation timelines are needed to distinguish a leak from
normal retained caches or allocation churn
([Chrome memory investigation](https://developer.chrome.com/docs/devtools/memory-problems)).
Track LCP, INP, and CLS where meaningful, with the published good thresholds
of 2.5 s, 200 ms, and 0.1 at the 75th percentile as reference—not claims about
this app and not substitutes for editor-specific timings
([Web Vitals](https://web.dev/articles/vitals)).

Set numeric regression budgets after slice 0 on named hardware/fixtures. Initial
structural gates can be firm immediately:

- No unopened-settings code/data load, hidden-panel refresh, or duplicate mobile
  panel fetch for the same query/event.
- No corpus-wide Markdown payload when opening a plain document or shell.
- Cursor-only changes reuse content analysis; unchanged task reads do not rewrite
  the index; list limits apply in SQL.
- Repeated open/close cycles release per-document resources. Any retained growth
  must be explained and bounded; no arbitrary universal heap-size cap.
- Record before/after metrics per slice, including first-open penalties introduced
  by deferral. Reject an optimization that only moves a worse delay elsewhere.

For implementation, run relevant tests, `npx tsc --noEmit`, lint against its
documented baseline, and a production build for bundle/loading changes. Add
focused regression tests for invalidation, permissions, races, and lifecycle;
avoid brittle millisecond unit assertions. Recheck two-user collaboration,
autosave, undo, public/share/embed rendering, and asset access as applicable.

## 5. Existing safeguards to preserve

- Extension render/editor modules are already loaded by content/enablement;
  public entries do not eagerly include the entire editor. CodeMirror language
  grammars and Prettier formatting are already lazy, with formatting in a worker.
- Workspace tabs are descriptors capped at 12, not twelve retained editor trees.
  The shared layout persists during ordinary navigation. Do not invent a tab
  eviction fix without evidence of retained editors.
- Workspace task/asset refreshes are event-driven, not continuous interval polls.
  Palette search is open-only, debounced, and abortable.
- The editor destroys its provider/Y.Doc on teardown, and live widgets unmount
  React roots. Extension analysis uses a WeakMap. These are reasons to profile
  lifecycle before claiming a leak, not proof that every lifecycle is correct.
- Asset delivery already streams and supports Range/HEAD; large uploads already
  bypass the web server via multipart R2. Thumbnail work solves a different cost.
- Collaboration writes remain authoritative for document edits, with permission
  checks and existing lock/lease rules. No optimization may bypass these paths.

## 6. Completion record for this planning pass

- [x] Source review across workspace/settings/assets, editor/extensions, server,
  database access, task indexing, collaboration, runner, and maintenance.
- [x] Production build and TypeScript phase passed; route entry sizes measured.
- [x] Synthetic wiki-map, task-parser, and editor measurements recorded.
- [ ] Authenticated browser/heap/network baseline and deployed resource samples.
- [~] Implement and verify slices 1–7 according to measured priority (first pass: §7).

Only documentation is changed. The application's full test/lint suite was not
rerun for this planning-only change; the build and targeted diagnostic checks
are the validation performed here.

## 7. Implementation record — first pass (2026-10-14)

Verified with `npx tsc --noEmit`, 909/909 tests (+12: embed pruning,
`shareInFlight`, `createCoalescedRunner`), lint at baseline on every touched
file (full lint 25 vs the recorded 26), two production builds, and a browser
pass against `next start` on the local dev database (signed in with a minted
Auth.js session, deleted afterwards; `ASSET_MAINTENANCE=off`). The local corpus
is ten small documents, so this pass proves behavior and structure, **not**
latency at scale — slice 0's protocol (§4) still has to be run.

### Done

| Slice | Change | Evidence |
|---|---|---|
| 1.1 | Shell DTOs are metadata-only: `listDocumentSummariesForUser`, `listSharedDocumentSummariesForUser`, `listPublicDocuments({ body: "none" })`; `WorkspacePublicDocumentItem.markdown` removed (no client read it). Gallery cards select `left(markdown, 4000)`; sitemap selects no body. `listPublicDocuments` applies `limit` in SQL | Types; gallery and shell render |
| 1.2 | `getWorkspaceData` is `cache()`-memoized per request (no longer a `"use server"` module — nothing client-side called it), so layout + page share one run and one Bin purge; the layout reuses its preferences instead of a second `listUserSettings`; `recent` is computed by the one page that shows it | Types; pages render |
| 1.3 | `pruneWikiEmbedBodies` keeps `embedMarkdown` only for documents the page transcludes, two levels deep (`WIKI_EMBED_RENDER_DEPTH`, shared with the renderer), on the document, public, share, guide, workspace-public and embed-editor pages. Links, headings, anchors and definition previews are untouched. A `![[...]]` typed later is fetched through `GET /api/documents/wiki-links?embed=<key>` (same read-scoped maps; ≤20 keys) | Doc page HTML carried exactly one body (the transcluded document, under its two keys); typing `![[Anchor]]` issued one `?embed=title:anchor` request and rendered it; unauthenticated request 401; document byte-identical afterwards |
| 2.1 | Settings load on open. `loadSettingsData` (server) returns plain data via `loadWorkspaceSettingsDataAction`; `settings-pages-view` (client, dynamically imported) builds the pages. Account and Extensions sections became client components (OAuth/sign-out actions moved to `server/auth-actions.ts`; extension cards are a server-derived view model). The layout passes a per-render `revision`, so an open modal still refreshes after `revalidatePath`. CodeMirror and the Markdown preview in Snippets are `next/dynamic` | `/workspace` entry 690 → 530 KiB gzip (assets/gallery/tasks the same); one action on open, none on reopen; 12 pages render; disabling Stickers removed its page live and re-enabling restored it; `/dashboard/settings` renders |
| 2.2 | The CSS-hidden desktop left (`< md`) and right (`< lg`) panel copies no longer mount after hydration; a copy that was ever shown stays mounted so a breakpoint change cannot cancel an upload. A collapsed left panel stays mounted but `useVisibleRefresh` defers its refreshes until shown | 390px: desktop aside empty after hydration; collapsed panel ignored an assets-changed event, refreshed once on show |
| 2.3 | `shareInFlight`: concurrent `/api/assets` fetches and `getTaskAgendaAction` calls (Tasks panel + home Today) share one request | Unit tests |
| 3 | Runner idle backoff 1s → 2s → 3s cap (`CODE_RUNNER_IDLE_MAX_MS`), ±10% jitter, reset on a claimed job. Steady idle ≈ 28.8k claims/day instead of 86.4k; worst extra pickup delay after a long idle ≈ 2s. Sweep was already throttled; heartbeats unchanged | Delay function exercised; syntax check. Not run against a live queue |
| 5 | `ensureTaskIndexFresh` is coalesced per user (≤ 2 refreshes for N concurrent reads, none reusing a stale set). The read path passes `onlyIfStale`: an index already stamped at the same `updated_at` is skipped before parsing and again under the lock. This also fixes a race where a read-path refresh could replace a live write's index (fresher Yjs text, equal stamp) with older stored text. Live writes keep the strict `>` | Coalescer unit tests; full suite. No SQL trace taken |
| 6.1 | Assets sidebar uses `GET /api/assets?view=summary` (SQL `count(*) filter` + 8 newest) instead of the whole library | Response verified; sidebar renders |
| 6.4 | `WorkspaceFileBrowser` folder grouping no longer copies the bucket per folder | Types |
| 7 (SW) | `public/sw.js`: caches split and bounded (`vault-static-v2` 400 entries, `vault-pages-v2` 20), `vault-runtime-v1` deleted on activate; only OK, non-redirected navigations cached; page cache dropped on sign-out (`CLEAR_PAGES` from the palette and Account) or when a navigation lands on `/login`; `/icons/` and the manifest are stale-while-revalidate | Browser on `next start`: caches split and bounded (pages 4, static 66 entries), offline navigation served from cache, `CLEAR_PAGES` and a `/login` landing each emptied the page cache. Deleting `vault-runtime-v1` on upgrade was not exercised |

### Lesson recorded

The first settings attempt returned server-rendered pages from a server
action. The build shrank, but the action failed at runtime: "Could not find the
module … in the React Client Manifest". Client components reachable only
through an action's result are not in the route's manifest. A smaller manifest
was therefore no proof of a working deferral, exactly as slice 2's exit check
warns. The working shape is a data-returning action plus a client-side
`import()`.

### Remaining

- Slice 0 baseline on representative fixtures; numeric budgets.
- 1.3 server side: the document page still reads every readable body to build
  headings, anchors and aliases (payload is fixed, DB/CPU work is not).
- 1.4 context-panel data (sharing, friends, history, snippets) on open; 1.5
  bounded content search.
- 2.3 coalescing events / stale-response discard beyond the shared request;
  `TaskQueryBlock` snapshots (slice 5 follow-up).
- Slice 4 entirely; slice 6.2–6.3 (thumbnails, conditional revalidation) and
  library pagination; slice 7 items other than the service worker.
- On a phone, the hidden desktop panel still mounts once during hydration
  (the server render assumes desktop), so it fetches once per full load.
