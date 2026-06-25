import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  assetTags,
  assets,
  documentAssets,
  tags,
  users,
  type AssetKind,
} from "@/db/schema";
import { extractAssetEmbedIds } from "@/lib/asset-embeds";
import {
  type ContentSearchQuery,
  contentSearchIsEmpty,
} from "@/lib/content-search-query";
import { normalizeTagSlug } from "@/lib/content-metadata";
import { canReadDocument } from "@/lib/permissions";
import { deleteAssetObject, getR2Bucket, putAssetObject } from "@/lib/storage/r2";
import { isUserBanActive } from "@/server/authz";
import { syncAssetTags } from "@/server/content-metadata";
import { getAssetContentStats } from "@/server/content-interactions";

const ALLOWED_MIME_TYPES: Record<string, { kind: AssetKind; extension: string }> = {
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/gif": { kind: "image", extension: "gif" },
  "application/pdf": { kind: "pdf", extension: "pdf" },
};

export class AssetError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "ASSET_ERROR",
  ) {
    super(message);
  }
}

export type ActiveAssetUser = {
  id: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
};

export type AssetResolution = {
  id: string;
  kind: AssetKind;
  url: string;
  altText: string | null;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export type AssetCompletion = {
  id: string;
  kind: AssetKind;
  displayName: string;
  description: string | null;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  visibility: "private" | "public";
  ownerUsername: string | null;
  scope: "mine" | "document";
  url: string;
  markdown: string;
};

export type PrivateEmbeddedAsset = {
  id: string;
  kind: AssetKind;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export async function getOptionalAssetUser(): Promise<ActiveAssetUser | null> {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      bannedAt: users.bannedAt,
      bannedUntil: users.bannedUntil,
      storageUsedBytes: users.storageUsedBytes,
      storageQuotaBytes: users.storageQuotaBytes,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user || isUserBanActive(user)) {
    return null;
  }

  return {
    id: user.id,
    storageUsedBytes: user.storageUsedBytes,
    storageQuotaBytes: user.storageQuotaBytes,
  };
}

export async function requireAssetUser() {
  const user = await getOptionalAssetUser();

  if (!user) {
    throw new AssetError("Sign in to upload assets.", 401, "UNAUTHENTICATED");
  }

  return user;
}

export function getAssetUploadLimits() {
  return {
    imageMaxBytes: readByteEnv("MAX_IMAGE_UPLOAD_BYTES", 10 * 1024 * 1024),
    pdfMaxBytes: readByteEnv("MAX_PDF_UPLOAD_BYTES", 25 * 1024 * 1024),
  };
}

export function buildAssetMarkdown(assetId: string, label?: string | null) {
  const cleanLabel = label?.trim().replaceAll("]", "").replaceAll("\n", " ");
  return cleanLabel ? `![[asset:${assetId}|${cleanLabel}]]` : `![[asset:${assetId}]]`;
}

export function buildAssetContentUrl(assetId: string, documentId?: string | null) {
  const basePath = process.env.ASSET_ROUTE_BASE_PATH || "/api/assets";
  const query = documentId ? `?doc=${encodeURIComponent(documentId)}` : "";
  return `${basePath.replace(/\/$/, "")}/${assetId}/content${query}`;
}

export async function createUploadedAsset(input: {
  userId: string;
  file: File;
  documentId?: string | null;
}) {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const validation = await validateAssetFile({
    buffer,
    declaredMimeType: input.file.type,
    filename: input.file.name,
  });
  const assetId = randomUUID();
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  const displayName = sanitizeFilename(input.file.name) || `asset.${validation.extension}`;
  const storageKey = buildObjectKey(input.userId, assetId, validation.extension);

  await reserveUserStorage(input.userId, buffer.byteLength);

  try {
    await db.insert(assets).values({
      id: assetId,
      ownerId: input.userId,
      uploaderId: input.userId,
      storageBucket: getR2Bucket(),
      storageKey,
      originalFilename: input.file.name || displayName,
      displayName,
      altText: validation.kind === "image" ? displayName : null,
      mimeType: validation.mimeType,
      detectedMimeType: validation.detectedMimeType,
      fileExtension: validation.extension,
      sizeBytes: buffer.byteLength,
      kind: validation.kind,
      status: "pending",
      checksumSha256,
    });

    await putAssetObject({
      key: storageKey,
      body: buffer,
      contentType: validation.mimeType,
    });

    await db
      .update(assets)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(assets.id, assetId));

    if (input.documentId) {
      await linkAssetToDocument({
        documentId: input.documentId,
        assetId,
        linkedBy: input.userId,
      });
    }
  } catch (error) {
    await markAssetFailed(assetId).catch(() => undefined);
    await releaseUserStorage(input.userId, buffer.byteLength).catch(() => undefined);
    throw error;
  }

  return {
    id: assetId,
    kind: validation.kind,
    displayName,
    mimeType: validation.mimeType,
    sizeBytes: buffer.byteLength,
    url: buildAssetContentUrl(assetId, input.documentId),
    markdown: buildAssetMarkdown(assetId, displayName),
  };
}

