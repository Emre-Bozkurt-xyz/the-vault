import { describe, expect, it } from "vitest";

import { canReadVideoType, parseProbe, posterTimeSeconds } from "@/server/video-frames";

describe("video frames", () => {
  it("reads duration and size from ffprobe JSON", () => {
    expect(
      parseProbe(JSON.stringify({ format: { duration: "12.480000" }, streams: [{ width: 640, height: 480 }] })),
    ).toEqual({ durationMs: 12480, width: 640, height: 480 });
  });

  it("swaps width and height for sideways phone video", () => {
    const sideData = { streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] };
    expect(parseProbe(JSON.stringify(sideData))).toMatchObject({ width: 1080, height: 1920 });
    const tag = { streams: [{ width: 1920, height: 1080, tags: { rotate: "270" } }] };
    expect(parseProbe(JSON.stringify(tag))).toMatchObject({ width: 1080, height: 1920 });
    const upsideDown = { streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: 180 }] }] };
    expect(parseProbe(JSON.stringify(upsideDown))).toMatchObject({ width: 1920, height: 1080 });
  });

  it("tolerates missing or junk fields", () => {
    expect(parseProbe("not json")).toEqual({ durationMs: null, width: null, height: null });
    expect(parseProbe(JSON.stringify({ format: { duration: "N/A" }, streams: [] }))).toEqual({
      durationMs: null,
      width: null,
      height: null,
    });
  });

  it("takes the poster a second in, or 10% into a short clip", () => {
    expect(posterTimeSeconds(null)).toBe(0);
    expect(posterTimeSeconds(3000)).toBeCloseTo(0.3);
    expect(posterTimeSeconds(600_000)).toBe(1);
  });

  it("only reads the accepted video types", () => {
    expect(canReadVideoType("video/quicktime")).toBe(true);
    expect(canReadVideoType("video/webm")).toBe(true);
    expect(canReadVideoType("video/x-msvideo")).toBe(false);
    expect(canReadVideoType("toString")).toBe(false);
  });
});
