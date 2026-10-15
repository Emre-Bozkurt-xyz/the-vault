"use client";

import { useEffect, useState } from "react";

import { useGlobalShortcuts } from "@/components/shortcuts/KeybindingsProvider";
import { TaskCaptureInput } from "@/components/tasks/TaskCaptureInput";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const openEvent = "vault:quick-add-task";

/** Opens the quick-add dialog (palette command, mobile chrome). */
export function openQuickAddTask() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(openEvent));
}

/**
 * "Add task" from anywhere in the workspace: the global shortcut (Hotkeys
 * settings, `global.quickAddTask`) or `openQuickAddTask`. Mounted once by the
 * workspace shell while Tasks is on. Closes after a capture; the toast that
 * confirms it carries the Undo.
 */
export function QuickAddTaskDialogHost() {
  const [open, setOpen] = useState(false);

  useGlobalShortcuts({ "global.quickAddTask": () => setOpen(true) });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(openEvent, onOpen);
    return () => window.removeEventListener(openEvent, onOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[22%] translate-y-0 gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription>
            End with a date, <code>!high</code>, <code>every week</code> or <code>#Document</code>. Enter to add.
          </DialogDescription>
        </DialogHeader>
        {open ? <TaskCaptureInput size="dialog" autoFocus onCaptured={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
