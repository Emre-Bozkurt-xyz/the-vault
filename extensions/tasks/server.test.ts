import { describe, expect, it, vi } from "vitest";
import type { ExtensionAgentActionContext } from "@/lib/extension-api/server";
import server from "./server";

const action = server.actions.find(
  (candidate) => candidate.id === "vault.tasks.setTaskPriority",
)!;
const ref = {
  documentId: "11111111-1111-4111-8111-111111111111",
  ordinal: 1,
  today: "2026-10-06",
};

describe("setTaskPriority", () => {
  it("validates the priority and delegates set and clear to the permission-gated service", async () => {
    const change = vi.fn().mockResolvedValue(undefined);
    const context: ExtensionAgentActionContext = {
      user: { id: "owner" },
      settings: {},
      tasks: { list: async () => [], change },
    };
    for (const priority of ["high", null]) {
      const input = action.input.parse({ ...ref, priority });
      await action.handler(input, context);
      expect(change).toHaveBeenLastCalledWith({
        ...ref,
        priority,
        change: { type: "priority", priority },
      });
    }
    expect(action.input.safeParse({ ...ref, priority: "urgent" }).success).toBe(
      false,
    );
  });
  it("refuses mutation without task write access", async () => {
    const context: ExtensionAgentActionContext = {
      user: { id: "reader" },
      settings: {},
      tasks: { list: async () => [] },
    };
    await expect(
      action.handler({ ...ref, priority: "high" }, context),
    ).rejects.toThrow("Task write access");
  });
});

it("validates recurrence rules and requires write access", async () => {
  const recurring = server.actions.find(
    (candidate) => candidate.id === "vault.tasks.setTaskRepeat",
  )!;
  expect(
    recurring.input.safeParse({ ...ref, repeat: "sometimes" }).success,
  ).toBe(false);
  const change = vi.fn().mockResolvedValue(undefined);
  const context: ExtensionAgentActionContext = {
    user: { id: "owner" },
    settings: {},
    tasks: { list: async () => [], change },
  };
  await recurring.handler(
    recurring.input.parse({ ...ref, repeat: "after 2 weeks" }),
    context,
  );
  expect(change).toHaveBeenCalledWith({
    ...ref,
    repeat: "after 2 weeks",
    change: { type: "repeat", repeat: "after 2 weeks" },
  });
  await expect(
    recurring.handler(
      { ...ref, repeat: null },
      { user: { id: "reader" }, settings: {} },
    ),
  ).rejects.toThrow("Task write access");
});
