import { describe, expect, it } from "vitest";

import {
  applyTextEdits,
  locateTaskLine,
  planTaskEdit,
  type TaskChange,
} from "@/lib/tasks/edit";
import { parseTasks } from "@/lib/tasks/parse";

const today = "2026-09-29";

function change(line: string, taskChange: TaskChange) {
  const edits = planTaskEdit(line, taskChange, today);
  return edits ? applyTextEdits(line, edits) : null;
}

describe("planTaskEdit", () => {
  it("ticks a task and stamps the completion day", () => {
    expect(change("- [ ] Ship it :due[2026-10-02]", { type: "status", status: "done" })).toBe(
      "- [x] Ship it :due[2026-10-02] :done[2026-09-29]",
    );
  });

  it("unticks a task and removes its completion day", () => {
    expect(
      change("- [x] Ship it :done[2026-09-20] :due[2026-10-02]", { type: "status", status: "open" }),
    ).toBe("- [ ] Ship it :due[2026-10-02]");
  });

  it("keeps an existing completion day and an uppercase X", () => {
    expect(change("- [X] Ship :done[2026-09-01]", { type: "status", status: "done" })).toBe(
      "- [X] Ship :done[2026-09-01]",
    );
  });

  it("changes only the marker when not stamping", () => {
    const line = "- [x] a :done[2026-09-01]";
    const edits = planTaskEdit(line, { type: "status", status: "open" }, today, { stampDone: false });
    expect(applyTextEdits(line, edits ?? [])).toBe("- [ ] a :done[2026-09-01]");
  });

  it("sets in-progress and cancelled markers", () => {
    expect(change("- [ ] a", { type: "status", status: "in_progress" })).toBe("- [/] a");
    expect(change("- [x] a :done[2026-09-01]", { type: "status", status: "cancelled" })).toBe("- [-] a");
  });

  it("appends, replaces and clears a due date", () => {
    expect(change("- [ ] a", { type: "due", day: "2026-10-05" })).toBe("- [ ] a :due[2026-10-05]");
    expect(change("- [ ] a :due[2026-10-01] b", { type: "due", day: "2026-10-05", time: "14:00" })).toBe(
      "- [ ] a :due[2026-10-05 14:00] b",
    );
    expect(change("- [ ] a :due[2026-10-01] b", { type: "due", day: null })).toBe("- [ ] a b");
  });

  it("collapses duplicate due fields when rescheduling", () => {
    expect(
      change("- [ ] a :due[2026-10-01] :due[2026-10-09]", { type: "due", day: "2026-10-05" }),
    ).toBe("- [ ] a :due[2026-10-05]");
  });

  it("appends before trailing whitespace", () => {
    expect(change("- [ ] a   ", { type: "due", day: "2026-10-05" })).toBe("- [ ] a :due[2026-10-05]   ");
  });

  it("works on quoted, nested and ordered task lines", () => {
    expect(change("> - [ ] quoted", { type: "status", status: "done" })).toBe(
      "> - [x] quoted :done[2026-09-29]",
    );
    expect(change("        - [ ] deep", { type: "due", day: "2026-10-05" })).toBe(
      "        - [ ] deep :due[2026-10-05]",
    );
    expect(change("3. [ ] ordered", { type: "status", status: "in_progress" })).toBe("3. [/] ordered");
  });

  it("leaves a directive inside inline code alone", () => {
    expect(change("- [ ] doc `:due[2026-01-01]`", { type: "due", day: "2026-10-05" })).toBe(
      "- [ ] doc `:due[2026-01-01]` :due[2026-10-05]",
    );
  });

  it("refuses non-task lines and invalid values", () => {
    expect(planTaskEdit("- plain", { type: "status", status: "done" }, today)).toBeNull();
    expect(planTaskEdit("- [ ] a", { type: "due", day: "2026-02-30" }, today)).toBeNull();
    expect(planTaskEdit("- [ ] a", { type: "due", day: "2026-10-05", time: "9am" }, today)).toBeNull();
  });

  it("produces lines the parser reads back as intended", () => {
    const line = change("- [ ] a :due[2026-10-01]", { type: "status", status: "done" }) ?? "";
    const [task] = parseTasks(line);

    expect(task).toMatchObject({ status: "done", doneDay: today, dueDay: "2026-10-01", text: "a" });
  });
});

describe("locateTaskLine", () => {
  const text = "# T\n- [ ] one\n- [ ] two\n- [ ] dup\n- [ ] dup";

  it("uses the recorded line, or the one line that moved", () => {
    expect(locateTaskLine(text, 2, "- [ ] two")).toEqual({ lineIndex: 2, offset: 14 });
    expect(locateTaskLine(text, 0, "- [ ] two")).toEqual({ lineIndex: 2, offset: 14 });
  });

  it("refuses a missing or ambiguous line", () => {
    expect(locateTaskLine(text, 1, "- [ ] gone")).toBeNull();
    expect(locateTaskLine(text, 0, "- [ ] dup")).toBeNull();
  });

  it("still takes a duplicate on its recorded line", () => {
    expect(locateTaskLine(text, 4, "- [ ] dup")?.lineIndex).toBe(4);
  });
});


describe("priority source edits", () => {
  it("changes only the directive, removes duplicates, and preserves code and other fields", () => {
    const source = "> - [/] **Ship** :priority[low] :due[2026-10-10 09:30] :priority[medium] `:priority[low]`";
    const result = change(source, { type: "priority", priority: "high" });
    expect(result).toBe("> - [/] **Ship** :priority[high] :due[2026-10-10 09:30] `:priority[low]`");
    expect(change(result!, { type: "priority", priority: null })).toBe("> - [/] **Ship** :due[2026-10-10 09:30] `:priority[low]`");
  });
  it("appends when absent, and clearing an absent field does nothing", () => {
    expect(change("- [ ] Ship", { type: "priority", priority: "medium" })).toBe("- [ ] Ship :priority[medium]");
    expect(change("- [ ] Ship", { type: "priority", priority: null })).toBe("- [ ] Ship");
  });
});
