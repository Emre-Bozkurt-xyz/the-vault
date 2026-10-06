import "server-only";

import {
  collectFolderSubtreeIds,
  resolveFolderRef,
} from "@/lib/folder-paths";
import { documentPath } from "@/lib/mcp/workspace-index";
import {
  listDocumentsForUser,
  listDocumentsInOwnedFoldersFromOthersWithBody,
  listSharedDocumentsForUser,
} from "@/server/documents-data";
import {
  listAccessibleFoldersForUser,
  type AccessibleFolder,
} from "@/server/folders-data";

/**
 * How a document reached the user: their own, shared with them (directly or
 * through a folder share), or filed by a collaborator into a folder they own.
 */
export type WorkspaceDocumentSource = "owned" | "shared" | "in_your_folder";

export type WorkspaceDocument = {
  id: string;
  title: string;
  markdown: string;
  folderId: string | null;
  /** Folder display path, or null at the root / when the folder is not visible. */
  folderPath: string | null;
  /** `folderPath/title`, the address an agent should show and reason with. */
  path: string;
  source: WorkspaceDocumentSource;
  role: "owner" | "editor" | "viewer";
  ownerUsername: string | null;
  visibility: string;
  updatedAt: Date;
};

export type WorkspaceSnapshot = {
  folders: AccessibleFolder[];
  documents: WorkspaceDocument[];
};

/**
 * Everything the user can read, with folder paths resolved, for the MCP read
 * tools. One snapshot per tool call: listing, searching, and folder filtering
 * all work in memory over it, the same scale assumption the original
 * `search_documents` made.
 */
export async function loadWorkspaceSnapshot(
  userId: string,
): Promise<WorkspaceSnapshot> {
  const [folders, owned, shared, foreign] = await Promise.all([
    listAccessibleFoldersForUser(userId),
    listDocumentsForUser(userId),
    listSharedDocumentsForUser(userId),
    listDocumentsInOwnedFoldersFromOthersWithBody(userId),
  ]);
  const folderPaths = new Map(folders.map((folder) => [folder.id, folder.path]));
  const seen = new Set<string>();
  const documents: WorkspaceDocument[] = [];

  const add = (
    row: {
      id: string;
      title: string;
      markdown: string;
      folderId: string | null;
      visibility: string;
      updatedAt: Date;
    },
    extra: Pick<WorkspaceDocument, "source" | "role" | "ownerUsername">,
  ) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);

    const folderPath = row.folderId ? (folderPaths.get(row.folderId) ?? null) : null;

    documents.push({
      id: row.id,
      title: row.title,
      markdown: row.markdown,
      folderId: row.folderId,
      folderPath,
      path: documentPath(folderPath, row.title),
      visibility: row.visibility,
      updatedAt: row.updatedAt,
      ...extra,
    });
  };

  for (const row of owned) {
    add(row, { source: "owned", role: "owner", ownerUsername: null });
  }

  for (const row of shared) {
    add(row, {
      source: "shared",
      role: row.role === "editor" ? "editor" : "viewer",
      ownerUsername: row.ownerUsername,
    });
  }

  for (const row of foreign) {
    add(row, {
      source: "in_your_folder",
      role: "editor",
      ownerUsername: row.ownerUsername,
    });
  }

  documents.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return { folders, documents };
}

/**
 * Resolves a folder id-or-path to the set of folder ids it covers: the folder
 * alone, or (when `recursive`) it plus every visible descendant. Throws a
 * readable error for an unknown or ambiguous reference.
 */
export function resolveFolderScope(
  folders: AccessibleFolder[],
  ref: string,
  recursive: boolean,
): { folder: AccessibleFolder; folderIds: Set<string> } {
  const resolved = resolveFolderRef(folders, ref);

  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  return {
    folder: resolved.folder,
    folderIds: new Set(
      recursive
        ? collectFolderSubtreeIds(folders, resolved.folder.id)
        : [resolved.folder.id],
    ),
  };
}

/**
 * Where a single document sits, for tools that load one document rather than a
 * snapshot: its folder path (null at the root or when not visible) and path.
 */
export async function describeDocumentLocation(
  userId: string,
  document: { title: string; folderId: string | null },
): Promise<{ folderPath: string | null; path: string }> {
  if (!document.folderId) {
    return { folderPath: null, path: document.title };
  }

  const folders = await listAccessibleFoldersForUser(userId);
  const folderPath =
    folders.find((folder) => folder.id === document.folderId)?.path ?? null;

  return { folderPath, path: documentPath(folderPath, document.title) };
}
