"use client";

import { useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type DocumentWorkspaceProps = {
  editor: ReactNode;
  sidePanel?: ReactNode;
};

export function DocumentWorkspace({
  editor,
  sidePanel,
}: DocumentWorkspaceProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const hasPanel = Boolean(sidePanel);

  return (
    <section
      className={cn(
        "grid gap-5 transition-[grid-template-columns] duration-200 sm:gap-8",
        hasPanel && panelOpen
          ? "lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]"
          : "lg:grid-cols-[minmax(0,min(100%,1180px))] lg:justify-center",
      )}
    >
      <div className="min-w-0">
        {hasPanel ? (
          <div className="mb-3 flex justify-end px-3 sm:px-0 lg:hidden">
            <MobilePanelDialog sidePanel={sidePanel} />
          </div>
        ) : null}
        {editor}
      </div>

      {hasPanel ? (
        <>
          <div
            className={cn(
              "hidden lg:fixed lg:right-4 lg:top-28 lg:z-30 lg:block 2xl:right-8",
              panelOpen ? "lg:hidden" : null,
            )}
          >
            <PanelToggleButton
              open={panelOpen}
              onClick={() => setPanelOpen(true)}
              compact
            />
          </div>

          {panelOpen ? (
            <aside className="hidden space-y-6 px-3 sm:px-0 lg:block">
              <div className="hidden justify-end lg:flex">
                <PanelToggleButton
                  open={panelOpen}
                  onClick={() => setPanelOpen(false)}
                />
              </div>
              {sidePanel}
            </aside>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function MobilePanelDialog({ sidePanel }: { sidePanel: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <SlidersHorizontal className="size-4" />
        Document actions
      </DialogTrigger>
      <DialogContent className="max-h-[min(86dvh,44rem)] overflow-hidden rounded-2xl border border-border/70 bg-background/95 p-0 shadow-2xl sm:max-w-lg">
        <DialogHeader className="border-b border-border/60 px-4 pb-3 pt-4">
          <DialogTitle>Document actions</DialogTitle>
          <DialogDescription>
            Visibility, sharing, and collaborator controls.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(min(86dvh,44rem)-5.5rem)] overflow-y-auto px-4 py-4">
          <div className="space-y-4">{sidePanel}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PanelToggleButton({
  open,
  onClick,
  compact = false,
}: {
  open: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = open ? PanelRightClose : PanelRightOpen;

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon-sm" : "sm"}
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? "Collapse document panel" : "Open document panel"}
      title={open ? "Collapse document panel" : "Open document panel"}
      className={cn("gap-1.5", compact ? "rounded-full shadow-lg" : null)}
    >
      <Icon className="size-4" />
      {compact ? null : open ? "Hide panel" : "Show panel"}
    </Button>
  );
}
