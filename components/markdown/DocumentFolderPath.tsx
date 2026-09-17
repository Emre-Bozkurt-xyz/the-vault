import { FolderOpen } from "lucide-react";

/**
 * The document's folder path, rendered above the title in both the editor and
 * the read-only view. The tab strip only has room for a name and two documents
 * can legitimately share one, so this is where "which of them am I looking at"
 * gets answered.
 *
 * Deliberately static text rather than links: the folder tree is one click away
 * in the sidebar, and a row of clickable crumbs above the title competes with
 * the title for attention.
 */
export function DocumentFolderPath({ path }: { path?: string | null }) {
  if (!path) {
    return null;
  }

  const segments = path.split("/");

  return (
    <p
      className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      title={path}
    >
      <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Folder: </span>
      {segments.map((segment, index) => (
        <span key={`${index}-${segment}`} className="flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground/50">
              /
            </span>
          ) : null}
          <span className="truncate">{segment}</span>
        </span>
      ))}
    </p>
  );
}
