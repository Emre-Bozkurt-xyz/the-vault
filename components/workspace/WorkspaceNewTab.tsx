"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FilePlus2, FileText, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createDocumentAction } from "@/server/documents";
import type { WorkspaceDocumentItem } from "@/components/workspace/workspace-types";

type WorkspaceNewTabProps = {
  recentDocuments: WorkspaceDocumentItem[];
  searchableDocuments: WorkspaceDocumentItem[];
  userLabel: string;
};

export function WorkspaceNewTab({
  recentDocuments,
  searchableDocuments,
  userLabel,
}: WorkspaceNewTabProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleDocuments = useMemo(() => {
    if (!normalizedQuery) {
      return recentDocuments;
    }

    return searchableDocuments
      .filter((document) =>
        [
          document.title,
          document.visibility,
          document.role,
          document.updatedAt.toLocaleDateString(),
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(normalizedQuery),
          ),
      )
      .slice(0, 12);
  }, [normalizedQuery, recentDocuments, searchableDocuments]);
  const listLabel = normalizedQuery ? "Search results" : "Recent";

  return (
    <div className="flex min-h-[calc(100vh-6rem)] justify-center px-5 py-12 sm:px-6 sm:py-20 md:py-28">
      <section className="w-full max-w-4xl">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground sm:text-[0.7rem]">
          Vault workspace
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:mt-4 sm:text-5xl vault-display">
          Hello, {userLabel}
        </h1>

        <div className="mt-8 flex flex-col gap-3 sm:mt-12 sm:flex-row sm:items-end">
          <label className="group flex min-w-0 flex-1 items-center gap-2 border-b border-border/80 pb-1.5 transition focus-within:border-foreground sm:gap-3 sm:pb-2">
            <Search className="size-4 shrink-0 text-muted-foreground transition group-focus-within:text-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              autoComplete="off"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:h-10 sm:text-xl"
            />
          </label>
          <form action={createDocumentAction}>
            <Button
              type="submit"
              variant="ghost"
              className="h-10 gap-2 border border-border/70 px-4 text-sm hover:bg-transparent hover:text-foreground sm:h-11 sm:border-x-0 sm:border-t-0 sm:px-3 sm:text-base"
            >
              <FilePlus2 className="size-4" />
              New document
            </Button>
          </form>
        </div>

        <div className="mt-9 sm:mt-12">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-xs sm:tracking-[0.18em]">
              {listLabel}
            </h2>
            <span className="text-xs text-muted-foreground">
              {visibleDocuments.length} shown
            </span>
          </div>
          <div className="mt-4 grid gap-0.5 sm:mt-5 sm:gap-1">
            {visibleDocuments.length > 0 ? (
              visibleDocuments.map((document) => (
                <Link
                  key={document.id}
                  href={document.href}
                  className="flex min-w-0 items-center justify-between gap-4 py-2 text-sm text-muted-foreground transition hover:text-foreground sm:py-2.5 sm:text-lg"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="size-3.5 shrink-0 sm:size-4" />
                    <span className="truncate">{document.title}</span>
                  </span>
                  <span className="shrink-0 text-xs">
                    {document.updatedAt.toLocaleDateString()}
                  </span>
                </Link>
              ))
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                {normalizedQuery ? "No matching documents." : "No documents yet."}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
