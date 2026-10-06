# Tasks, Agenda, and Inbox

Status as of 2026-10-06: **slices 1-6 are implemented and verified** (index and
sidebar agenda, write-back, authoring in the editor, Inbox and capture, the
Tasks page, home/side-panel/query blocks/progress); slice 7 code is implemented,
with browser regression still pending.
Query-block rows are read-only lists (tick in the document or the agenda), and
the editor's own Read mode does not expand them, matching calendars, since it
renders without a document id. Editors can tick uniquely identifiable task lines
in Read mode; duplicate identical lines stay disabled. The Inbox can be re-pointed from Settings (§6.3)
using a generic owned-document field. Decisions in §2 were confirmed with the user in conversation on
2026-09-28. Tracked as Phase 26 in `docs/01_PROGRESS_TRACKER.md`.

2026-10-06 integration: `:::tasks` is an SDK leaf block declared by
`extensions/tasks/manifest.ts` and rendered by `extensions/tasks/TaskQueryBlock.tsx`.
Core owns task-list syntax and the workspace views; the SDK still has no
workspace-panel contribution. The earlier browser checks preceded this merge,
so a browser regression pass remains.

2026-10-06 slice 7: `extensions/tasks/server.ts` declares four agent actions over
the owner-scoped index. `context.tasks` is a permission-gated SDK service: reads
refresh the index and mutations use the same live collaboration write path as
the UI. Calendar's upcoming-task action includes dated Markdown tasks. Server
modules may contribute `loadWorkspaceAgendaEvents`; the host gathers only
enabled extensions' owner-scoped state, and Calendar contributes events to
the sidebar and Tasks-page Agenda. Calendar events remain in extension state.

## 1. Product direction

Give Vault a sense of schedule without leaving Markdown. A task is an ordinary
task-list line in any document:

```md
## Launch
- [ ] Write the task index migration :due[2026-10-02]
- [/] Redesign calendar cells :due[2026-09-30 15:00]
  - [x] Agenda view :done[2026-09-27]
  - [ ] Month heatmap
- [-] Port the old planner
```

Every schedule surface — the sidebar agenda, the Tasks page, the home page's
Today strip, in-document task lists — is a **query over those lines**, never a
second store. Ticking a box in the agenda writes `[x]` back into the source
document.

This replaces the month grid as the primary way to see what is due. The
Calendar extension's month cells cannot show more than a word or two of an entry
(`.vault-calendar-entry-text` is a single ellipsized line at 0.78rem inside a
seventh of the document column), and its entries live in extension state, so
they neither export with the Markdown nor appear in search.

## 2. Decisions

- **Tasks live in Markdown.** Portable, visible in Source mode, exported with
  the document, merged by Yjs like any other text.
- **The agenda is a singleton view, not a document.** It has no file in the
  file explorer, the same way Gallery and Search have none. A derived file would
  go stale, and edits to it would have to be written back somewhere else anyway.
- **One Inbox document is the capture target.** It is an ordinary document the
  user can rename, move, and edit. Vault remembers it by id; if it is deleted,
  the next capture creates a new one. Daily notes are deferred.
- **Personal scope.** The agenda shows tasks from documents the viewer **owns**.
  Tasks in documents shared with them do not appear. Assignment (`@person`) and
  shared-document scope come after the core works (§10).
- **The agenda shows dated tasks plus the Inbox.** Undated tasks elsewhere go to
  a Backlog view grouped by document. Otherwise every checklist ever written
  (shopping lists, old meeting notes) floods the agenda. Giving a task a date is
  how it gets scheduled.
- **Syntax rendering is core; surfaces are the `vault.tasks` extension.** `[/]`,
  `[-]`, `:due[…]` and `:done[…]` render the same for every viewer, including on
  public pages, where there are no viewer settings. The sidebar mode, Tasks
  page, capture command, and query blocks belong to a `vault.tasks` extension
  that is **off by default**, like every other catalog extension.
- **Calendar stays for events.** Its entries appear in the agenda in a later
  slice (§9, slice 7); nothing is migrated out of it.

## 3. Syntax

### 3.1 Task lines

A task is a list item (bullet or ordered) whose marker is followed by one of:

