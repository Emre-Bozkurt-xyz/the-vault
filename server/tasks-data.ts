import "server-only";

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { z } from "zod";

import { db } from "@/db";
import { documentTags, documentTaskIndex, documentTasks, documents, tags } from "@/db/schema";
import { withLiveDocumentText } from "@/lib/collab-write";
import { getDocumentAccess } from "@/lib/permissions";
import { parseCapture, type CapturedTask } from "@/lib/tasks/capture";
import { locateTaskLine, planTaskEdit, type TaskChange } from "@/lib/tasks/edit";
import { parseTasks, type TaskStatus } from "@/lib/tasks/parse";
import { createDocumentForUser } from "@/server/documents-data";
import { getUserExtensionSetting, upsertUserExtensionSettings } from "@/server/user-settings";

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
  /** Null only for undated tasks in the Inbox document. */
  dueDay: string | null;
  dueTime: string | null;
  doneDay: string | null;
};

export type TaskAgenda = {
  /**
   * Open or in-progress dated tasks due on or before `through`, oldest first,
   * plus dated tasks completed `today`, so a tick does not make its row vanish,
   * plus the Inbox's undated tasks (last).
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
  inboxDocumentId: string | null = null,
): Promise<TaskAgenda> {
  const owned = and(eq(documents.ownerId, userId), isNull(documents.deletedAt));
  const ownedOpen = and(owned, inArray(documentTasks.status, ["open", "in_progress"]));
  const doneToday = and(owned, eq(documentTasks.status, "done"), eq(documentTasks.doneDay, today));
  const dated = or(
    and(ownedOpen, lte(documentTasks.dueDay, through)),
    and(doneToday, isNotNull(documentTasks.dueDay)),
  );
  // Undated tasks only reach the agenda from the Inbox; anywhere else they
  // are backlog (plan §2), or every old checklist would flood the list.
  const inbox = inboxDocumentId
    ? and(
        eq(documentTasks.documentId, inboxDocumentId),
        isNull(documentTasks.dueDay),
        or(ownedOpen, doneToday),
      )
    : undefined;

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
      .where(inbox ? or(dated, inbox) : dated)
      .orderBy(
        sql`${documentTasks.dueDay} asc nulls last`,
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

  return { tasks: rows, laterCount: later?.value ?? 0 };
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

  await reindexAfterWrite(input.documentId, markdown);
}

/**
 * `vault.tasks` extension settings. Only the Inbox pointer for now; the jsonb
 * column may hold keys this build does not know, which are preserved.
 */
const tasksSettingsSchema = z
  .object({ inboxDocumentId: z.string().uuid().nullable().optional() })
  .passthrough();

async function readTasksSettings(userId: string) {
  const row = await getUserExtensionSetting({ userId, extensionId: "vault.tasks" });
  const parsed = tasksSettingsSchema.safeParse(row?.settings ?? {});
  return parsed.success ? parsed.data : {};
}

async function isUsableInbox(userId: string, documentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.ownerId, userId), isNull(documents.deletedAt)),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The Inbox document's id when it still exists and is still the user's, else
 * null. Never creates one: reading the agenda should not make documents.
 */
export async function getInboxDocumentId(userId: string): Promise<string | null> {
  const { inboxDocumentId } = await readTasksSettings(userId);
  return inboxDocumentId && (await isUsableInbox(userId, inboxDocumentId))
    ? inboxDocumentId
    : null;
}

/**
 * The capture target. Remembered by id, so renaming or moving it is fine; if it
 * was deleted (or is in the Bin, or changed owner) a fresh "Inbox" is created
 * at the root and remembered instead (plan §6.3).
 */
export async function resolveInboxDocument(userId: string): Promise<string> {
  const existing = await getInboxDocumentId(userId);
  if (existing) return existing;

  const { id } = await createDocumentForUser(userId, { title: "Inbox" });
  const settings = await readTasksSettings(userId);

  await upsertUserExtensionSettings({
    userId,
    extensionId: "vault.tasks",
    settings: { ...settings, inboxDocumentId: id },
  });

  return id;
}

export type CaptureResult = CapturedTask & {
  documentId: string;
  /** 0-based line the task landed on; with `line`, what Undo needs. */
  lineIndex: number;
};

