/**
 * Reads when a photo was taken from its raw EXIF block (what sharp's
 * `metadata().exif` returns). Only what "Date taken" needs: `DateTimeOriginal`,
 * then `DateTimeDigitized`, then IFD0 `DateTime`. Every read is bounds-checked
 * and anything malformed yields null — EXIF comes from the uploader.
 *
 * EXIF times are the camera's wall clock with no time zone. The result keeps
 * that wall clock as an ISO string in UTC ("2026-10-01T09:30:15.000Z"), so
 * sorting works and display shows the camera's time when formatted in UTC.
 */

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME = 0x0132;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TYPE_ASCII = 2;
const MAX_ENTRIES = 512;

export function readExifDateTaken(raw: Uint8Array | null | undefined): string | null {
  if (!raw || raw.length < 14) return null;

  // sharp hands back the APP1 payload, which starts with "Exif\0\0".
  const start =
    raw[0] === 0x45 && raw[1] === 0x78 && raw[2] === 0x69 && raw[3] === 0x66 ? 6 : 0;
  const view = new DataView(raw.buffer, raw.byteOffset + start, raw.byteLength - start);
  if (view.byteLength < 8) return null;

  const order = view.getUint16(0);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  if (view.getUint16(2, little) !== 42) return null;

  const u16 = (offset: number) =>
    offset >= 0 && offset + 2 <= view.byteLength ? view.getUint16(offset, little) : null;
  const u32 = (offset: number) =>
    offset >= 0 && offset + 4 <= view.byteLength ? view.getUint32(offset, little) : null;

  function readIfd(offset: number | null) {
    const tags = new Map<number, { type: number; count: number; valueOffset: number }>();
    if (offset === null) return tags;
    const count = u16(offset);
    if (count === null || count > MAX_ENTRIES) return tags;

    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const valueCount = u32(entry + 4);
      if (tag === null || type === null || valueCount === null) break;
      // Values up to 4 bytes sit inline; larger ones are at an offset.
      const valueOffset = valueCount <= 4 ? entry + 8 : u32(entry + 8);
      if (valueOffset === null) continue;
      tags.set(tag, { type, count: valueCount, valueOffset });
    }
    return tags;
  }

  function readAscii(entry: { type: number; count: number; valueOffset: number } | undefined) {
    if (!entry || entry.type !== TYPE_ASCII || entry.count < 19 || entry.count > 64) return null;
    if (entry.valueOffset + entry.count > view.byteLength) return null;
    let text = "";
    for (let index = 0; index < entry.count; index += 1) {
      const code = view.getUint8(entry.valueOffset + index);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }

  const ifd0 = readIfd(u32(4));
  const exifPointer = ifd0.get(TAG_EXIF_IFD);
  const exifIfd = exifPointer ? readIfd(u32(exifPointer.valueOffset) ?? null) : new Map();

  for (const candidate of [
    readAscii(exifIfd.get(TAG_DATE_TIME_ORIGINAL)),
    readAscii(exifIfd.get(TAG_DATE_TIME_DIGITIZED)),
    readAscii(ifd0.get(TAG_DATE_TIME)),
  ]) {
    const parsed = parseExifDateTime(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/** "2026:10:01 09:30:15" → "2026-10-01T09:30:15.000Z"; null for blanks and nonsense. */
export function parseExifDateTime(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  // Cameras with a flat clock battery write 0000:00:00 or their epoch.
  if (year < 1970 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  return date.toISOString();
}
