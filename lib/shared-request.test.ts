import { describe, expect, it } from "vitest";

import { shareInFlight } from "@/lib/shared-request";

describe("shareInFlight", () => {
  it("shares a request between concurrent callers", async () => {
    let calls = 0;
    let release: (value: number) => void = () => {};
    const request = () => {
      calls += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const first = shareInFlight("k", request);
    const second = shareInFlight("k", request);
    release(7);

    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
    expect(calls).toBe(1);
  });

  it("starts a fresh request once the previous one settled", async () => {
    let calls = 0;
    const request = async () => ++calls;

    await shareInFlight("fresh", request);
    await expect(shareInFlight("fresh", request)).resolves.toBe(2);
  });

  it("does not keep a failed request", async () => {
    await expect(
      shareInFlight("fail", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(shareInFlight("fail", async () => "ok")).resolves.toBe("ok");
  });

  it("re-runs once for callers who asked after the request went out", async () => {
    let calls = 0;
    const releases: ((value: number) => void)[] = [];
    const request = () => {
      calls += 1;
      const call = calls;
      return new Promise<number>((resolve) => {
        releases.push(() => resolve(call));
      });
    };

    const first = shareInFlight("late", request);
    // A later task: e.g. a second upload finished while this refresh loads.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = shareInFlight("late", request);
    const third = shareInFlight("late", request);
    expect(calls).toBe(1);

    releases[0](0);
    await expect(first).resolves.toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    releases[1](0);
    await expect(Promise.all([second, third])).resolves.toEqual([2, 2]);
  });

  it("re-runs for late callers even when the first request fails", async () => {
    let calls = 0;
    let fail: (error: Error) => void = () => {};
    const first = shareInFlight("late-fail", () => {
      calls += 1;
      return new Promise<string>((_, reject) => {
        fail = reject;
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = shareInFlight("late-fail", async () => {
      calls += 1;
      return "fresh";
    });
    fail(new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("fresh");
    expect(calls).toBe(2);
  });

  it("keeps different keys apart", async () => {
    const [a, b] = await Promise.all([
      shareInFlight("a", async () => "a"),
      shareInFlight("b", async () => "b"),
    ]);

    expect([a, b]).toEqual(["a", "b"]);
  });
});
