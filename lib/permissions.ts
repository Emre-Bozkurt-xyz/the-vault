import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documentPermissions,
  documents,
  type DocumentRole,
  type FolderRole,
} from "@/db/schema";

export type DocumentAccess = {
  canRead: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  canPublish: boolean;
  role: DocumentRole | null;
};

const noAccess: DocumentAccess = {
  canRead: false,
  canEdit: false,
  canShare: false,
  canDelete: false,
  canPublish: false,
  role: null,
};

export async function getDocumentAccess(
  userId: string | null,
  documentId: string,
): Promise<DocumentAccess> {
  const [document] = await db
    .select({
      ownerId: documents.ownerId,
      visibility: documents.visibility,
      folderId: documents.folderId,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    return noAccess;
  }

  if (document.visibility === "public" && !userId) {
    return {
      ...noAccess,
      canRead: true,
    };
  }

  if (!userId) {
    return noAccess;
  }

  if (document.ownerId === userId) {
    return {
      canRead: true,
      canEdit: true,
      canShare: true,
      canDelete: true,
      canPublish: true,
      role: "owner",
    };
  }

  const [[permission], inheritedFolderRole] = await Promise.all([
    db
      .select({ role: documentPermissions.role })
      .from(documentPermissions)
      .where(
        and(
          eq(documentPermissions.documentId, documentId),
          eq(documentPermissions.userId, userId),
        ),
      )
      .limit(1),
    getInheritedFolderRole(userId, document.folderId),
  ]);

  // A document share grants its role directly; a folder share (or owning an
  // ancestor folder) grants at most editor — structural rights (share/delete/
  // publish) stay tied to document ownership, never folder membership.
  const directRole = permission?.role ?? null;
  const isDocOwner = directRole === "owner";
  const canEdit =
    directRole === "owner" ||
    directRole === "editor" ||
    inheritedFolderRole === "editor";
  const canRead =
    canEdit ||
    directRole === "viewer" ||
    inheritedFolderRole === "viewer" ||
    document.visibility === "public";

  if (!canRead) {
    return noAccess;
  }

  return {
    canRead: true,
    canEdit,
    canShare: isDocOwner,
    canDelete: isDocOwner,
    canPublish: isDocOwner,
    role: isDocOwner ? "owner" : canEdit ? "editor" : "viewer",
  };
}

/**
 * Resolves the effective folder-inherited role for a user on the folder a
 * document lives in, walking the full ancestor chain. Owning any ancestor
 * folder, or holding a folder permission on any ancestor, grants access to the
 * documents within. Returns the strongest role found (editor beats viewer),
 * or null when the user inherits nothing.
 */
async function getInheritedFolderRole(
  userId: string,
  folderId: string | null,
): Promise<FolderRole | null> {
  if (!folderId) {
    return null;
  }

  const rows = await db.execute<{ owns_any: boolean; perm_rank: number }>(sql`
    with recursive chain as (
      select id, parent_id, owner_id
      from folders
      where id = ${folderId} and deleted_at is null
      union all
      select f.id, f.parent_id, f.owner_id
      from folders f
      join chain c on f.id = c.parent_id
      where f.deleted_at is null
    )
    select
      coalesce(bool_or(chain.owner_id = ${userId}), false) as owns_any,
      coalesce(max(case
        when fp.role = 'editor' then 2
        when fp.role = 'viewer' then 1
        else 0
      end), 0) as perm_rank
    from chain
    left join folder_permissions fp
      on fp.folder_id = chain.id and fp.user_id = ${userId}
  `);

  const result = rows[0];

  if (!result) {
    return null;
  }

  if (result.owns_any || result.perm_rank >= 2) {
    return "editor";
  }

  if (result.perm_rank >= 1) {
    return "viewer";
  }

  return null;
}

export async function canReadDocument(userId: string | null, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canRead;
}

/**
 * Whether a user may add, remove, or create documents inside a folder. True for
 * the folder owner and for anyone with an editor share on the folder or any
 * ancestor; folder viewers cannot manage contents.
 */
export async function canEditFolderContents(
  userId: string,
  folderId: string,
): Promise<boolean> {
  return (await getInheritedFolderRole(userId, folderId)) === "editor";
}

export async function canEditDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canEdit;
}

export async function canShareDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canShare;
}

export async function canDeleteDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canDelete;
}

export async function canPublishDocument(userId: string, documentId: string) {
  return (await getDocumentAccess(userId, documentId)).canPublish;
}
