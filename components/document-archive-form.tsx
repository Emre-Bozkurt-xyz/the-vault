"use client";

import { useState, useTransition } from "react";

import { archiveDocumentAction } from "@/server/documents";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dispatchWorkspaceDocumentRemoved } from "@/components/workspace/workspace-events";

export function DocumentArchiveForm({ documentId }: { documentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function archive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveDocumentAction(documentId);

      if (result.ok) {
        setConfirming(false);
        // Closes the document's tab and removes it from the sidebar; no
        // navigation/redirect is needed here.
        dispatchWorkspaceDocumentRemoved({ id: documentId });
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="mt-3 w-full"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Archive document
      </Button>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setConfirming(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive document</DialogTitle>
            <DialogDescription>
              This moves the document to the Bin. You can restore it from the
              Files panel until it is automatically deleted.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={archive}
              disabled={isPending}
            >
              {isPending ? "Archiving…" : "Move to Bin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
