---
title: Tasks
slug: tasks
category: Extensions
order: 45
public: true
---

# Tasks

Tasks gathers the to-dos written in your documents into one agenda: what is
overdue, what is due today and what is coming up this week. A task is an
ordinary checklist line in any document you own — there is no separate task
list to keep in sync.

Turn it on from **Settings → Extensions** (see [[guide:extensions-and-settings]]).
A **Tasks** icon then appears in the sidebar.

## Writing a task

Any checklist line is a task:

```md
- [ ] Send the invoice
```

Give it a date and it shows up in the agenda. On a task line, type `@` and
pick a date — **Today**, **Tomorrow**, **Next week**, a weekday — or keep
typing: `@oct 12`, `@fri 3pm`, `@in 3 days`. The date becomes a small chip in
the line:

```md
- [ ] Send the invoice :due[2026-10-02]
```

That `:due[…]` text is what the chip stands for, and it is what you would see
in the Markdown source or an export. Click a chip to pick a different date, or
clear it with the date picker's own clear button.

### Priority

Use a task's **? ? Priority** menu to choose **High**, **Medium**, **Low**,
or **No priority**. You can also write it directly:

```md
- [ ] Send the invoice :priority[high] :due[2026-10-02]
```

Priority appears as a chip in the editor and reading view, and as a badge in
workspace task lists. Tasks with the same due date and time sort high, medium,
low, then tasks without priority. A priority does not give an undated task a date.

### Repeating tasks

Choose **? ? Repeat** for daily, weekly, monthly, yearly or every two weeks.
You can also write a custom interval in Source, with a number from 1 to 365:

```md
- [ ] Weekly review :due[2026-10-06] :repeat[weekly]
- [ ] Water plants :repeat[after 3 days]
- [ ] Review finances :due[2026-10-31] :repeat[every 2 months]
```

With Tasks enabled, completing through a checkbox or a task control keeps the
completed occurrence and creates one new task after it. Fixed schedules use the
old due date and skip missed dates; **after** intervals use the day you complete
it. Undated recurrences start from the completion day. Monthly/yearly rules
remember the intended day and use a month's last day when needed. Vault records
that intent as `monthly on 31` or `yearly on 02-29` in the next occurrence.

Notes and subtasks carry forward. Completed subtasks reset in the new checklist;
unfinished work moves forward, with its old copies cancelled so it does not
appear twice. Already-cancelled subtasks stay cancelled. A recurring parent
controls its whole checklist's cadence, including children with repeat rules.

Choose **Does not repeat** on the active occurrence to stop the series. Archived
occurrences have their repeat fields removed, so ticking history again does
not create extra tasks. Typing `x` in Source, or ticking with Tasks disabled,
only changes the checkbox; it does not create a new occurrence.

### Four states

| Box | Meaning |
|---|---|
| `[ ]` | open |
| `[/]` | in progress |
| `[x]` | done |
| `[-]` | cancelled |

Click a box in the editor to tick it or untick it. With Tasks on, ticking also
records the day you finished it, as `:done[…]`.
In **Read** mode, editors can also tick boxes, including nested tasks and tasks
inside a region. Readers without edit access cannot tick boxes.

## The agenda

The **Tasks** sidebar lists:

- **Overdue** — open tasks whose date has passed.
- **Today** — tasks due today, plus anything you ticked off today.
- **Next 7 days** — what is coming up.
- **Inbox** — tasks in your Inbox that have no date yet.

Click a task to open its document at that line. Tick its box to complete it, or
use the **⋯** menu (or right-click the task) to:

- **Edit text** — rename it in place; its date, priority and repeat stay.
- Move it to **Today**, **Tomorrow** or **Next week**, **Pick date…**, or
  **Clear date**.
- Set **Repeat** or **Priority**.
- **Move to** another document: your Inbox, a document already in the list, or
  **Other document…** to search. The task goes to the end of that document,
  with its note and subtasks.
- **Mark done**, **In progress**, **Cancel task**, or **Delete task**. Deleting
  removes the task together with its note and subtasks.

Deletes and moves confirm with an **Undo**. Every change is written back into
the document itself, so collaborators see it straight away.

The overdue section has **Move to today**, which reschedules everything in it
at once.

The lists stay live. While you type a task into a document, it shows up in the
Tasks panel, the Tasks page and the Today section as you pause, before the
document is even saved. Changes made elsewhere — on another device, by a
collaborator or by an agent — arrive within a few seconds. Editing ordinary
prose does not cause any refresh.

