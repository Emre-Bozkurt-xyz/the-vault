/**
 * Entry names for "Download all" zips of a shared folder: `path/name`, with
 * characters Windows or macOS refuse in file names replaced, and "name (2).ext"
 * for two files that would land on the same name (compared case-insensitively,
 * as most file systems do). Pure, so it is unit-tested.
 */
export function zipEntryNames<T extends { displayName: string; path: string }>(files: readonly T[]) {
  const taken = new Set<string>();

  return files.map((file) => {
    const base = cleanSegment(file.displayName) || "file";
    // Empty segments and "."/".." are dropped before cleaning, so a top-level
    // file stays top-level and no path can climb out of the zip.
    const folder = file.path
      .split("/")
      .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
      .map((segment) => cleanSegment(segment) || "folder")
      .join("/");
    const prefix = folder ? `${folder}/` : "";
    const dot = base.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ""];

    let name = `${prefix}${base}`;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
      name = `${prefix}${stem} (${n})${extension}`;
    }
    taken.add(name.toLowerCase());
    return { ...file, name };
  });
}

/** A file name for the zip itself. */
export function zipFileName(folderName: string) {
  return `${cleanSegment(folderName) || "folder"}.zip`;
}

function cleanSegment(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
}
