import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { RENDITIONS } from "@/lib/asset-renditions";
import { RenditionDecodeError, renderRenditions } from "@/server/asset-rendition-render";

/** A camera-like JPEG: landscape pixels, EXIF says "rotate 90°", with GPS. */
async function cameraJpeg(width: number, height: number, orientation = 6) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .jpeg({ quality: 80 })
    .withExif({
      IFD0: { Make: "TestCam", Model: "X100" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" },
    })
    .withMetadata({ orientation })
    .toBuffer();
}

describe("renderRenditions", () => {
  it("rotates by EXIF orientation, fits each box, and strips every bit of metadata", async () => {
    const input = await cameraJpeg(3000, 2000, 6);
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.orientation).toBe(6);
    expect(inputMeta.exif).toBeDefined();

    const result = await renderRenditions(input, "image/jpeg");

    // Displayed (rotated) size of the original.
    expect(result).toMatchObject({ width: 2000, height: 3000, animated: false, takenAt: null });
    expect(result.outputs.display).toMatchObject({ width: 1365, height: 2048 });
    expect(result.outputs.thumb).toMatchObject({ width: 640, height: 960 });

    for (const output of Object.values(result.outputs)) {
      const meta = await sharp(output.body).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(output.width);
      expect(meta.height).toBe(output.height);
      // Already upright, and nothing left to leak a location or a camera.
      expect(meta.orientation).toBeUndefined();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }
  });

  it("records when the photo was taken", async () => {
    const input = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#000" } })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: "2026:10:01 09:30:15" } })
      .toBuffer();
    expect((await renderRenditions(input, "image/jpeg")).takenAt).toBe("2026-10-01T09:30:15.000Z");
  });

  it("never enlarges small images", async () => {
    const input = await sharp({
      create: { width: 200, height: 100, channels: 4, background: "#336699" },
    })
      .png()
      .toBuffer();

    const result = await renderRenditions(input, "image/png");
    expect(result.outputs.display).toMatchObject({ width: 200, height: 100 });
    expect(result.outputs.thumb).toMatchObject({ width: 200, height: 100 });
  });

  it("caps tall panoramas by height in the thumbnail", async () => {
    const input = await sharp({
      create: { width: 800, height: 8000, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();

    const result = await renderRenditions(input, "image/jpeg");
    expect(result.outputs.thumb.height).toBeLessThanOrEqual(RENDITIONS.thumb.maxHeight);
    expect(result.outputs.display.height).toBeLessThanOrEqual(RENDITIONS.display.maxHeight);
  });

  it("reports bytes that are not an image as a permanent decode error", async () => {
    await expect(
      renderRenditions(Buffer.from("definitely not an image"), "image/png"),
    ).rejects.toBeInstanceOf(RenditionDecodeError);

    const truncated = (await cameraJpeg(400, 300, 1)).subarray(0, 40);
    await expect(renderRenditions(truncated, "image/jpeg")).rejects.toBeInstanceOf(
      RenditionDecodeError,
    );
  });

  it("refuses images over the pixel limit before decoding them", async () => {
    const input = await cameraJpeg(2000, 1000, 1);
    await expect(
      renderRenditions(input, "image/jpeg", { maxInputPixels: 1_000_000 }),
    ).rejects.toBeInstanceOf(RenditionDecodeError);
  });

  it("keeps animated GIFs animated", async () => {
    const frame = (colour: string) =>
      sharp({ create: { width: 300, height: 200, channels: 3, background: colour } })
        .png()
        .toBuffer();
    const gif = await sharp([await frame("#ff0000"), await frame("#0000ff")], {
      join: { animated: true },
    })
      .gif()
      .toBuffer();
    expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2);

    const result = await renderRenditions(gif, "image/gif");
    expect(result).toMatchObject({ width: 300, height: 200, animated: true });
    const thumbMeta = await sharp(result.outputs.thumb.body, { animated: true }).metadata();
    expect(thumbMeta.format).toBe("webp");
    expect(thumbMeta.pages).toBe(2);
    expect(result.outputs.thumb).toMatchObject({ width: 300, height: 200 });
  });
});
