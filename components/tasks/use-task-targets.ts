"use client";

import { useEffect, useState } from "react";

import { searchTaskTargetsAction } from "@/server/tasks";
import type { TaskTargetDocument } from "@/server/tasks-data";

const debounceMs = 120;

/**
 * The user's own documents matching `query`, for "Move to…" and `#` in the
 * capture box. Debounced; stale responses are dropped; null while the first
 * response is pending.
 */
export function useTaskTargets(query: string | null): TaskTargetDocument[] | null {
  const [results, setResults] = useState<{ query: string; documents: TaskTargetDocument[] } | null>(null);

  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchTaskTargetsAction({ query })
        .catch(() => [])
        .then((documents) => {
          if (!cancelled) setResults({ query, documents });
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Keep showing the last results while the next ones load, so the list
  // does not flicker on every keystroke.
  return query === null ? null : (results?.documents ?? null);
}
