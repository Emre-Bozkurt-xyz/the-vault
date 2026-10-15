// A minimal toast bus for the workspace shell: one message at a time, with an
// optional action (e.g. "Undo"). Dispatched from anywhere on the client and
// rendered by `WorkspaceToast`, which lives in the shell so a toast survives
// the command palette closing or a panel unmounting.

export type WorkspaceToastDetail = {
  message: string;
  tone?: "default" | "error";
  action?: { label: string; run: () => void | Promise<void> };
  /** Milliseconds before it hides itself. Defaults to 6s. */
  durationMs?: number;
};

const toastEventName = "vault:toast";
const tasksChangedEventName = "vault:tasks-changed";

export function showWorkspaceToast(detail: WorkspaceToastDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkspaceToastDetail>(toastEventName, { detail }));
}

export function subscribeToWorkspaceToasts(handler: (detail: WorkspaceToastDetail) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<WorkspaceToastDetail>).detail);
  window.addEventListener(toastEventName, listener);
  return () => window.removeEventListener(toastEventName, listener);
}

export type TasksChangedDetail = {
  /** The one document whose tasks changed; null or absent when unknown or several. */
  documentId?: string | null;
};

/**
 * Tells any open task surface to refetch: after a capture, an undo, a write
 * from another surface, or a live notice from the server (`lib/tasks/live-events.ts`).
 */
export function dispatchTasksChanged(detail: TasksChangedDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TasksChangedDetail>(tasksChangedEventName, { detail }));
}

export function subscribeToTasksChanged(handler: (detail: TasksChangedDetail) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) =>
    handler((event instanceof CustomEvent ? (event.detail as TasksChangedDetail | null) : null) ?? {});
  window.addEventListener(tasksChangedEventName, listener);
  return () => window.removeEventListener(tasksChangedEventName, listener);
}
