"use client";

import { useMemo, useState } from "react";
import { BookOpen, FileText, Globe2, Search, Users } from "lucide-react";

import {
  SidePanel,
  SidePanelBody,
  SidePanelEmpty,
  SidePanelHeader,
  SidePanelNavItem,
  SidePanelSearch,
  SidePanelSection,
  SidePanelToolbar,
  useActiveHref,
} from "@/components/workspace/SidePanel";
import { openWorkspaceCommandPalette } from "@/components/workspace/WorkspaceCommandPalette";
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
};

type ResultGroup = {
  id: "mine" | "shared" | "public" | "guides";
  title: string;
  icon: typeof FileText;
  results: SearchResult[];
};

const PER_GROUP = 8;

/**
 * Search mode of the left panel: one field over your documents, documents
 * shared with you, public documents, and guides, grouped by where each result
 * lives. With no query it shows the most recent of each as quick-open lists.
 */
export function WorkspaceSearchPanel({
  owned,
  shared,
  publicDocuments,
  guideGroups,
}: {
  owned: WorkspaceDocumentItem[];
  shared: WorkspaceDocumentItem[];
  publicDocuments: WorkspacePublicDocumentItem[];
  guideGroups: WorkspaceGuideGroup[];
}) {
  const isActive = useActiveHref();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase().replace(/^@/, "");

  const groups = useMemo<ResultGroup[]>(() => {
    const matches = (result: SearchResult) =>
      !normalizedQuery ||
      `${result.title} ${result.detail}`.toLowerCase().includes(normalizedQuery);

    return [
      {
        id: "mine" as const,
        title: "Your documents",
        icon: FileText,
        results: owned.map((doc) => ({
          key: `mine-${doc.id}`,
          title: doc.title,
          href: doc.href,
          detail: doc.visibility === "public" ? "Published" : "Private",
        })),
      },
      {
        id: "shared" as const,
        title: "Shared with you",
        icon: Users,
        results: shared.map((doc) => ({
          key: `shared-${doc.id}`,
          title: doc.title,
          href: doc.href,
          detail:
            [doc.ownerUsername ? `@${doc.ownerUsername}` : doc.ownerName, doc.role]
              .filter(Boolean)
              .join(" · ") || "Shared",
        })),
      },
      {
        id: "public" as const,
        title: "Public",
        icon: Globe2,
        results: publicDocuments.map((doc) => ({
          key: `public-${doc.id}`,
          title: doc.title,
          href: doc.href,
          detail: doc.ownerUsername ? `@${doc.ownerUsername}` : doc.ownerName ?? "Public",
        })),
      },
      {
        id: "guides" as const,
        title: "Guides",
        icon: BookOpen,
        results: guideGroups.flatMap((group) =>
          group.docs.map((doc) => ({
            key: `guide-${doc.id}`,
            title: doc.title,
            href: doc.href,
            detail: group.category,
          })),
        ),
      },
    ].map((group) => ({ ...group, results: group.results.filter(matches) }));
  }, [guideGroups, normalizedQuery, owned, publicDocuments, shared]);

  const total = groups.reduce((sum, group) => sum + group.results.length, 0);

  return (
    <SidePanel>
      <SidePanelHeader
        icon={Search}
        title="Search"
        subtitle="Documents, shared, public, guides"
      />
      <SidePanelToolbar>
        <SidePanelSearch
          value={query}
          onChange={setQuery}
          placeholder="Type to filter…"
          label="Search the workspace"
        />
      </SidePanelToolbar>

      <SidePanelBody>
        {normalizedQuery && total === 0 ? (
          <SidePanelEmpty>
            Nothing matches “{query.trim()}”. The command palette (Ctrl K) also searches
            commands and document text.{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openWorkspaceCommandPalette()}
            >
              Open it
            </button>
          </SidePanelEmpty>
        ) : null}

        {groups.map((group) =>
          group.results.length > 0 ? (
            <SidePanelSection
              key={group.id}
              title={group.title}
              count={group.results.length}
              collapsible
            >
              {group.results.slice(0, normalizedQuery ? 25 : PER_GROUP).map((result) => (
                <SidePanelNavItem
                  key={result.key}
                  href={result.href}
                  icon={group.icon}
                  label={result.title}
                  detail={result.detail}
                  active={isActive(result.href)}
                />
              ))}
            </SidePanelSection>
          ) : null,
        )}
      </SidePanelBody>
    </SidePanel>
  );
}
