import { describe, expect, it } from "vitest";

import { updateTaskInputSchema } from "@/lib/tasks/change-schema";
import type { TaskChange } from "@/lib/tasks/edit";

const locator = {
  today: "2026-10-15",
  documentId: "8f8c4d4e-2f4b-4f7e-9b0a-6f1d2c3b4a59",
  line: 3,
  rawLine: "- [ ] Ship it",
};

describe("updateTaskInputSchema", () => {
  // Every TaskChange variant must parse. A duplicated variant in the union
  // throws on first parse under Zod 4, which once broke every UI task write.
  const changes: TaskChange[] = [
    { type: "status", status: "done" },
    { type: "status", status: "cancelled" },
    { type: "due", day: "2026-10-16", time: "09:30" },
    { type: "due", day: null },
    { type: "priority", priority: "high" },
    { type: "priority", priority: null },
    { type: "repeat", repeat: "weekly" },
    { type: "repeat", repeat: null },
  ];

  it.each(changes)("accepts %o", (change) => {
    expect(updateTaskInputSchema.safeParse({ ...locator, change }).success).toBe(true);
  });

  it("rejects invalid values without throwing", () => {
    for (const change of [
      { type: "status", status: "finished" },
      { type: "due", day: "2026-02-30" },
      { type: "priority", priority: "urgent" },
      { type: "repeat", repeat: "sometimes" },
      { type: "delete" },
    ]) {
      expect(updateTaskInputSchema.safeParse({ ...locator, change }).success).toBe(false);
    }
  });
});

describe("task operations", () => {
  it("accepts text edits and each operation kind", async () => {
    const { taskOperationInputSchema } = await import("@/lib/tasks/change-schema");
    const items = [{ documentId: locator.documentId, line: 0, rawLine: "- [ ] A" }];
    for (const operation of [
      { kind: "change", change: { type: "text", text: "Renamed" } },
      { kind: "delete" },
      { kind: "move", targetDocumentId: locator.documentId },
    ]) {
      expect(taskOperationInputSchema.safeParse({ today: locator.today, items, operation }).success).toBe(true);
    }
    expect(
      taskOperationInputSchema.safeParse({ today: locator.today, items: [], operation: { kind: "delete" } }).success,
    ).toBe(false);
  });
});
