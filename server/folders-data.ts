/**
 * Data access for `@/server/folders`, for callers that have already
 * authenticated the user.
 *
 * These functions take a `userId` and trust it. They live here, in a module with
 * **no** `"use server"` directive, because every export of such a module is
 * registered as a callable server action — and as endpoints their only protection
 * would be that no client bundle happens to contain their action id. Never add the
 * directive to this file, and never accept a user id in an action.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { folderPermissions, folders, users } from "@/db/schema";

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
