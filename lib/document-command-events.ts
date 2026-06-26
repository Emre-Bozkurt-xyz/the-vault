// Client-side event bus that lets the command palette trigger UI that lives in
// other components (the share dialog, history section, and the editor). Some of
// these targets are unmounted when the right context panel is collapsed, so a
// dispatched command is also *retained* briefly: the palette opens the panel,
// and the target consumes the pending command when it mounts.

export type DocumentCommandType =
  | "open-share"
  | "open-history"
  | "insert-calendar"
  | "insert-sticker";

const eventName = "vault:document-command";
const openRightPanelEventName = "vault:open-right-panel";

/** How long a dispatched command waits for a just-mounted target to claim it. */
const retainWindowMs = 2000;

let pending: DocumentCommandType | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function clearPending() {
  pending = null;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

export function dispatchDocumentCommand(type: DocumentCommandType) {
  if (typeof window === "undefined") {
    return;
  }

  pending = type;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }
  pendingTimer = setTimeout(clearPending, retainWindowMs);

  window.dispatchEvent(new CustomEvent(eventName, { detail: { type } }));
}

/**
 * Claims a retained command if it matches one of `types` (e.g. the share dialog
 * passes `["open-share"]` from its mount effect). Returns the claimed type once,
 * then forgets it.
 */
export function consumePendingDocumentCommand(
  types: readonly DocumentCommandType[],
): DocumentCommandType | null {
  if (pending && types.includes(pending)) {
    const claimed = pending;
    clearPending();
    return claimed;
  }

  return null;
}

export function subscribeToDocumentCommand(
  listener: (type: DocumentCommandType) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const type = (event.detail as { type?: DocumentCommandType } | undefined)
      ?.type;

    if (type) {
      listener(type);
    }
  };

  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

/** Asks the workspace shell to reveal the (possibly collapsed) right panel. */
export function requestOpenRightPanel() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(openRightPanelEventName));
}

export function subscribeToOpenRightPanel(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => listener();
  window.addEventListener(openRightPanelEventName, handler);
  return () => window.removeEventListener(openRightPanelEventName, handler);
}
