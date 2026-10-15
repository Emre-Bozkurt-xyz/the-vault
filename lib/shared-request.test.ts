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

  it("keeps different keys apart", async () => {
    const [a, b] = await Promise.all([
      shareInFlight("a", async () => "a"),
      shareInFlight("b", async () => "b"),
    ]);

    expect([a, b]).toEqual(["a", "b"]);
  });
});
