/**
 * Opens the New document dialog (`NewDocumentDialog`, mounted once in the
 * workspace chrome) from anywhere: the Files panel, a folder's menu, the
 * command palette, the new tab page.
 */
const newDocumentEvent = "vault:new-document";

export type NewDocumentRequest = {
  /** The folder to suggest; the user can change it. */
  folderId?: string | null;
};

export function openNewDocumentDialog(request: NewDocumentRequest = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NewDocumentRequest>(newDocumentEvent, { detail: request }));
}

let mountedDialogs = 0;

/** Whether a dialog is listening (pages outside the workspace chrome have none). */
export function hasNewDocumentDialog() {
  return mountedDialogs > 0;
}

export function subscribeToNewDocumentRequests(handler: (request: NewDocumentRequest) => void) {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => handler((event as CustomEvent<NewDocumentRequest>).detail ?? {});
  window.addEventListener(newDocumentEvent, listener);
  mountedDialogs += 1;
  return () => {
    window.removeEventListener(newDocumentEvent, listener);
    mountedDialogs -= 1;
  };
}