| Marker | Status | GFM-compatible |
|---|---|---|
| `[ ]` | `open` | yes |
| `[/]` | `in_progress` | no — plain text elsewhere |
| `[x]` / `[X]` | `done` | yes |
| `[-]` | `cancelled` | no — plain text elsewhere |

`[/]` and `[-]` follow the Obsidian Tasks convention. Other renderers show them
as literal text, which is acceptable.

Scanning rules:

- Skip YAML frontmatter, fenced code, and raw HTML blocks.
- Tasks inside blockquotes and callouts count (`> [!todo]` holding a checklist is
  a natural pattern).
- The task **text** is the first line after the marker with task directives
  removed. Continuation lines indented under it are its **note**. Nested task
  items are **subtasks**; a parent's progress is `done / (total − cancelled)` over
  its direct children.
- Tasks belong to the document whose Markdown contains them. A transclusion
  (`![[doc]]`) does not copy the embedded document's tasks into the embedding one.
- Caps: 2,000 tasks per document and 500 characters of text per task (the
  Calendar entry limit). Excess tasks are skipped rather than failing the index.

### 3.2 Task fields are text directives

Fields are inline `remark-directive` text directives. The 2026-09-08 decisions
log entry settled this as the form for inline extensions (`:calc[…]`): a
directive is a real mdast node, so recognition is structural rather than a regex
over prose.

| Directive | Value | Written by |
|---|---|---|
| `:due[YYYY-MM-DD]` or `:due[YYYY-MM-DD HH:MM]` | Due day, optional start time | The `@` date menu, capture, reschedule actions |
| `:done[YYYY-MM-DD]` | Completion day | Ticking a task through any Vault surface |

- Day keys are timezone-naive `YYYY-MM-DD` strings, validated with
  `isValidDayKey` from `lib/calendar.ts`, the same convention the Calendar
  extension uses. An invalid value leaves the task undated and renders as an
  error-styled chip.
- A directive only counts on a task line. `:due[…]` in ordinary prose is left
  alone and renders as text.
- A document read by something that does not understand these directives shows
  the literal source. `restoreDirectiveText` in `lib/markdown/calc-directive.ts`
  already restores unclaimed directives verbatim, so nothing silently disappears.
  The tasks render plugin must claim `due`/`done` before that restore step runs.
- Ticking a box by typing `x` in Source mode does not add `:done[…]`. Such a task
  is done with an unknown completion day.

v1 has no priority, start date, recurrence, or tags on the task itself; filtering
uses the document's existing frontmatter tags and folder. See §10.

## 4. Index

### 4.1 Tables

A new migration adds two tables, documented in `docs/03_DATA_MODEL.md` when it
lands.

`document_tasks` — one row per task, fully regenerated per document on reindex:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | Ephemeral. **Not** a stable task identity; see §5.1 |
| `document_id` | uuid fk → documents, cascade | |
| `ordinal` | int | Nth task in the document, 0-based |
| `line` | int | 0-based source line at index time |
| `raw_line` | text | Exact source line, used as the write-back precondition |
| `parent_ordinal` | int null | Enclosing task, for subtasks and progress |
| `status` | text | `open` \| `in_progress` \| `done` \| `cancelled` |
| `text` | text | Markdown, directives stripped; rendered with wiki links |
| `note` | text null | Indented continuation lines |
| `heading` | text null | Nearest preceding heading, for context ("Launch plan › Launch") |
| `due_day` | date (`mode: "string"`) null | |
| `due_time` | text null | `HH:MM` |
| `done_day` | date (`mode: "string"`) null | |

Unique `(document_id, ordinal)`. Index `(due_day)` filtered to
`status in ('open','in_progress')`.

`document_task_index` — one row per indexed document, including documents with
no tasks, so a task-free document is not reparsed on every read:

| Column | Type |
|---|---|
| `document_id` | uuid pk fk → documents, cascade |
| `source_updated_at` | timestamptz — `documents.updated_at` at index time |
| `indexed_at` | timestamptz |

### 4.2 Index lazily, on read

Every task read (panel, page, home strip, query block, agent action) first calls
`ensureTaskIndexFresh(userId)` in a new `server/tasks.ts`:

1. Select the viewer's owned, non-deleted documents whose `updated_at` is newer
   than their `document_task_index.source_updated_at`, or that have no index row.