export async function linkAssetToDocument(input: {
  documentId: string;
  assetId: string;
  linkedBy: string;
}) {
  await db
    .insert(documentAssets)
    .values(input)
    .onConflictDoNothing({
      target: [documentAssets.documentId, documentAssets.assetId],
    });
}

export async function reconcileDocumentAssetLinks(input: {
  documentId: string;
  markdown: string;
}) {
  const embeddedAssetIds = [...new Set(extractAssetEmbedIds(input.markdown))];

  if (embeddedAssetIds.length === 0) {
    await db
      .delete(documentAssets)
      .where(eq(documentAssets.documentId, input.documentId));
    return;
  }

  await db
    .delete(documentAssets)
    .where(
      and(
        eq(documentAssets.documentId, input.documentId),
        notInArray(documentAssets.assetId, embeddedAssetIds),
      ),
    );
}

export async function listPrivateEmbeddedAssetsForPublish(input: {
  documentId: string;
  markdown: string;
}): Promise<PrivateEmbeddedAsset[]> {
  const embeddedAssetIds = [...new Set(extractAssetEmbedIds(input.markdown))];

  if (embeddedAssetIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
    })
    .from(documentAssets)
    .innerJoin(assets, eq(documentAssets.assetId, assets.id))
    .where(
      and(
        eq(documentAssets.documentId, input.documentId),
        inArray(documentAssets.assetId, embeddedAssetIds),
        eq(assets.visibility, "private"),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(desc(documentAssets.createdAt));
}

export async function linkExistingAssetToDocument(input: {
  userId: string;
  documentId: string;
  assetId: string;
}) {
  const [asset] = await db
    .select({
      id: assets.id,
      ownerId: assets.ownerId,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      ownerUsername: users.username,
    })
    .from(assets)
    .innerJoin(users, eq(assets.ownerId, users.id))
    .where(
      and(
        eq(assets.id, input.assetId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset) {
    throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
  }

  if (asset.ownerId !== input.userId) {
    const [existingLink] = await db
      .select({ assetId: documentAssets.assetId })
      .from(documentAssets)
      .where(
        and(
          eq(documentAssets.documentId, input.documentId),
          eq(documentAssets.assetId, input.assetId),
        ),
      )
      .limit(1);

    if (!existingLink) {
      throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
    }
  }

  await linkAssetToDocument({
    documentId: input.documentId,
    assetId: input.assetId,
    linkedBy: input.userId,
  });

  return {
    id: asset.id,
    kind: asset.kind,
    displayName: asset.displayName,
    description: asset.description,
    altText: asset.altText,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    visibility: asset.visibility,
    ownerUsername: asset.ownerUsername,
    scope: asset.ownerId === input.userId ? "mine" : "document",
    url: buildAssetContentUrl(asset.id, input.documentId),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  };
}

export async function listAssetCompletionsForDocument(input: {
  userId: string;
  documentId: string;
}): Promise<AssetCompletion[]> {
  const [ownedRows, documentRows] = await Promise.all([
    db
      .select({
        id: assets.id,
        kind: assets.kind,
        displayName: assets.displayName,
        description: assets.description,
        altText: assets.altText,
        mimeType: assets.mimeType,
        sizeBytes: assets.sizeBytes,
        visibility: assets.visibility,
        ownerUsername: users.username,
      })
      .from(assets)
      .innerJoin(users, eq(assets.ownerId, users.id))
      .where(
        and(
          eq(assets.ownerId, input.userId),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        ),
      )
      .orderBy(desc(assets.createdAt))
      .limit(80),
    db
      .select({
        id: assets.id,
        kind: assets.kind,
        displayName: assets.displayName,
        description: assets.description,
        altText: assets.altText,
        mimeType: assets.mimeType,
        sizeBytes: assets.sizeBytes,
        visibility: assets.visibility,
        ownerUsername: users.username,
      })
      .from(documentAssets)
      .innerJoin(assets, eq(documentAssets.assetId, assets.id))
      .innerJoin(users, eq(assets.ownerId, users.id))
      .where(
        and(
          eq(documentAssets.documentId, input.documentId),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        ),
      )
      .orderBy(desc(documentAssets.createdAt))
      .limit(80),
  ]);

  const completions = new Map<string, AssetCompletion>();

  for (const asset of ownedRows) {
    completions.set(asset.id, {
      ...asset,
      scope: "mine",
      url: buildAssetContentUrl(asset.id, input.documentId),
      markdown: buildAssetMarkdown(asset.id, asset.displayName),
    });
  }

  for (const asset of documentRows) {
    if (completions.has(asset.id)) {
      continue;
    }

    completions.set(asset.id, {
      ...asset,
      scope: "document",
      url: buildAssetContentUrl(asset.id, input.documentId),
      markdown: buildAssetMarkdown(asset.id, asset.displayName),
    });
  }

  return [...completions.values()];
}

export async function listAssetsForUser(userId: string) {
  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(eq(assets.ownerId, userId), eq(assets.status, "ready"), isNull(assets.deletedAt)),
    )
    .orderBy(desc(assets.createdAt));

  const tagMap = await listTagsForAssetIds(rows.map((asset) => asset.id));

  return rows.map((asset) => ({
    ...asset,
    tags: tagMap.get(asset.id) ?? [],
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  }));
}

export async function listPublicAssets(
  options: {
    userId?: string | null;
    query?: ContentSearchQuery;
    limit?: number;
  } = {},
) {
  const where = buildPublicAssetSearchWhere(options.query);
  const textTerms = options.query?.textTerms ?? [];
  const sort = options.query?.filters.sort;
  const useRelevanceSort = textTerms.length > 0 && sort !== "score" && sort !== "trending";

  const baseQuery = db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
      ownerName: users.name,
      ownerUsername: users.username,
    })
    .from(assets)
    .innerJoin(users, eq(assets.ownerId, users.id))
    .where(
      and(
        eq(assets.visibility, "public"),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
        where,
      ),
    );

  const rows = await (useRelevanceSort
    ? baseQuery.orderBy(desc(buildAssetRelevanceScore(textTerms)), desc(assets.createdAt))
    : baseQuery.orderBy(desc(assets.publishedAt), desc(assets.createdAt)));

  const limitedRows = options.limit ? rows.slice(0, options.limit) : rows;

  const assetIds = limitedRows.map((asset) => asset.id);
  const [tagMap, statsMap] = await Promise.all([
    listTagsForAssetIds(assetIds),
    getAssetContentStats(assetIds, options.userId),
  ]);

  return limitedRows.map((asset) => ({
    ...asset,
    tags: tagMap.get(asset.id) ?? [],
    stats: statsMap.get(asset.id) ?? {
      likeCount: 0,
      viewCount: 0,
      viewerHasLiked: false,
      score: 0,
      trendingScore: 0,
    },
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  }));
}

