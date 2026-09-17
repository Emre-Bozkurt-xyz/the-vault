import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Tags that arrive from a folder rather than from the thing being edited (see
 * `lib/folder-tags.ts`). The padlock and the dashed border are the "reserved"
 * marker: they read as chips, but visibly not the same kind of chip as an
 * editable tag.
 *
 * Kept in its own module so the editor can render it without pulling in the
 * folder settings dialog and the server actions that dialog imports.
 */
export function InheritedTagList({
  tags,
  className,
}: {
  tags: string[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <li
          key={tag}
          title="Inherited from a folder — edit it in that folder's settings"
          className="flex items-center gap-1 rounded border border-dashed border-border/80 bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground"
        >
          <Lock className="size-3 shrink-0" aria-hidden="true" />
          {tag}
        </li>
      ))}
    </ul>
  );
}
