"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Globe2, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspacePublicDocumentItem } from "@/components/workspace/workspace-types";

export function WorkspaceGalleryPanel({
  publicDocuments,
  activeHref,
}: {
  publicDocuments: WorkspacePublicDocumentItem[];
  activeHref?: string;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase().replace(/^@/, "");
  const filteredDocuments = useMemo(() => {
    const docs = normalizedQuery
      ? publicDocuments.filter((document) =>
          [
            document.title,
            document.ownerName,
            document.ownerUsername,
            document.publicSlug,
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedQuery)),
        )
      : publicDocuments;

    return docs.slice(0, 20);
  }, [normalizedQuery, publicDocuments]);
  const galleryHref = normalizedQuery
    ? `/gallery?q=${encodeURIComponent(normalizedQuery)}`
    : "/gallery";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Gallery
        </p>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-border/70 bg-background/55 px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title or @user"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Link
            href={galleryHref}
            className="flex size-8 shrink-0 items-center justify-center border border-border/70 text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Open full gallery"
            aria-label="Open full gallery"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="flex items-center justify-between px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span>Public docs</span>
          <span>{filteredDocuments.length}</span>
        </div>
        <div className="grid gap-0.5">
          {filteredDocuments.length > 0 ? (
            filteredDocuments.map((document) => (
              <Link
                key={document.id}
                href={document.href}
                className={cn(
                  "grid grid-cols-[1rem_1fr] gap-x-2 rounded-[5px] px-2 py-1.5 text-sm transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  activeHref === document.href
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Globe2 className="mt-0.5 size-3.5" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{document.title}</span>
                  <span className="block truncate text-xs opacity-70">
                    {document.ownerUsername
                      ? `@${document.ownerUsername}`
                      : document.ownerName ?? "Unknown owner"}
                  </span>
                </span>
              </Link>
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No matching public documents.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
