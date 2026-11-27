import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { parseDocumentAppearance } from "@/lib/content-metadata";

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  assetFolders,
  assetTags,
  assetUploads,
  assets,
  documentAssets,
  tags,
  users,
  type AssetKind,
  type AssetRenditionStatus,
} from "@/db/schema";
import { fileExtensionFromName } from "@/lib/asset-delivery";
import { servableRenditionVersion } from "@/lib/asset-renditions";
import {
  STORED_ASSET_STATUSES,
  binPurgeAt,
  readableStatusFor,
  transitionSources,
} from "@/lib/asset-lifecycle";
import { extractAssetEmbedIds } from "@/lib/asset-embeds";
import {
  type ContentSearchQuery,
  contentSearchIsEmpty,
} from "@/lib/content-search-query";
import { normalizeTagSlug } from "@/lib/content-metadata";
import { verifyEmbedSessionToken } from "@/lib/embed-session-token";
import { canReadDocument } from "@/lib/permissions";
import { deleteAssetObject, getR2Bucket, putAssetObject } from "@/lib/storage/r2";
import { isUserBanActive } from "@/server/authz";
import { syncAssetTags } from "@/server/content-metadata";
import { getUploadLimits } from "@/server/deployment-settings";
import { effectiveStorageQuotaSql, effectiveUnrestrictedUploadsSql } from "@/server/user-tiers";
import { getAssetContentStats } from "@/server/content-interactions";
import { deleteRenditionObjects, scheduleRenditionsAfterUpload } from "@/server/asset-renditions";

const ALLOWED_MIME_TYPES: Record<string, { kind: AssetKind; extension: string }> = {
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/gif": { kind: "image", extension: "gif" },
  "application/pdf": { kind: "pdf", extension: "pdf" },
  // Camera and phone clips. Served inline with byte ranges, so the browser
  // plays them directly; codecs it can't decode (some HEVC MOVs) still download.
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/x-m4v": { kind: "video", extension: "m4v" },
  "video/quicktime": { kind: "video", extension: "mov" },
  "video/webm": { kind: "video", extension: "webm" },
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

/**
 * `folder_id` kept only if that folder is still live, else the root. Used
 * wherever an asset becomes `ready` again (upload completion, restore): the
 * folder may have been binned meanwhile, and a ready asset inside a binned
 * folder would be invisible and outside the Bin.
 */
export const liveFolderOrRoot = sql`(select live.id from asset_folders live where live.id = "assets"."folder_id" and live.status = 'active')`;

export type ActiveAssetUser = {
  id: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  /** Admin grant: may upload any file type (stored as `kind: "file"`). */
  unrestrictedUploadsAllowed: boolean;
};

export type AssetResolution = {
  id: string;
  kind: AssetKind;
  url: string;
  altText: string | null;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * The display rendition (≤2048 px WebP, metadata stripped) for image
   * embeds; null/absent means use `url`. `url` stays the original, for Open
   * and Download.
   */
  displayUrl?: string | null;
  /** Pixel size, when known, so an image reserves its space before loading. */
  width?: number | null;
  height?: number | null;
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
      storageQuotaBytes: effectiveStorageQuotaSql(),
      unrestrictedUploadsAllowed: effectiveUnrestrictedUploadsSql(),
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
    unrestrictedUploadsAllowed: user.unrestrictedUploadsAllowed,
  };
}

