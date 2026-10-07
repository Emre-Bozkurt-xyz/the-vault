"use client";

// Client side of quick capture, shared by the Tasks panel's "Add task…" box and
// the command palette's `/task …`: runs the action, then announces the result
// with an Undo, and tells any open task surface to refetch.

import { todayDayKey } from "@/lib/tasks/dates";
import { formatDueLabel } from "@/lib/tasks/dates";
import { dispatchTasksChanged, showWorkspaceToast } from "@/lib/workspace-toast";
import {
  captureTaskAction,
  undoCaptureAction,
  type CaptureTaskResult,
} from "@/server/tasks";

export async function captureTaskFromClient(text: string): Promise<CaptureTaskResult> {
  const today = todayDayKey();
  let result: CaptureTaskResult;

  try {
    result = await captureTaskAction({ today, text });
  } catch {
    result = { ok: false, error: "Could not add the task." };
  }

  if (!result.ok) {
    showWorkspaceToast({ message: result.error, tone: "error" });
    return result;
  }

  const due = result.dueDay
    ? ` · ${formatDueLabel(result.dueDay, today)}${result.dueTime ? ` ${result.dueTime}` : ""}`
    : "";
  const { documentId, line, rawLine } = result;

  dispatchTasksChanged();
  showWorkspaceToast({
    message: `Added to ${result.destination}${due}: ${result.text}`,
    action: {
      label: "Undo",
      run: async () => {
        const undone = await undoCaptureAction({ today: todayDayKey(), documentId, line, rawLine }).catch(
          () => ({ ok: false as const, error: "Could not undo." }),
        );
        dispatchTasksChanged();
        if (!undone.ok) showWorkspaceToast({ message: undone.error, tone: "error" });
      },
    },
  });

  return result;
}
