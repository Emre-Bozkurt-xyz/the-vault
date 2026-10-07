"use server";

import { z } from "zod";

import { parseRecurrence } from "@/lib/tasks/recurrence";
import { addDaysToDayKey, isValidDayKey } from "@/lib/tasks/dates";
import { TASK_PRIORITIES, TASK_TIME_PATTERN } from "@/lib/tasks/parse";
import { requireActiveUser } from "@/server/authz";
import {
  TaskMovedError,
  applyTaskChange,
  captureTask,
  ensureTaskIndexFresh,
  getInboxDocumentId,
  getTaskDetail,
  listAgendaTasks,
  listDocumentTasks,
  listTaskPageData,
  removeCapturedTask,
  type DocumentTaskSummary,
  type TaskAgenda,
  type TaskDetail,
  type TaskPageData,
} from "@/server/tasks-data";
import { getUserExtensionSetting } from "@/server/user-settings";
import { listWorkspaceAgendaEvents } from "@/server/extension-agenda";
import type { WorkspaceAgendaEvent } from "@/lib/extension-api/server";

/** How far ahead the sidebar agenda looks, counting today. */
const agendaHorizonDays = 7;

const dayKeySchema = z.string().refine(isValidDayKey, "Must be a real YYYY-MM-DD date.");

const agendaInputSchema = z.object({
  /** The viewer's local day. The server clock is never the reference. */
  today: dayKeySchema,
});

const updateTaskInputSchema = z.object({
  today: dayKeySchema,
  documentId: z.string().uuid(),
  line: z.number().int().min(0),
  rawLine: z.string().max(20_000),
  change: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("status"),
      status: z.enum(["open", "in_progress", "done", "cancelled"]),
    }),
    z.object({
      type: z.literal("due"),
      day: dayKeySchema.nullable(),
      time: z.string().regex(TASK_TIME_PATTERN).nullable().optional(),
    }),
    z.object({ type: z.literal("priority"), priority: z.enum(TASK_PRIORITIES).nullable() }),
    z.object({ type: z.literal("repeat"), repeat: z.string().max(40).refine((value) => Boolean(parseRecurrence(value))).nullable() }),
    z.object({ type: z.literal("priority"), priority: z.enum(TASK_PRIORITIES).nullable() }),
    z.object({ type: z.literal("repeat"), repeat: z.string().max(40).refine((value) => Boolean(parseRecurrence(value))).nullable() }),
  ]),
});

export type TaskAgendaResult =
  | ({ ok: true; today: string; through: string; inboxDocumentId: string | null; events: WorkspaceAgendaEvent[] } & TaskAgenda)
  | { ok: false; error: string; code?: "moved" };

const captureInputSchema = z.object({
  today: dayKeySchema,
  text: z.string().max(2_000),
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
      agenda: TaskAgendaResult;
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

/**
 * Changes one task's status or due date in its source document and returns the
 * refreshed agenda. The task is addressed by line + exact text (index row ids
 * are not stable); a task that moved or changed since the caller's read yields
 * `code: "moved"` rather than an edit to the wrong line. Edit access is checked
 * by the collaboration write itself.
 */
export async function updateTaskAction(input: unknown): Promise<TaskAgendaResult> {
  const user = await requireActiveUser();
  const parsed = updateTaskInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid task change." };
  }

  if (!(await requireTasksEnabled(user.id))) {
    return disabledResult;
  }

  const { today, documentId, line, rawLine, change } = parsed.data;

  try {
    await applyTaskChange(user.id, { documentId, line, rawLine, change, today });
  } catch (error) {
    if (error instanceof TaskMovedError) {
      return { ok: false, code: "moved", error: "That task changed since the list loaded." };
    }

    console.error("Failed to update a task", error);
    return { ok: false, error: collabError(error, "Could not change the task.") };
  }

  try {
    return await loadAgenda(user.id, today);
  } catch (error) {
    console.error("Failed to reload the task agenda", error);
    return { ok: false, error: "The task changed, but the list could not reload." };
  }
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
 * for the confirmation and its Undo, plus the refreshed agenda.
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

  const { today, text } = parsed.data;

  try {
    const captured = await captureTask(user.id, { text, today });

    if (!captured) {
      return { ok: false, error: "Type the task first." };
    }

    return {
      ok: true,
      agenda: await loadAgenda(user.id, today),
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
