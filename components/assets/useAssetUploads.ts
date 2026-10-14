"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  UploadCancelledError,
  uploadAsset,
  type UploadedAsset,
  type UploadProgress,
} from "@/lib/asset-upload-client";

export type UploadItemStatus =
  | "queued"
  | "starting"
  | "uploading"
  | "finishing"
  | "done"
  | "error"
  | "cancelled";

export type UploadItem = {
  id: string;
  name: string;
  totalBytes: number;
  loadedBytes: number;
  status: UploadItemStatus;
  error: string | null;
  /** Smoothed transfer rate, null until there is enough signal. */
  bytesPerSecond: number | null;
};

type QueuedUpload<Context> = { id: string; file: File; context: Context };

type Options<Context> = {
  documentId?: string | null;
  shareLinkId?: string | null;
  bearerToken?: string | null;
  onUploaded?: (asset: UploadedAsset, context: Context) => void;
  /** Called after each file settles, success or not (e.g. to refresh a list). */
  onSettled?: () => void;
  /** Remove finished items after this long; failures stay until dismissed. */
  autoDismissMs?: number;
};

const ACTIVE: UploadItemStatus[] = ["queued", "starting", "uploading", "finishing"];

export function isUploadActive(item: UploadItem) {
  return ACTIVE.includes(item.status);
}

/**
 * Upload queue with live progress. Files upload one at a time (a large file
 * already sends four parts in parallel); `enqueue` returns immediately.
 */
export function useAssetUploads<Context = void>(options: Options<Context> = {}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const optionsRef = useRef(options);
  const queueRef = useRef<QueuedUpload<Context>[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const runningRef = useRef(false);
  const pendingProgressRef = useRef(new Map<string, Partial<UploadItem>>());
  const frameRef = useRef<number | null>(null);
  const timersRef = useRef(new Set<number>());

  useEffect(() => {
    optionsRef.current = options;
  });

  const patch = useCallback((id: string, update: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }, []);

  // Progress events fire many times a second per part; flush once per frame.
  const queueProgress = useCallback((id: string, update: Partial<UploadItem>) => {
    pendingProgressRef.current.set(id, {
      ...pendingProgressRef.current.get(id),
      ...update,
    });

    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingProgressRef.current;
      pendingProgressRef.current = new Map();
      setItems((current) =>
        current.map((item) => {
          const update = pending.get(item.id);
          return update && isUploadActive(item) ? { ...item, ...update } : item;
        }),
      );
    });
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      for (
        let next = queueRef.current.shift();
        next !== undefined;
        next = queueRef.current.shift()
      ) {
        const { id, file, context } = next;
        const controller = new AbortController();
        controllersRef.current.set(id, controller);
        const meter = createRateMeter();
        patch(id, { status: "starting" });

        try {
          const { documentId, shareLinkId, bearerToken } = optionsRef.current;
          const asset = await uploadAsset(file, {
            documentId,
            shareLinkId,
            bearerToken,
            signal: controller.signal,
            onProgress: (progress: UploadProgress) =>
              queueProgress(id, {
                status: progress.phase,
                loadedBytes: progress.loadedBytes,
                bytesPerSecond: meter(progress.loadedBytes),
              }),
          });

          pendingProgressRef.current.delete(id);
          patch(id, { status: "done", loadedBytes: file.size, bytesPerSecond: null });
          optionsRef.current.onUploaded?.(asset, context);

          const dismissAfter = optionsRef.current.autoDismissMs;
          if (dismissAfter) {
            const timer = window.setTimeout(() => {
              timersRef.current.delete(timer);
              setItems((current) => current.filter((item) => item.id !== id));
            }, dismissAfter);
            timersRef.current.add(timer);
          }
        } catch (error) {
          pendingProgressRef.current.delete(id);
          patch(
            id,
            error instanceof UploadCancelledError
              ? { status: "cancelled", bytesPerSecond: null }
              : {
                  status: "error",
                  bytesPerSecond: null,
                  error: error instanceof Error ? error.message : "Upload failed.",
                },
          );
        } finally {
          controllersRef.current.delete(id);
          optionsRef.current.onSettled?.();
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch, queueProgress]);

  const enqueue = useCallback(
    (files: File[], context: Context) => {
      const queued = files.map((file) => ({ id: crypto.randomUUID(), file, context }));

      setItems((current) => [
        ...current,
        ...queued.map(({ id, file }) => ({
          id,
          name: file.name,
          totalBytes: file.size,
          loadedBytes: 0,
          status: "queued" as const,
          error: null,
          bytesPerSecond: null,
        })),
      ]);
      queueRef.current.push(...queued);
      void run();
    },
    [run],
  );

  const cancel = useCallback(
    (id: string) => {
      const controller = controllersRef.current.get(id);

      if (controller) {
        controller.abort();
        return;
      }

      queueRef.current = queueRef.current.filter((queued) => queued.id !== id);
      patch(id, { status: "cancelled" });
    },
    [patch],
  );

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id || isUploadActive(item)));
  }, []);

  const hasActive = items.some(isUploadActive);

  // Leaving mid-upload would strand it; ask first.
  useEffect(() => {
    if (!hasActive) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasActive]);

  useEffect(() => {
    const controllers = controllersRef.current;
    const timers = timersRef.current;

    return () => {
      for (const controller of controllers.values()) controller.abort();
      for (const timer of timers) window.clearTimeout(timer);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return { items, enqueue, cancel, dismiss, hasActive };
}

/** Exponentially smoothed bytes/second from cumulative byte counts. */
function createRateMeter() {
  let lastTime = 0;
  let lastBytes = 0;
  let rate: number | null = null;

  return (bytes: number) => {
    const now = performance.now();

    if (lastTime === 0) {
      lastTime = now;
      lastBytes = bytes;
      return rate;
    }

    const elapsed = (now - lastTime) / 1000;
    if (elapsed < 0.25) return rate;

    const instant = Math.max(bytes - lastBytes, 0) / elapsed;
    rate = rate === null ? instant : rate * 0.7 + instant * 0.3;
    lastTime = now;
    lastBytes = bytes;
    return rate;
  };
}
