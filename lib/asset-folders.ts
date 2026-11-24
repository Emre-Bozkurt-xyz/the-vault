/**
 * Media library folder rules, pure and client-safe: name validation, unique
 * sibling names, tree walks over a flat folder list, the move checks (no
 * cycles, bounded depth), and turning a dropped directory into the folders to
 * create. The server enforces the same rules inside a locked transaction; the
 * client uses them to disable impossible moves and to plan folder uploads.
 * See docs/26_MEDIA_LIBRARY_AND_FOLDERS_PLAN.md §4.2 and §6.
 */

export const MAX_FOLDER_NAME_LENGTH = 120;
/** Deepest a folder may sit (root children are depth 1). */
export const MAX_FOLDER_DEPTH = 32;

export type FolderNode = { id: string; parentId: string | null; name: string };

export type FolderNameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Trims and collapses whitespace, then rejects what would be confusing or
 * unsafe as a path segment: empty, `.`/`..`, slashes, control characters,
 * over-long names.
 */
export function normalizeFolderName(raw: unknown): FolderNameResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a folder name." };

  const name = raw.replace(/\s+/g, " ").trim();

  if (!name) return { ok: false, error: "Enter a folder name." };
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, error: "Folder names can't contain control characters." };
  }
  if (/[/\\]/.test(name)) return { ok: false, error: "Folder names can't contain / or \\." };
  if (name === "." || name === "..") return { ok: false, error: "That name is reserved." };
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return { ok: false, error: `Keep folder names under ${MAX_FOLDER_NAME_LENGTH} characters.` };
  }

  return { ok: true, name };
}

/** Names compare case-insensitively, matching the database's unique index. */
export function folderNameKey(name: string) {
  return name.toLowerCase();
}

/**
 * `desired`, or `desired (2)`, `desired (3)`… — the first not in `taken`
 * (compared with {@link folderNameKey}). Trims the base so the suffix always
 * fits the length limit.
 */
export function uniqueFolderName(desired: string, taken: Iterable<string>) {
  const takenKeys = new Set([...taken].map(folderNameKey));
  if (!takenKeys.has(folderNameKey(desired))) return desired;

  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const base = desired.slice(0, MAX_FOLDER_NAME_LENGTH - suffix.length).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!takenKeys.has(folderNameKey(candidate))) return candidate;
  }
}

function byId(folders: readonly FolderNode[]) {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

/**
 * Root-first chain from the library root down to `folderId` (inclusive). Stops
 * at a missing parent or a cycle instead of looping, so bad data degrades to a
 * shorter breadcrumb rather than a hang.
 */
export function folderPath(folders: readonly FolderNode[], folderId: string | null) {
  const index = byId(folders);
  const chain: FolderNode[] = [];
  const seen = new Set<string>();
  let current = folderId ? index.get(folderId) : undefined;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }

  return chain;
}

/** Depth of a folder: root children are 1; the root itself (null) is 0. */
export function folderDepth(folders: readonly FolderNode[], folderId: string | null) {
  return folderPath(folders, folderId).length;
}

export function childFolders(folders: readonly FolderNode[], parentId: string | null) {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

/** Every folder below `folderId` (not including it). */
export function descendantFolderIds(folders: readonly FolderNode[], folderId: string) {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder.id]);
  }

  const found = new Set<string>();
  const stack = [...(children.get(folderId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (found.has(id) || id === folderId) continue;
    found.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return found;
}

/** Levels below `folderId` (0 for a leaf). */
export function subtreeHeight(folders: readonly FolderNode[], folderId: string): number {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder.id]);
  }

  // Breadth-first, one level at a time; `seen` guards against cyclic data.
  const seen = new Set([folderId]);
  let frontier = [folderId];
  let height = -1;
  while (frontier.length > 0) {
    height += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return height;
}

export type FolderMoveCheck =
  | { ok: true }
  | { ok: false; reason: "same-place" | "into-itself" | "too-deep" | "name-taken" };

/**
 * Whether `folderId` may move under `targetParentId` (null = root): not into
 * itself or anything below it, not deeper than {@link MAX_FOLDER_DEPTH}, and
 * not onto a live sibling with the same name.
 */
