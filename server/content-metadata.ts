"use server";

import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  assets,
  assetTags,
  documentMetadata,
  documentPermissions,
  documentTags,
  documents,
  tags,
} from "@/db/schema";
import {
  normalizeTagList,
  normalizeTagSlug,
  parseDocumentMetadata,
  tagDisplayName,
} from "@/lib/content-metadata";

type MetadataExecutor = Pick<typeof db, "delete" | "insert" | "select">;

export type TagSuggestionScope = "mine" | "public";

export async function syncDocumentMetadata(input: {
  documentId: string;
  markdown: string;
}) {
  const metadata = parseDocumentMetadata(input.markdown);

  await db.transaction(async (tx) => {
    await syncDocumentMetadataWithExecutor(tx, input.documentId, metadata);
  });
}

export async function syncAssetTags(input: {
  assetId: string;
  tags: string[];
}) {
  const normalizedTags = normalizeTagList(input.tags);

  await db.transaction(async (tx) => {
    await syncTagsForAssetWithExecutor(tx, input.assetId, normalizedTags);
  });
}

export async function syncDocumentMetadataWithExecutor(
  tx: MetadataExecutor,
  documentId: string,
  metadata: ReturnType<typeof parseDocumentMetadata>,
) {
  await tx
    .insert(documentMetadata)
    .values({
      documentId,
      aliases: metadata.aliases,
      summary: metadata.summary,
      status: metadata.status,
      project: metadata.project,
    })
    .onConflictDoUpdate({
      target: documentMetadata.documentId,
      set: {
        aliases: metadata.aliases,
        summary: metadata.summary,
        status: metadata.status,
        project: metadata.project,
        updatedAt: sql`now()`,
      },
    });

  await syncTagsForDocumentWithExecutor(tx, documentId, metadata.tags);
}

export async function listTagSuggestions(input: {
  userId?: string | null;
  query: string;
  scope: TagSuggestionScope;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 30);
  const normalizedQuery = normalizeTagSlug(input.query);
  const tagWhere = normalizedQuery
    ? ilike(tags.slug, `${normalizedQuery.replace(/[%_]/g, "\\$&")}%`)
    : undefined;
  const assetWhere =
    input.scope === "public"
      ? and(
          eq(assets.visibility, "public"),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        )
      : input.userId
        ? and(
            eq(assets.ownerId, input.userId),
            eq(assets.status, "ready"),
            isNull(assets.deletedAt),
          )
        : undefined;
  const documentWhere =
    input.scope === "public"
      ? and(
          eq(documents.visibility, "public"),
          isNull(documents.deletedAt),
        )
      : input.userId
        ? and(
            isNull(documents.deletedAt),
            or(
              eq(documents.ownerId, input.userId),
              eq(documentPermissions.userId, input.userId),
            ),
          )
        : undefined;

  if (!assetWhere || !documentWhere) {
    return [];
  }

  const [assetRows, documentRows] = await Promise.all([
    db
      .select({
        slug: tags.slug,
        displayName: tags.displayName,
        category: tags.category,
        count: sql<number>`count(distinct ${assetTags.assetId})`,
      })
      .from(assetTags)
      .innerJoin(tags, eq(assetTags.tagId, tags.id))
      .innerJoin(assets, eq(assetTags.assetId, assets.id))
      .where(tagWhere ? and(assetWhere, tagWhere) : assetWhere)
      .groupBy(tags.slug, tags.displayName, tags.category),
    db
      .select({
        slug: tags.slug,
        displayName: tags.displayName,
        category: tags.category,
        count: sql<number>`count(distinct ${documentTags.documentId})`,
      })
      .from(documentTags)
      .innerJoin(tags, eq(documentTags.tagId, tags.id))
      .innerJoin(documents, eq(documentTags.documentId, documents.id))
      .leftJoin(
        documentPermissions,
        eq(documentPermissions.documentId, documents.id),
      )
      .where(tagWhere ? and(documentWhere, tagWhere) : documentWhere)
      .groupBy(tags.slug, tags.displayName, tags.category),
  ]);

  const suggestions = new Map<
    string,
    {
      slug: string;
      displayName: string;
      category: string;
      assetCount: number;
      documentCount: number;
    }
  >();

  for (const row of assetRows) {
    const current = suggestions.get(row.slug);

    if (current) {
      current.assetCount = Number(row.count);
      continue;
    }

    suggestions.set(row.slug, {
      slug: row.slug,
      displayName: row.displayName,
      category: row.category,
      assetCount: Number(row.count),
      documentCount: 0,
    });
  }

  for (const row of documentRows) {
    const current = suggestions.get(row.slug);

    if (current) {
      current.documentCount = Number(row.count);
      continue;
    }

    suggestions.set(row.slug, {
      slug: row.slug,
      displayName: row.displayName,
      category: row.category,
      assetCount: 0,
      documentCount: Number(row.count),
    });
  }

  return [...suggestions.values()]
    .filter((suggestion) => suggestion.assetCount + suggestion.documentCount > 0)
    .sort((first, second) => {
      const firstTotal = first.assetCount + first.documentCount;
      const secondTotal = second.assetCount + second.documentCount;

      if (firstTotal !== secondTotal) {
        return secondTotal - firstTotal;
      }

      return first.slug.localeCompare(second.slug);
    })
    .slice(0, limit);
}

async function syncTagsForDocumentWithExecutor(
  tx: MetadataExecutor,
  documentId: string,
  tagSlugs: string[],
) {
  const tagIds = await ensureTags(tx, tagSlugs);

  await tx.delete(documentTags).where(eq(documentTags.documentId, documentId));

  if (tagIds.length === 0) {
    return;
  }

  await tx.insert(documentTags).values(
    tagIds.map((tagId) => ({
      documentId,
      tagId,
    })),
  );
}

async function syncTagsForAssetWithExecutor(
  tx: MetadataExecutor,
  assetId: string,
  tagSlugs: string[],
) {
  const tagIds = await ensureTags(tx, tagSlugs);

  await tx.delete(assetTags).where(eq(assetTags.assetId, assetId));

  if (tagIds.length === 0) {
    return;
  }

  await tx.insert(assetTags).values(
    tagIds.map((tagId) => ({
      assetId,
      tagId,
    })),
  );
}

async function ensureTags(tx: MetadataExecutor, tagSlugs: string[]) {
  const uniqueSlugs = [...new Set(tagSlugs)];

  if (uniqueSlugs.length === 0) {
    return [];
  }

  await tx
    .insert(tags)
    .values(
      uniqueSlugs.map((slug) => ({
        slug,
        displayName: tagDisplayName(slug),
      })),
    )
    .onConflictDoNothing();

  const rows = await tx
    .select({
      id: tags.id,
      slug: tags.slug,
    })
    .from(tags)
    .where(inArray(tags.slug, uniqueSlugs));

  const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
  return uniqueSlugs.map((slug) => bySlug.get(slug)).filter(Boolean) as string[];
}