export async function getUserStorageSummary(
  userId: string,
): Promise<{
  usedBytes: number;
  quotaBytes: number;
  unrestrictedUploadsAllowed: boolean;
}> {
  const [user] = await db
    .select({
      storageUsedBytes: users.storageUsedBytes,
      storageQuotaBytes: effectiveStorageQuotaSql(),
      unrestrictedUploadsAllowed: effectiveUnrestrictedUploadsSql(),
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    usedBytes: user?.storageUsedBytes ?? 0,
    quotaBytes: user?.storageQuotaBytes ?? 0,
    unrestrictedUploadsAllowed: user?.unrestrictedUploadsAllowed ?? false,
  };
}

export async function requireAssetUser() {
  const user = await getOptionalAssetUser();

  if (!user) {
    throw new AssetError("Sign in to upload assets.", 401, "UNAUTHENTICATED");
  }

  return user;
}

/**
 * Resolves the embed session bearer token's `vaultUserId` into an
 * {@link ActiveAssetUser}, exactly like a cookie session would. This is an
 * **identity assertion only** (docs/DEN_EMBED_BRIDGE.md) — it answers "who is
 * asking", never "are they allowed". Every caller must still run its own
 * permission check (`getReadableAsset`, `canEditDocumentWithOptionalShareLink`,
 * etc.) against the returned id; this function does not and must not bypass,
 * short-circuit, or widen any of those checks.
 */
async function resolveAssetUserFromEmbedSessionToken(
  token: string | null,
): Promise<ActiveAssetUser | null> {
  if (!token) {
    return null;
  }

  const payload = verifyEmbedSessionToken(token);

  if (!payload) {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      bannedAt: users.bannedAt,
      bannedUntil: users.bannedUntil,
      storageUsedBytes: users.storageUsedBytes,
      storageQuotaBytes: effectiveStorageQuotaSql(),
      unrestrictedUploadsAllowed: effectiveUnrestrictedUploadsSql(),
    })
    .from(users)
    .where(eq(users.id, payload.vaultUserId))
    .limit(1);

  if (!user || isUserBanActive(user)) {
    return null;
  }

  return {
    id: user.id,
    storageUsedBytes: user.storageUsedBytes,
    storageQuotaBytes: user.storageQuotaBytes,
    unrestrictedUploadsAllowed: user.unrestrictedUploadsAllowed,
  };
}

/**
 * Identity resolution for `/api/assets/[assetId]/content`, which an `<img>`
 * tag hits directly and therefore cannot attach an `Authorization` header —
 * the embed session token travels as a `?embed=` query param there instead
 * (see `buildAssetContentUrl`). Tries the Vault session cookie first, exactly
 * like every non-embed caller; only falls back to the token when there is no
 * cookie session.
 */
export async function getOptionalAssetUserForContentRequest(
  request: Request,
): Promise<ActiveAssetUser | null> {
  const cookieUser = await getOptionalAssetUser();

  if (cookieUser) {
    return cookieUser;
  }

  const embedToken = new URL(request.url).searchParams.get("embed");
  return resolveAssetUserFromEmbedSessionToken(embedToken);
}

/**
 * Identity resolution for the embed-aware asset routes that DO receive a
 * normal `Authorization` header from `fetch` calls inside the embed editor
 * (`/api/assets/completions`, `/api/assets/[id]/link`, `POST /api/assets`).
 * Same cookie-first, token-fallback contract as
 * {@link getOptionalAssetUserForContentRequest}.
 */
export async function getOptionalAssetUserFromRequest(
  request: Request,
): Promise<ActiveAssetUser | null> {
  const cookieUser = await getOptionalAssetUser();

  if (cookieUser) {
    return cookieUser;
  }

  const header =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);

  return resolveAssetUserFromEmbedSessionToken(match?.[1]?.trim() ?? null);
}

/**
 * {@link requireAssetUser}, but also accepting an embed session bearer token
 * when there is no Vault session cookie. Used by the upload/completions/link
 * routes so the embed editor (framed cross-origin, no cookie) can reach them.
 */
export async function requireAssetUserFromRequest(request: Request) {
  const user = await getOptionalAssetUserFromRequest(request);

  if (!user) {
    throw new AssetError("Sign in to upload assets.", 401, "UNAUTHENTICATED");
  }

  return user;
}

export function buildAssetMarkdown(assetId: string, label?: string | null) {
  const cleanLabel = label?.trim().replaceAll("]", "").replaceAll("\n", " ");
  return cleanLabel ? `![[asset:${assetId}|${cleanLabel}]]` : `![[asset:${assetId}]]`;
}

/**
 * Builds the content URL for an asset. The single URL-construction chokepoint
 * for every asset link/embed in the app (docs/DEN_EMBED_BRIDGE.md). `embedSessionToken`
 * is optional and only ever supplied by the embed editor page: an `<img>` tag
 * can't attach an `Authorization` header, so the embed session token travels
 * as a query param instead and `/api/assets/[assetId]/content` reads it back
 * as an identity assertion (see `getOptionalAssetUserForContentRequest`) —
 * the normal permission check still runs against the resolved user.
 */