export function checkFolderMove(
  folders: readonly FolderNode[],
  folderId: string,
  targetParentId: string | null,
): FolderMoveCheck {
  const folder = folders.find((candidate) => candidate.id === folderId);
  if (!folder) return { ok: false, reason: "into-itself" };
  if (folder.parentId === targetParentId) return { ok: false, reason: "same-place" };
  if (
    targetParentId !== null &&
    (targetParentId === folderId || descendantFolderIds(folders, folderId).has(targetParentId))
  ) {
    return { ok: false, reason: "into-itself" };
  }
  if (folderDepth(folders, targetParentId) + 1 + subtreeHeight(folders, folderId) > MAX_FOLDER_DEPTH) {
    return { ok: false, reason: "too-deep" };
  }
  const clash = folders.some(
    (sibling) =>
      sibling.id !== folderId &&
      sibling.parentId === targetParentId &&
      folderNameKey(sibling.name) === folderNameKey(folder.name),
  );
  if (clash) return { ok: false, reason: "name-taken" };
  return { ok: true };
}

/** Files a camera or OS drops alongside photos that nobody wants uploaded. */
const IGNORED_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export function isIgnoredUploadFile(name: string) {
  const lower = name.toLowerCase();
  return IGNORED_FILE_NAMES.has(lower) || lower.startsWith("._");
}

export type FolderUploadPlan = {
  /** Directories to create, parents before children, as relative paths. */
  directories: string[];
  /** Each file's directory (relative path; "" for the drop target itself). */
  files: { path: string; directory: string }[];
};

/**
 * Turns the relative paths of a dropped directory tree (`DCIM/100CANON/IMG_1.JPG`)
 * into the folders to create and where each file goes. Directory segments go
 * through {@link normalizeFolderName}; a segment that fails (e.g. too long) is
 * truncated or replaced rather than failing the whole drop. Junk files
 * (`.DS_Store`, `Thumbs.db`, `._*`) are skipped.
 */
export function planFolderUpload(paths: readonly string[]): FolderUploadPlan {
  const directories = new Set<string>();
  const files: FolderUploadPlan["files"] = [];

  for (const raw of paths) {
    const segments = raw.split(/[/\\]+/).filter((segment) => segment && segment !== ".");
    const fileName = segments.pop();
    if (!fileName || isIgnoredUploadFile(fileName)) continue;

    const safeSegments = segments
      .map((segment) => {
        const result = normalizeFolderName(segment.slice(0, MAX_FOLDER_NAME_LENGTH));
        return result.ok ? result.name : "Folder";
      })
      .slice(0, MAX_FOLDER_DEPTH - 1);

    for (let length = 1; length <= safeSegments.length; length += 1) {
      directories.add(safeSegments.slice(0, length).join("/"));
    }
    files.push({ path: raw, directory: safeSegments.join("/") });
  }

  return {
    directories: [...directories].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
    ),
    files,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Most items one move may name. */
export const MAX_MOVE_ITEMS = 500;

export type MoveRequest = {
  assetIds: string[];
  folderIds: string[];
  targetFolderId: string | null;
};

/**
 * Validates a move request body: `assetIds`/`folderIds` are optional uuid
 * lists (either may be empty, not both), at most {@link MAX_MOVE_ITEMS} in
 * all, de-duplicated; `targetFolderId` is a uuid or null (the root). Null for
 * anything else, so the route answers 400 before touching the database.
 */
export function parseMoveRequest(body: unknown): MoveRequest | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  const ids = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    const unique = new Set<string>();
    for (const item of value) {
      if (typeof item !== "string" || !uuidPattern.test(item)) return null;
      unique.add(item.toLowerCase());
    }
    return [...unique];
  };

  const assetIds = ids(record.assetIds);
  const folderIds = ids(record.folderIds);
  const target = record.targetFolderId;
  if (!assetIds || !folderIds) return null;
  if (assetIds.length + folderIds.length === 0) return null;
  if (assetIds.length + folderIds.length > MAX_MOVE_ITEMS) return null;
  if (!(target === null || (typeof target === "string" && uuidPattern.test(target)))) return null;

  return { assetIds, folderIds, targetFolderId: target === null ? null : target.toLowerCase() };
}
