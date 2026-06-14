"use client";

import { useState } from "react";
import { AlertTriangle, Link2 } from "lucide-react";

import { CopyPublicLink } from "@/components/copy-public-link";
import { Button } from "@/components/ui/button";

type DocumentLinkAccessFieldsProps = {
  currentMode: string;
  activeShareLinkId: string | null;
};

export function DocumentLinkAccessFields({
  currentMode,
  activeShareLinkId,
}: DocumentLinkAccessFieldsProps) {
  const [mode, setMode] = useState(currentMode);

  return (
    <>
      <select
        name="mode"
        className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        value={mode}
        onChange={(event) => setMode(event.target.value)}
      >
        <option value="off">Off</option>
        <option value="anyone-viewer">Anyone with the link can view</option>
        <option value="members-viewer">
          Signed-in Vault members with the link can view
        </option>
        <option value="members-editor">
          Signed-in Vault members with the link can edit
        </option>
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline">
          <Link2 className="size-4" />
          Save link settings
        </Button>
        {activeShareLinkId ? (
          <CopyPublicLink path={`/share/${activeShareLinkId}`} />
        ) : null}
      </div>
      {mode === "members-editor" ? (
        <div className="flex gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Edit links let any signed-in Vault member with the URL change this
          document until you disable or rotate the link.
        </div>
      ) : null}
    </>
  );
}
