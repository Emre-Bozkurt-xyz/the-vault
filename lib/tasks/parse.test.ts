import { describe, expect, it } from "vitest";

import { MAX_TASKS_PER_DOCUMENT, parseTasks } from "@/lib/tasks/parse";

describe("parseTasks", () => {
  it("reads the four statuses from their markers", () => {
    const tasks = parseTasks(
      ["- [ ] open", "- [/] started", "- [x] done", "- [X] also done", "- [-] dropped"].join("\n"),
    );

    expect(tasks.map((task) => [task.text, task.status])).toEqual([
      ["open", "open"],
      ["started", "in_progress"],
      ["done", "done"],
      ["also done", "done"],
      ["dropped", "cancelled"],
    ]);
  });

  it("ignores list items that are not tasks", () => {
    const tasks = parseTasks(
      ["- plain bullet", "- [link](https://x.test)", "- [?] unknown marker", "- [ ]no space", "- [ ] real"].join("\n"),
    );

    expect(tasks.map((task) => task.text)).toEqual(["real"]);
  });

  it("accepts every bullet and ordered marker", () => {
    const tasks = parseTasks(["* [ ] star", "+ [ ] plus", "1. [ ] one", "2) [x] two"].join("\n\n"));

    expect(tasks.map((task) => task.text)).toEqual(["star", "plus", "one", "two"]);
  });

  it("reads due and done fields and strips them from the text", () => {
    const [task] = parseTasks(
      "- [x] Ship it :due[2026-10-02 15:00] today :done[2026-09-28]",
    );

    expect(task).toMatchObject({
      text: "Ship it today",
      dueDay: "2026-10-02",
      dueTime: "15:00",
      doneDay: "2026-09-28",
      dueInvalid: false,
    });
  });

  it("flags an impossible due date instead of guessing", () => {
    const [bad, noValue] = parseTasks(
      ["- [ ] a :due[2026-13-40]", "- [ ] b :due[soon]"].join("\n"),
    );

    expect(bad).toMatchObject({ dueDay: null, dueInvalid: true, text: "a" });
    expect(noValue).toMatchObject({ dueDay: null, dueInvalid: true, text: "b" });
  });

  it("rejects a malformed time along with the date", () => {
    const [task] = parseTasks("- [ ] a :due[2026-10-02 25:00]");

    expect(task).toMatchObject({ dueDay: null, dueTime: null, dueInvalid: true });
  });

  it("does not read a directive inside inline code as a field", () => {
    const [task] = parseTasks("- [ ] write `:due[2026-10-02]` docs");

    expect(task.dueDay).toBeNull();
    expect(task.text).toBe("write `:due[2026-10-02]` docs");
  });

  it("keeps unrelated directives in the text", () => {
    const [task] = parseTasks("- [ ] budget :calc[2 + 2] :due[2026-10-02]");

    expect(task.text).toBe("budget :calc[2 + 2]");
    expect(task.dueDay).toBe("2026-10-02");
  });

  it("skips checkboxes inside fenced code and frontmatter", () => {
    const markdown = [
      "---",
      "tags: todo",
      "- [ ] yaml list item",
      "---",
      "```md",
      "- [ ] example in code",
      "```",
      "- [ ] real one",
    ].join("\n");

    const tasks = parseTasks(markdown);

    expect(tasks.map((task) => [task.text, task.line])).toEqual([["real one", 7]]);
  });

  it("finds tasks inside blockquotes and callouts", () => {
    const tasks = parseTasks(["> [!todo] Chores", "> - [ ] water plants :due[2026-10-01]"].join("\n"));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ text: "water plants", dueDay: "2026-10-01", line: 1 });
    expect(tasks[0].rawLine).toBe("> - [ ] water plants :due[2026-10-01]");
  });

  it("records subtasks against their parent and heading context", () => {
    const markdown = [
      "# Launch",
      "- [ ] parent",
      "  - [x] child one",
      "  - plain note bullet",
      "  - [ ] child two",
      "## Later",
      "- [ ] sibling",
    ].join("\n");

    const tasks = parseTasks(markdown);

    expect(
      tasks.map((task) => [task.text, task.parentOrdinal, task.heading, task.line]),
    ).toEqual([
      ["parent", null, "Launch", 1],
      ["child one", 0, "Launch", 2],
      ["child two", 0, "Launch", 4],
      ["sibling", null, "Later", 6],
    ]);
  });

  it("collects continuation text as the note, excluding subtasks", () => {
    const markdown = [
      "- [ ] call the bank",
      "  ask about the fee",
      "",
      "  and the card",
      "  - [ ] subtask",
    ].join("\n");

    const [task] = parseTasks(markdown);

    expect(task.note).toBe("ask about the fee\n\nand the card");
  });

  it("keeps the exact original line, including Windows line endings", () => {
    const [task] = parseTasks("intro\r\n- [ ]  spaced   text \r\n");

    expect(task.line).toBe(1);
    expect(task.rawLine).toBe("- [ ]  spaced   text ");
    expect(task.text).toBe("spaced text");
  });

  it("stops at the per-document ceiling", () => {
    const markdown = Array.from(
      { length: MAX_TASKS_PER_DOCUMENT + 5 },
      (_, index) => `- [ ] task ${index}`,
    ).join("\n");

    expect(parseTasks(markdown)).toHaveLength(MAX_TASKS_PER_DOCUMENT);
  });

  it("returns nothing for a document without tasks", () => {
    expect(parseTasks("")).toEqual([]);
    expect(parseTasks("# Title\n\nJust prose.")).toEqual([]);
  });
});


describe("task priority", () => {
  it("reads the first valid priority on the task line and keeps unknown values visible", () => {
    const [task] = parseTasks("- [ ] Ship :priority[urgent] :priority[high] :priority[low] `:priority[medium]`\n  note :priority[low]");
    expect(task).toMatchObject({ priority: "high", text: "Ship :priority[urgent] `:priority[medium]`", note: "note :priority[low]" });
    expect(parseTasks("- [ ] plain")[0].priority).toBeNull();
  });
  it("does not read priority from code or ordinary bullets", () => {
    expect(parseTasks("- [ ] `:priority[high]`\n- ordinary :priority[low]")[0].priority).toBeNull();
  });
});
