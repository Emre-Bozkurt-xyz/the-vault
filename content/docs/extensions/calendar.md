---
title: Calendar
slug: calendar
category: Extensions
order: 40
public: true
---

# Calendar

Calendar embeds a month grid inside a document, for tracking tasks and events
that belong to what the document is about — a project's milestones next to the
project's notes, rather than in a separate app.

Turn it on from **Settings → Extensions** (see [[guide:extensions-and-settings]]).

## Inserting a calendar

Type `/calendar` in the editor, or run *Insert calendar* from the command palette
(**Ctrl/Cmd+K**). Either way you get a block like this:

```md
:::calendar{id=abc123}
```

The `id` is how the calendar finds its entries, so leave it alone. A document can
hold several calendars; each keeps its own entries.

## Tasks and events

A calendar holds two kinds of entry:

- **Tasks** can be completed. Tick one off in the grid.
- **Events** are time-anchored reminders. An optional `HH:MM` start time sorts
  them within their day.

Either kind can carry a longer note, and entries within a day can be reordered.

## Where entries are stored

Entries are **not** written into your Markdown. The block in your document is an
anchor; the entries live alongside the document as extension state. Two
consequences worth knowing:

- Copying the `:::calendar` block into another document does not copy the
  entries — it points at a calendar that document does not have.
- Exporting the Markdown exports the anchor, not the entries.

## Who can see the entries

Each calendar's entries have their own visibility, set from the **Default
visibility** option on the Calendar settings page before you create it:

| Visibility | Who sees the entries |
|---|---|
| Private | only you |
| Editors only | people who can edit the document |
| Public | anyone who can read the document |

Existing calendars keep the visibility they were created with — changing the
setting affects the next one you make.

## Settings

| Setting | Effect |
|---|---|
| Default visibility | Who can see a new calendar's entries |
| Week starts on | Sunday or Monday |

## Asking an assistant about a calendar

With Calendar enabled, an AI assistant connected to your vault can list a
document's calendars and their entries, add a task or event on a given day, tick
a task off, insert a new calendar, and gather upcoming tasks **across all your
documents** — which is what makes "what is due this week?" answerable when your
tasks live in a dozen project notes.
