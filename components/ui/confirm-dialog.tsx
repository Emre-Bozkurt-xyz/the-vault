"use client";

import { useId, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The one confirmation prompt shape for the app: an icon, a title, a short
 * description, an optional "don't ask again" checkbox, and Cancel / confirm.
 * Use this instead of hand-assembling a `Dialog` (or `window.confirm`) for a
 * yes/no question, so every confirmation looks and behaves the same.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  icon: Icon,
  rememberLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  icon?: LucideIcon;
  /** When set, shows a checkbox with this label; its value is passed to `onConfirm`. */
  rememberLabel?: string;
  onConfirm: (options: { remember: boolean }) => void;
}) {
  const [remember, setRemember] = useState(false);
  const rememberId = useId();
  const destructive = tone === "destructive";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setRemember(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-[26rem]">
        <div className="flex gap-3.5">
          {Icon ? (
            <span
              aria-hidden
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg",
                destructive
                  ? "bg-destructive/12 text-destructive"
                  : "bg-muted text-foreground",
              )}
            >
              <Icon className="size-[1.05rem]" />
            </span>
          ) : null}
          <DialogHeader className="min-w-0 pt-0.5">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
        </div>
        <DialogFooter className={cn(rememberLabel && "sm:justify-between")}>
          {rememberLabel ? (
            <label
              htmlFor={rememberId}
              className="order-last flex cursor-pointer items-center gap-2 py-1 text-[0.8rem] text-muted-foreground select-none hover:text-foreground sm:order-first"
            >
              <input
                id={rememberId}
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="size-3.5 cursor-pointer accent-foreground"
              />
              {rememberLabel}
            </label>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={destructive ? "danger" : "default"}
              autoFocus
              onClick={() => {
                onConfirm({ remember });
                setRemember(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
