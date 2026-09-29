import "server-only";

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { documentTaskIndex, documentTasks, documents } from "@/db/schema";
import { withLiveDocumentText } from "@/lib/collab-write";
import { locateTaskLine, planTaskEdit, type TaskChange } from "@/lib/tasks/edit";
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
  doneDay: string | null;
};

export type TaskAgenda = {
  /**
   * Open or in-progress dated tasks due on or before `through`, oldest first,
   * plus dated tasks completed `today`, so a tick does not make its row vanish.
   */
  tasks: AgendaTask[];
  /** Open dated tasks due after `through`. */
  laterCount: number;
};

/** Enough for a sidebar; the Tasks page (slice 5) will page properly. */
const agendaLimit = 300;

/**
 * Open and in-progress tasks with a due day up to and including `through`,
 * from documents `userId` owns, plus dated tasks completed on `today`. Overdue
 * tasks are included however old: the caller buckets them against the viewer's
 * own "today".
 */
export async function listAgendaTasks(
  userId: string,
  today: string,
  through: string,
): Promise<TaskAgenda> {
  const owned = and(eq(documents.ownerId, userId), isNull(documents.deletedAt));
  const ownedOpen = and(owned, inArray(documentTasks.status, ["open", "in_progress"]));
  const doneToday = and(
    owned,
    eq(documentTasks.status, "done"),
    eq(documentTasks.doneDay, today),
    isNotNull(documentTasks.dueDay),
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
        doneDay: documentTasks.doneDay,
      })
      .from(documentTasks)
      .innerJoin(documents, eq(documents.id, documentTasks.documentId))
      .where(or(and(ownedOpen, lte(documentTasks.dueDay, through)), doneToday))
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
    // Both branches of the filter exclude undated rows.
    tasks: rows.map((row) => ({ ...row, dueDay: row.dueDay as string })),
    laterCount: later?.value ?? 0,
  };
}

/** The task's line is gone, changed, or ambiguous since the caller last read it. */
export class TaskMovedError extends Error {
  constructor() {
    super("This task changed since the list was loaded.");
    this.name = "TaskMovedError";
  }
}

/**
 * Applies one task change to the live document through the collaboration
 * layer (so it merges with anyone editing), then reindexes the document from
 * the text that write produced.
 *
 * The write records no restore point: a checkbox tick is not worth one, and the
 * collab server's own threshold versioning still applies. Reindexing from the
 * returned text matters because `documents.markdown` only catches up when the
 * collab server's debounced store runs; a refetch before then would otherwise
 * read the old line and revert the tick. The stamp stays at the document's
 * current `updated_at`, so that store triggers one more reindex from the same
 * text.
 */
export async function applyTaskChange(
  userId: string,
  input: {
    documentId: string;
    line: number;
    rawLine: string;
    change: TaskChange;
    today: string;
  },
): Promise<void> {
  const { markdown } = await withLiveDocumentText(
    userId,
    input.documentId,
    (ytext) => {
      const text = ytext.toString();
      const located = locateTaskLine(text, input.line, input.rawLine);

      if (!located) throw new TaskMovedError();

      const lineText = (text.slice(located.offset).split("\n")[0] ?? "").replace(/\r$/, "");
      const edits = planTaskEdit(lineText, input.change, input.today);

      if (!edits) throw new TaskMovedError();

      // Edits arrive last-first, so earlier offsets stay valid as each applies.
      for (const edit of edits) {
        const at = located.offset + edit.from;
        if (edit.to > edit.from) ytext.delete(at, edit.to - edit.from);
        if (edit.insert) ytext.insert(at, edit.insert);
      }
    },
    { origin: "tasks", restorePoint: false },
  );

  const [row] = await db
    .select({ updatedAt: sql<string>`${documents.updatedAt}::text` })
    .from(documents)
    .where(eq(documents.id, input.documentId));

  if (row) {
    await reindexDocumentTasks({
      documentId: input.documentId,
      markdown,
      sourceUpdatedAt: row.updatedAt,
    });
  }
}
