import type { MetadataRoute } from "next";

import { getPrivacyPage, getTermsPage } from "@/lib/repo-docs";
import { getAbsoluteSiteUrl } from "@/lib/site-url";
import { listPublicDocuments } from "@/server/documents";
import { listPublishedOfficialDocs } from "@/server/official-docs";

export const dynamic = "force-dynamic";

type SitemapEntry = MetadataRoute.Sitemap[number];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [publicDocuments, officialDocs, termsPage, privacyPage] = await Promise.all([
    listPublicDocuments(),
    listPublishedOfficialDocs(),
    getTermsPage(),
    getPrivacyPage(),
  ]);

  return [
    page("/", {
      changeFrequency: "weekly",
      priority: 1,
    }),
    page("/docs", {
      changeFrequency: "weekly",
      priority: 0.8,
    }),
    page("/terms", {
      lastModified: termsPage?.updatedAt,
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    page("/privacy", {
      lastModified: privacyPage?.updatedAt,
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    ...officialDocs.map((doc) =>
      page(`/docs/guides/${doc.slug}`, {
        lastModified: doc.updatedAt,
        changeFrequency: "monthly",
        priority: 0.7,
      }),
    ),
    ...publicDocuments
      .filter((document) => document.publicSlug)
      .map((document) =>
        page(`/public/${document.publicSlug}`, {
          lastModified: document.updatedAt,
          changeFrequency: "weekly",
          priority: 0.6,
        }),
      ),
  ];
}

function page(
  pathname: string,
  options: Omit<SitemapEntry, "url"> = {},
): SitemapEntry {
  return {
    url: getAbsoluteSiteUrl(pathname),
    ...options,
  };
}