2. For each, parse `documents.markdown` and replace its `document_tasks` rows and
   stamp in one transaction, under a per-document
   `pg_advisory_xact_lock` so two concurrent reads cannot interleave a delete
   and an insert.

**Why not index on save**, as metadata does: most saves happen in
`scripts/collab-server.mjs` (`onStoreDocument`), a separate plain-JS process that
already carries its own copy of the frontmatter parser
(`syncDocumentMetadata`, line 330) because it cannot import the TypeScript
`lib/`. A task parser is larger and subtler than a frontmatter parser; keeping
two copies in step is the drift this design avoids. Lazy indexing keeps one
TypeScript parser, needs no backfill script (the first read indexes everything),
and costs one stamp comparison when nothing has changed.

Freshness caveat: `documents.markdown` is written by the collab server's
debounced store (1.5s, at most 10s). A task edited in the editor reaches the
agenda after that store. The panel also refetches on the existing
`dispatchWorkspaceDocumentChanged` save events.

### 4.3 Parser

`lib/tasks/parse.ts`: a pure function from Markdown to the task rows above. It uses
the shared remark pipeline (`remark-gfm`, `remark-directive`) for structure —
fences, blockquotes, list nesting, directive nodes, positions — and reads the
marker character (`[/]`, `[-]`) from the raw source line, since GFM does not
recognize those two. Heavily unit-tested; it is the foundation every surface
trusts.

## 5. Writing back

### 5.1 Locating a task

Row ids are regenerated on every reindex, so the client addresses a task by
`{ documentId, line, rawLine }`. The server resolves it against the **live** text:

1. If line `line` still equals `rawLine`, use it.
2. Otherwise, if exactly one line in the document equals `rawLine`, use that.
3. Otherwise refuse with a "task moved" error; the client refetches and retries
   once.

No hidden ids are written into the Markdown: tasks stay clean, hand-written
Markdown. Two identical task lines in one document can only be addressed while
they stay on their indexed line numbers; that is the accepted cost.

### 5.2 Through the collaboration layer

Writes go through `withLiveDocumentText` (`lib/collab-write.ts`, moved from `lib/mcp/` in slice 2). It opens the
document's live Yjs session like a browser editor and lets the collab server's
`onStoreDocument` do all persistence. Two changes are needed:

- Take the transaction **origin** as a parameter (`"tasks"` rather than the fixed
  `"mcp"`), and move the helper to a neutral module (`lib/collab-write.ts`), since
  it is no longer MCP-only.
- Make its **pre-edit version snapshot** optional. It records a restore point
  before every edit, which is right for an AI rewrite and wrong for a checkbox
  tick. Task writes skip it; the collab server's threshold-based versioning still
  applies.

Edits are minimal Y.Text operations: replace the one marker character, or insert,
replace, or remove one directive. The line is never rewritten whole, so a
collaborator typing on the same line keeps their edit.

Operations: set status (stamps or clears `:done[today]`), set due (day, optional
time, or clear), and append a task (capture, §6.3).

### 5.3 Keeping the UI honest

- **Optimistic UI.** A write opens a WebSocket, syncs, and flushes, which takes
  hundreds of milliseconds. The client updates immediately and serializes writes
  per document.
- **Reindex from the returned text.** `withLiveDocumentText` returns the resulting
  Markdown. The action reindexes that document from it immediately, rather than
  waiting for the debounced store to reach `documents.markdown`, so a refetch
  right after a tick cannot revert the checkbox. The stamp keeps the document's
  current `updated_at`, so the later store triggers one more reindex, from
  identical text.
- **Today comes from the client.** "Today" and "overdue" use the viewer's local
  day (`todayDayKey()`), sent with each read. The server's clock is never the
  reference.
- **Permissions.** Writes re-check `getDocumentAccess(...).canEdit` inside
  `withLiveDocumentText`. Personal scope means the viewer owns every document the
  agenda shows, but the check stays.

## 6. Surfaces

### 6.1 Sidebar Tasks mode (glance)

A new `tasks` value in `WorkspacePanelMode`, with a sidebar icon shown only while
`vault.tasks` is enabled (the same gating pattern `calendarEnabled` uses in the
command palette context). The left panel shows:

