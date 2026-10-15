"use server";

import { z } from "zod";

import {
  taskDayKeySchema as dayKeySchema,
  taskOperationInputSchema,
  taskUndoSchema,

} from "@/lib/tasks/change-schema";
import { addDaysToDayKey } from "@/lib/tasks/dates";
import { requireActiveUser } from "@/server/authz";
import {
  TaskMovedError,
  applyTaskChange,
  captureTask,
  ensureTaskIndexFresh,
  getInboxDocumentId,
  getTaskDetail,
  listAgendaTasks,
  listCompletedTasks,
  listDocumentTasks,
  listTaskPageData,
  removeCapturedTask,
  runTaskOperation,
  searchTaskTargetDocuments,
  undoTaskOperation,
  type CompletedTask,
  type DocumentTaskSummary,
  type TaskOperationResult,
  type TaskTargetDocument,
  type TaskAgenda,
  type TaskDetail,
  type TaskPageData,
} from "@/server/tasks-data";
import { getUserExtensionSetting } from "@/server/user-settings";
import { listWorkspaceAgendaEvents } from "@/server/extension-agenda";
import type { WorkspaceAgendaEvent } from "@/lib/extension-api/server";

/** How far ahead the sidebar agenda looks, counting today. */
const agendaHorizonDays = 7;

const agendaInputSchema = z.object({
  /** The viewer's local day. The server clock is never the reference. */
  today: dayKeySchema,
});

export type TaskAgendaResult =
  | ({ ok: true; today: string; through: string; inboxDocumentId: string | null; events: WorkspaceAgendaEvent[] } & TaskAgenda)
  | { ok: false; error: string; code?: "moved" };

const captureInputSchema = z.object({
  today: dayKeySchema,
  text: z.string().max(2_000),
  /** A document picked in the capture box; wins over a typed `#Title`. */
  targetDocumentId: z.string().uuid().nullable().optional(),
});

const undoCaptureInputSchema = z.object({
  today: dayKeySchema,
  documentId: z.string().uuid(),
  line: z.number().int().min(0),
  rawLine: z.string().max(20_000),
});

export type CaptureTaskResult =
  | {
      ok: true;
      /** Where the task landed, for the confirmation and for Undo. */
      documentId: string;
      destination: string;
      line: number;
      rawLine: string;
      text: string;
      dueDay: string | null;
      dueTime: string | null;
    }
  | { ok: false; error: string };

async function requireTasksEnabled(userId: string): Promise<boolean> {
  const setting = await getUserExtensionSetting({ userId, extensionId: "vault.tasks" });
  return Boolean(setting?.enabled);
}

async function loadAgenda(userId: string, today: string): Promise<TaskAgendaResult> {
  const through = addDaysToDayKey(today, agendaHorizonDays);
  await ensureTaskIndexFresh(userId);
  const inboxDocumentId = await getInboxDocumentId(userId);
  const [agenda, events] = await Promise.all([
    listAgendaTasks(userId, today, through, inboxDocumentId),
    listWorkspaceAgendaEvents(userId, today, through),
  ]);
  return { ok: true, today, through, inboxDocumentId, events, ...agenda };
}

const disabledResult: TaskAgendaResult = {
  ok: false,
  error: "Tasks is turned off in Settings → Extensions.",
};

/**
 * The sidebar agenda: open tasks due through today + 7 days (including every
 * overdue one), and tasks completed today, from documents the viewer owns.
 * Refreshes the lazy index first.
 */
export async function getTaskAgendaAction(input: unknown): Promise<TaskAgendaResult> {
  const user = await requireActiveUser();
  const parsed = agendaInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid date." };
  }

  if (!(await requireTasksEnabled(user.id))) {
    return disabledResult;
  }

  try {
    return await loadAgenda(user.id, parsed.data.today);
  } catch (error) {
    console.error("Failed to load the task agenda", error);
    return { ok: false, error: "Could not load tasks." };
  }
}

export type TaskOperationActionResult =
  | ({ ok: true } & TaskOperationResult)
  | { ok: false; error: string; code?: "moved" };

