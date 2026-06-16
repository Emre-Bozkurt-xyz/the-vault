import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  assets,
  documentAssets,
  users,
  type AssetKind,
} from "@/db/schema";
import { canReadDocument } from "@/lib/permissions";
import { deleteAssetObject, getR2Bucket, putAssetObject } from "@/lib/storage/r2";
import { isUserBanActive } from "@/server/authz";

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

  return rows.map((asset) => ({
    ...asset,
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  }));
}

export async function listPublicAssets() {
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
      ),
    )
    .orderBy(desc(assets.publishedAt), desc(assets.createdAt));

  return rows.map((asset) => ({
    ...asset,
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  }));
}

export async function updateAssetForUser(input: {
  userId: string;
  assetId: string;
  displayName: string;
  altText?: string | null;
  description?: string | null;
  visibility: "private" | "public";
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

  return {
    ...asset,
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
    url: buildAssetContentUrl(asset.id),
    markdown: buildAssetMarkdown(asset.id, asset.displayName),
  };
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
