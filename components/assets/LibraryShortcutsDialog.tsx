"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: [string, string][] = [
  ["Click", "Select"],
  ["Ctrl / ⌘ + click", "Add to the selection"],
  ["Shift + click", "Select a range"],
  ["Double-click, Enter", "Open"],
  ["Space", "Preview the selected file"],
  ["Right-click, Shift + F10", "Actions for what's under the pointer"],
  ["I", "Show or hide details"],
  ["F2", "Rename"],
  ["Delete", "Move to Bin"],
  ["Ctrl / ⌘ + A", "Select everything here"],
  ["Esc", "Clear the selection"],
  ["← →", "Previous / next, in the viewer"],
  ["?", "This list"],
];

/** The library's keyboard and mouse shortcuts (`?`). */
export function LibraryShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Library shortcuts</DialogTitle>
          <DialogDescription>Select first, then act: most actions follow the selection.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.flatMap(([keys, action]) => [
            <dt key={`${keys}-k`}>
              <kbd className="rounded border border-border/80 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.72rem]">
                {keys}
              </kbd>
            </dt>,
            <dd key={`${keys}-a`} className="text-muted-foreground">
              {action}
            </dd>,
          ])}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