export function buildAssetContentUrl(
  assetId: string,
  documentId?: string | null,
  embedSessionToken?: string | null,
) {
  const basePath = process.env.ASSET_ROUTE_BASE_PATH || "/api/assets";
  const params = new URLSearchParams();

  if (documentId) {
    params.set("doc", documentId);
  }

  if (embedSessionToken) {
    params.set("embed", embedSessionToken);
  }

  const query = params.toString();
  return `${basePath.replace(/\/$/, "")}/${assetId}/content${query ? `?${query}` : ""}`;
}

/**
 * Columns every asset list selects so the client can show renditions: the
 * displayed pixel size (reserves masonry space before the image loads) and the
 * rendition state behind {@link buildAssetRenditionUrls}.
 */
const assetMediaColumns = {
  width: assets.width,
  height: assets.height,
  takenAt: assets.takenAt,
  durationMs: assets.durationMs,
  renditionStatus: assets.renditionStatus,
  renditionVersion: assets.renditionVersion,
};

/**
 * Thumbnail and display URLs for an image asset, or nulls when it has none:
 * not a decodable image, or rendering failed for the current version. They
 * point at the permission-checked content route (`?r=`), which renders on the
 * first request if the upload-time render has not happened yet. `v` changes
 * with `RENDITION_VERSION`, so caches never serve an old rendition.
 */
export function buildAssetRenditionUrls(
  asset: {
    id: string;
    kind: string;
    mimeType: string;
    renditionStatus: AssetRenditionStatus;
    renditionVersion: number | null;
  },
  documentId?: string | null,
  embedSessionToken?: string | null,
) {
  const version = servableRenditionVersion(asset);

  if (version === null) {
    return { thumbUrl: null, displayUrl: null };
  }

  const base = buildAssetContentUrl(asset.id, documentId, embedSessionToken);
  const join = base.includes("?") ? "&" : "?";
  return {
    thumbUrl: `${base}${join}r=thumb&v=${version}`,
    displayUrl: `${base}${join}r=display&v=${version}`,
  };
}

export async function createUploadedAsset(input: {
  userId: string;
  file: File;
  documentId?: string | null;
  /** Media library folder, already checked live and owned by the caller. */
  folderId?: string | null;
  /** The uploader's effective "any file type" grant (override, else tier; server/user-tiers.ts). */
  allowAnyFileType?: boolean;
}) {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const validation = await classifyAssetBytes({
    head: buffer,
    sizeBytes: buffer.byteLength,
    declaredMimeType: input.file.type,
    filename: input.file.name,
    allowAnyFileType: input.allowAnyFileType ?? false,
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
      folderId: input.folderId ?? null,
    });

    await putAssetObject({
      key: storageKey,
      body: buffer,
      contentType:
        validation.kind === "file" ? "application/octet-stream" : validation.mimeType,
    });

    await db
      .update(assets)
      .set({ status: "ready", folderId: liveFolderOrRoot, updatedAt: new Date() })
      .where(eq(assets.id, assetId));

    if (validation.kind === "image") {
      scheduleRenditionsAfterUpload(assetId, buffer);
    }

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
  // The page cover (frontmatter `cover:`) is the document's file too.
  const coverAssetId = parseDocumentAppearance(input.markdown).coverAssetId;
  const embeddedAssetIds = [
    ...new Set([...extractAssetEmbedIds(input.markdown), ...(coverAssetId ? [coverAssetId] : [])]),
  ];

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
  // The cover is shown on the public page too.
  const coverAssetId = parseDocumentAppearance(input.markdown).coverAssetId;
  const embeddedAssetIds = [
    ...new Set([...extractAssetEmbedIds(input.markdown), ...(coverAssetId ? [coverAssetId] : [])]),
  ];

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
      folderId: assets.folderId,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
      ...assetMediaColumns,
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
    ...buildAssetRenditionUrls(asset),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  }));
}

/**
 * What the assets sidebar shows — per-kind counts and the newest few uploads —
 * computed in SQL instead of shipping the whole library to count it in the
 * browser. Same scope as {@link listAssetsForUser}: the user's ready, live assets.
 */
