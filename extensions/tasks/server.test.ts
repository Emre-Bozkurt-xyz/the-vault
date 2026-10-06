import { describe, expect, it, vi } from "vitest";

import type {
  ExtensionAgentActionContext,
  ExtensionAgentTask,
  ExtensionServerModule,
} from "@/lib/extension-api/server";

import server from "./server";

type ServerAction = ExtensionServerModule["actions"][number];

function action(id: string): ServerAction {
  const found = server.actions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No action ${id}`);
  return found;
}

const task: ExtensionAgentTask = {
  documentId: "11111111-1111-4111-8111-111111111111",
  documentTitle: "Todo",
  folderPath: "Courses/CS101",
  path: "Courses/CS101/Todo",
  line: 3,
  rawLine: "- [ ] lab report",
  ordinal: 0,
  parentOrdinal: null,
  status: "open",
  text: "lab report",
  note: null,
  heading: "Todo",
  dueDay: null,
  dueTime: null,
  doneDay: null,
};

function context(extra: Partial<ExtensionAgentActionContext>): ExtensionAgentActionContext {
  return { user: { id: "user" }, settings: {}, ...extra };
}

async function run(id: string, input: unknown, ctx: ExtensionAgentActionContext) {
  const found = action(id);
  const result = await found.handler(found.input.parse(input), ctx);
  // The dispatcher validates outputs; do the same here.
  found.output?.parse(result.data);
  return result;
}

describe("vault.tasks.listTasks", () => {
  it("maps a named due window to bounds relative to the given today", async () => {
    const list = vi.fn().mockResolvedValue({ tasks: [task], total: 1 });
    const ctx = context({ workspace: { tasks: { list } } });

    await run("vault.tasks.listTasks", { due: "overdue", today: "2026-10-06" }, ctx);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ dueThrough: "2026-10-05", statuses: ["open", "in_progress"] }),
    );

    await run(
      "vault.tasks.listTasks",
      { due: "today", today: "2026-10-06", folder: "Courses/CS101" },
      ctx,
    );
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dueFrom: "2026-10-06",
        dueThrough: "2026-10-06",
        folder: "Courses/CS101",
        recursive: true,
      }),
    );

    await run("vault.tasks.listTasks", { due: "undated" }, ctx);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ dated: "undated" }));
  });

  it("reports when results were limited", async () => {
    const list = vi.fn().mockResolvedValue({ tasks: [task], total: 4 });
    const result = await run(
      "vault.tasks.listTasks",
      { limit: 1 },
      context({ workspace: { tasks: { list } } }),
    );
    expect(result.message).toMatch(/4 tasks matched; showing the first 1/);
  });

  it("rejects an impossible date", () => {
    expect(() => action("vault.tasks.listTasks").input.parse({ today: "2026-02-30" })).toThrow();
  });
});

describe("vault.tasks document actions", () => {
  const documentContext = (tasks: NonNullable<ExtensionAgentActionContext["document"]>["tasks"]) =>
    context({
      document: {
        id: task.documentId,
        canEdit: true,
        state: {} as never,
        tasks,
      },
    });

  it("filters a document's tasks by status", async () => {
    const done = { ...task, ordinal: 1, status: "done" as const };
    const result = await run(
      "vault.tasks.listDocumentTasks",
      { status: ["done"] },
      documentContext({ list: vi.fn().mockResolvedValue([task, done]) }),
    );
    expect(result.data).toEqual({ tasks: [done] });
  });

  it("passes the task reference and today through to setStatus", async () => {
    const setStatus = vi.fn().mockResolvedValue({ ...task, status: "done" });
    await run(
      "vault.tasks.setTaskStatus",
      { line: 3, rawLine: task.rawLine, status: "done", today: "2026-10-06" },
      documentContext({ list: vi.fn(), setStatus }),
    );
    expect(setStatus).toHaveBeenCalledWith(
      { line: 3, rawLine: task.rawLine },
      "done",
      { today: "2026-10-06" },
    );
  });

  it("clears a due date with null", async () => {
    const setDue = vi.fn().mockResolvedValue(task);
    await run(
      "vault.tasks.setTaskDue",
      { line: 3, rawLine: task.rawLine, due: null },
      documentContext({ list: vi.fn(), setDue }),
    );
    expect(setDue).toHaveBeenCalledWith({ line: 3, rawLine: task.rawLine }, null);
  });

  it("refuses a due time without a day", async () => {
    await expect(
      run("vault.tasks.addTask", { text: "x", time: "09:00" }, documentContext({ list: vi.fn(), add: vi.fn() })),
    ).rejects.toThrow(/needs a due day/);
  });

  it("needs edit access to write", async () => {
    await expect(
      run(
        "vault.tasks.setTaskStatus",
        { line: 3, rawLine: task.rawLine, status: "done" },
        documentContext({ list: vi.fn() }),
      ),
    ).rejects.toThrow(/edit access/);
  });
});
