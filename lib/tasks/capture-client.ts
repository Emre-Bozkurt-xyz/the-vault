"use client";

// Client side of quick capture, shared by every "Add task…" box, the quick-add
// dialog and the command palette's `/task …`: runs the action, announces the
// result with an Undo, and tells any open task surface to refetch.

import { todayDayKey } from "@/lib/tasks/dates";
import { formatDueLabel } from "@/lib/tasks/dates";
import { dispatchTasksChanged, showWorkspaceToast } from "@/lib/workspace-toast";
import {
  captureTaskAction,
  undoCaptureAction,
  type CaptureTaskResult,
} from "@/server/tasks";

export async function captureTaskFromClient(
  text: string,
  options: { targetDocumentId?: string | null } = {},
): Promise<CaptureTaskResult> {
  const today = todayDayKey();
  let result: CaptureTaskResult;

  try {
    result = await captureTaskAction({ today, text, targetDocumentId: options.targetDocumentId ?? null });
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

  dispatchTasksChanged({ documentId });
  showWorkspaceToast({
    message: `Added to ${result.destination}${due}: ${result.text}`,
    action: {
      label: "Undo",
      run: async () => {
        const undone = await undoCaptureAction({ today: todayDayKey(), documentId, line, rawLine }).catch(
          () => ({ ok: false as const, error: "Could not undo." }),
        );
        dispatchTasksChanged({ documentId });
        if (!undone.ok) showWorkspaceToast({ message: undone.error, tone: "error" });
      },
    },
  });

  return result;
}
