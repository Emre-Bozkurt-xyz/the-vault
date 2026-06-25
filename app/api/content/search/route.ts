import { NextResponse } from "next/server";

import {
  matchesContentSearchQuery,
  parseContentSearchQuery,
} from "@/lib/content-search-query";
import { parseDocumentMetadata } from "@/lib/content-metadata";
import { listAssetsForUser } from "@/server/assets";
import {
  listDocumentsForUser,
  listPublicDocuments,
  listSharedDocumentsForUser,
} from "@/server/documents";
import { listPublishedOfficialDocs } from "@/server/official-docs";
import { requireActiveUser } from "@/server/authz";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q") ?? "";
  const query = parseContentSearchQuery(rawQuery);
  const [owned, shared, publicDocs, assets, guides] = await Promise.all([
    listDocumentsForUser(user.id),
    listSharedDocumentsForUser(user.id),
    listPublicDocuments({ userId: user.id }),
    listAssetsForUser(user.id),
    listPublishedOfficialDocs(),
  ]);

  const ownedResults = owned.map((document) => {
    const metadata = parseDocumentMetadata(document.markdown);

    return {
      id: `document-${document.id}`,
      kind: "document" as const,
      title: document.title,
      href: `/docs/${document.id}`,
      detail: "My document",
      searchable: {
        title: document.title,
        description: document.markdown,
        summary: [
          metadata.summary,
          metadata.aliases.join(" "),
          metadata.status,
          metadata.project,
        ]
          .filter(Boolean)
          .join(" "),
        kind: "document",
        visibility: document.visibility,
        tags: metadata.tags,
      },
    };
  });
  const sharedResults = shared.map((document) => {
    const metadata = parseDocumentMetadata(document.markdown);

    return {
      id: `shared-${document.id}`,
      kind: "document" as const,
      title: document.title,
      href: `/docs/${document.id}`,
      detail: `Shared ${document.role}`,
      searchable: {
        title: document.title,
        description: document.markdown,
        summary: [
          metadata.summary,
          metadata.aliases.join(" "),
          metadata.status,
          metadata.project,
        ]
          .filter(Boolean)
          .join(" "),
        kind: "document",
        visibility: document.visibility,
        tags: metadata.tags,
      },
    };
  });
  const guideResults = guides.map((guide) => ({
    id: `guide-${guide.id}`,
    kind: "guide" as const,
    title: guide.title,
    href: `/docs/guides/${guide.slug}`,
    detail: `Guide / ${guide.category}`,
    searchable: {
      title: guide.title,
      description: guide.markdown,
      kind: "guide",
    },
  }));
  const assetResults = assets.map((asset) => ({
    id: `asset-${asset.id}`,
    kind: "asset" as const,
    title: asset.displayName,
    href: "/assets",
    detail: `${asset.kind} asset - ${asset.visibility}`,
    searchable: {
      title: asset.displayName,
      description: asset.description,
      altText: asset.altText,
      mimeType: asset.mimeType,
      kind: asset.kind,
      visibility: asset.visibility,
      tags: asset.tags,
    },
  }));
  const publicResults = publicDocs.map((document) => ({
      id: `public-${document.id}`,
      kind: "public" as const,
      title: document.title,
      href: document.publicSlug
        ? `/workspace/public/${document.publicSlug}`
        : "/gallery",
      detail: `Public${document.ownerUsername ? ` @${document.ownerUsername}` : ""}`,
      searchable: {
        title: document.title,
        description: document.markdown,
        ownerName: document.ownerName,
        ownerUsername: document.ownerUsername,
        publicSlug: document.publicSlug,
        kind: "document",
        visibility: "public",
        tags: document.tags,
      },
    }));
  const results = [
    ...ownedResults,
    ...sharedResults,
    ...guideResults,
    ...assetResults,
    ...publicResults,
  ];

  const filtered = rawQuery.trim()
    ? results.filter((result) =>
        matchesContentSearchQuery(result.searchable, query),
      )
    : results;

  return NextResponse.json({
    results: filtered
      .slice(0, 24)
      .map(({ searchable: _searchable, ...result }) => result),
  });
}
