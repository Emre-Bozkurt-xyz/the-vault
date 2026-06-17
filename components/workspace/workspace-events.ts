import type { WorkspaceDocumentItem } from "@/components/workspace/workspace-types";

export const workspaceDocumentChangedEvent = "vault:workspace-document-changed";

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
