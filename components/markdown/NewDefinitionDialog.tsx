"use client";

import { useState } from "react";
import { BookMarked } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Names the term for `/def` (`docs/20_DICTIONARY_EXTENSION_PLAN.md` slice 4).
 *
 * A dialog rather than an in-document placeholder, because the term becomes a
 * document *title* and the author needs to see it as one before a file is
 * created. Prefilled from the selection when there is one, so defining a word
 * you just wrote is select-then-`/def`.
 */
export function NewDefinitionDialog({
  open,
  initialTerm,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initialTerm: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (term: string) => void;
}) {
  // Keyed by the caller on `initialTerm`, so each invocation gets a fresh field
  // rather than the previous term needing to be cleared out.
  const [term, setTerm] = useState(initialTerm);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="size-4 text-muted-foreground" />
            Define a term
          </DialogTitle>
          <DialogDescription>
            Creates a definition document and links to it here. It opens in a
            background tab, so you can keep writing.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(term);
          }}
        >
          <input
            // The dialog exists only to collect this one value.
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Idempotence"
            maxLength={200}
            aria-label="Term"
            className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/60"
          />
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              An existing definition with this title is reused rather than
              duplicated.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !term.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
