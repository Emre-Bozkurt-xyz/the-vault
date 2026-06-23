"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getDocumentExtensionStateAction,
  upsertDocumentExtensionStateAction,
  type DocumentExtensionStateActionRecord,
} from "@/server/document-extension-actions";
import type {
  ExtensionStateValue,
  ExtensionStateVisibility,
} from "@/lib/extensions/types";

type DocumentExtensionObjectState = Record<string, ExtensionStateValue>;

type UseDocumentExtensionStateOptions = {
  documentId: string;
  extensionId: string;
  stateKey?: string;
  initialState?: DocumentExtensionStateActionRecord | null;
  debounceMs?: number;
  version?: number;
  visibility?: ExtensionStateVisibility;
  disabled?: boolean;
};

export type DocumentExtensionStateStatus = "idle" | "loading" | "dirty" | "saving" | "saved" | "error";

export function useDocumentExtensionState({
  documentId,
  extensionId,
  stateKey,
  initialState = null,
  debounceMs = 600,
  version = initialState?.version ?? 1,
  visibility = initialState?.visibility ?? "private",
  disabled = false,
}: UseDocumentExtensionStateOptions) {
  const [state, setState] = useState<DocumentExtensionObjectState | null>(
    () => (initialState?.state as DocumentExtensionObjectState | undefined) ?? null,
  );
  const [status, setStatus] = useState<DocumentExtensionStateStatus>(
    initialState ? "saved" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(Boolean(initialState));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJsonRef = useRef(
    initialState ? JSON.stringify(initialState.state) : "",
  );

  const identity = useMemo(
    () => ({ documentId, extensionId, stateKey }),
    [documentId, extensionId, stateKey],
  );

  useEffect(() => {
    if (disabled || loadedRef.current) {
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    getDocumentExtensionStateAction(identity)
      .then((record) => {
        if (cancelled) {
          return;
        }

        const nextState =
          (record?.state as DocumentExtensionObjectState | undefined) ?? null;
        loadedRef.current = true;
        lastSavedJsonRef.current = record ? JSON.stringify(nextState) : "";
        setState(nextState);
        setStatus(record ? "saved" : "idle");
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Failed to load extension state.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [disabled, identity]);

  useEffect(() => {
    if (disabled || !loadedRef.current) {
      return;
    }

    const nextJson = JSON.stringify(state);
    if (nextJson === lastSavedJsonRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    setStatus("dirty");
    setError(null);
    saveTimerRef.current = setTimeout(() => {
      setStatus("saving");
      upsertDocumentExtensionStateAction({
        ...identity,
        state: state ?? {},
        version,
        visibility,
      })
        .then((record) => {
          lastSavedJsonRef.current = JSON.stringify(record.state);
          setStatus("saved");
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Failed to save extension state.");
          setStatus("error");
        });
    }, debounceMs);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [debounceMs, disabled, identity, state, version, visibility]);

  const updateState = useCallback((nextState: DocumentExtensionObjectState | null) => {
    setState(nextState);
  }, []);

  const flush = useCallback(async () => {
    if (disabled || !loadedRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    setStatus("saving");
    const record = await upsertDocumentExtensionStateAction({
      ...identity,
      state: state ?? {},
      version,
      visibility,
    });
    lastSavedJsonRef.current = JSON.stringify(record.state);
    setStatus("saved");
  }, [disabled, identity, state, version, visibility]);

  return {
    state,
    setState: updateState,
    status,
    dirty: status === "dirty",
    saving: status === "saving",
    error,
    flush,
  };
}
