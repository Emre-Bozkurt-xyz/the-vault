import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { parseExifDateTime, readExifDateTaken } from "@/lib/exif-date";

async function exifOf(exif: Parameters<sharp.Sharp["withExif"]>[0]) {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
    .jpeg()
    .withExif(exif)
    .toBuffer();
  return (await sharp(jpeg).metadata()).exif;
}

describe("readExifDateTaken", () => {
  it("reads DateTimeOriginal from the Exif IFD", async () => {
    const exif = await exifOf({
      IFD0: { Make: "TestCam", DateTime: "2026:10:05 12:00:00" },
      IFD2: { DateTimeOriginal: "2026:10:01 09:30:15", DateTimeDigitized: "2026:10:02 00:00:00" },
    });
    expect(readExifDateTaken(exif)).toBe("2026-10-01T09:30:15.000Z");
  });

  it("falls back to DateTimeDigitized, then IFD0 DateTime", async () => {
    expect(readExifDateTaken(await exifOf({ IFD2: { DateTimeDigitized: "2025:01:02 03:04:05" } }))).toBe(
      "2025-01-02T03:04:05.000Z",
    );
    expect(readExifDateTaken(await exifOf({ IFD0: { DateTime: "2024:12:31 23:59:59" } }))).toBe(
      "2024-12-31T23:59:59.000Z",
    );
  });

  it("returns null without a usable date", async () => {
    expect(readExifDateTaken(await exifOf({ IFD0: { Make: "TestCam" } }))).toBeNull();
    expect(readExifDateTaken(await exifOf({ IFD2: { DateTimeOriginal: "0000:00:00 00:00:00" } }))).toBeNull();
    expect(readExifDateTaken(undefined)).toBeNull();
  });

  it("survives garbage and truncation", async () => {
    const exif = await exifOf({ IFD2: { DateTimeOriginal: "2026:10:01 09:30:15" } });
    for (let length = 0; length < exif!.length; length += 7) {
      expect(() => readExifDateTaken(exif!.subarray(0, length))).not.toThrow();
    }
    expect(readExifDateTaken(Buffer.from("Exif\0\0MM\0*\xff\xff\xff\xff", "latin1"))).toBeNull();
    expect(readExifDateTaken(new Uint8Array(64).fill(0xff))).toBeNull();
  });
});

describe("parseExifDateTime", () => {
  it("rejects impossible dates and times", () => {
    expect(parseExifDateTime("2026:02:30 10:00:00")).toBeNull();
    expect(parseExifDateTime("2026:10:01 24:00:00")).toBeNull();
    expect(parseExifDateTime("1969:12:31 23:59:59")).toBeNull();
    expect(parseExifDateTime("yesterday")).toBeNull();
    expect(parseExifDateTime("2026-10-01T09:30:15")).toBe("2026-10-01T09:30:15.000Z");
  });
});