/**
 * Appends one task line to the Inbox through the collaboration layer (so it
 * merges with the Inbox if it is open), then reindexes from the returned text.
 * Null when the input holds no task text.
 */
export async function captureTask(
  userId: string,
  input: { text: string; today: string },
): Promise<CaptureResult | null> {
  const captured = parseCapture(input.text, input.today);
  if (!captured) return null;

  const documentId = await resolveInboxDocument(userId);
  let lineIndex = 0;

  const { markdown } = await withLiveDocumentText(
    userId,
    documentId,
    (ytext) => {
      const current = ytext.toString();
      const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
      // Lines before the insertion point, counting the separator's new line.
      lineIndex = current.length === 0 ? 0 : current.split("\n").length - (separator ? 0 : 1);
      ytext.insert(current.length, `${separator}${captured.line}\n`);
    },
    { origin: "tasks", restorePoint: false },
  );

  await reindexAfterWrite(documentId, markdown);
  return { ...captured, documentId, lineIndex };
}

/** Undo for a capture: removes that line, if it is still exactly there. */
export async function removeCapturedTask(
  userId: string,
  input: { documentId: string; line: number; rawLine: string },
): Promise<void> {
  const { markdown } = await withLiveDocumentText(
    userId,
    input.documentId,
    (ytext) => {
      const text = ytext.toString();
      const located = locateTaskLine(text, input.line, input.rawLine);
      if (!located) throw new TaskMovedError();

      const end = text.indexOf("\n", located.offset);
      ytext.delete(located.offset, (end === -1 ? text.length : end + 1) - located.offset);
    },
    { origin: "tasks", restorePoint: false },
  );

  await reindexAfterWrite(input.documentId, markdown);
}

async function reindexAfterWrite(documentId: string, markdown: string) {
  const [row] = await db
    .select({ updatedAt: sql<string>`${documents.updatedAt}::text` })
    .from(documents)
    .where(eq(documents.id, documentId));

  if (row) {
    await reindexDocumentTasks({ documentId, markdown, sourceUpdatedAt: row.updatedAt });
  }
}

export type PageTask = AgendaTask & {
  folderId: string | null;
  note: string | null;
};

export type TaskPageData = {
  /** Every open or in-progress task (dated or not), plus tasks done today. */
  tasks: PageTask[];
  /** Tag slugs per document, for the tag filter. */
  tagsByDocument: Record<string, string[]>;
  tags: Array<{ slug: string; displayName: string }>;
  /** True when the list hit its ceiling and some tasks are missing. */
  truncated: boolean;
};

/** A page of this size stays responsive to filter client-side. */
const pageTaskLimit = 2000;

/**
 * Everything the Tasks page (slice 5) filters and groups client-side: its
 * Agenda, Week and Month views use the dated tasks, Backlog the undated ones.
 * Personal scope, like the agenda.
 */
