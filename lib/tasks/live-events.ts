import { dispatchTasksChanged } from "@/lib/workspace-toast";

/**
 * The browser end of live task sync (docs/24_TASKS_AND_AGENDA_PLAN.md §5.4).
 * One EventSource per tab on `/api/tasks/events`; each notice is re-dispatched
 * as the ordinary "tasks changed" window event every task surface already
 * refetches on, so they need no knowledge of the transport.
 *
 * - Bursts are coalesced into one dispatch (`burstMs`).
 * - While the tab is hidden nothing is dispatched; one dispatch follows when it
 *   is shown again, so a background tab costs no refetches.
 * - After a dropped connection reconnects, one dispatch with no document
 *   covers anything missed in the gap.
 */
const burstMs = 250;

export function connectLiveTaskEvents(): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }

  const source = new EventSource("/api/tasks/events");
  /** Documents changed since the last dispatch; `null` when it is unknown which. */
  let pending: Set<string> | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dropped = false;

  const flush = () => {
    timer = null;
    if (pending === undefined || document.visibilityState === "hidden") return;
    const documentIds = pending;
    pending = undefined;
    dispatchTasksChanged({
      documentId: documentIds && documentIds.size === 1 ? [...documentIds][0] : null,
    });
  };

  const queue = (documentId: string | null) => {
    if (documentId === null || pending === null) pending = null;
    else (pending ??= new Set()).add(documentId);
    if (!timer) timer = setTimeout(flush, burstMs);
  };

  source.addEventListener("tasks", (event) => {
    let documentId: string | null = null;
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { documentId?: unknown };
      if (typeof data.documentId === "string") documentId = data.documentId;
    } catch {
      // A malformed notice still means "something changed".
    }
    queue(documentId);
  });
  source.addEventListener("open", () => {
    if (dropped) queue(null);
    dropped = false;
  });
  source.addEventListener("error", () => {
    // EventSource retries by itself (204 or a closed stream stops it).
    dropped = true;
  });

  const onVisibility = () => {
    if (document.visibilityState === "visible" && pending !== undefined && !timer) flush();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    source.close();
    document.removeEventListener("visibilitychange", onVisibility);
    if (timer) clearTimeout(timer);
  };
}
