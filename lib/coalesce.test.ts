import { describe, expect, it } from "vitest";

import { createCoalescedRunner } from "@/lib/coalesce";

function deferredRunner() {
  const started: string[] = [];
  const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const runner = createCoalescedRunner((key) => {
    started.push(key);
    return new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  });
  const settle = async (index: number, error?: Error) => {
    if (error) pending[index]!.reject(error);
    else pending[index]!.resolve();
    // Let the follow-up run start.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return { runner, started, settle };
}

describe("createCoalescedRunner", () => {
  it("runs once for a lone caller", async () => {
    const { runner, started, settle } = deferredRunner();
    const done = runner("u");
    await settle(0);
    await done;
    expect(started).toEqual(["u"]);
  });

  it("shares one follow-up run between callers that arrive mid-run", async () => {
    const { runner, started, settle } = deferredRunner();
    const first = runner("u");
    const second = runner("u");
    const third = runner("u");

    expect(second).toBe(third);
    expect(started).toHaveLength(1);

    await settle(0);
    await first;
    // The follow-up started only after the first run finished.
    expect(started).toHaveLength(2);

    let secondDone = false;
    void second.then(() => {
      secondDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondDone).toBe(false);

    await settle(1);
    await Promise.all([second, third]);
    expect(started).toHaveLength(2);
  });

  it("starts fresh once everything settled", async () => {
    const { runner, started, settle } = deferredRunner();
    const first = runner("u");
    await settle(0);
    await first;
    const again = runner("u");
    await settle(1);
    await again;
    expect(started).toHaveLength(2);
  });

  it("still runs the follow-up when the first run fails", async () => {
    const { runner, started, settle } = deferredRunner();
    const first = runner("u");
    const second = runner("u");
    await settle(0, new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await settle(1);
    await expect(second).resolves.toBeUndefined();
    expect(started).toHaveLength(2);
  });

  it("keeps keys independent", async () => {
    const { runner, started } = deferredRunner();
    void runner("a");
    void runner("b");
    expect(started).toEqual(["a", "b"]);
  });
});
