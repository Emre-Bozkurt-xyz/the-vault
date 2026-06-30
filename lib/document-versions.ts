import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { documentVersions } from "@/db/schema";

/**
 * Cap on auto-generated `assistant` version snapshots kept per document. Agent
 * tools snapshot the prior state on every mutation for granular undo, so this
 * bounds growth without affecting human-authored versions (manual/collab/restore
 * snapshots are never pruned).
 */
export const maxAssistantVersionsPerDocument = 30;

type DeleteExecutor = Pick<typeof db, "delete">;

/**
 * Deletes `assistant` versions for a document beyond the newest
 * {@link maxAssistantVersionsPerDocument}. Accepts a db or transaction executor
 * so it can run inside the same transaction that created the snapshot.
 */
export async function pruneAssistantVersions(
  executor: DeleteExecutor,
  documentId: string,
  keep: number = maxAssistantVersionsPerDocument,
): Promise<void> {
  await executor.delete(documentVersions).where(
    and(
      eq(documentVersions.documentId, documentId),
      eq(documentVersions.reason, "assistant"),
      sql`${documentVersions.id} not in (
        select id from ${documentVersions}
        where ${documentVersions.documentId} = ${documentId}
          and ${documentVersions.reason} = 'assistant'
        order by ${documentVersions.createdAt} desc
        limit ${keep}
      )`,
    ),
  );
}
