import { describe, expect, it } from "vitest";

import { parseTasks } from "@/lib/tasks/parse";
import {
  TaskMovedError,
  formatTaskLine,
  locateTaskLine,
  minimalReplacement,
  planTaskInsertion,
  setTaskLineDue,
  setTaskLineStatus,
} from "@/lib/tasks/write";

const today = "2026-10-06";

describe("locateTaskLine", () => {
  const lines = ["# Todo", "- [ ] a", "- [ ] b", "- [ ] b"];

  it("uses the indexed line while it still matches", () => {
    expect(locateTaskLine(lines, 1, "- [ ] a")).toBe(1);
  });

  it("follows a task that moved to a unique line", () => {
    expect(locateTaskLine(["intro", ...lines], 1, "- [ ] a")).toBe(2);
  });

  it("refuses an ambiguous or vanished task", () => {
    expect(() => locateTaskLine(lines, 0, "- [ ] b")).toThrow(TaskMovedError);
    expect(() => locateTaskLine(lines, 1, "- [ ] gone")).toThrow(TaskMovedError);
  });
});

describe("setTaskLineStatus", () => {
  it("completes a task and stamps the done day", () => {
    expect(setTaskLineStatus("- [ ] ship it", "done", today)).toBe(
      "- [x] ship it :done[2026-10-06]",
    );
  });

  it("keeps an existing done stamp when completing again", () => {
    const line = "- [x] ship it :done[2026-10-01]";
    expect(setTaskLineStatus(line, "done", today)).toBe(line);
  });

  it("reopens a task and clears its done stamp", () => {
    expect(
      setTaskLineStatus("- [x] ship it :due[2026-10-02] :done[2026-10-01]", "open", today),
    ).toBe("- [ ] ship it :due[2026-10-02]");
  });

  it("handles in-progress, cancelled, nesting, and callouts", () => {
    expect(setTaskLineStatus("  - [ ] sub", "in_progress", today)).toBe("  - [/] sub");
    expect(setTaskLineStatus("> 1. [ ] quoted", "cancelled", today)).toBe("> 1. [-] quoted");
  });

  it("ignores a done directive written inside inline code", () => {
    expect(setTaskLineStatus("- [ ] write `:done[x]` docs", "done", today)).toBe(
      "- [x] write `:done[x]` docs :done[2026-10-06]",
    );
  });

  it("rejects a non-task line", () => {
    expect(() => setTaskLineStatus("just text", "done", today)).toThrow(/not a task/);
  });

  it("round-trips through the parser", () => {
    const [task] = parseTasks(setTaskLineStatus("- [ ] a :due[2026-10-09]", "done", today));
    expect(task).toMatchObject({ status: "done", dueDay: "2026-10-09", doneDay: today, text: "a" });
  });
});

describe("setTaskLineDue", () => {
  it("adds, replaces, and clears a due date", () => {
    expect(setTaskLineDue("- [ ] a", { day: "2026-10-09" })).toBe("- [ ] a :due[2026-10-09]");
    expect(setTaskLineDue("- [ ] a :due[2026-10-09]", { day: "2026-10-10", time: "15:00" })).toBe(
      "- [ ] a :due[2026-10-10 15:00]",
    );
    expect(setTaskLineDue("- [ ] a :due[2026-10-09] rest", null)).toBe("- [ ] a rest");
  });

  it("places a new due date before the done stamp", () => {
    expect(setTaskLineDue("- [x] a :done[2026-10-01]", { day: "2026-10-02" })).toBe(
      "- [x] a :due[2026-10-02] :done[2026-10-01]",
    );
  });

  it("validates the date and time", () => {
    expect(() => setTaskLineDue("- [ ] a", { day: "2026-13-01" })).toThrow();
    expect(() => setTaskLineDue("- [ ] a", { day: "2026-10-01", time: "3pm" })).toThrow();
  });
});

describe("formatTaskLine", () => {
  it("builds an open task, with an optional due date", () => {
    expect(formatTaskLine("call mum")).toBe("- [ ] call mum");
    expect(formatTaskLine("call mum", { day: "2026-10-09" })).toBe(
      "- [ ] call mum :due[2026-10-09]",
    );
  });

  it("does not double a checkbox the caller already wrote", () => {
    expect(formatTaskLine("- [ ] call mum")).toBe("- [ ] call mum");
  });

  it("rejects empty and multi-line text", () => {
    expect(() => formatTaskLine("  ")).toThrow();
    expect(() => formatTaskLine("a\nb")).toThrow();
  });
});

describe("planTaskInsertion", () => {
  const apply = (markdown: string, heading?: string) => {
    const plan = planTaskInsertion(markdown, "- [ ] new", heading);
    if (!plan) return null;
    const next = markdown.slice(0, plan.offset) + plan.text + markdown.slice(plan.offset);
    return { next, line: plan.line };
  };

  it("joins a list that ends the document", () => {
    const result = apply("# Todo\n\n- [ ] a\n");
    expect(result?.next).toBe("# Todo\n\n- [ ] a\n- [ ] new\n");
    expect(result?.next.split("\n")[result.line]).toBe("- [ ] new");
  });

  it("starts a new block after a paragraph", () => {
    const result = apply("Some notes");
    expect(result?.next).toBe("Some notes\n\n- [ ] new");
    expect(result?.next.split("\n")[result.line]).toBe("- [ ] new");
  });

  it("writes into an empty document", () => {
    expect(apply("")?.next).toBe("- [ ] new");
  });

  it("inserts at the end of a heading's section", () => {
    const markdown = "# A\n\n- [ ] a1\n\n# B\n\n- [ ] b1\n";
    const result = apply(markdown, "a");
    expect(result?.next).toBe("# A\n\n- [ ] a1\n- [ ] new\n\n# B\n\n- [ ] b1\n");
    expect(result?.next.split("\n")[result.line]).toBe("- [ ] new");
    expect(parseTasks(result!.next).map((task) => task.heading)).toEqual(["A", "A", "B"]);
  });

  it("returns null for a missing heading", () => {
    expect(apply("# A\n", "Nope")).toBeNull();
  });
});

describe("minimalReplacement", () => {
  it("touches only the changed span", () => {
    expect(minimalReplacement("- [ ] a", "- [x] a")).toEqual({
      from: 3,
      deleteCount: 1,
      insert: "x",
    });
    expect(minimalReplacement("- [ ] a", "- [ ] a :due[2026-10-09]")).toEqual({
      from: 7,
      deleteCount: 0,
      insert: " :due[2026-10-09]",
    });
  });
});
