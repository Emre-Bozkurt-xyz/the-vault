// Client-side bus for "show this extension item" (the delete warning's link to
// where a sticker uses a file, and anything else that points at an item an
// extension draws). Like editor jumps (`lib/editor-jump-events.ts`) the request
// is also *retained*: the caller usually navigates to the document at the same
// moment, and the extension's layer that mounts there claims it once its state
// has loaded. Never put in the URL, where it would fire again on every reopen.

export type ExtensionRevealRequest = {
  documentId: string;
  extensionId: string;
  /** The extension's own handle for the item (from its `assetIds`). */
  locator: string;
};

const eventName = "vault:extension-reveal";

/** Long enough for a cold document route plus loading extension state. */
const retainWindowMs = 15_000;

let pending: (ExtensionRevealRequest & { expiresAt: number }) | null = null;

export function requestExtensionReveal(request: ExtensionRevealRequest) {
  if (typeof window === "undefined") return;
  pending = { ...request, expiresAt: Date.now() + retainWindowMs };
  window.dispatchEvent(new CustomEvent<ExtensionRevealRequest>(eventName, { detail: request }));
}

/** Claims the retained request for this extension on this document, once. */
export function consumeExtensionReveal(documentId: string, extensionId: string): string | null {
  if (!pending || pending.documentId !== documentId || pending.extensionId !== extensionId) return null;
  if (pending.expiresAt < Date.now()) {
    pending = null;
    return null;
  }
  const { locator } = pending;
  pending = null;
  return locator;
}

export function subscribeToExtensionReveals(handler: (request: ExtensionRevealRequest) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<ExtensionRevealRequest>).detail);
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