export async function listTaskPageData(userId: string, today: string): Promise<TaskPageData> {
  const owned = and(eq(documents.ownerId, userId), isNull(documents.deletedAt));

  const rows = await db
    .select({
      documentId: documentTasks.documentId,
      documentTitle: documents.title,
      folderId: documents.folderId,
      ordinal: documentTasks.ordinal,
      line: documentTasks.line,
      rawLine: documentTasks.rawLine,
      parentOrdinal: documentTasks.parentOrdinal,
      status: documentTasks.status,
      text: documentTasks.text,
      note: documentTasks.note,
      heading: documentTasks.heading,
      dueDay: documentTasks.dueDay,
      dueTime: documentTasks.dueTime,
      doneDay: documentTasks.doneDay,
    })
    .from(documentTasks)
    .innerJoin(documents, eq(documents.id, documentTasks.documentId))
    .where(
      and(
        owned,
        or(
          inArray(documentTasks.status, ["open", "in_progress"]),
          and(eq(documentTasks.status, "done"), eq(documentTasks.doneDay, today)),
        ),
      ),
    )
    .orderBy(
      sql`${documentTasks.dueDay} asc nulls last`,
      sql`${documentTasks.dueTime} asc nulls last`,
      asc(documents.title),
      asc(documentTasks.ordinal),
    )
    .limit(pageTaskLimit + 1);

  const truncated = rows.length > pageTaskLimit;
  const tasks = rows.slice(0, pageTaskLimit);
  const documentIds = [...new Set(tasks.map((task) => task.documentId))];
  const tagRows = documentIds.length
    ? await db
        .select({
          documentId: documentTags.documentId,
          slug: tags.slug,
          displayName: tags.displayName,
        })
        .from(documentTags)
        .innerJoin(tags, eq(tags.id, documentTags.tagId))
        .where(inArray(documentTags.documentId, documentIds))
    : [];

  const tagsByDocument: Record<string, string[]> = {};
  const tagNames = new Map<string, string>();

  for (const row of tagRows) {
    (tagsByDocument[row.documentId] ??= []).push(row.slug);
    tagNames.set(row.slug, row.displayName);
  }

  return {
    tasks,
    tagsByDocument,
    tags: [...tagNames]
      .map(([slug, displayName]) => ({ slug, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    truncated,
  };
}

export type TaskDetail = {
  task: PageTask;
  /** Direct subtasks in any status, for the checklist and progress. */
  subtasks: Array<{
    ordinal: number;
    line: number;
    rawLine: string;
    status: TaskStatus;
    text: string;
    dueDay: string | null;
  }>;
  /** A few source lines around the task, from the last saved text. */
  context: { startLine: number; lines: string[] };
};

/** The right-panel detail for one task, or null when it is not the user's. */
export async function getTaskDetail(
  userId: string,
  documentId: string,
  ordinal: number,
): Promise<TaskDetail | null> {
  const owned = and(
    eq(documents.id, documentId),
    eq(documents.ownerId, userId),
    isNull(documents.deletedAt),
  );

  const [row] = await db
    .select({
      documentId: documentTasks.documentId,
      documentTitle: documents.title,
      folderId: documents.folderId,
      markdown: documents.markdown,
      ordinal: documentTasks.ordinal,
      line: documentTasks.line,
      rawLine: documentTasks.rawLine,
      parentOrdinal: documentTasks.parentOrdinal,
      status: documentTasks.status,
      text: documentTasks.text,
      note: documentTasks.note,
      heading: documentTasks.heading,
      dueDay: documentTasks.dueDay,
      dueTime: documentTasks.dueTime,
      doneDay: documentTasks.doneDay,
    })
    .from(documentTasks)
    .innerJoin(documents, eq(documents.id, documentTasks.documentId))
    .where(and(owned, eq(documentTasks.ordinal, ordinal)))
    .limit(1);

  if (!row) return null;

  const subtasks = await db
    .select({
      ordinal: documentTasks.ordinal,
      line: documentTasks.line,
      rawLine: documentTasks.rawLine,
      status: documentTasks.status,
      text: documentTasks.text,
      dueDay: documentTasks.dueDay,
    })
    .from(documentTasks)
    .where(and(eq(documentTasks.documentId, documentId), eq(documentTasks.parentOrdinal, ordinal)))
    .orderBy(asc(documentTasks.ordinal));

  const { markdown, ...task } = row;
  const lines = markdown.split(/\r?\n/);
  const startLine = Math.max(0, task.line - 2);

  return {
    task,
    subtasks,
    context: { startLine, lines: lines.slice(startLine, task.line + 4) },
  };
}

export type DocumentTaskSummary = {
  line: number;
  rawLine: string;
  status: TaskStatus;
  text: string;
  dueDay: string | null;
  dueTime: string | null;
  parentOrdinal: number | null;
  ordinal: number;
};

/**
 * One document's tasks, parsed from its saved text rather than read from the
 * index: this serves the document's own side panel, for anyone who can read
 * it (shared documents included), and the index only covers owned documents.
 * Null when the viewer cannot read it.
 */
export async function listDocumentTasks(
  userId: string,
  documentId: string,
): Promise<DocumentTaskSummary[] | null> {
  const access = await getDocumentAccess(userId, documentId);
  if (!access.canRead) return null;

  const [row] = await db
    .select({ markdown: documents.markdown })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!row) return null;

  return parseTasks(row.markdown).map((task) => ({
    line: task.line,
    rawLine: task.rawLine,
    status: task.status,
    text: task.text,
    dueDay: task.dueDay,
    dueTime: task.dueTime,
    parentOrdinal: task.parentOrdinal,
    ordinal: task.ordinal,
  }));
}
