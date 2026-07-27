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