Undated tasks in your other documents stay out of the agenda on purpose;
otherwise every old checklist would crowd it. Give a task a date to schedule it.

Only documents **you own** feed your agenda. Tasks in documents others have
shared with you are not included.

## The Tasks page

Open **Tasks** from the sidebar's "Open Tasks page" arrow or the command palette.
It has five views: **Agenda**, **Week** (drag a task to another day), **Month**,
**Backlog** (undated tasks by document) and **Done** (what you ticked off in the
last 30 days; untick one to reopen it). Filter by text, folder or tag.

**Selecting several tasks.** Ctrl/Cmd-click adds a task to the selection,
Shift-click selects a range, and Ctrl/Cmd+A selects every task in the view. A bar
appears above the list to mark them done, reschedule, set a priority, move or
delete them together.

**Keyboard.** Press `?` on the Tasks page for the full list:

| Key | Does |
|---|---|
| `j` / `k` | Move down / up (with Shift: extend the selection) |
| `x` | Done / not done |
| `t` / `m` | Due today / tomorrow |
| `p` | Next priority |
| `e` | Edit the text |
| `Delete` | Delete, with Undo |
| `Enter` | Open at its line |
| `/` | Filter |
| `Esc` | Clear the selection |

With tasks selected, `x`, `t`, `m`, `p` and `Delete` act on all of them.

## Tasks around the workspace

- **Home page.** The new-tab page shows a **Today** section — overdue tasks and
  tasks due today — that you can tick off without opening anything.
- **Document side panel.** Each document's side panel has a **Tasks** section:
  how many are open, the next due date, and the open tasks with their subtask
  progress. Click one to jump to it.
- **Subtask progress.** A task with nested subtasks shows how many are done,
  such as `2/4`, in both the editor and the reading view.

## Task lists inside a document

Type `/tasks` to insert a live task list, or write the block yourself:

```md
:::tasks{due=week}
```

| Option | Values | Default |
|---|---|---|
| `scope` | `doc` (this document's tasks), `all` (your tasks everywhere) | `doc` |
| `due` | `any`, `overdue`, `today`, `week`, `month`, `none` | `any` |
| `status` | `open`, `done`, `all` | `open` |
| `tag` | a document tag | — |
| `title` | a heading for the block, in quotes | — |

`week` and `month` include anything already overdue. A `scope=all` block always
shows **the reader's own** tasks, never yours: share a "My week" document and
each person sees their own week. On a public page it shows a short note
instead.

If you can edit the document, you can tick tasks right in the block. Readers,
public pages and shared links see it read-only.

## Capturing a task quickly

Press **Ctrl+Alt+T** (**⌘⌥T** on a Mac; change it under Settings → Hotkeys)
anywhere in the workspace, or run **Add task…** from the command palette. You
can also type into **Add task…** at the top of the Tasks sidebar, or press
**Ctrl/Cmd+K** and type `/task` followed by the task:

```txt
call Sam tomorrow at 9am
water the plants every week !low
standup every monday
draft the intro friday !high #Thesis
```

Extras go at the **end**, in any order:

| You type | You get |
|---|---|
| a date: `friday`, `tomorrow at 9am`, `oct 12`, `@fri` | a due date |
| `!high`, `!med`, `!low` | a priority |
| `every day`, `every week`, `every 2 weeks`, `every other week`, `every monday` | a repeating task (`every monday` also starts it next Monday) |
| `#Document` or `#[[Document with spaces]]` | added to that document instead |

As you type, what Vault understood shows as small chips under the field, so you
can check before pressing Enter. Typing `#` lists your documents to pick from.
Anything that doesn't parse stays part of the task: "fix bug #123" keeps its
`#123`, and "call Tom" stays "call Tom" rather than becoming a task for
tomorrow. Put `@` in front of a date to make it explicit. A confirmation
appears with an **Undo** button.

Under **Settings → Tasks → Quick capture destination**, choose **Inbox** or
**Daily note**. Daily note capture reuses your root-level document titled with
today's local date (such as `2026-10-06`), creating one if needed. An undated
task captured there gets `:due[today]` so it appears in Today's agenda; an
explicit date in the task stays as you entered it.

The Inbox is an ordinary document, created the first time you capture
something. Rename it or move it into a folder as you like; if you delete it, the
next capture starts a new one.

To capture into a different document you own, open **Settings → Tasks** and
choose it under **Inbox document**. Choosing **Create an Inbox automatically**
clears the pointer; the next capture creates a fresh Inbox document.
