"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { archiveDocumentAction } from "@/server/documents";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  setConfirmMoveToBin,
  useConfirmMoveToBin,
} from "@/components/workspace/move-to-bin-preference";
import { dispatchWorkspaceDocumentRemoved } from "@/components/workspace/workspace-events";

export function DocumentArchiveForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const confirmMoveToBin = useConfirmMoveToBin();

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
        className="w-full"
        onClick={() => (confirmMoveToBin ? setConfirming(true) : archive())}
      >
        Move to Bin
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="destructive"
        icon={Trash2}
        title="Move to Bin?"
        description="This document can be restored from the Bin in the Files panel until it is automatically deleted."
        confirmLabel="Move to Bin"
        rememberLabel="Don't ask again"
        onConfirm={({ remember }) => {
          if (remember) {
            setConfirmMoveToBin(false);
          }
          archive();
        }}
      />
    </>
  );
}
