"use client";

import { type FormEvent } from "react";

import { archiveDocumentAction } from "@/server/documents";
import { Button } from "@/components/ui/button";
import { dispatchWorkspaceDocumentRemoved } from "@/components/workspace/workspace-events";

export function DocumentArchiveForm({ documentId }: { documentId: string }) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (event.defaultPrevented) {
      return;
    }

    dispatchWorkspaceDocumentRemoved({ id: documentId });
  }

  return (
    <form action={archiveDocumentAction} className="mt-3" onSubmit={handleSubmit}>
      <input type="hidden" name="documentId" value={documentId} />
      <Button type="submit" variant="destructive" size="sm" className="w-full">
        Archive document
      </Button>
    </form>
  );
}
