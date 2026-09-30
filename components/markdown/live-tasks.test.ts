import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { findTaskDateFields, subtaskProgress } from "@/components/markdown/live-tasks";

describe("subtaskProgress", () => {
  const doc = Text.of([
    "- [ ] parent",
    "  - [x] one",
    "  - [ ] two",
    "    - [x] grandchild (not direct)",
    "  - [-] dropped",
    "",
    "  - [x] after a blank line",
    "- [ ] sibling",
    "- [ ] no children",
  ]);

  it("counts direct subtasks, skipping cancelled and deeper ones", () => {
    expect(subtaskProgress(doc, 1)).toEqual({ done: 2, total: 3 });
  });

  it("returns null for a task without subtasks", () => {
    expect(subtaskProgress(doc, 9)).toBeNull();
    expect(subtaskProgress(doc, 8)).toBeNull();
  });
});

describe("findTaskDateFields", () => {
  it("finds fields outside inline code and word boundaries", () => {
    const fields = findTaskDateFields("- [ ] a :due[2026-10-02] `:due[x]` b:due[y] :done[2026-09-30]");
    expect(fields.map((field) => [field.name, field.value, field.valid])).toEqual([
      ["due", "2026-10-02", true],
      ["done", "2026-09-30", true],
    ]);
  });
});
