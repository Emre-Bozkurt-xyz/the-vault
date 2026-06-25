"use server";

import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  assetTags,
  documentTags,
  tagAliases,
  tags,
  type TagCategory,
} from "@/db/schema";
import { normalizeTagSlug, tagDisplayName } from "@/lib/content-metadata";
import { requireAdmin } from "@/server/authz";

const tagCategories = [
  "general",
  "topic",
  "person",
  "place",
  "project",
  "technical",
] as const satisfies readonly TagCategory[];

const tagIdSchema = z.string().uuid();
const aliasIdSchema = z.string().uuid();
const tagCategorySchema = z.enum(tagCategories);
const tagInputSchema = z.object({
  slug: z.string().trim().min(1).max(64),
  displayName: z.string().trim().max(80).optional(),
  category: tagCategorySchema.default("general"),
  description: z.string().trim().max(500).optional(),
});

const tagUpdateSchema = tagInputSchema.extend({
  tagId: tagIdSchema,
});

const aliasInputSchema = z.object({
  tagId: tagIdSchema,
  aliasSlug: z.string().trim().min(1).max(64),
});

export type AdminTagListItem = {
  id: string;
  slug: string;
  displayName: string;
  category: TagCategory;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  documentCount: number;
  assetCount: number;
  aliases: Array<{
    id: string;
    aliasSlug: string;
  }>;
};

export async function listTagsForAdmin(
  query?: string,
): Promise<AdminTagListItem[]> {
  await requireAdmin();

  const trimmedQuery = query?.trim();
  const likeQuery = trimmedQuery ? `%${escapeLike(trimmedQuery)}%` : null;
  const rows = await db
    .select({
      id: tags.id,
      slug: tags.slug,
      displayName: tags.displayName,
      category: tags.category,
      description: tags.description,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
      documentCount: sql<number>`(
        select count(*)::int from ${documentTags}
        where ${documentTags.tagId} = ${tags.id}
      )`,
      assetCount: sql<number>`(
        select count(*)::int from ${assetTags}
        where ${assetTags.tagId} = ${tags.id}
      )`,
    })
    .from(tags)
    .where(
      likeQuery
        ? sql`(
            ${tags.slug} ilike ${likeQuery} escape '\\'
            or ${tags.displayName} ilike ${likeQuery} escape '\\'
            or coalesce(${tags.description}, '') ilike ${likeQuery} escape '\\'
          )`
        : undefined,
    )
    .orderBy(asc(tags.slug))
    .limit(200);

  const aliasesByTag = new Map<string, AdminTagListItem["aliases"]>();
  const tagIds = rows.map((row) => row.id);

  if (tagIds.length > 0) {
    const aliasRows = await db
      .select({
        id: tagAliases.id,
        tagId: tagAliases.tagId,
        aliasSlug: tagAliases.aliasSlug,
      })
      .from(tagAliases)
      .where(inArray(tagAliases.tagId, tagIds))
      .orderBy(asc(tagAliases.aliasSlug));

    for (const alias of aliasRows) {
      aliasesByTag.set(alias.tagId, [
        ...(aliasesByTag.get(alias.tagId) ?? []),
        { id: alias.id, aliasSlug: alias.aliasSlug },
      ]);
    }
  }

  return rows.map((row) => ({
    ...row,
    documentCount: Number(row.documentCount),
    assetCount: Number(row.assetCount),
    aliases: aliasesByTag.get(row.id) ?? [],
  }));
}

export async function createTagAction(formData: FormData) {
  await requireAdmin();
  const input = parseTagInput(formData);

  await db
    .insert(tags)
    .values({
      slug: input.slug,
      displayName: input.displayName || tagDisplayName(input.slug),
      category: input.category,
      description: input.description || null,
    })
    .onConflictDoNothing();

  revalidatePath("/dashboard/admin/tags");
}

export async function updateTagAction(formData: FormData) {
  await requireAdmin();
  const input = tagUpdateSchema.parse({
    tagId: formData.get("tagId"),
    ...parseTagInput(formData),
  });

  await db
    .update(tags)
    .set({
      slug: input.slug,
      displayName: input.displayName || tagDisplayName(input.slug),
      category: input.category,
      description: input.description || null,
      updatedAt: sql`now()`,
    })
    .where(eq(tags.id, input.tagId));

  revalidatePath("/dashboard/admin/tags");
}

export async function deleteUnusedTagAction(formData: FormData) {
  await requireAdmin();
  const tagId = tagIdSchema.parse(formData.get("tagId"));

  await db
    .delete(tags)
    .where(
      and(
        eq(tags.id, tagId),
        sql`not exists (
          select 1 from ${documentTags}
          where ${documentTags.tagId} = ${tags.id}
        )`,
        sql`not exists (
          select 1 from ${assetTags}
          where ${assetTags.tagId} = ${tags.id}
        )`,
        sql`not exists (
          select 1 from ${tagAliases}
          where ${tagAliases.tagId} = ${tags.id}
        )`,
      ),
    );

  revalidatePath("/dashboard/admin/tags");
}

export async function deleteAllUnusedTagsAction() {
  await requireAdmin();

  await db
    .delete(tags)
    .where(
      and(
        sql`not exists (
          select 1 from ${documentTags}
          where ${documentTags.tagId} = ${tags.id}
        )`,
        sql`not exists (
          select 1 from ${assetTags}
          where ${assetTags.tagId} = ${tags.id}
        )`,
        sql`not exists (
          select 1 from ${tagAliases}
          where ${tagAliases.tagId} = ${tags.id}
        )`,
      ),
    );

  revalidatePath("/dashboard/admin/tags");
}

export async function createTagAliasAction(formData: FormData) {
  await requireAdmin();
  const input = aliasInputSchema.parse({
    tagId: formData.get("tagId"),
    aliasSlug: normalizeSingleTag(formData.get("aliasSlug")),
  });

  await db
    .insert(tagAliases)
    .values({
      tagId: input.tagId,
      aliasSlug: input.aliasSlug,
    })
    .onConflictDoNothing();

  revalidatePath("/dashboard/admin/tags");
}

export async function deleteTagAliasAction(formData: FormData) {
  await requireAdmin();
  const aliasId = aliasIdSchema.parse(formData.get("aliasId"));

  await db.delete(tagAliases).where(eq(tagAliases.id, aliasId));

  revalidatePath("/dashboard/admin/tags");
}

export async function getAdminTagCategories() {
  return tagCategories;
}

function parseTagInput(formData: FormData) {
  return tagInputSchema.parse({
    slug: normalizeSingleTag(formData.get("slug")),
    displayName: formData.get("displayName") || undefined,
    category: formData.get("category") || "general",
    description: formData.get("description") || undefined,
  });
}

function normalizeSingleTag(value: unknown) {
  return normalizeTagSlug(String(value ?? "")).split(/\s+/)[0] ?? "";
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
