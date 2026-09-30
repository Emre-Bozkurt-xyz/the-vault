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

### Four states

| Box | Meaning |
|---|---|
| `[ ]` | open |
| `[/]` | in progress |
| `[x]` | done |
| `[-]` | cancelled |

Click a box in the editor to tick it or untick it. With Tasks on, ticking also
records the day you finished it, as `:done[…]`.

## The agenda

The **Tasks** sidebar lists:

- **Overdue** — open tasks whose date has passed.
- **Today** — tasks due today, plus anything you ticked off today.
- **Next 7 days** — what is coming up.
- **Inbox** — tasks in your Inbox that have no date yet.

Click a task to open its document at that line. Tick its box to complete it, or
use the **⋯** menu to move it to today, tomorrow or next week, pick a date,
clear the date, mark it in progress, or cancel it. Every change is written back
into the document itself, so collaborators see it straight away.

Undated tasks in your other documents stay out of the agenda on purpose;
otherwise every old checklist would crowd it. Give a task a date to schedule it.

Only documents **you own** feed your agenda. Tasks in documents others have
shared with you are not included.

## Capturing a task quickly

Type into **Add task…** at the top of the Tasks sidebar, or press
**Ctrl/Cmd+K** and type `/task` followed by the task:

```txt
/task send invoice friday
/task call Sam tomorrow at 9am
/task pay rent @oct 1
```

The task is added to your **Inbox** document, with the date taken from the end
of what you typed. Only clear dates are picked up — "call Tom" stays "call Tom"
rather than becoming a task for tomorrow; put `@` in front of a date to make it
explicit. A confirmation appears with an **Undo** button.

The Inbox is an ordinary document, created the first time you capture
something. Rename it or move it into a folder as you like; if you delete it, the
next capture starts a new one.
