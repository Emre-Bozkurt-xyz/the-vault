"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";

import { requestEditorJump } from "@/lib/editor-jump-events";
import type { AssetUsage } from "@/server/asset-usage";

export type { AssetUsage };

/**
 * Which documents embed these files (folders count what's inside). Fails open:
 * if the check can't run, the caller carries on as if nothing used them,
 * since binning is undoable and must not be blocked by a lookup.
 */
export async function fetchAssetUsage(items: { assetIds?: string[]; folderIds?: string[] }): Promise<AssetUsage[]> {
  if ((items.assetIds?.length ?? 0) + (items.folderIds?.length ?? 0) === 0) return [];
  try {
    const response = await fetch("/api/assets/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { usage?: AssetUsage[] };
    return body.usage ?? [];
  } catch {
    return [];
  }
}

/** Documents across all the files, counting ones the user can't open. */
export function usageDocumentCount(usage: AssetUsage[]) {
  const ids = new Set<string>();
  let hidden = 0;
  for (const entry of usage) {
    for (const document of entry.documents) ids.add(document.id);
    hidden += entry.hidden;
  }
  return ids.size + hidden;
}

/** The documents one file is used in, for the Details panel; null while loading. */
export function useAssetUsage(assetId: string) {
  const [state, setState] = useState<{ assetId: string; usage: AssetUsage | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchAssetUsage({ assetIds: [assetId] }).then((usage) => {
      if (!cancelled) setState({ assetId, usage: usage[0] ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  if (state?.assetId !== assetId) return { loading: true, usage: null };
  return { loading: false, usage: state.usage };
}

const PER_FILE = 6;

/**
 * The documents as links. Each opens the document and, when the embed's line
 * is known, jumps to it and flashes it (the task agenda's jump). With several
 * files, each gets its own heading. Documents the user can't open are only
 * counted.
 */
export function AssetUsageList({
  usage,
  showFileNames = usage.length > 1,
  onNavigate,
}: {
  usage: AssetUsage[];
  showFileNames?: boolean;
  /** Called when a link is followed (a dialog closes itself). */
  onNavigate?: () => void;
}) {
  return (
    <div className="grid max-h-60 gap-3 overflow-y-auto">
      {usage.map((entry) => (
        <div key={entry.assetId} className="grid gap-1">
          {showFileNames ? (
            <p className="truncate text-xs font-medium text-foreground">{entry.name}</p>
          ) : null}
          <ul className="grid gap-0.5">
            {entry.documents.slice(0, PER_FILE).map((document) => (
              <li key={document.id}>
                <Link
                  href={`/docs/${document.id}`}
                  onClick={() => {
                    if (document.line !== null) {
                      requestEditorJump({
                        documentId: document.id,
                        line: document.line,
                        text: document.text ?? undefined,
                      });
                    }
                    onNavigate?.();
                  }}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate underline-offset-4 hover:underline">{document.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          {entry.documents.length > PER_FILE || entry.hidden > 0 ? (
            <p className="px-1.5 text-xs text-muted-foreground">
              {[
                entry.documents.length > PER_FILE ? `${entry.documents.length - PER_FILE} more` : null,
                entry.hidden > 0
                  ? `${entry.hidden} ${entry.hidden === 1 ? "document" : "documents"} you can't open`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
