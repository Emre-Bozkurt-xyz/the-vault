import "server-only";

import { and, asc, count, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { documentTaskIndex, documentTasks, documents } from "@/db/schema";
import { parseTasks, type TaskStatus } from "@/lib/tasks/parse";

/**
 * The task index behind every agenda surface (docs/23_TASKS_AND_AGENDA_PLAN.md
 * §4). Tasks are Markdown lines; `document_tasks` is a disposable projection of
 * them, refreshed lazily on read rather than on save — saves mostly happen in
 * `scripts/collab-server.mjs`, a plain-JS process that could only index with a
 * second copy of the parser.
 *
 * Scope is personal: only documents the user owns, and not in the Bin.
 */

type Executor = Pick<typeof db, "select" | "delete" | "insert" | "execute">;

/** Documents reindexed per query batch, bounding how much Markdown is loaded at once. */
const reindexBatchSize = 25;

/**
 * Reparses every owned document whose `updated_at` moved past its index stamp
 * (or that was never indexed). Costs one comparison query when nothing changed.
 */
export async function ensureTaskIndexFresh(userId: string): Promise<void> {
  const stale = await db
    .select({ id: documents.id })
    .from(documents)
    .leftJoin(documentTaskIndex, eq(documentTaskIndex.documentId, documents.id))
    .where(
      and(
        eq(documents.ownerId, userId),
        isNull(documents.deletedAt),
        or(
          isNull(documentTaskIndex.documentId),
          lt(documentTaskIndex.sourceUpdatedAt, documents.updatedAt),
        ),
      ),
    );

  for (let start = 0; start < stale.length; start += reindexBatchSize) {
    const ids = stale.slice(start, start + reindexBatchSize).map((row) => row.id);
    const rows = await db
      .select({
        id: documents.id,
        markdown: documents.markdown,
        // Kept as text: a JS Date drops Postgres's microseconds, so a stamp
        // round-tripped through one would always look older than `updated_at`
        // and every read would reindex everything.
        updatedAt: sql<string>`${documents.updatedAt}::text`,
      })
      .from(documents)
      .where(inArray(documents.id, ids));

    for (const row of rows) {
      await reindexDocumentTasks({
        documentId: row.id,
        markdown: row.markdown,
        sourceUpdatedAt: row.updatedAt,
      });
    }
  }
}

/**
 * Replaces one document's task rows from `markdown` and stamps it as fresh as
 * of `sourceUpdatedAt` (a Postgres timestamptz literal). A per-document advisory
 * lock keeps two concurrent reads from interleaving delete and insert; a newer
 * stamp already in place wins, so a slow reindex of older text cannot overwrite
 * a faster one of newer text.
 */
export async function reindexDocumentTasks(input: {
  documentId: string;
  markdown: string;
  sourceUpdatedAt: string;
}): Promise<void> {
  const tasks = parseTasks(input.markdown);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`document_tasks:${input.documentId}`}))`,
    );

    const [current] = await tx
      .select({
        newer: sql<boolean>`${documentTaskIndex.sourceUpdatedAt} > ${input.sourceUpdatedAt}::timestamptz`,
      })
      .from(documentTaskIndex)
      .where(eq(documentTaskIndex.documentId, input.documentId));

    if (current?.newer) {
      return;
    }

    await writeTaskRows(tx, input.documentId, tasks);

    await tx
      .insert(documentTaskIndex)
      .values({
        documentId: input.documentId,
        sourceUpdatedAt: sql`${input.sourceUpdatedAt}::timestamptz`,
      })
      .onConflictDoUpdate({
        target: documentTaskIndex.documentId,
        set: {
          sourceUpdatedAt: sql`${input.sourceUpdatedAt}::timestamptz`,
          indexedAt: sql`now()`,
        },
      });
  });
}

async function writeTaskRows(
  executor: Executor,
  documentId: string,
  tasks: ReturnType<typeof parseTasks>,
) {
  await executor.delete(documentTasks).where(eq(documentTasks.documentId, documentId));

  if (tasks.length === 0) {
    return;
  }

  // 13 columns per row keeps a full 2,000-task document well under Postgres's
  // 65,535 bind-parameter limit in one statement.
  await executor.insert(documentTasks).values(
    tasks.map((task) => ({
      documentId,
      ordinal: task.ordinal,
      line: task.line,
      rawLine: task.rawLine,
      parentOrdinal: task.parentOrdinal,
      status: task.status,
      text: task.text,
      note: task.note,
      heading: task.heading,
      dueDay: task.dueDay,
      dueTime: task.dueTime,
      doneDay: task.doneDay,
    })),
  );
}

export type AgendaTask = {
  documentId: string;
  documentTitle: string;
  ordinal: number;
  line: number;
  rawLine: string;
  parentOrdinal: number | null;
  status: TaskStatus;
  text: string;
  heading: string | null;
  dueDay: string;
  dueTime: string | null;
};

export type TaskAgenda = {
  /** Open or in-progress dated tasks due on or before `through`, oldest first. */
  tasks: AgendaTask[];
  /** Open dated tasks due after `through`. */
  laterCount: number;
};

/** Enough for a sidebar; the Tasks page (slice 5) will page properly. */
const agendaLimit = 300;

/**
 * Open and in-progress tasks with a due day up to and including `through`,
 * from documents `userId` owns. Overdue tasks are included however old: the
 * caller buckets them against the viewer's own "today".
 */
export async function listAgendaTasks(
  userId: string,
  through: string,
): Promise<TaskAgenda> {
  const ownedOpen = and(
    eq(documents.ownerId, userId),
    isNull(documents.deletedAt),
    inArray(documentTasks.status, ["open", "in_progress"]),
  );

  const [rows, [later]] = await Promise.all([
    db
      .select({
        documentId: documentTasks.documentId,
        documentTitle: documents.title,
        ordinal: documentTasks.ordinal,
        line: documentTasks.line,
        rawLine: documentTasks.rawLine,
        parentOrdinal: documentTasks.parentOrdinal,
        status: documentTasks.status,
        text: documentTasks.text,
        heading: documentTasks.heading,
        dueDay: documentTasks.dueDay,
        dueTime: documentTasks.dueTime,
      })
      .from(documentTasks)
      .innerJoin(documents, eq(documents.id, documentTasks.documentId))
      .where(and(ownedOpen, lte(documentTasks.dueDay, through)))
      .orderBy(
        asc(documentTasks.dueDay),
        sql`${documentTasks.dueTime} asc nulls last`,
        asc(documents.title),
        asc(documentTasks.ordinal),
      )
      .limit(agendaLimit),
    db
      .select({ value: count() })
      .from(documentTasks)
      .innerJoin(documents, eq(documents.id, documentTasks.documentId))
      .where(and(ownedOpen, gt(documentTasks.dueDay, through))),
  ]);

  return {
    // `lte` on the due day already excludes undated rows.
    tasks: rows.map((row) => ({ ...row, dueDay: row.dueDay as string })),
    laterCount: later?.value ?? 0,
  };
}
