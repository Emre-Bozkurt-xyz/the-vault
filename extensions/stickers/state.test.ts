import { describe, expect, it } from "vitest";

import { STICKER_MIN_SIZE, stickerBleed, stickerDisplayWidth } from "./state";

describe("sticker sizing", () => {
  it("reaches past its square only when rotated", () => {
    expect(stickerBleed(100, 0)).toBeCloseTo(0);
    expect(stickerBleed(100, 90)).toBeCloseTo(0);
    expect(stickerBleed(100, 45)).toBeCloseTo((100 * Math.SQRT2 - 100) / 2);
  });

  it("scales down only on small screens, never below the minimum", () => {
    expect(stickerDisplayWidth(120, 1400)).toBe(120);
    expect(stickerDisplayWidth(400, 390)).toBe(156);
    expect(stickerDisplayWidth(400, 60)).toBe(STICKER_MIN_SIZE);
    expect(stickerDisplayWidth(400, null)).toBe(400);
  });
});
