"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Flame,
  Globe2,
  Images,
  LayoutGrid,
  SquareArrowOutUpRight,
} from "lucide-react";

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
import type { WorkspacePublicDocumentItem } from "@/components/workspace/workspace-types";

const BROWSE = [
  { label: "Everything", href: "/gallery", icon: LayoutGrid },
  { label: "Documents", href: "/gallery?q=kind%3Adocument", icon: FileText },
  { label: "Assets", href: "/gallery?q=kind%3Aasset", icon: Images },
  { label: "Trending", href: "/gallery?q=sort%3Atrending", icon: Flame },
] as const;

/**
 * Gallery mode of the left panel: views of the public gallery as navigation,
 * a search that filters the list here and opens the full gallery on Enter,
 * and the public documents themselves.
 */
export function WorkspaceGalleryPanel({
  publicDocuments,
}: {
  publicDocuments: WorkspacePublicDocumentItem[];
}) {
  const router = useRouter();
  const isActive = useActiveHref();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase().replace(/^@/, "");
  const filteredDocuments = useMemo(() => {
    const docs = normalizedQuery
      ? publicDocuments.filter((document) =>
          [document.title, document.ownerName, document.ownerUsername, document.publicSlug]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedQuery)),
        )
      : publicDocuments;

    return docs.slice(0, 30);
  }, [normalizedQuery, publicDocuments]);

  return (
    <SidePanel>
      <SidePanelHeader
        icon={LayoutGrid}
        title="Gallery"
        subtitle="Public documents and assets"
        actions={
          <SidePanelAction icon={SquareArrowOutUpRight} label="Open gallery" href="/gallery" />
        }
      />
      <SidePanelToolbar>
        <SidePanelSearch
          value={query}
          onChange={setQuery}
          onSubmit={() =>
            router.push(
              normalizedQuery ? `/gallery?q=${encodeURIComponent(query.trim())}` : "/gallery",
            )
          }
          placeholder="Title or @user · Enter for all"
          label="Search the gallery"
        />
      </SidePanelToolbar>

      <SidePanelBody>
        {normalizedQuery ? null : (
          <SidePanelSection title="Browse">
            {BROWSE.map((item) => (
              <SidePanelNavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                active={isActive(item.href, { filterKeys: ["q"] })}
              />
            ))}
          </SidePanelSection>
        )}

        <SidePanelSection
          title={normalizedQuery ? "Matching documents" : "Public documents"}
          count={filteredDocuments.length}
        >
          {filteredDocuments.length > 0 ? (
            filteredDocuments.map((document) => (
              <SidePanelNavItem
                key={document.id}
                href={document.href}
                icon={Globe2}
                label={document.title}
                detail={
                  document.ownerUsername
                    ? `@${document.ownerUsername}`
                    : document.ownerName ?? "Unknown owner"
                }
                active={isActive(document.href)}
              />
            ))
          ) : (
            <SidePanelEmpty>
              {normalizedQuery
                ? "No public documents match. Press Enter to search assets too."
                : "Nothing has been published yet."}
            </SidePanelEmpty>
          )}
        </SidePanelSection>
      </SidePanelBody>
    </SidePanel>
  );
}