/**
 * Every workspace task write: change a field, edit the text, delete, or move
 * one or many tasks (see `runTaskOperation`). Returns counts and, for deletes
 * and moves, the Undo record. Surfaces refetch on the task-change event that
 * follows, so no list is returned. Edit access is checked per document by
 * the collaboration write.
 */
export async function runTaskOperationAction(input: unknown): Promise<TaskOperationActionResult> {
  const user = await requireActiveUser();
  const parsed = taskOperationInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid task change." };
  }

  if (!(await requireTasksEnabled(user.id))) {
    return { ok: false, error: "Tasks is turned off in Settings → Extensions." };
  }

  try {
    return { ok: true, ...(await runTaskOperation(user.id, parsed.data)) };
  } catch (error) {
    if (error instanceof TaskMovedError) {
      return {
        ok: false,
        code: "moved",
        error:
          parsed.data.items.length > 1
            ? "Those tasks changed since the list loaded."
            : "That task changed since the list loaded.",
      };
    }

    console.error("Failed to run a task operation", error);
    const message = error instanceof Error && /cannot edit/.test(error.message) ? error.message : null;
    return { ok: false, error: message ?? collabError(error, "Could not change the task.") };
  }
}

/** Undo for a delete or move from `runTaskOperationAction`. */
export async function undoTaskOperationAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireActiveUser();
  const parsed = taskUndoSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid undo." };
  }

  try {
    await undoTaskOperation(user.id, parsed.data);
    return { ok: true };
  } catch (error) {
    console.error("Failed to undo a task operation", error);
    return { ok: false, error: collabError(error, "Could not undo.") };
  }
}

/** How far back the Tasks page's Done view reaches. */
const completedWindowDays = 30;

export type CompletedTasksResult =
  | { ok: true; today: string; since: string; tasks: CompletedTask[] }
  | { ok: false; error: string };

/** Tasks completed in the last month, newest first, for the Done view. */
export async function getCompletedTasksAction(input: unknown): Promise<CompletedTasksResult> {
  const user = await requireActiveUser();
  const parsed = agendaInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, error: "Invalid date." };
  if (!(await requireTasksEnabled(user.id))) {
    return { ok: false, error: "Tasks is turned off in Settings → Extensions." };
  }

  try {
    await ensureTaskIndexFresh(user.id);
    const since = addDaysToDayKey(parsed.data.today, -completedWindowDays);
    return { ok: true, today: parsed.data.today, since, tasks: await listCompletedTasks(user.id, since) };
  } catch (error) {
    console.error("Failed to load completed tasks", error);
    return { ok: false, error: "Could not load completed tasks." };
  }
}

