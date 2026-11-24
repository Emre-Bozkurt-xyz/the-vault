"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FileText, Link2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextPanelSection } from "@/components/workspace/ContextPanel";
import { subscribeToWorkspaceDocumentChanges } from "@/components/workspace/workspace-events";
import { requestEditorJump } from "@/lib/editor-jump-events";
import { getDocumentBacklinksAction, type DocumentBacklink } from "@/server/backlinks";

/** After an editor save the collab server stores the text on a debounce. */
const refetchAfterSaveMs = 2500;

// One fetch per document shared by the title chip and the panel section.
type Entry = { backlinks: DocumentBacklink[] | null; listeners: Set<() => void>; inFlight: boolean };
const cache = new Map<string, Entry>();

function entryFor(documentId: string): Entry {
  let entry = cache.get(documentId);
  if (!entry) {
    entry = { backlinks: null, listeners: new Set(), inFlight: false };
    cache.set(documentId, entry);
  }
  return entry;
}

function load(documentId: string) {
  const entry = entryFor(documentId);
  if (entry.inFlight) return;
  entry.inFlight = true;
  void getDocumentBacklinksAction({ documentId })
    .then(
      (backlinks) => {
        entry.backlinks = backlinks ?? [];
      },
      () => undefined,
    )
    .finally(() => {
      entry.inFlight = false;
      for (const listener of entry.listeners) listener();
    });
}

/** Documents linking to this one, loaded once and refreshed after saves anywhere in the workspace. */
function useDocumentBacklinks(documentId: string): DocumentBacklink[] | null {
  const backlinks = useSyncExternalStore(
    (listener) => {
      const entry = entryFor(documentId);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    () => entryFor(documentId).backlinks,
    () => null,
  );

  useEffect(() => {
    load(documentId);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToWorkspaceDocumentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(documentId), refetchAfterSaveMs);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [documentId]);

  return backlinks;
}

function openBacklink(backlink: DocumentBacklink) {
  requestEditorJump({ documentId: backlink.id, line: backlink.line, text: backlink.text });
}

function plural(count: number, one: string) {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/**
 * "3 backlinks" beside the folder path, above the title: quiet, and absent
 * when nothing links here. Opens a list of the linking documents.
 */
export function BacklinksChip({ documentId }: { documentId: string }) {
  const backlinks = useDocumentBacklinks(documentId);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!backlinks || backlinks.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Link2 className="size-3.5" aria-hidden="true" />
        {plural(backlinks.length, "backlink")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Linked from</DropdownMenuLabel>
          {backlinks.map((backlink) => (
            <DropdownMenuItem
              key={backlink.id}
              className="flex-col items-start gap-0.5 whitespace-normal"
              onClick={() => {
                openBacklink(backlink);
                router.push(`/docs/${backlink.id}`);
              }}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5 font-medium">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{backlink.title || "Untitled document"}</span>
              </span>
              <span className="line-clamp-2 w-full text-xs text-muted-foreground">{backlink.text}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Linked from" in the document's right panel: each linking document with the line that links. */
export function DocumentBacklinksSection({ documentId }: { documentId: string }) {
  const backlinks = useDocumentBacklinks(documentId);

  return (
    <ContextPanelSection
      icon={Link2}
      title="Linked from"
      description={
        backlinks === null
          ? "Looking for links to this document…"
          : backlinks.length === 0
            ? "No documents link here yet. Link one with [[its title]]."
            : backlinks.length === 1
              ? "1 document links here."
              : `${backlinks.length} documents link here.`
      }
    >
      {backlinks && backlinks.length > 0 ? (
        <ul className="grid gap-1">
          {backlinks.map((backlink) => (
            <li key={backlink.id}>
              <Link
                href={`/docs/${backlink.id}`}
                onClick={() => openBacklink(backlink)}
                className="grid gap-0.5 rounded-md px-1.5 py-1 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{backlink.title || "Untitled document"}</span>
                  {backlink.count > 1 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">×{backlink.count}</span>
                  ) : null}
                  {backlink.embedOnly ? (
                    <span className="shrink-0 text-xs text-muted-foreground">· embeds</span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{backlink.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </ContextPanelSection>
  );
}
