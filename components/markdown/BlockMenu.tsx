"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Copy, Link2, Trash2 } from "lucide-react";

import { replaceDocument, type BlockMenuRequest } from "@/components/markdown/block-handle";
import {
  blockAnchorId,
  findBlock,
  moveBlockWithSpacing,
  newBlockAnchorId,
  turnInto,
  type TurnIntoKind,
} from "@/lib/markdown/blocks";
import { showWorkspaceToast } from "@/lib/workspace-toast";

const TURN_INTO: { kind: TurnIntoKind; label: string; mark: string }[] = [
  { kind: "text", label: "Text", mark: "T" },
  { kind: "h1", label: "Heading 1", mark: "H1" },
  { kind: "h2", label: "Heading 2", mark: "H2" },
  { kind: "h3", label: "Heading 3", mark: "H3" },
  { kind: "bullet", label: "Bulleted list", mark: "•" },
  { kind: "numbered", label: "Numbered list", mark: "1." },
  { kind: "todo", label: "To-do", mark: "☐" },
  { kind: "quote", label: "Quote", mark: "❝" },
  { kind: "callout", label: "Callout", mark: "!" },
];

/**
 * The block handle's menu (`block-handle.ts`): turn the block into another
 * kind, duplicate, move, copy a link to it, delete. Each is one edit to the
 * Markdown, so undo, collaboration and history treat it like typing.
 */
export function BlockMenu({
  request,
  documentId,
  onClose,
}: {
  request: BlockMenuRequest;
  documentId: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { view, block } = request;

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        view.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, view]);

  const lines = () => view.state.doc.toString().split("\n");
  const run = (edit: (all: string[]) => string[] | null, message?: string) => {
    const next = edit(lines());
    if (next) replaceDocument(view, next.join("\n"));
    if (message) showWorkspaceToast({ message });
    onClose();
    view.focus();
  };

  const neighbour = (all: string[], direction: -1 | 1) => {
    for (let line = direction < 0 ? block.start - 1 : block.end; line >= 0 && line < all.length; line += direction) {
      const found = findBlock(all, line);
      if (found) return found;
    }
    return null;
  };

  const copyLink = async () => {
    const all = lines();
    const blockLines = all.slice(block.start, block.end);
    let fragment: string;
    let next: string[] | null = null;
    if (block.kind === "heading") {
      fragment = blockLines[0].replace(/^#{1,6}\s+/, "").replace(/\s+#*\s*$/, "").trim();
    } else {
      let id = blockAnchorId(blockLines);
      if (!id) {
        id = newBlockAnchorId();
        next = [...all];
        // Code and tables take the anchor on its own line under them.
        if (block.kind === "code" || block.kind === "table") next.splice(block.end, 0, `^${id}`);
        else next[block.end - 1] = `${next[block.end - 1].replace(/\s+$/, "")} ^${id}`;
      }
      fragment = `^${id}`;
    }
    if (next) replaceDocument(view, next.join("\n"));
    const link = `[[doc:${documentId}#${fragment}]]`;
    try {
      await navigator.clipboard.writeText(link);
      showWorkspaceToast({ message: "Link to block copied. Paste it into any document." });
    } catch {
      showWorkspaceToast({ message: `Couldn't copy. The link is ${link}`, tone: "error" });
    }
    onClose();
    view.focus();
  };

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Block"
      className="fixed z-50 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{
        top: Math.min(request.anchor.bottom + 4, window.innerHeight - 380),
        left: Math.max(8, request.anchor.left),
      }}
    >
      <p className="px-2 pb-1 pt-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Turn into</p>
      <div className="grid grid-cols-3 gap-0.5 pb-1">
        {TURN_INTO.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="menuitem"
            title={option.label}
            onClick={() =>
              run((all) => {
                all.splice(block.start, block.end - block.start, ...turnInto(all.slice(block.start, block.end), option.kind));
                return all;
              })
            }
            className="grid h-12 place-items-center gap-0.5 rounded-md text-xs transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <span className="text-sm font-semibold">{option.mark}</span>
            <span className="text-[0.65rem] text-muted-foreground">{option.label}</span>
          </button>
        ))}
      </div>
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() =>
          run((all) => {
            const copy = all.slice(block.start, block.end).map((line) => line.replace(/\s\^[A-Za-z0-9_-]+\s*$/, ""));
            all.splice(block.end, 0, ...(block.kind === "list" ? copy : ["", ...copy]));
            return all;
          })
        }
      >
        <Copy className="size-4" /> Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() =>
          run((all) => {
            const previous = neighbour(all, -1);
            return previous ? moveBlockWithSpacing(all, block, previous.start) : null;
          })
        }
      >
        <ArrowUp className="size-4" /> Move up
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() =>
          run((all) => {
            const next = neighbour(all, 1);
            return next ? moveBlockWithSpacing(all, block, next.end) : null;
          })
        }
      >
        <ArrowDown className="size-4" /> Move down
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={() => void copyLink()}>
        <Link2 className="size-4" /> Copy link to block
      </button>
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} text-destructive`}
        onClick={() =>
          run((all) => {
            // Take one blank line with it, so no double gap is left.
            const extra = block.end < all.length && !all[block.end].trim() && block.kind !== "list" ? 1 : 0;
            all.splice(block.start, block.end - block.start + extra);
            return all;
          })
        }
      >
        <Trash2 className="size-4" /> Delete
      </button>
    </div>
  );
}
