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
 * Names — and, ideally, defines — a term (`docs/20_DICTIONARY_EXTENSION_PLAN.md`).
 *
 * A dialog rather than an in-document placeholder, because the term becomes a
 * document *title* and the author needs to see it as one before a file is
 * created. Prefilled from the selection, or from an unresolved `[[link]]` the
 * author chose to define.
 *
 * The definition line is what makes the result useful immediately: it becomes
 * the document's `summary:`, which is the hover text. Without it the new
 * definition has nothing to preview, so its links render as plain wiki links
 * until someone opens the stub and writes something.
 */
export function NewDefinitionDialog({
  open,
  initialTerm,
  linksHere,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initialTerm: string;
  /** Whether a link is inserted at the cursor — false when defining an existing link. */
  linksHere: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: { term: string; summary: string }) => void;
}) {
  // Keyed by the caller per invocation, so each opening starts from its own term
  // rather than the previous one needing to be cleared out.
  const [term, setTerm] = useState(initialTerm);
  const [summary, setSummary] = useState("");

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
            {linksHere
              ? "Creates a definition and links to it here."
              : "Creates a definition for this link."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ term, summary });
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Term</span>
            <input
              // Focus the field that still needs something: the term when it is
              // blank, the definition when the term arrived prefilled.
              autoFocus={!initialTerm}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Idempotence"
              maxLength={200}
              className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/60"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Definition</span>
            <textarea
              autoFocus={Boolean(initialTerm)}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              onKeyDown={(event) => {
                // Enter submits, as in the term field; Shift+Enter is still a
                // newline for the rare definition that wants one.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Repeating it produces the same result as doing it once."
              maxLength={500}
              rows={2}
              className="w-full resize-none rounded-md border border-border/70 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/60"
            />
          </label>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Shown when hovering the term. If it is already defined, the
              existing definition is kept.
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
