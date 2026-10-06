/**
 * Pure folder-path flattening, kept out of `server/` deliberately: everything
 * under `server/` transitively imports `auth.ts`/next-auth, which cannot load
 * under vitest, so pure helpers that deserve tests live in `lib/` (same reason
 * `components/workspace/command-ranking.ts` holds no React imports).
 */

export type FolderPathNode = {
  id: string;
  name: string;
  parentId: string | null;
};

/**
 * Flattens folder rows into `id -> "Parent/Child"` display paths by walking
 * `parentId` in memory. A cycle or a missing ancestor (a shared folder whose
 * parent the user cannot see) simply stops the walk, yielding a shorter path
 * rather than looping forever.
 */
export function buildFolderPaths(
  folders: FolderPathNode[],
): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();

  for (const folder of folders) {
    const segments: string[] = [];
    const seen = new Set<string>();
    let current: FolderPathNode | undefined = folder;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      segments.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    paths.set(folder.id, segments.join("/"));
  }

  return paths;
}

/**
 * Walks a folder's ancestry root-first. Shares `buildFolderPaths`'s containment
 * rule: a cycle or an ancestor the caller cannot see ends the walk, so the
 * result is always the visible suffix of the real chain rather than a loop or
 * an invented parent.
 */
export function resolveFolderAncestry<TFolder extends FolderPathNode>(
  folders: TFolder[],
  folderId: string | null | undefined,
): TFolder[] {
  if (!folderId) {
    return [];
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: TFolder[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return chain;
}

/**
 * Maps each document's href to the display path of the folder holding it, for
 * the tab-bar tooltip and the editor breadcrumb. Documents at the vault root,
 * and documents whose folder the caller cannot see (a doc shared directly out
 * of someone else's folder), are simply absent from the map — the UI then shows
 * no path rather than a misleading one.
 */
export function buildDocumentFolderPaths(
  folders: FolderPathNode[],
  documentsInFolders: { href: string; folderId?: string | null }[],
): Map<string, string> {
  const folderPaths = buildFolderPaths(folders);
  const paths = new Map<string, string>();

  for (const document of documentsInFolders) {
    const path = document.folderId
      ? folderPaths.get(document.folderId)
      : undefined;

    if (path) {
      paths.set(document.href.split("?")[0] ?? document.href, path);
    }
  }

  return paths;
}

/**
 * Canonical form of a folder path typed by a person or an agent: segments
 * trimmed, empty segments (doubled, leading, or trailing slashes) dropped, and
 * compared case-insensitively. `"/Courses//CS101/"` and `"courses/cs101"` are
 * the same folder.
 */
export function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/")
    .toLowerCase();
}

export type FolderRefResolution<TFolder> =
  | { ok: true; folder: TFolder }
  | { ok: false; error: string };

/**
 * Resolves a folder reference that may be either a folder id or a display path
 * ("Courses/CS101") against folders the caller can already see. A path that
 * matches two visible folders (an owned and a shared folder with the same
 * name) is refused as ambiguous rather than guessed, and the error names the
 * closest paths so the caller can retry.
 */
export function resolveFolderRef<TFolder extends FolderPathNode>(
  folders: TFolder[],
  ref: string,
): FolderRefResolution<TFolder> {
  const trimmed = ref.trim();
  const byId = folders.find((folder) => folder.id === trimmed);

  if (byId) {
    return { ok: true, folder: byId };
  }

  const wanted = normalizeFolderPath(trimmed);

  if (!wanted) {
    return { ok: false, error: "Folder reference is empty." };
  }

  const paths = buildFolderPaths(folders);
  const matches = folders.filter(
    (folder) => normalizeFolderPath(paths.get(folder.id) ?? folder.name) === wanted,
  );

  if (matches.length === 1) {
    return { ok: true, folder: matches[0]! };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error: `Folder path "${trimmed}" matches ${matches.length} folders; pass a folder id instead (${matches
        .map((folder) => folder.id)
        .join(", ")}).`,
    };
  }

  const leaf = wanted.split("/").pop() ?? wanted;
  const suggestions = folders
    .map((folder) => paths.get(folder.id) ?? folder.name)
    .filter((path) => normalizeFolderPath(path).includes(leaf))
    .sort()
    .slice(0, 5);

  return {
    ok: false,
    error: suggestions.length
      ? `No folder at "${trimmed}". Did you mean: ${suggestions.join(", ")}?`
      : `No folder at "${trimmed}". Use list_folders to see the folder tree.`,
  };
}

/**
 * The ids of `rootId` and every folder beneath it, walking only folders the
 * caller can see (root first). A cycle cannot loop: each id is visited once.
 */
export function collectFolderSubtreeIds(
  folders: FolderPathNode[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();

  for (const folder of folders) {
    if (folder.parentId) {
      const siblings = children.get(folder.parentId) ?? [];
      siblings.push(folder.id);
      children.set(folder.parentId, siblings);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;

    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }

  return result;
}
