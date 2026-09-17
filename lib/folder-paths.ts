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
