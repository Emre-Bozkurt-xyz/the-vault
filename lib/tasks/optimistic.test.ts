import { describe, expect, it } from "vitest";

import { inAgenda, inTaskPage, mergeLiveTasks, type LiveDocumentTasks } from "@/lib/tasks/overlay";
import { applyTaskPatches, expectedRawLine, type PatchableRow } from "@/lib/tasks/optimistic";
import { parseTasks } from "@/lib/tasks/parse";

const today = "2026-10-15";

function row(rawLine: string, documentId = "doc"): PatchableRow & { ordinal: number } {
  const [task] = parseTasks(rawLine);
  return { documentId, rawLine, ordinal: task.ordinal, status: task.status, text: task.text,
    dueDay: task.dueDay, dueTime: task.dueTime, doneDay: task.doneDay, priority: task.priority, repeat: task.repeat };
}

describe("applyTaskPatches", () => {
  it("patches by document and line, in order, and removes deleted rows", () => {
    const a = row("- [ ] Alpha :due[2026-10-15]");
    const b = row("- [ ] Bravo");
    const result = applyTaskPatches([a, b], [
      { id: 1, documentId: "doc", rawLine: a.rawLine, change: { type: "status", status: "done" } },
      { id: 2, documentId: "doc", rawLine: a.rawLine, change: { type: "priority", priority: "high" } },
      { id: 3, documentId: "doc", rawLine: b.rawLine, change: { type: "delete" } },
    ], today);
    expect(result).toEqual([{ ...a, status: "done", doneDay: today, priority: "high" }]);
  });

  it("ignores rows in other documents with the same text", () => {
    const other = row("- [ ] Same", "other");
    expect(applyTaskPatches([other], [
      { id: 1, documentId: "doc", rawLine: other.rawLine, change: { type: "delete" } },
    ], today)).toEqual([other]);
  });
});

describe("expectedRawLine", () => {
  it("predicts field edits so a queued second write still finds the line", () => {
    expect(expectedRawLine("- [ ] Ship", { type: "status", status: "done" }, today)).toBe(
      `- [x] Ship :done[${today}]`,
    );
    expect(expectedRawLine("- [ ] Ship", { type: "text", text: "Ship it" }, today)).toBe("- [ ] Ship it");
  });

  it("gives up where the whole document changes", () => {
    expect(expectedRawLine("- [ ] Gym :repeat[daily]", { type: "status", status: "done" }, today)).toBeNull();
    expect(expectedRawLine("- [ ] Gone", { type: "delete" }, today)).toBeNull();
  });
});

describe("mergeLiveTasks", () => {
  const live: LiveDocumentTasks = {
    documentId: "open",
    title: "Open doc",
    folderId: null,
    owned: true,
    tasks: parseTasks("- [ ] Typed just now :due[2026-10-15]\n- [x] Old"),
  };

  it("replaces the open document's server rows with its live parse", () => {
    const rows = [
      { documentId: "open", text: "stale" },
      { documentId: "elsewhere", text: "kept" },
    ];
    const merged = mergeLiveTasks(rows, new Map([["open", live]]), {
      ownedOnly: true,
      include: (task) => inTaskPage(task, today),
      build: (task, document) => ({ documentId: document.documentId, text: task.text }),
    });
    expect(merged).toEqual([
      { documentId: "elsewhere", text: "kept" },
      { documentId: "open", text: "Typed just now" },
    ]);
  });

  it("leaves documents the viewer does not own to the server for personal lists", () => {
    const rows = [{ documentId: "open", text: "server" }];
    const merged = mergeLiveTasks(rows, new Map([["open", { ...live, owned: false }]]), {
      ownedOnly: true,
      include: () => true,
      build: (task, document) => ({ documentId: document.documentId, text: task.text }),
    });
    expect(merged).toEqual(rows);
  });

  it("matches the agenda query's rules", () => {
    const context = { documentId: "doc", today, through: "2026-10-22", inboxDocumentId: "inbox" };
    expect(inAgenda({ status: "open", dueDay: "2026-10-22", doneDay: null }, context)).toBe(true);
    expect(inAgenda({ status: "open", dueDay: "2026-10-23", doneDay: null }, context)).toBe(false);
    expect(inAgenda({ status: "open", dueDay: null, doneDay: null }, context)).toBe(false);
    expect(inAgenda({ status: "open", dueDay: null, doneDay: null }, { ...context, documentId: "inbox" })).toBe(true);
    expect(inAgenda({ status: "done", dueDay: "2026-10-01", doneDay: today }, context)).toBe(true);
    expect(inAgenda({ status: "cancelled", dueDay: today, doneDay: null }, context)).toBe(false);
  });
});