- An **Add task…** input at the top (capture, §6.3).
- **Overdue**, **Today**, and **Next 7 days** sections; **Inbox** for its undated
  tasks; and an "Open Tasks page" link for everything later.
- Each row: checkbox (four states), task text rendered inline through
  `MarkdownDocument` the way Calendar entries are, and a secondary line with the
  source document title and due label.
- Clicking the text opens the source document in a tab and scrolls to the task
  line with a brief highlight. **Nothing does this today.** The editor needs a
  jump-to-line entry point (a query parameter or workspace event consumed by
  `MarkdownEditor`), built in slice 1.
- Row hover actions: **Today**, **Tomorrow**, **Next week**, **Pick date…**,
  **Clear date**.
- The sidebar icon carries an overdue count badge.

The mobile Panel drawer mirrors the sidebar modes, so this is also the phone
view.

### 6.2 Tasks page (plan)

A `/tasks` route and a `tasks` `WorkspacePageType`: the Gallery pattern of a panel
mode plus a full page.

- Views: **Agenda** (default), **Week** (seven tall columns; text wraps; drag
  between days), **Month** (per-day density dots, never task text; clicking a day
  scrolls the Agenda to it), and **Backlog** (undated tasks outside the Inbox,
  grouped by document).
- Filters: folder, document tag, and text.
- Keyboard: `j`/`k` move, `x` toggles done, `t` sets today, `m` sets tomorrow, `/`
  focuses the filter.
- The right context panel shows the selected task: source document path, its
  heading, a few rendered lines of surrounding context, status and date controls,
  subtasks, and note.

### 6.3 Inbox and capture

- **Inbox pointer.** Stored in the `vault.tasks` extension settings
  (`user_extension_settings`) as `inboxDocumentId`. It is re-validated on every
  capture: if the document is missing, deleted, or no longer owned by the user,
  a new document titled "Inbox" is created at the root and the pointer updated.
  Settings offers a generic document selector with active owned documents; the
  server validates ownership on save. Clearing it creates a fresh Inbox on the
  next capture.
- **Capture paths.** `/task <text>` in the Ctrl+K command mode (the palette already
  switches to commands on `/`), and the panel's Add task input. A trailing date
  phrase is parsed with the §7 grammar: `/task send invoice fri` appends
  `- [ ] send invoice :due[2026-10-02]` to the end of the Inbox. Capture never
  navigates. A toast confirms "Added to Inbox · Fri 2 Oct" with **Undo**.

### 6.4 Elsewhere

- **Home page.** `/workspace` (`WorkspaceNewTab`) gains a Today section above
  Recent: overdue and due-today tasks, tickable in place.
- **Document side panel.** The document's right context panel gains a Tasks
  section: "3 open · next due Fri", listing that document's tasks.
- **Query blocks.** `:::tasks{due=week status=open}` embeds a live task list in any
  document. Parameters:
  - `scope=doc|all` (default `doc`)
  - `due=overdue|today|week|month|none|any`
  - `status=open|done|all`
  - `folder=…`, `tag=…`

  With `scope=doc` the block lists only tasks already written in that document,
  so it leaks nothing. With `scope=all` it lists **the viewer's own** tasks,
  never the author's, and renders a sign-in prompt on public pages. This is what
  keeps personal scope intact when a document containing a query block is
  shared or published.
- **Progress.** Parents with subtasks show `2/4` in both editor modes and in every
  list surface.

## 7. Authoring in the editor

- **`@` date menu.** On a task line, typing `@` opens a menu: Today, Tomorrow,
  the weekdays, Next week, Pick date…. It filters as the user types (`@fri`,
  `@oct 2`, `@in 3 days`); accepting writes `:due[…]`. It is explicit, like `[[`
  and `/`, so prose such as "meet on fri" is never converted by surprise.
  Assignment (§10) later adds people to the same `@` menu, the Notion model.
- **Date grammar.** `lib/tasks/natural-date.ts` is a small hand-written,
  unit-tested parser relative to a supplied today key. It accepts `today`,
  `tomorrow`/`tmrw`, weekday names (the next occurrence), `next <weekday>`,
  `next week` (the coming Monday; the only week-start setting today belongs to
  the Calendar extension), `in N days|weeks`, month-day forms (`oct 2`, `2 oct`), ISO dates, and an optional time
  (`3pm`, `15:00`). No numeric `10/2` forms, which are ambiguous across locales.
  This avoids a dependency such as `chrono-node` for a grammar this small.
