"use client";

import { useMemo, useState } from "react";
import { BookOpen, FileText, Library } from "lucide-react";

import {
  SidePanel,
  SidePanelAction,
  SidePanelBody,
  SidePanelEmpty,
  SidePanelHeader,
  SidePanelNavItem,
  SidePanelSearch,
  SidePanelSection,
  SidePanelToolbar,
  useActiveHref,
} from "@/components/workspace/SidePanel";
import type { WorkspaceGuideGroup } from "@/components/workspace/workspace-types";

/**
 * Docs mode of the left panel: the official guides by category, with a filter.
 * Categories collapse; the one holding the open guide always starts expanded,
 * and the rest start collapsed only once the catalogue gets long.
 */
export function WorkspaceDocsPanel({
  docs,
}: {
  docs: WorkspaceGuideGroup[];
}) {
  const isActive = useActiveHref();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      docs
        .map((group) => ({
          ...group,
          docs: normalizedQuery
            ? group.docs.filter((doc) =>
                `${doc.title} ${group.category}`.toLowerCase().includes(normalizedQuery),
              )
            : group.docs,
        }))
        .filter((group) => group.docs.length > 0),
    [docs, normalizedQuery],
  );
  const guideCount = docs.reduce((sum, group) => sum + group.docs.length, 0);
  // Collapse only long catalogues; a short one reads better fully open.
  const collapseByDefault = guideCount > 30;

  return (
    <SidePanel>
      <SidePanelHeader
        icon={BookOpen}
        title="Docs"
        subtitle={`${guideCount} official guide${guideCount === 1 ? "" : "s"}`}
        actions={<SidePanelAction icon={Library} label="All docs" href="/docs" />}
      />
      <SidePanelToolbar>
        <SidePanelSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter guides"
          label="Filter guides"
        />
      </SidePanelToolbar>

      <SidePanelBody>
        {groups.length > 0 ? (
          groups.map((group) => {
            const holdsActive = group.docs.some((doc) => isActive(doc.href));

            return (
              <SidePanelSection
                // Re-key on filtering so matches always show expanded.
                key={`${group.category}-${normalizedQuery ? "q" : ""}`}
                title={group.category}
                count={group.docs.length}
                collapsible
                defaultOpen={Boolean(normalizedQuery) || holdsActive || !collapseByDefault}
              >
                {group.docs.map((doc) => (
                  <SidePanelNavItem
                    key={doc.id}
                    href={doc.href}
                    icon={FileText}
                    label={doc.title}
                    active={isActive(doc.href)}
                  />
                ))}
              </SidePanelSection>
            );
          })
        ) : (
          <SidePanelEmpty>
            {normalizedQuery ? "No guides match." : "No published docs yet."}
          </SidePanelEmpty>
        )}
      </SidePanelBody>
    </SidePanel>
  );
}
