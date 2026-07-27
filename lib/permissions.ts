import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documentPermissions,
  documents,
  groupMembers,
  groups,
  services,
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
      owningGroupId: documents.owningGroupId,
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

  const [[permission], inheritedFolderRole, isGroupMember] = await Promise.all([
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
    isMemberOfGroup(userId, document.owningGroupId),
  ]);

  // A document share grants its role directly; a folder share (or owning an
  // ancestor folder) grants at most editor; group membership (Den embed
  // bridge, docs/DEN_EMBED_BRIDGE.md §C.7) is a third "at most editor"
  // source. Structural rights (share/delete/publish) stay tied to document
  // ownership, never folder membership or group membership — mirroring the
  // folder-inheritance decision below. Because a group doc's `ownerId` is
  // always the owning service's principal (never a human), the owner branch
  // above never fires for a group member: they top out at editor by
  // construction, with no special-casing needed here.
  const directRole = permission?.role ?? null;
  const isDocOwner = directRole === "owner";
  const groupRole: "editor" | null = isGroupMember ? "editor" : null;
  const canEdit =
    directRole === "owner" ||
    directRole === "editor" ||
    inheritedFolderRole === "editor" ||
    groupRole === "editor";
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

/**
 * Whether a user belongs to the *live* group that owns a document (Den embed
 * bridge, docs/DEN_EMBED_BRIDGE.md §C.7). `groupId` is null for documents with
 * no owning group, which always resolves to false without a query.
 *
 * Membership alone is not enough — the grant is also void when the group has
 * been soft-deleted (`groups.deleted_at`, e.g. the chat it mirrors was
 * deleted) or when its owning service has been revoked
 * (`services.revoked_at`). Both are the only mechanisms that exist to turn a
 * whole group's access off at once, so the permission layer has to honor them:
 * `server/services.ts` already filters on both when listing groups for the
 * workspace UI and when resolving a group for the owner-op APIs, and a
 * permission layer that ignored them would leave every former member with
 * editor access to documents the rest of the system treats as gone.
 * A group with no service (`service_id is null`) is a plain user group and has
 * no service to revoke.
 *
 * ⚠️ `scripts/collab-server.mjs` `onAuthenticate` hand-maintains a SQL twin of
 * this exact check for the collab connect-time re-check — including these two
 * conditions. The two must stay in agreement, or a removed group member could
 * keep editing collaboratively past the point this function would deny them.
 */
async function isMemberOfGroup(
  userId: string,
  groupId: string | null,
): Promise<boolean> {
  if (!groupId) {
    return false;
  }

  const [membership] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .leftJoin(services, eq(services.id, groups.serviceId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNull(groups.deletedAt),
        or(isNull(groups.serviceId), isNull(services.revokedAt)),
      ),
    )
    .limit(1);

  return Boolean(membership);
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