- **Chips.** An inactive `:due[…]` renders as a chip: "Today", "Fri 2 Oct",
  "Overdue · Thu" in the destructive colour. Clicking it opens a date popover
  (reschedule or clear); moving the cursor inside reveals the source, like every
  other Live construct. `:done[…]` renders as a faint chip. Read mode renders the
  same chips through a `remarkTasks` plugin, statically on public pages.
- **Four-state checkboxes.** Live mode's task-marker regexes in
  `MarkdownEditor.tsx` (`[ xX]` at about six sites, including list continuation
  on Enter) widen to `[ xX/-]`. `TaskCheckboxWidget` gains the in-progress and
  cancelled states. Read mode claims `[/]` and `[-]` list items so they render
  as checkboxes rather than literal text.
- **Clickable checkboxes.** Today the Live widget is decorative (`aria-hidden`) and
  the Read-mode input is `disabled`. In Live mode, clicking a box for an editor
  toggles it, as one undo step, and stamps or clears `:done[…]`. Read mode stays
  non-interactive for now.

## 8. Agent actions

`vault.tasks` contributes MCP actions over the index. They call
`ensureTaskIndexFresh` first and use the same write path as the UI:

- `listTasks` (workspace, read)
- `addTask` (to the Inbox or a named document)
- `setTaskStatus`, `setTaskDue` (mutating)

The Calendar extension's `listUpcomingTasks` grows to include Markdown tasks, so
"what is due this week?" covers both.

## 9. Slices

Each slice leaves the app runnable and is verified with
`npx tsc --noEmit`, `npm run lint` (against the `MarkdownEditor.tsx` baseline),
and `npm test`.

1. **Parser, index, read-only panel.** `lib/tasks/parse.ts` plus tests; the two
   tables and migration; `ensureTaskIndexFresh`; register `vault.tasks`; the
   sidebar mode listing Overdue, Today, Next 7 days, and Inbox; the editor
   jump-to-line entry point.
   *Exit:* a hand-written `- [ ] x :due[…]` in an owned document appears in the
   panel after save and opens at its line; the same line in a document shared
   with the viewer does not appear.
2. **Write-back.** Generalize `withLiveDocumentText` (origin, optional snapshot);
   the §5.1 locator; status and due actions; optimistic panel; reindex from the
   returned text; `:done[…]` stamping.
   *Exit:* ticking in the panel updates the open editor live, creates no restore
   point, and survives an immediate refetch; a task edited away since the last
   index yields a clean refresh rather than a wrong-line edit.
3. **Authoring.** Four-state markers in Live and Read modes; `:due`/`:done` chips
   and the `remarkTasks` plugin; the `@` date menu; `lib/tasks/natural-date.ts`;
   clickable Live checkboxes.
   *Exit:* scheduling a task never requires typing directive syntax, and Read,
   Live, and public pages render it identically.
4. **Inbox and capture.** Inbox pointer and self-healing; `/task` in the palette;
   the panel input; the Undo toast; user guide `content/docs/extensions/tasks.md`,
   with `tasks` added to the extension list in `lib/repo-docs.test.ts`.
5. **Tasks page.** Agenda, Week, Month, and Backlog views; filters; keyboard; the
   right-panel task detail; drag rescheduling in Week.
6. **Everywhere else.** Home Today section; document side-panel section;
   `:::tasks{…}` query blocks with the §6.4 scope rule; subtask progress.
7. **Agents and Calendar.** §8 actions; Calendar events shown in the agenda.

## 10. Deferred

- **Assignment and shared documents.** `@person` in the same `@` menu, limited to
  friends; the agenda then adds "assigned to me" tasks from shared documents,
  with a toggle to show all of them.
- **Recurrence, priority, start dates and ranges, reminders** (PWA push).
- **Daily notes** as an alternative capture target.
- **Moving Calendar events into Markdown.**
- **Clickable Read-mode checkboxes** for editors: implemented for uniquely identifiable task lines on 2026-10-06. Identical duplicate source lines and task lines changed by render preprocessing remain disabled until source positions can be carried through the render split; authenticated browser verification remains.
