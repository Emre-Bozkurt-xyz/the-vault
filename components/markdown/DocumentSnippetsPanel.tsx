"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  DocumentSnippetAttachment,
  SnippetSummary,
} from "@/server/snippets";
import {
  attachSnippetAction,
  detachSnippetAction,
  listDocumentSnippetAttachmentsAction,
} from "@/server/snippets-actions";

type DocumentSnippetsPanelProps = {
  documentId: string;
  initialAttached: DocumentSnippetAttachment[];
  initialAvailable: SnippetSummary[];
};

export function DocumentSnippetsPanel({
  documentId,
  initialAttached,
  initialAvailable,
}: DocumentSnippetsPanelProps) {
  const [attached, setAttached] = useState(initialAttached);
  const [available, setAvailable] = useState(initialAvailable);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-sync on mount so snippets created in Settings after this doc rendered
  // show up in "Available" without a full page reload.
  useEffect(() => {
    let active = true;
    void listDocumentSnippetAttachmentsAction(documentId).then((result) => {
      if (active && result) {
        setAttached(result.attached);
        setAvailable(result.available);
      }
    });
    return () => {
      active = false;
    };
  }, [documentId]);

  function attach(snippet: SnippetSummary) {
    setError(null);
    startTransition(async () => {
      const result = await attachSnippetAction(documentId, snippet.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAttached((prev) => [
        ...prev,
        {
          snippetId: snippet.id,
          name: snippet.name,
          status: snippet.status,
          sortOrder: prev.length,
        },
      ]);
      setAvailable((prev) => prev.filter((item) => item.id !== snippet.id));
    });
  }

  function detach(snippetId: string) {
    setError(null);
    startTransition(async () => {
      const result = await detachSnippetAction(documentId, snippetId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const removed = attached.find((item) => item.snippetId === snippetId);
      setAttached((prev) => prev.filter((item) => item.snippetId !== snippetId));
      if (removed) {
        setAvailable((prev) => [
          ...prev,
          {
            id: removed.snippetId,
            name: removed.name,
            description: null,
            status: removed.status,
            sourceBytes: 0,
            compiledBytes: 0,
            attachedCount: 0,
            updatedAt: new Date(),
          },
        ]);
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-muted-foreground" />
        Styling
      </div>
      <p className="text-xs text-muted-foreground">
        Attach your CSS snippets to style this document for everyone who can view
        it. Manage snippets in Settings → Snippets.
      </p>

      {attached.length > 0 ? (
        <ul className="grid gap-1.5">
          {attached.map((item) => (
            <li
              key={item.snippetId}
              className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Check className="size-3.5 text-muted-foreground" />
                <span className="truncate">{item.name}</span>
                {item.status !== "ok" ? (
                  <span className="text-[0.65rem] font-semibold text-destructive">
                    ({item.status})
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Detach ${item.name}`}
                disabled={pending}
                onClick={() => detach(item.snippetId)}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border/70 px-2.5 py-2 text-xs text-muted-foreground">
          No snippets attached.
        </p>
      )}

      {available.length > 0 ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Available
          </span>
          {available.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              disabled={pending}
              onClick={() => attach(snippet)}
              className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-left text-sm transition hover:border-primary/50"
            >
              <span className="truncate">{snippet.name}</span>
              <Plus className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
