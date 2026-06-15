"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, FileText, Globe2, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  WorkspaceDocumentItem,
  WorkspaceGuideGroup,
  WorkspacePublicDocumentItem,
} from "@/components/workspace/workspace-types";

type SearchResult = {
  key: string;
  title: string;
  href: string;
  detail: string;
  kind: "document" | "public" | "guide";
};

export function WorkspaceSearchPanel({
  owned,
  shared,
  publicDocuments,
  guideGroups,
  activeHref,
}: {
  owned: WorkspaceDocumentItem[];
  shared: WorkspaceDocumentItem[];
  publicDocuments: WorkspacePublicDocumentItem[];
  guideGroups: WorkspaceGuideGroup[];
  activeHref?: string;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase().replace(/^@/, "");
  const results = useMemo(() => {
    const localDocs: SearchResult[] = [
      ...owned.map((doc) => toDocumentResult(doc, "Mine")),
      ...shared.map((doc) => toDocumentResult(doc, `Shared ${doc.role ?? ""}`.trim())),
      ...publicDocuments.map((doc) => ({
        key: `public-${doc.id}`,
        title: doc.title,
        href: doc.href,
        detail: `Public${doc.ownerUsername ? ` @${doc.ownerUsername}` : ""}`,
        kind: "public" as const,
      })),
      ...guideGroups.flatMap((group) =>
        group.docs.map((doc) => ({
          key: `guide-${doc.id}`,
          title: doc.title,
          href: doc.href,
          detail: `Guide / ${group.category}`,
          kind: "guide" as const,
        })),
      ),
    ];

    const filtered = normalizedQuery
      ? localDocs.filter((item) =>
          `${item.title} ${item.detail}`.toLowerCase().includes(normalizedQuery),
        )
      : localDocs.slice(0, 10);

    return filtered.slice(0, 18);
  }, [guideGroups, normalizedQuery, owned, publicDocuments, shared]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Search
        </p>
        <label className="mt-2 flex h-8 items-center gap-2 border border-border/70 bg-background/55 px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Files, public docs, guides"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {normalizedQuery ? "Matches" : "Quick open"}
        </p>
        <div className="grid gap-0.5">
          {results.length > 0 ? (
            results.map((result) => (
              <SearchResultRow
                key={result.key}
                result={result}
                active={activeHref === result.href}
              />
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No matching workspace items.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchResultRow({
  result,
  active,
}: {
  result: SearchResult;
  active: boolean;
}) {
  const Icon =
    result.kind === "document" ? FileText : result.kind === "guide" ? BookOpen : Globe2;

  return (
    <Link
      href={result.href}
      className={cn(
        "grid grid-cols-[1rem_1fr] gap-x-2 rounded-[5px] px-2 py-1.5 text-sm transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-3.5" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{result.title}</span>
        <span className="block truncate text-xs opacity-70">{result.detail}</span>
      </span>
    </Link>
  );
}

function toDocumentResult(doc: WorkspaceDocumentItem, detail: string): SearchResult {
  return {
    key: `document-${doc.id}`,
    title: doc.title,
    href: doc.href,
    detail,
    kind: "document",
  };
}
