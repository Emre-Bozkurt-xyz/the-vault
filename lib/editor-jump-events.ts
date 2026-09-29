// Client-side bus for "open this document at this line" (the task agenda, and
// later anything else that points into a document). The request is also
// *retained*: the caller usually navigates to the document at the same moment,
// and the editor that mounts there claims the pending jump once its content has
// loaded. A jump is never put in the URL, where it would stick to the tab and
// fire again every time the tab reopened.

export type EditorJump = {
  documentId: string;
  /** 0-based line where the target was last seen. */
  line: number;
  /** Exact source text of that line, used to find it again if it has moved. */
  text?: string;
};

const eventName = "vault:editor-jump";

/** Long enough for a cold document route plus a collaboration sync. */
const retainWindowMs = 15_000;

let pending: (EditorJump & { expiresAt: number }) | null = null;

export function requestEditorJump(jump: EditorJump) {
  if (typeof window === "undefined") {
    return;
  }

  pending = { ...jump, expiresAt: Date.now() + retainWindowMs };
  window.dispatchEvent(new CustomEvent<EditorJump>(eventName, { detail: jump }));
}

/** The retained jump for `documentId`, without claiming it. */
export function peekEditorJump(documentId: string): EditorJump | null {
  if (!pending || pending.documentId !== documentId) {
    return null;
  }

  if (pending.expiresAt < Date.now()) {
    pending = null;
    return null;
  }

  return pending;
}

/** Claims the retained jump for `documentId` once, then forgets it. */
export function consumeEditorJump(documentId: string): EditorJump | null {
  const jump = peekEditorJump(documentId);

  if (jump) {
    pending = null;
  }

  return jump;
}

export function subscribeToEditorJumps(handler: (jump: EditorJump) => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = (event: Event) => {
    handler((event as CustomEvent<EditorJump>).detail);
  };

  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