export async function summarizeAssetsForUser(userId: string, recentCount: number) {
  const scope = and(
    eq(assets.ownerId, userId),
    eq(assets.status, "ready"),
    isNull(assets.deletedAt),
  );
  const [[counts], [bin], recentRows] = await Promise.all([
    db
      .select({
        all: sql<number>`count(*)::int`,
        image: sql<number>`(count(*) filter (where ${assets.kind} = 'image'))::int`,
        pdf: sql<number>`(count(*) filter (where ${assets.kind} = 'pdf'))::int`,
        video: sql<number>`(count(*) filter (where ${assets.kind} = 'video'))::int`,
        file: sql<number>`(count(*) filter (where ${assets.kind} = 'file'))::int`,
        public: sql<number>`(count(*) filter (where ${assets.visibility} = 'public'))::int`,
      })
      .from(assets)
      .where(scope),
    db
      .select({
        count: sql<number>`(
          (select count(*) from ${assets} where ${assets.ownerId} = ${userId}
            and ${assets.status} = 'trashed' and ${assets.trashedViaFolderId} is null)
          + (select count(*) from ${assetFolders} where ${assetFolders.ownerId} = ${userId}
            and ${assetFolders.status} = 'trashed' and ${assetFolders.trashedViaFolderId} is null)
        )::int`,
      })
      .from(sql`(select 1) as one`),
    db
      .select({
        id: assets.id,
        kind: assets.kind,
        displayName: assets.displayName,
        sizeBytes: assets.sizeBytes,
        mimeType: assets.mimeType,
        createdAt: assets.createdAt,
        ...assetMediaColumns,
      })
      .from(assets)
      .where(scope)
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(Math.max(0, Math.floor(recentCount))),
  ]);

  return {
    counts: counts ?? { all: 0, image: 0, pdf: 0, video: 0, file: 0, public: 0 },
    binCount: bin?.count ?? 0,
    recent: recentRows.map((asset) => ({
      ...asset,
      url: buildAssetContentUrl(asset.id),
      ...buildAssetRenditionUrls(asset),
    })),
  };
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
      ...assetMediaColumns,
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
    ...buildAssetRenditionUrls(asset),
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
    !["asset", "image", "pdf", "video", "file"].includes(query.filters.kind)
  ) {
    conditions.push(sql`false`);
  }

  if (
    query.filters.kind === "image" ||
    query.filters.kind === "pdf" ||
    query.filters.kind === "video" ||
    query.filters.kind === "file"
  ) {
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
      // Saving other details of a public asset keeps when it was published.
      publishedAt: input.visibility === "public" ? sql`coalesce(${assets.publishedAt}, now())` : null,
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
      ...assetMediaColumns,
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
    ...buildAssetRenditionUrls(asset),
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
      ...assetMediaColumns,
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
    ...buildAssetRenditionUrls(asset),
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

/**
 * Moves the user's live assets to the Bin. Bytes, quota, tags, document links
 * and stored visibility are all kept, so a restore puts everything back; while
 * binned, every `ready`-gated read path (embeds, gallery, search, completions,
 * MCP) simply stops seeing them. Ids that are not the user's live assets are
 * skipped, so repeating the call is harmless.
 */
export async function trashAssetsForUser(input: { userId: string; assetIds: string[] }) {
  if (input.assetIds.length === 0) return [];
  const now = new Date();

  return db
    .update(assets)
    .set({ status: "trashed", trashedAt: now, updatedAt: now })
    .where(
      and(
        inArray(assets.id, input.assetIds),
        eq(assets.ownerId, input.userId),
        inArray(assets.status, [...transitionSources("trash", "owner")]),
        isNull(assets.deletedAt),
      ),
    )
    .returning({ id: assets.id, trashedAt: assets.trashedAt });
}

/** Takes the user's assets back out of the Bin. No quota change: binned bytes still counted. */
export async function restoreAssetsForUser(input: { userId: string; assetIds: string[] }) {
  if (input.assetIds.length === 0) return [];

  return db
    .update(assets)
    .set({
      status: "ready",
      trashedAt: null,
      folderId: liveFolderOrRoot,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(assets.id, input.assetIds),
        eq(assets.ownerId, input.userId),
        inArray(assets.status, [...transitionSources("restore", "owner")]),
        isNull(assets.deletedAt),
        // Something binned along with a folder comes back with that folder,
        // never on its own into a binned folder.
        isNull(assets.trashedViaFolderId),
      ),
    )
    .returning({ id: assets.id });
}

/** "Delete forever" from the Bin. Only binned assets are affected. */
export async function deleteAssetsForeverForUser(input: { userId: string; assetIds: string[] }) {
  if (input.assetIds.length === 0) return [];

  return permanentlyDeleteAssets(
    and(inArray(assets.id, input.assetIds), eq(assets.ownerId, input.userId)),
    "owner",
  );
}

/** Deletes for good the assets binned along with these Bin folders. */
export async function deleteFolderBinAssetsForever(userId: string, folderIds: string[]) {
  if (folderIds.length === 0) return [];

  return permanentlyDeleteAssets(
    and(eq(assets.ownerId, userId), inArray(assets.trashedViaFolderId, folderIds)),
    "owner",
  );
}

/** Every binned asset the user owns, deleted for good (Empty Bin's asset half). */
export async function emptyAssetBinForUser(userId: string) {
  return permanentlyDeleteAssets(eq(assets.ownerId, userId), "owner");
}

/**
 * The Bin purge: deletes up to `limit` assets binned before `cutoff`. The
 * maintenance run calls it until it returns fewer than `limit`.
 */
export async function purgeExpiredBinAssets(input: { cutoff: Date; limit: number }) {
  return permanentlyDeleteAssets(
    // Raw fragments bypass Drizzle's column mapping: bind text and cast.
    sql`${assets.trashedAt} < ${input.cutoff.toISOString()}::timestamptz`,
    "system",
    input.limit,
  );
}

/** Admin moderation delete: skips the Bin, from either a live or a binned asset. */
export async function adminDeleteAsset(assetId: string) {
  const [deleted] = await permanentlyDeleteAssets(eq(assets.id, assetId), "admin");

  if (!deleted) {
    throw new AssetError("Asset not found.", 404, "ASSET_NOT_FOUND");
  }

  return { id: deleted.id };
}

const OBJECT_DELETE_CONCURRENCY = 8;

/**
 * The one way an asset is deleted for good. The status update is conditional
 * on the actor's allowed source statuses, and quota is released only for the
 * rows that update returned, inside the same transaction — so two concurrent
 * deletes (or a delete racing a restore) can never release quota twice or
 * delete something that was just restored. Storage objects are removed after
 * commit, best effort: the daily orphan sweep retries anything that fails.
 */
async function permanentlyDeleteAssets(
  scope: SQL | undefined,
  actor: "owner" | "admin" | "system",
  limit?: number,
) {
  const sources = [...transitionSources("delete", actor)];
  const now = new Date();

  const deleted = await db.transaction(async (tx) => {
    const target = and(scope, inArray(assets.status, sources), isNull(assets.deletedAt));
    // UPDATE has no LIMIT in Postgres; bound it through an id subquery.
    const bounded = limit
      ? inArray(
          assets.id,
          tx
            .select({ id: assets.id })
            .from(assets)
            .where(target)
            .orderBy(assets.trashedAt)
            .limit(limit),
        )
      : target;

    const rows = await tx
      .update(assets)
      .set({
        status: "deleted",
        visibility: "private",
        trashedAt: null,
        trashedViaFolderId: null,
        deletedAt: now,
        updatedAt: now,
      })
      // Re-state the source check on the update itself: under concurrency the
      // subquery's snapshot can be older than the row this update locks.
      .where(and(bounded, inArray(assets.status, sources), isNull(assets.deletedAt)))
      .returning({
        id: assets.id,
        ownerId: assets.ownerId,
        storageKey: assets.storageKey,
        sizeBytes: assets.sizeBytes,
        renditionStatus: assets.renditionStatus,
        renditionVersion: assets.renditionVersion,
      });

    if (rows.length === 0) return rows;

    await tx.delete(documentAssets).where(
      inArray(
        documentAssets.assetId,
        rows.map((row) => row.id),
      ),
    );

    const releasedByOwner = new Map<string, number>();
    for (const row of rows) {
      releasedByOwner.set(row.ownerId, (releasedByOwner.get(row.ownerId) ?? 0) + row.sizeBytes);
    }
    for (const [ownerId, bytes] of releasedByOwner) {
      await tx
        .update(users)
        .set({
          storageUsedBytes: sql`greatest(${users.storageUsedBytes} - ${bytes}, 0)`,
          updatedAt: now,
        })
        .where(eq(users.id, ownerId));
    }

    return rows;
  });

  for (let index = 0; index < deleted.length; index += OBJECT_DELETE_CONCURRENCY) {
    const batch = deleted.slice(index, index + OBJECT_DELETE_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((row) => deleteAssetObject(row.storageKey)),
    );
    settled.forEach((outcome, offset) => {
      if (outcome.status === "rejected") {
        console.error("Failed to delete R2 asset object", {
          assetId: batch[offset].id,
          storageKey: batch[offset].storageKey,
          error: outcome.reason,
        });
      }
    });
  }

  for (const row of deleted) {
    if (row.renditionStatus === "ready" && row.renditionVersion !== null) {
      await deleteRenditionObjects({
        ownerId: row.ownerId,
        assetId: row.id,
        version: row.renditionVersion,
      });
    }
  }

  return deleted.map((row) => ({ id: row.id, sizeBytes: row.sizeBytes }));
}

/** The user's Bin, most recently binned first, with when each item goes for good. */
export async function listBinAssetsForUser(userId: string) {
  const rows = await db
    .select({
      id: assets.id,
      folderId: assets.folderId,
      kind: assets.kind,
      displayName: assets.displayName,
      description: assets.description,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      createdAt: assets.createdAt,
      ...assetMediaColumns,
      trashedAt: assets.trashedAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.ownerId, userId),
        eq(assets.status, "trashed"),
        isNull(assets.deletedAt),
        // Assets binned with a folder are shown inside that folder's entry.
        isNull(assets.trashedViaFolderId),
      ),
    )
    .orderBy(desc(assets.trashedAt), desc(assets.id));

  return rows.map((asset) => {
    const trashedAt = asset.trashedAt ?? asset.createdAt;
    return {
      ...asset,
      trashedAt,
      purgeAt: binPurgeAt(trashedAt),
      tags: [] as string[],
      // The content route lets the owner read binned bytes, so previews work.
      url: buildAssetContentUrl(asset.id),
    ...buildAssetRenditionUrls(asset),
      markdown: buildAssetMarkdown(asset.id, asset.displayName),
    };
  });
}

