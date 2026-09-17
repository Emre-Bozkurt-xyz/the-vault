import type { WorkspaceDocumentItem } from "@/components/workspace/workspace-types";

export const workspaceDocumentChangedEvent = "vault:workspace-document-changed";
export const workspaceDocumentRemovedEvent = "vault:workspace-document-removed";

export type WorkspaceDocumentChangedDetail = Partial<
  Omit<WorkspaceDocumentItem, "updatedAt">
> & {
  id: string;
  updatedAt?: string;
};

export function dispatchWorkspaceDocumentChanged(
  detail: WorkspaceDocumentChangedDetail,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(workspaceDocumentChangedEvent, { detail }),
  );
}

export function subscribeToWorkspaceDocumentChanges(
  listener: (detail: WorkspaceDocumentChangedDetail) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = event.detail as WorkspaceDocumentChangedDetail | undefined;

    if (!detail?.id) {
      return;
    }

    listener(detail);
  };

  window.addEventListener(workspaceDocumentChangedEvent, handler);

  return () => {
    window.removeEventListener(workspaceDocumentChangedEvent, handler);
  };
}

export type WorkspaceDocumentRemovedDetail = {
  id: string;
};

export function dispatchWorkspaceDocumentRemoved(
  detail: WorkspaceDocumentRemovedDetail,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(workspaceDocumentRemovedEvent, { detail }),
  );
}

export function subscribeToWorkspaceDocumentRemovals(
  listener: (detail: WorkspaceDocumentRemovedDetail) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = event.detail as WorkspaceDocumentRemovedDetail | undefined;

    if (!detail?.id) {
      return;
    }

    listener(detail);
  };

  window.addEventListener(workspaceDocumentRemovedEvent, handler);

  return () => {
    window.removeEventListener(workspaceDocumentRemovedEvent, handler);
  };
}

export const workspaceTabOpenedEvent = "vault:workspace-tab-opened";

export type WorkspaceTabOpenedDetail = {
  href: string;
  title: string;
};

/**
 * Asks the tab strip to open a tab **without navigating to it**.
 *
 * `/def` is the reason this exists: it creates a definition document while the
 * author is mid-sentence, and moving the viewport to a blank document to name a
 * term costs more than it saves. The stub waits in the strip instead.
 */
export function dispatchWorkspaceOpenTab(detail: WorkspaceTabOpenedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(workspaceTabOpenedEvent, { detail }));
}

export function subscribeToWorkspaceTabOpened(
  listener: (detail: WorkspaceTabOpenedDetail) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = event.detail as WorkspaceTabOpenedDetail | undefined;

    if (!detail?.href) {
      return;
    }

    listener(detail);
  };

  window.addEventListener(workspaceTabOpenedEvent, handler);

  return () => {
    window.removeEventListener(workspaceTabOpenedEvent, handler);
  };
}