/** Owned documents matching `query`, for "Move to…" and `#` in the capture box. */
export async function searchTaskTargetsAction(input: unknown): Promise<TaskTargetDocument[]> {
  const user = await requireActiveUser();
  const parsed = z.object({ query: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return [];
  return searchTaskTargetDocuments(user.id, parsed.data.query);
}

const readCheckboxInputSchema = z.object({
  documentId: z.string().uuid(),
  line: z.number().int().min(0),
  rawLine: z.string().max(20_000),
  checked: z.boolean(),
  today: dayKeySchema,
});

/** Read-mode checkbox writes use the live document and its edit permission. */
export async function toggleReadCheckboxAction(input: unknown): Promise<
  | { ok: true; markdown: string }
  | { ok: false; error: string }
> {
  const user = await requireActiveUser();
  const parsed = readCheckboxInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid checkbox change." };

  try {
    const markdown = await applyTaskChange(user.id, {
      ...parsed.data,
      change: { type: "status", status: parsed.data.checked ? "done" : "open" },
      stampDone: await requireTasksEnabled(user.id),
    });
    return { ok: true, markdown };
  } catch (error) {
    if (error instanceof TaskMovedError) {
      return { ok: false, error: "That task changed. Refresh the document and try again." };
    }
    console.error("Failed to toggle a Read-mode task", error);
    return { ok: false, error: collabError(error, "Could not change the task.") };
  }
}

function collabError(error: unknown, fallback: string): string {
  return error instanceof Error && /collaboration/i.test(error.message)
    ? "Could not reach the collaboration server, so nothing was saved."
    : fallback;
}

/**
 * Quick capture: appends a task to the Inbox (created on first use), taking a
 * trailing date from the text ("send invoice friday"). Returns where it landed,
 * for the confirmation and its Undo.
 */
export async function captureTaskAction(input: unknown): Promise<CaptureTaskResult> {
  const user = await requireActiveUser();
  const parsed = captureInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid task." };
  }

  if (!(await requireTasksEnabled(user.id))) {
    return { ok: false, error: disabledResult.ok ? "" : disabledResult.error };
  }

  const { today, text, targetDocumentId } = parsed.data;

  try {
    const captured = await captureTask(user.id, { text, today, targetDocumentId });

    if (!captured) {
      return { ok: false, error: "Type the task first." };
    }

    return {
      ok: true,
      documentId: captured.documentId,
      destination: captured.destination,
      line: captured.lineIndex,
      rawLine: captured.line,
      text: captured.text,
      dueDay: captured.due?.day ?? null,
      dueTime: captured.due?.time ?? null,
    };
  } catch (error) {
    console.error("Failed to capture a task", error);
    return { ok: false, error: collabError(error, "Could not add the task.") };
  }
}

/** Undo for a capture: removes the captured line if it is still unchanged. */
export async function undoCaptureAction(input: unknown): Promise<TaskAgendaResult> {
  const user = await requireActiveUser();
  const parsed = undoCaptureInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid undo." };
  }

  const { today, documentId, line, rawLine } = parsed.data;

  try {
    await removeCapturedTask(user.id, { documentId, line, rawLine });
    return await loadAgenda(user.id, today);
  } catch (error) {
    if (error instanceof TaskMovedError) {
      return { ok: false, code: "moved", error: "That task was already changed, so it was kept." };
    }

    console.error("Failed to undo a capture", error);
    return { ok: false, error: collabError(error, "Could not undo.") };
  }
}

export type TaskPageResult =
  | ({ ok: true; today: string; inboxDocumentId: string | null; events: WorkspaceAgendaEvent[] } & TaskPageData)
  | { ok: false; error: string };

/** Everything the Tasks page shows; it filters and groups client-side. */
export async function getTaskPageAction(input: unknown): Promise<TaskPageResult> {
  const user = await requireActiveUser();
  const parsed = agendaInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid date." };
  }

  if (!(await requireTasksEnabled(user.id))) {
    return { ok: false, error: "Tasks is turned off in Settings → Extensions." };
  }

  try {
    await ensureTaskIndexFresh(user.id);
    const [data, inboxDocumentId, events] = await Promise.all([
      listTaskPageData(user.id, parsed.data.today),
      getInboxDocumentId(user.id),
      listWorkspaceAgendaEvents(user.id, parsed.data.today, addDaysToDayKey(parsed.data.today, 30)),
    ]);
    return { ok: true, today: parsed.data.today, inboxDocumentId, events, ...data };
  } catch (error) {
    console.error("Failed to load the tasks page", error);
    return { ok: false, error: "Could not load tasks." };
  }
}

const taskDetailInputSchema = z.object({
  documentId: z.string().uuid(),
  ordinal: z.number().int().min(0),
});

/** The Tasks page's right-panel detail for one task. */
export async function getTaskDetailAction(input: unknown): Promise<TaskDetail | null> {
  const user = await requireActiveUser();
  const parsed = taskDetailInputSchema.safeParse(input);

  if (!parsed.success || !(await requireTasksEnabled(user.id))) {
    return null;
  }

  return getTaskDetail(user.id, parsed.data.documentId, parsed.data.ordinal);
}

/** A document's own tasks, for its side panel. Null when not readable. */
export async function getDocumentTasksAction(input: unknown): Promise<DocumentTaskSummary[] | null> {
  const user = await requireActiveUser();
  const parsed = z.object({ documentId: z.string().uuid() }).safeParse(input);

  if (!parsed.success || !(await requireTasksEnabled(user.id))) {
    return null;
  }

  return listDocumentTasks(user.id, parsed.data.documentId);
}