export async function recalculateUserStorage(userId: string) {
  // In-flight direct uploads (pending, with an `asset_uploads` row) hold a
  // quota reservation that completion does not re-add, so they count too, as
  // do binned assets (their bytes are kept until purge).
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${assets.sizeBytes}), 0)`,
    })
    .from(assets)
    .where(
      and(
        eq(assets.ownerId, userId),
        isNull(assets.deletedAt),
        or(
          // Binned bytes still exist in storage until they are purged.
          inArray(assets.status, [...STORED_ASSET_STATUSES]),
          and(
            eq(assets.status, "pending"),
            sql`exists (select 1 from ${assetUploads} where ${assetUploads.assetId} = ${assets.id})`,
          ),
        ),
      ),
    );

  const total = Number(row?.total ?? 0);

  await db
    .update(users)
    .set({ storageUsedBytes: total, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return total;
}

export async function listAssetResolutionsForDocument(
  documentId: string,
  userId: string | null,
  markdown?: string | null,
  embedSessionToken?: string | null,
) {
  const canRead = await canReadDocument(userId, documentId);

  if (!canRead) {
    return {};
  }

  const resolutionColumns = {
    id: assets.id,
    kind: assets.kind,
    displayName: assets.displayName,
    altText: assets.altText,
    mimeType: assets.mimeType,
    sizeBytes: assets.sizeBytes,
    visibility: assets.visibility,
    renditionStatus: assets.renditionStatus,
    renditionVersion: assets.renditionVersion,
    width: assets.width,
    height: assets.height,
  };

  // Linked assets: the document_assets row is an access grant, which is what
  // lets a viewer load a *private* asset they don't own. Anonymous viewers can
  // still only see the public ones.
  const linkedRows = await db
    .select(resolutionColumns)
    .from(documentAssets)
    .innerJoin(assets, eq(documentAssets.assetId, assets.id))
    .where(
      and(
        eq(documentAssets.documentId, documentId),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    );

  const rows = linkedRows.filter(
    (row) => userId || row.visibility === "public",
  );

  // Public assets need no grant — they're world-readable — so resolve any
  // public asset referenced in the body even if it was never linked (e.g. an
  // embed copy-pasted from the public gallery, possibly owned by someone else).
  const embeddedIds = markdown
    ? [...new Set(extractAssetEmbedIds(markdown))]
    : [];
  const unresolvedIds = embeddedIds.filter(
    (id) => !rows.some((row) => row.id === id),
  );

  if (unresolvedIds.length > 0) {
    const publicRows = await db
      .select(resolutionColumns)
      .from(assets)
      .where(
        and(
          inArray(assets.id, unresolvedIds),
          eq(assets.visibility, "public"),
          eq(assets.status, "ready"),
          isNull(assets.deletedAt),
        ),
      );

    rows.push(...publicRows);
  }

  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        kind: row.kind,
        displayName: row.displayName,
        altText: row.altText,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        url: buildAssetContentUrl(row.id, documentId, embedSessionToken),
        displayUrl: embedDisplayUrl(row, documentId, embedSessionToken),
        width: row.width,
        height: row.height,
      } satisfies AssetResolution,
    ]),
  );
}

/**
 * Resolves a single embed reference for the live editor when its id isn't in the
 * server-rendered resolution map yet (e.g. a public embed just pasted from the
 * gallery). Mirrors {@link listAssetResolutionsForDocument}'s public branch:
 * only *public* assets resolve without a link, and the caller must be able to
 * read the document. Returns null when it wouldn't render on a reload anyway.
 */
export async function resolveEmbeddableAssetForDocument(input: {
  assetId: string;
  userId: string | null;
  documentId: string;
}): Promise<AssetResolution | null> {
  const canRead = await canReadDocument(input.userId, input.documentId);

  if (!canRead) {
    return null;
  }

  const [asset] = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      displayName: assets.displayName,
      altText: assets.altText,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
      width: assets.width,
      height: assets.height,
    })
    .from(assets)
    .where(
      and(
        eq(assets.id, input.assetId),
        eq(assets.visibility, "public"),
        eq(assets.status, "ready"),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    kind: asset.kind,
    displayName: asset.displayName,
    altText: asset.altText,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    url: buildAssetContentUrl(asset.id, input.documentId),
    displayUrl: embedDisplayUrl(asset, input.documentId),
    width: asset.width,
    height: asset.height,
  } satisfies AssetResolution;
}

/**
 * The display copy for an image embed, through the same `?doc=` grant (and
 * embed token) as the original, or null to use the original: not an image,
 * or rendering failed. Videos and PDFs render as cards, never as <img>.
 */
function embedDisplayUrl(
  asset: Parameters<typeof buildAssetRenditionUrls>[0],
  documentId: string,
  embedSessionToken?: string | null,
) {
  if (asset.kind !== "image") return null;
  return buildAssetRenditionUrls(asset, documentId, embedSessionToken).displayUrl;
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
      kind: assets.kind,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      visibility: assets.visibility,
      status: assets.status,
      deletedAt: assets.deletedAt,
      renditionStatus: assets.renditionStatus,
      renditionVersion: assets.renditionVersion,
    })
    .from(assets)
    .where(eq(assets.id, input.assetId))
    .limit(1);

  if (!asset || asset.deletedAt) {
    return null;
  }

  const isOwner = input.userId !== null && asset.ownerId === input.userId;
  const readable = readableStatusFor(asset.status, isOwner);

  if (readable === "none") {
    return null;
  }

  if (readable === "owner-only") {
    // A binned asset is the owner's alone, whatever its stored visibility:
    // never let a shared cache keep it around for anyone else.
    return { ...asset, visibility: "private" as const };
  }

  if (asset.visibility === "public" || isOwner) {
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

/**
 * Decides what an upload is from its leading bytes and its total size: the
 * sniffed type, the asset kind, the stored extension, and whether it is within
 * the cap for that kind. `head` may be the whole file (single-request uploads)
 * or just its first bytes (direct uploads, sniffed again after completion).
 */
export async function classifyAssetBytes(input: {
  head: Buffer;
  sizeBytes: number;
  declaredMimeType?: string;
  filename: string;
  allowAnyFileType?: boolean;
}) {
  if (input.sizeBytes === 0 || input.head.byteLength === 0) {
    throw new AssetError("Choose a non-empty file.", 400, "EMPTY_FILE");
  }

  const detected = await fileTypeFromBuffer(input.head);
  const detectedMimeType = detected?.mime;
  const allowed = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : null;

  if (!detectedMimeType || !allowed) {
    if (!input.allowAnyFileType) {
      throw new AssetError("Unsupported file type.", 415, "UNSUPPORTED_TYPE");
    }

    return await validateGenericFile({
      sizeBytes: input.sizeBytes,
      filename: input.filename,
      detectedMimeType: detectedMimeType ?? null,
      detectedExtension: detected?.ext ?? null,
    });
  }

  const declaredMimeType = input.declaredMimeType || "application/octet-stream";
  const declaredAllowed =
    declaredMimeType === "application/octet-stream" ||
    declaredMimeType === "" ||
    declaredMimeType === detectedMimeType;

  if (!declaredAllowed) {
    throw new AssetError("File type does not match its contents.", 415, "TYPE_MISMATCH");
  }

  const limits = await getUploadLimits();
  const maxBytes =
    allowed.kind === "image"
      ? limits.imageMaxBytes
      : allowed.kind === "video"
        ? limits.videoMaxBytes
        : limits.pdfMaxBytes;

  if (input.sizeBytes > maxBytes) {
    throw new AssetError("File is too large.", 413, "FILE_TOO_LARGE");
  }

  return {
    kind: allowed.kind,
    mimeType: detectedMimeType,
    detectedMimeType,
    extension: detected?.ext ?? allowed.extension,
  };
}

/**
 * Anything outside the image/PDF allow-list, for users granted unrestricted
 * uploads. The declared type is client-controlled, so it is ignored; the
 * content route serves `kind: "file"` as a sandboxed `octet-stream` download
 * whatever `mimeType` says, so a stored HTML/SVG never renders on our origin.
 */
async function validateGenericFile(input: {
  sizeBytes: number;
  filename: string;
  detectedMimeType: string | null;
  detectedExtension: string | null;
}) {
  if (input.sizeBytes > (await getUploadLimits()).fileMaxBytes) {
    throw new AssetError("File is too large.", 413, "FILE_TOO_LARGE");
  }

  return {
    kind: "file" as AssetKind,
    mimeType: input.detectedMimeType ?? "application/octet-stream",
    detectedMimeType: input.detectedMimeType ?? "application/octet-stream",
    extension:
      fileExtensionFromName(input.filename) ?? input.detectedExtension ?? "bin",
  };
}

export async function reserveUserStorage(userId: string, sizeBytes: number) {
  const rows = await db
    .update(users)
    .set({
      storageUsedBytes: sql`${users.storageUsedBytes} + ${sizeBytes}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        sql`${users.storageUsedBytes} + ${sizeBytes} <= ${effectiveStorageQuotaSql()}`,
      ),
    )
    .returning({ id: users.id });

  if (rows.length === 0) {
    throw new AssetError("Storage quota exceeded.", 413, "QUOTA_EXCEEDED");
  }
}

export async function releaseUserStorage(userId: string, sizeBytes: number) {
  await db
    .update(users)
    .set({
      storageUsedBytes: sql`greatest(${users.storageUsedBytes} - ${sizeBytes}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function markAssetFailed(assetId: string) {
  await db
    .update(assets)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(assets.id, assetId));
}

export function buildObjectKey(userId: string, assetId: string, extension: string) {
  return `users/${userId}/assets/${assetId}.${extension}`;
}

export function sanitizeFilename(filename: string) {
  return filename
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/[^\w .()\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function emptyToNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
