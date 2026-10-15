"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  clearLiveDocumentTasks,
  getLiveDocumentTasks,
  getServerLiveDocumentTasks,
  publishLiveDocumentTasks,
  subscribeToLiveDocumentTasks,
  type LiveDocumentTasks,
} from "@/lib/tasks/overlay";
import { parseTasks } from "@/lib/tasks/parse";
import { taskSourceSignature } from "@/lib/tasks/signature";

/** A pause in typing before the open document's tasks are re-read. */
const publishDelayMs = 250;

/** Tasks of documents open in an editor in this tab, fresher than the server's. */
export function useLiveDocumentTasks(): ReadonlyMap<string, LiveDocumentTasks> {
  return useSyncExternalStore(subscribeToLiveDocumentTasks, getLiveDocumentTasks, getServerLiveDocumentTasks);
}

/**
 * Called by the workspace editor: publishes the document's parsed tasks after
 * each pause in typing, but only when its task lines actually changed, and
 * withdraws them when the editor closes (the server has caught up by then, or
 * will announce it).
 */
export function usePublishLiveTasks({
  enabled,
  documentId,
  markdown,
  title,
  folderId,
  owned,
}: {
  enabled: boolean;
  documentId: string;
  markdown: string;
  title: string;
  folderId: string | null;
  owned: boolean;
}) {
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const key = `${title}\u0000${folderId}\u0000${owned}\u0000${taskSourceSignature(markdown)}`;
      if (key === lastRef.current) return;
      lastRef.current = key;
      publishLiveDocumentTasks({ documentId, title, folderId, owned, tasks: parseTasks(markdown) });
    }, publishDelayMs);
    return () => clearTimeout(timer);
  }, [enabled, documentId, markdown, title, folderId, owned]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      lastRef.current = null;
      clearLiveDocumentTasks(documentId);
    };
  }, [enabled, documentId]);
}