function buildAssetRelevanceScore(textTerms: string[]): SQL<number> {
  const termScores = textTerms.map((term) => {
    const pattern = `%${escapeLike(term)}%`;
    const tagSlug = normalizeTagSlug(term);
    const tagBoost = tagSlug
      ? sql<number>`case when ${publicAssetHasTag(tagSlug)} then 3 else 0 end`
      : sql<number>`0`;

    return sql<number>`(case
      when lower(${assets.displayName}) = ${term} then 8
      when lower(${assets.displayName}) like ${pattern} escape '\\' then 4
      else 0
    end + ${tagBoost}
    + case when
        lower(coalesce(${assets.description}, '')) like ${pattern} escape '\\'
        or lower(coalesce(${assets.altText}, '')) like ${pattern} escape '\\'
      then 2 else 0 end
    + case when
        lower(coalesce(${users.name}, '')) like ${pattern} escape '\\'
        or lower(coalesce(${users.username}, '')) like ${pattern} escape '\\'
      then 1 else 0 end)`;
  });

  return termScores.length === 1
    ? termScores[0]!
    : sql<number>`(${sql.join(termScores, sql` + `)})`;
}

function buildPublicAssetSearchWhere(query?: ContentSearchQuery) {
  if (!query || contentSearchIsEmpty(query)) {
    return undefined;
  }

  const conditions: SQL[] = [];

  if (
    query.filters.kind &&
    !["asset", "image", "pdf"].includes(query.filters.kind)
  ) {
    conditions.push(sql`false`);
  }

  if (query.filters.kind === "image" || query.filters.kind === "pdf") {
    conditions.push(eq(assets.kind, query.filters.kind));
  }

  if (query.filters.visibility && query.filters.visibility !== "public") {
    conditions.push(sql`false`);
  }

  if (query.filters.owner) {
    const ownerPattern = `%${escapeLike(query.filters.owner)}%`;
    conditions.push(sql`(
      lower(coalesce(${users.name}, '')) like ${ownerPattern} escape '\\'
      or lower(coalesce(${users.username}, '')) like ${ownerPattern} escape '\\'
    )`);
  }

  for (const tag of query.tagTerms) {
    conditions.push(publicAssetHasTag(tag));
  }

  for (const term of query.textTerms) {
    const pattern = `%${escapeLike(term)}%`;
    const tagSlug = normalizeTagSlug(term);
    conditions.push(sql`(
      lower(${assets.displayName}) like ${pattern} escape '\\'
      or lower(coalesce(${assets.description}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${assets.altText}, '')) like ${pattern} escape '\\'
      or lower(${assets.mimeType}) like ${pattern} escape '\\'
      or lower(coalesce(${users.name}, '')) like ${pattern} escape '\\'
      or lower(coalesce(${users.username}, '')) like ${pattern} escape '\\'
      or ${tagSlug ? publicAssetHasTag(tagSlug) : sql`false`}
    )`);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function publicAssetHasTag(tag: string) {
  return sql`exists (
    select 1
    from ${assetTags}
    inner join ${tags} on ${tags.id} = ${assetTags.tagId}
    where ${assetTags.assetId} = ${assets.id}
    and ${tags.slug} = ${tag}
  )`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function updateAssetForUser(input: {
  userId: string;
  assetId: string;
  displayName: string;
  altText?: string | null;
  description?: string | null;
  visibility: "private" | "public";
  tags?: string[];
}) {
  const displayName = input.displayName.trim().slice(0, 160);

  if (!displayName) {
    throw new AssetError("Display name is required.", 400, "DISPLAY_NAME_REQUIRED");
  }

  const [asset] = await db
    .update(assets)
    .set({
      displayName,
      altText: emptyToNull(input.altText)?.slice(0, 240) ?? null,
      description: emptyToNull(input.description)?.slice(0, 1000) ?? null,
      visibility: input.visibility,
      publishedAt: input.visibility === "public" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assets.id, input.assetId),
        eq(assets.ownerId, input.userId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .returning({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
    });

  if (!asset) {
    throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
  }

  if (input.tags) {
    await syncAssetTags({
      assetId: asset.id,
      tags: input.tags,
    });
  }

  return {
    ...asset,
    tags: await listTagsForAssetId(asset.id),
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  };
}

export async function getAssetForUser(userId: string, assetId: string) {
  const [asset] = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.ownerId, userId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset) {
    throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
  }

  return {
    ...asset,
    tags: await listTagsForAssetId(asset.id),
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  };
}

async function listTagsForAssetId(assetId: string) {
  const tagMap = await listTagsForAssetIds([assetId]);
  return tagMap.get(assetId) ?? [];
}

async function listTagsForAssetIds(assetIds: string[]) {
  const uniqueAssetIds = [...new Set(assetIds)];
  const tagMap = new Map<string, string[]>();

  if (uniqueAssetIds.length === 0) {
    return tagMap;
  }

  const rows = await db
    .select({
      assetId: assetTags.assetId,
      slug: tags.slug,
    })
    .from(assetTags)
    .innerJoin(tags, eq(assetTags.tagId, tags.id))
    .where(inArray(assetTags.assetId, uniqueAssetIds));

  for (const row of rows) {
    tagMap.set(row.assetId, [...(tagMap.get(row.assetId) ?? []), row.slug]);
  }

  return tagMap;
}

export async function softDeleteAssetForUser(input: {
  userId: string;
  assetId: string;
}) {
  const [asset] = await db
    .update(assets)
    .set({
      status: "deleted",
      visibility: "private",
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assets.id, input.assetId),
        eq(assets.ownerId, input.userId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .returning({
      id: assets.id,
      storageKey: assets.storageKey,
      sizeBytes: assets.sizeBytes,
    });

  if (!asset) {
    throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
  }

  await db
    .delete(documentAssets)
    .where(eq(documentAssets.assetId, input.assetId));
  await releaseUserStorage(input.userId, asset.sizeBytes);

  try {
    await deleteAssetObject(asset.storageKey);
  } catch (error) {
    console.error("Failed to delete R2 asset object", {
      assetId: input.assetId,
      storageKey: asset.storageKey,
      error,
    });
  }

  return { id: asset.id };
}

export async function listAssetResolutionsForDocument(
  documentId: string,
  userId: string | null,
) {
  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
    })
    .from(documentAssets)
    .innerJoin(assets, eq(documentAssets.assetId, assets.id))
    .where(
      and(
        eq(documentAssets.documentId, documentId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    );

  const canRead = await canReadDocument(userId, documentId);

  if (!canRead) {
    return {};
  }

  return Object.fromEntries(
    rows
      .filter((row) => userId || row.visibility === "public")
      .map((row) => [
        row.id,
        {
          id: row.id,
          kind: row.kind,
          displayName: row.displayName,
          altText: row.altText,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          url: buildAssetContentUrl(row.id, documentId),
        } satisfies AssetResolution,
      ]),
  );
}

export async function getReadableAsset(input: {
  assetId: string;
  userId: string | null;
  documentId?: string | null;
}) {
  const [asset] = await db
    .select({
      id: assets.id,
      ownerId: assets.ownerId,
      storageKey: assets.storageKey,
      displayName: assets.displayName,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      status: assets.status,
      deletedAt: assets.deletedAt,
    })
    .from(assets)
    .where(eq(assets.id, input.assetId))
    .limit(1);

  if (!asset || asset.status !== "ready" || asset.deletedAt) {
    return null;
  }

  if (asset.visibility === "public" || asset.ownerId === input.userId) {
    return asset;
  }

  if (input.documentId) {
    const [linked] = await db
      .select({ assetId: documentAssets.assetId })
      .from(documentAssets)
      .where(
        and(
          eq(documentAssets.documentId, input.documentId),
          eq(documentAssets.assetId, input.assetId),
        ),
      )
      .limit(1);

    if (
      input.userId &&
      linked &&
      (await canReadDocument(input.userId, input.documentId))
    ) {
      return asset;
    }
  }

  return null;
}

async function validateAssetFile(input: {
  buffer: Buffer;
  declaredMimeType?: string;
  filename: string;
}) {
  if (input.buffer.byteLength === 0) {
    throw new AssetError("Choose a non-empty file.", 400, "EMPTY_FILE");
  }

  const detected = await fileTypeFromBuffer(input.buffer);
  const detectedMimeType = detected?.mime;
  const allowed = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : null;

  if (!detectedMimeType || !allowed) {
    throw new AssetError("Unsupported file type.", 415, "UNSUPPORTED_TYPE");
  }

  const declaredMimeType = input.declaredMimeType || "application/octet-stream";
  const declaredAllowed =
    declaredMimeType === "application/octet-stream" ||
    declaredMimeType === "" ||
    declaredMimeType === detectedMimeType;

  if (!declaredAllowed) {
    throw new AssetError("File type does not match its contents.", 415, "TYPE_MISMATCH");
  }

  const limits = getAssetUploadLimits();
  const maxBytes =
    allowed.kind === "image" ? limits.imageMaxBytes : limits.pdfMaxBytes;

  if (input.buffer.byteLength > maxBytes) {
    throw new AssetError("File is too large.", 413, "FILE_TOO_LARGE");
  }

  return {
    kind: allowed.kind,
    mimeType: detectedMimeType,
    detectedMimeType,
    extension: detected?.ext ?? allowed.extension,
  };
}

async function reserveUserStorage(userId: string, sizeBytes: number) {
  const rows = await db
    .update(users)
    .set({
      storageUsedBytes: sql`${users.storageUsedBytes} + ${sizeBytes}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        sql`${users.storageUsedBytes} + ${sizeBytes} <= ${users.storageQuotaBytes}`,
      ),
    )
    .returning({ id: users.id });

  if (rows.length === 0) {
    throw new AssetError("Storage quota exceeded.", 413, "QUOTA_EXCEEDED");
  }
}

async function releaseUserStorage(userId: string, sizeBytes: number) {
  await db
    .update(users)
    .set({
      storageUsedBytes: sql`greatest(${users.storageUsedBytes} - ${sizeBytes}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

async function markAssetFailed(assetId: string) {
  await db
    .update(assets)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(assets.id, assetId));
}

function buildObjectKey(userId: string, assetId: string, extension: string) {
  return `users/${userId}/assets/${assetId}.${extension}`;
}

function sanitizeFilename(filename: string) {
  return filename
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/[^\w .()\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function readByteEnv(name: string, fallback: number) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function emptyToNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
