"use server";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { documents, folderPermissions, folders, users } from "@/db/schema";
import { canEditDocument, canEditFolderContents } from "@/lib/permissions";
import { requireActiveUser } from "@/server/authz";
import { listFriendsForUser } from "@/server/friends";

const folderIdSchema = z.string().uuid();
const folderNameSchema = z.string().trim().min(1, "Name is required").max(120);
const folderShareSchema = z.object({
  folderId: folderIdSchema,
  userId: z.string().uuid().optional().or(z.literal("")),
  query: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.enum(["viewer", "editor"]),
});
const folderCollaboratorSchema = z.object({
  folderId: folderIdSchema,
  userId: z.string().uuid(),
});
const updateFolderCollaboratorSchema = folderCollaboratorSchema.extend({
  role: z.enum(["viewer", "editor"]),
});
const optionalFolderIdSchema = z
  .union([folderIdSchema, z.literal(""), z.null(), z.undefined()])
  .transform((value) => (value ? value : null));

function revalidateWorkspace() {
  // The folder tree lives in the workspace layout, which wraps every workspace
  // route, so revalidate the whole layout to refresh the sidebar everywhere.
  revalidatePath("/", "layout");
}

export async function listFoldersForUser(userId: string) {
  return db
    .select({
      id: folders.id,
      name: folders.name,
      parentId: folders.parentId,
      sortOrder: folders.sortOrder,
    })
    .from(folders)
    .where(and(eq(folders.ownerId, userId), isNull(folders.deletedAt)))
    .orderBy(asc(folders.sortOrder), asc(folders.name));
}

/**
 * Folders a user can reach through a folder share: every folder directly shared
 * with them plus all descendants, annotated with the folder owner. The client
 * renders these as a navigable read-only tree under "Shared with me", treating a
 * folder whose parent is not itself accessible as a top-level entry.
 */
