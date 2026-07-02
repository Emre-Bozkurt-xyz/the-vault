"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  function archive() {
    setConfirming(false);
    // Navigate away from (and close) this document's tab BEFORE the soft delete
    // runs. The server action revalidates this route on completion, which would
    // otherwise flash the archived doc's notFound state; switching to a nearby
    // tab first keeps that off-screen. The removal event drives the tab switch
    // (WorkspaceTabBar) and the sidebar/Bin update (WorkspaceChrome).
    dispatchWorkspaceDocumentRemoved({ id: documentId });

    void archiveDocumentAction(documentId).then((result) => {
      if (!result.ok) {
        // The optimistic removal already happened; resync from the server so the
        // still-active document reappears in the file tree.
        router.refresh();
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
        onClick={() => setConfirming(true)}
      >
        Archive document
      </Button>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) {
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={archive}>
              Move to Bin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
