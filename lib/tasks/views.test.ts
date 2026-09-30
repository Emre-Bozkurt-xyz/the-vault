import { describe, expect, it } from "vitest";

import {
  dayCounts,
  filterTasks,
  groupAgenda,
  groupBacklog,
  mondayOf,
  tasksByDay,
  weekDays,
  type ViewTask,
} from "@/lib/tasks/views";

const today = "2026-09-30"; // Wednesday

function task(overrides: Partial<ViewTask> & { text: string }): ViewTask {
  return {
    documentId: "doc-a",
    documentTitle: "Alpha",
    folderId: null,
    ordinal: 0,
    status: "open",
    heading: null,
    dueDay: null,
    dueTime: null,
    ...overrides,
  };
}

const tasks: ViewTask[] = [
  task({ text: "late", ordinal: 0, dueDay: "2026-09-28" }),
  task({ text: "late but done", ordinal: 1, dueDay: "2026-09-28", status: "done" }),
  task({ text: "today", ordinal: 2, dueDay: today, dueTime: "15:00" }),
  task({ text: "today early", ordinal: 3, dueDay: today, dueTime: "09:00" }),
  task({ text: "friday", ordinal: 4, dueDay: "2026-10-02" }),
  task({ text: "inbox idea", documentId: "inbox", documentTitle: "Inbox", ordinal: 0 }),
  task({ text: "backlog b", documentId: "doc-b", documentTitle: "Beta", ordinal: 2 }),
  task({ text: "backlog a", documentId: "doc-b", documentTitle: "Beta", ordinal: 1 }),
];

describe("groupAgenda", () => {
  it("orders overdue, days, then inbox, and files a ticked late task under today", () => {
    const groups = groupAgenda(tasks, today, "inbox");

    expect(groups.map((group) => [group.id, group.tasks.map((t) => t.text)])).toEqual([
      ["overdue", ["late"]],
      [today, ["late but done", "today early", "today"]],
      ["2026-10-02", ["friday"]],
      ["inbox", ["inbox idea"]],
    ]);
  });

  it("adds an empty group for a focused day with nothing due", () => {
    const groups = groupAgenda(tasks, today, "inbox", "2026-10-06");
    expect(groups.find((group) => group.id === "2026-10-06")?.tasks).toEqual([]);
  });
});

describe("filterTasks", () => {
  const context = {
    folders: [
      { id: "work", parentId: null },
      { id: "specs", parentId: "work" },
    ],
    tagsByDocument: { "doc-b": ["urgent"] },
  };

  it("matches every term across text, title and heading", () => {
    const found = filterTasks(tasks, { text: "beta backlog", folderId: null, tag: null }, context);
    expect(found.map((t) => t.text)).toEqual(["backlog b", "backlog a"]);
  });

  it("includes subfolders and filters by tag", () => {
    const inSpecs = [task({ text: "spec", folderId: "specs" }), task({ text: "root" })];
    expect(filterTasks(inSpecs, { text: "", folderId: "work", tag: null }, context).map((t) => t.text)).toEqual([
      "spec",
    ]);
    expect(filterTasks(tasks, { text: "", folderId: null, tag: "urgent" }, context)).toHaveLength(2);
  });
});

describe("week and month helpers", () => {
  it("finds the Monday and the seven days", () => {
    expect(mondayOf(today)).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(weekDays("2026-09-28").at(-1)).toBe("2026-10-04");
  });

  it("buckets tasks by day", () => {
    const byDay = tasksByDay(tasks, weekDays("2026-09-28"));
    expect(byDay.get(today)?.map((t) => t.text)).toEqual(["today early", "today"]);
    expect(byDay.get("2026-10-01")).toEqual([]);
  });

  it("counts open tasks per day and marks overdue ones", () => {
    const counts = dayCounts(tasks, today);
    expect(counts.get("2026-09-28")).toEqual({ open: 1, overdue: 1 });
    expect(counts.get(today)).toEqual({ open: 2, overdue: 0 });
  });
});

describe("groupBacklog", () => {
  it("lists undated tasks outside the Inbox, by document", () => {
    expect(groupBacklog(tasks, "inbox")).toEqual([
      {
        documentId: "doc-b",
        documentTitle: "Beta",
        tasks: [expect.objectContaining({ text: "backlog a" }), expect.objectContaining({ text: "backlog b" })],
      },
    ]);
  });
});