export async function listSharedFoldersForUser(userId: string) {
  const rows = await db.execute<{
    id: string;
    name: string;
    parentId: string | null;
    ownerId: string;
    ownerName: string | null;
    ownerUsername: string | null;
    rank: number;
  }>(sql`
    with recursive accessible as (
      select
        f.id, f.parent_id, f.name, f.owner_id,
        case when fp.role = 'editor' then 2 else 1 end as rank
      from ${folders} f
      join ${folderPermissions} fp
        on fp.folder_id = f.id and fp.user_id = ${userId}
      where f.deleted_at is null
      union all
      select c.id, c.parent_id, c.name, c.owner_id, a.rank
      from ${folders} c
      join accessible a on c.parent_id = a.id
      where c.deleted_at is null
    )
    select
      a.id as "id",
      a.name as "name",
      a.parent_id as "parentId",
      a.owner_id as "ownerId",
      u.name as "ownerName",
      u.username as "ownerUsername",
      max(a.rank) as "rank"
    from accessible a
    join ${users} u on u.id = a.owner_id
    group by a.id, a.name, a.parent_id, a.owner_id, u.name, u.username
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    ownerUsername: row.ownerUsername,
    role: (Number(row.rank) >= 2 ? "editor" : "viewer") as "editor" | "viewer",
  }));
}

/** Ensures the folder exists, is live, and is owned by the user. */
async function requireOwnedFolder(userId: string, folderId: string) {
  const [folder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.ownerId, userId),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);

  if (!folder) {
    notFound();
  }

  return folder;
}

export async function createFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const name = folderNameSchema.parse(formData.get("name"));
  const parentId = optionalFolderIdSchema.parse(formData.get("parentId"));

  if (parentId) {
    await requireOwnedFolder(user.id, parentId);
  }

  await db.insert(folders).values({
    ownerId: user.id,
    parentId,
    name,
  });

  revalidateWorkspace();
}

export async function renameFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const folderId = folderIdSchema.parse(formData.get("folderId"));
  const name = folderNameSchema.parse(formData.get("name"));

  await requireOwnedFolder(user.id, folderId);

  await db
    .update(folders)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(folders.id, folderId), eq(folders.ownerId, user.id)));

  revalidateWorkspace();
}

export async function deleteFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const folderId = folderIdSchema.parse(formData.get("folderId"));

  await requireOwnedFolder(user.id, folderId);

  // Soft-delete the folder and its whole subtree, and unfile any documents that
  // lived inside it (rather than deleting them) so nothing is lost.
  const subtree = await collectFolderSubtree(user.id, folderId);

  if (subtree.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ folderId: null, updatedAt: sql`now()` })
      .where(inArray(documents.folderId, subtree));

    await tx
      .update(folders)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(inArray(folders.id, subtree), isNull(folders.deletedAt)));
  });

  revalidateWorkspace();
}

export async function moveFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const folderId = folderIdSchema.parse(formData.get("folderId"));
  const parentId = optionalFolderIdSchema.parse(formData.get("parentId"));

  await requireOwnedFolder(user.id, folderId);

  if (parentId) {
    await requireOwnedFolder(user.id, parentId);

    // Prevent cycles: the new parent cannot be the folder itself or any of its
    // descendants.
    const subtree = await collectFolderSubtree(user.id, folderId);

    if (subtree.includes(parentId)) {
      notFound();
    }
  }

  await db
    .update(folders)
    .set({ parentId, updatedAt: sql`now()` })
    .where(and(eq(folders.id, folderId), eq(folders.ownerId, user.id)));

  revalidateWorkspace();
}

export async function moveDocumentToFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const documentId = folderIdSchema.parse(formData.get("documentId"));
  const folderId = optionalFolderIdSchema.parse(formData.get("folderId"));

  if (!(await canEditDocument(user.id, documentId))) {
    notFound();
  }

  // Filing into a folder requires edit rights on that folder (owner or folder
  // editor). Unfiling (folderId null) only needs document edit rights.
  if (folderId && !(await canEditFolderContents(user.id, folderId))) {
    notFound();
  }

  await db
    .update(documents)
    .set({ folderId, updatedAt: sql`now()` })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));

  revalidateWorkspace();
}

export async function shareFolderAction(formData: FormData) {
  const user = await requireActiveUser();
  const input = folderShareSchema.parse({
    folderId: formData.get("folderId"),
    userId: formData.get("userId"),
    query: formData.get("query"),
    role: formData.get("role"),
  });

  // Only the folder owner can share it.
  await requireOwnedFolder(user.id, input.folderId);

  const query = input.query?.trim() ?? "";
  const normalizedQuery = query.toLowerCase().replace(/^@/, "");
  const [targetUser] = input.userId
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    : await db
        .select({ id: users.id })
        .from(users)
        .where(
          or(
            eq(users.email, query.toLowerCase()),
            eq(users.username, normalizedQuery),
          ),
        )
        .limit(1);

  if (!targetUser || targetUser.id === user.id) {
    return;
  }

  await db
    .insert(folderPermissions)
    .values({
      folderId: input.folderId,
      userId: targetUser.id,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [folderPermissions.folderId, folderPermissions.userId],
      set: { role: input.role, updatedAt: sql`now()` },
    });

  revalidateWorkspace();
}

export async function updateFolderCollaboratorRoleAction(formData: FormData) {
  const user = await requireActiveUser();
  const input = updateFolderCollaboratorSchema.parse({
    folderId: formData.get("folderId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  await requireOwnedFolder(user.id, input.folderId);

  await db
    .update(folderPermissions)
    .set({ role: input.role, updatedAt: sql`now()` })
    .where(
      and(
        eq(folderPermissions.folderId, input.folderId),
        eq(folderPermissions.userId, input.userId),
      ),
    );

  revalidateWorkspace();
}

export async function removeFolderCollaboratorAction(formData: FormData) {
  const user = await requireActiveUser();
  const input = folderCollaboratorSchema.parse({
    folderId: formData.get("folderId"),
    userId: formData.get("userId"),
  });

  await requireOwnedFolder(user.id, input.folderId);

  await db
    .delete(folderPermissions)
    .where(
      and(
        eq(folderPermissions.folderId, input.folderId),
        eq(folderPermissions.userId, input.userId),
      ),
    );

  revalidateWorkspace();
}

/**
 * Loads the share state for a folder so the share dialog can populate on open.
 * Returns null when the caller does not own the folder.
 */
export async function getFolderShareData(folderId: string) {
  const user = await requireActiveUser();
  const parsed = folderIdSchema.safeParse(folderId);

  if (!parsed.success) {
    return null;
  }

  const [folder] = await db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(
      and(
        eq(folders.id, parsed.data),
        eq(folders.ownerId, user.id),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);

  if (!folder) {
    return null;
  }

  const [collaborators, friends] = await Promise.all([
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: folderPermissions.role,
      })
      .from(folderPermissions)
      .innerJoin(users, eq(folderPermissions.userId, users.id))
      .where(eq(folderPermissions.folderId, parsed.data))
      .orderBy(users.email),
    listFriendsForUser(user.id),
  ]);

  return {
    folderId: folder.id,
    folderName: folder.name,
    collaborators,
    friends,
  };
}

/**
 * Returns the ids of a folder and all of its descendants (the folder first).
 * Scoped to the owner so the recursion can never escape the user's own tree.
 */
async function collectFolderSubtree(userId: string, folderId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive subtree as (
      select id
      from folders
      where id = ${folderId} and owner_id = ${userId} and deleted_at is null
      union all
      select f.id
      from folders f
      join subtree s on f.parent_id = s.id
      where f.owner_id = ${userId} and f.deleted_at is null
    )
    select id from subtree
  `);

  return rows.map((row) => row.id);
}
