import "server-only";

import { randomUUID } from "node:crypto";

import { and, count, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { assetUploads, assets } from "@/db/schema";
import { ASSET_LIMITS } from "@/lib/config/asset-limits";
import {
  abortAssetMultipartUpload,
  completeAssetMultipartUpload,
  createAssetMultipartUpload,
  deleteAssetObject,
  getR2Bucket,
  headAssetObject,
  listAssetUploadParts,
  presignAssetUploadPart,
  readAssetObjectHead,
} from "@/lib/storage/r2";
import { partsCoverFile, planMultipartUpload } from "@/lib/upload-limits";
import {
  AssetError,
  buildAssetContentUrl,
  buildAssetMarkdown,
  buildObjectKey,
  classifyAssetBytes,
  linkAssetToDocument,
  markAssetFailed,
  releaseUserStorage,
  reserveUserStorage,
  sanitizeFilename,
  type ActiveAssetUser,
} from "@/server/assets";
import { canEditDocumentWithOptionalShareLink } from "@/server/documents-data";

/**
 * Direct-to-R2 multipart uploads for large files.
 *
 * Bytes never pass through Vault (or Cloudflare's 100 MB proxied-request cap):
 * the browser PUTs each part to a short-lived presigned R2 URL. Vault still
 * owns every decision. It sniffs the file's first bytes before the upload
 * starts, reserves the declared size against quota, presigns only this
 * upload's parts for its owner, and on completion re-checks part layout, total
 * size, and the stored object's real content before the asset becomes ready.
 */

/** Leading bytes sniffed before the upload starts and again after it lands. */
export const DIRECT_UPLOAD_HEAD_BYTES = 64 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const PART_URL_TTL_SECONDS = 30 * 60;
const MAX_ACTIVE_UPLOADS_PER_USER = 5;
export const MAX_PART_URLS_PER_REQUEST = 50;

export type DirectUploadPlan = {
  uploadId: string;
  partSizeBytes: number;
  partCount: number;
};

export async function startDirectUpload(input: {
  user: ActiveAssetUser;
  filename: string;
  sizeBytes: number;
  declaredMimeType: string;
  head: Buffer;
  documentId: string | null;
  shareLinkId: string | null;
}): Promise<DirectUploadPlan> {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new AssetError("Choose a non-empty file.", 400, "EMPTY_FILE");
  }

  if (input.sizeBytes > ASSET_LIMITS.maxUploadBytes) {
    throw new AssetError("File is too large.", 413, "FILE_TOO_LARGE");
  }

  const expectedHead = Math.min(DIRECT_UPLOAD_HEAD_BYTES, input.sizeBytes);
  if (input.head.byteLength !== expectedHead) {
    throw new AssetError("Upload header does not match the file size.", 400, "BAD_HEAD");
  }

  await sweepExpiredUploads(input.user.id);

  const [active] = await db
    .select({ total: count() })
    .from(assetUploads)
    .where(eq(assetUploads.userId, input.user.id));

  if ((active?.total ?? 0) >= MAX_ACTIVE_UPLOADS_PER_USER) {
    throw new AssetError(
      "Too many uploads in progress. Wait for one to finish.",
      429,
      "TOO_MANY_UPLOADS",
    );
  }

  const validation = await classifyAssetBytes({
    head: input.head,
    sizeBytes: input.sizeBytes,
    declaredMimeType: input.declaredMimeType,
    filename: input.filename,
    allowAnyFileType: input.user.unrestrictedUploadsAllowed,
  });
  const plan = planMultipartUpload(input.sizeBytes);
  const assetId = randomUUID();
  const displayName = sanitizeFilename(input.filename) || `asset.${validation.extension}`;
  const storageKey = buildObjectKey(input.user.id, assetId, validation.extension);

  await reserveUserStorage(input.user.id, input.sizeBytes);

  let multipartUploadId: string | null = null;

  try {
    await db.insert(assets).values({
      id: assetId,
      ownerId: input.user.id,
      uploaderId: input.user.id,
      storageBucket: getR2Bucket(),
      storageKey,
      originalFilename: input.filename || displayName,
      displayName,
      altText: validation.kind === "image" ? displayName : null,
      mimeType: validation.mimeType,
      detectedMimeType: validation.detectedMimeType,
      fileExtension: validation.extension,
      sizeBytes: input.sizeBytes,
      kind: validation.kind,
      status: "pending",
      // Hashing would mean reading the whole object back; parts carry their
      // own integrity checks in R2.
      checksumSha256: null,
    });

    multipartUploadId = await createAssetMultipartUpload({
      key: storageKey,
      contentType:
        validation.kind === "file" ? "application/octet-stream" : validation.mimeType,
    });

    await db.insert(assetUploads).values({
      assetId,
      userId: input.user.id,
      uploadId: multipartUploadId,
      partSizeBytes: plan.partSizeBytes,
      partCount: plan.partCount,
      allowAnyFileType: input.user.unrestrictedUploadsAllowed,
      documentId: input.documentId,
      shareLinkId: input.shareLinkId,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
    });
  } catch (error) {
    if (multipartUploadId) {
      await abortAssetMultipartUpload({ key: storageKey, uploadId: multipartUploadId }).catch(
        () => undefined,
      );
    }
    await markAssetFailed(assetId).catch(() => undefined);
    await releaseUserStorage(input.user.id, input.sizeBytes).catch(() => undefined);
    throw error;
  }

  return { uploadId: assetId, ...plan };
}

/** Presigned PUT URLs for some of an upload's parts, for its owner only. */
export async function presignDirectUploadParts(input: {
  userId: string;
  uploadId: string;
  partNumbers: number[];
}) {
  const upload = await getActiveUpload(input.userId, input.uploadId);
  const unique = [...new Set(input.partNumbers)];

  if (unique.length === 0 || unique.length > MAX_PART_URLS_PER_REQUEST) {
    throw new AssetError("Request between 1 and 50 parts.", 400, "BAD_PARTS");
  }

  if (unique.some((part) => !Number.isInteger(part) || part < 1 || part > upload.partCount)) {
    throw new AssetError("Part number out of range.", 400, "BAD_PARTS");
  }

  return Promise.all(
    unique.map(async (partNumber) => ({
      partNumber,
      url: await presignAssetUploadPart({
        key: upload.storageKey,
        uploadId: upload.multipartUploadId,
        partNumber,
        expiresInSeconds: PART_URL_TTL_SECONDS,
      }),
    })),
  );
}

/**
 * Verifies and finalizes an upload. Claiming the `asset_uploads` row first
 * makes complete and abort mutually exclusive; after the claim, any failure
 * tears the upload down and releases its quota.
 */
export async function completeDirectUpload(input: { userId: string; uploadId: string }) {
  const upload = await claimUpload(input.userId, input.uploadId);

  if (!upload) {
    throw new AssetError("Upload not found.", 404, "UPLOAD_NOT_FOUND");
  }

  const key = upload.storageKey;
  let completed = false;

  try {
    const parts = await listAssetUploadParts({ key, uploadId: upload.multipartUploadId });
    if (!partsCoverFile(parts, upload)) {
      throw new AssetError("Upload is incomplete.", 409, "UPLOAD_INCOMPLETE");
    }

    await completeAssetMultipartUpload({
      key,
      uploadId: upload.multipartUploadId,
      parts,
    });
    completed = true;

    const stored = await headAssetObject(key);
    if (stored.ContentLength !== upload.sizeBytes) {
      throw new AssetError("Uploaded size does not match.", 400, "SIZE_MISMATCH");
    }

    // The type was sniffed from bytes the client chose to send at start; check
    // what actually landed before anyone can read it.
    const head = await readAssetObjectHead(
      key,
      Math.min(DIRECT_UPLOAD_HEAD_BYTES, upload.sizeBytes),
    );
    const validation = await classifyAssetBytes({
      head,
      sizeBytes: upload.sizeBytes,
      filename: upload.originalFilename,
      allowAnyFileType: upload.allowAnyFileType,
    });

    if (validation.kind !== upload.kind || validation.mimeType !== upload.mimeType) {
      throw new AssetError("File type does not match its contents.", 415, "TYPE_MISMATCH");
    }

    await db
      .update(assets)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(assets.id, upload.assetId));
  } catch (error) {
    if (completed) {
      await deleteAssetObject(key).catch(() => undefined);
    } else {
      await abortAssetMultipartUpload({ key, uploadId: upload.multipartUploadId }).catch(
        () => undefined,
      );
    }
    await markAssetFailed(upload.assetId).catch(() => undefined);
    await releaseUserStorage(input.userId, upload.sizeBytes).catch(() => undefined);
    throw error;
  }

  if (
    upload.documentId &&
    (await canEditDocumentWithOptionalShareLink(
      input.userId,
      upload.documentId,
      upload.shareLinkId,
    ))
  ) {
    await linkAssetToDocument({
      documentId: upload.documentId,
      assetId: upload.assetId,
      linkedBy: input.userId,
    });
  }

  return {
    id: upload.assetId,
    kind: upload.kind,
    displayName: upload.displayName,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
    url: buildAssetContentUrl(upload.assetId, upload.documentId),
    markdown: buildAssetMarkdown(upload.assetId, upload.displayName),
  };
}

/** Cancels an upload. Idempotent: an unknown or finished upload is a no-op. */
export async function abortDirectUpload(input: { userId: string; uploadId: string }) {
  const upload = await claimUpload(input.userId, input.uploadId);

  if (upload) {
    await tearDown(upload);
  }
}

/**
 * Abandoned uploads (tab closed mid-way) keep quota reserved until swept. This
 * runs whenever their owner starts another upload; the bucket's lifecycle rule
 * (`npm run assets:configure-bucket`) aborts the R2 side regardless.
 */
async function sweepExpiredUploads(userId: string) {
  const expired = await db
    .select({ assetId: assetUploads.assetId })
    .from(assetUploads)
    .where(and(eq(assetUploads.userId, userId), lt(assetUploads.expiresAt, new Date())));

  for (const row of expired) {
    const upload = await claimUpload(userId, row.assetId);
    if (upload) {
      await tearDown(upload).catch(() => undefined);
    }
  }
}

type ClaimedUpload = NonNullable<Awaited<ReturnType<typeof loadUpload>>>;

async function tearDown(upload: ClaimedUpload) {
  await abortAssetMultipartUpload({
    key: upload.storageKey,
    uploadId: upload.multipartUploadId,
  }).catch(() => undefined);
  await markAssetFailed(upload.assetId);
  await releaseUserStorage(upload.userId, upload.sizeBytes);
}

async function getActiveUpload(userId: string, uploadId: string) {
  const upload = await loadUpload(userId, uploadId);

  if (!upload || upload.expiresAt < new Date()) {
    throw new AssetError("Upload not found.", 404, "UPLOAD_NOT_FOUND");
  }

  return upload;
}

/** Loads, then deletes, the upload row; null if someone else claimed it first. */
async function claimUpload(userId: string, uploadId: string) {
  const upload = await loadUpload(userId, uploadId);

  if (!upload) {
    return null;
  }

  const claimed = await db
    .delete(assetUploads)
    .where(and(eq(assetUploads.assetId, upload.assetId), eq(assetUploads.userId, userId)))
    .returning({ assetId: assetUploads.assetId });

  return claimed.length > 0 ? upload : null;
}

async function loadUpload(userId: string, uploadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
    return null;
  }

  const [row] = await db
    .select({
      assetId: assetUploads.assetId,
      userId: assetUploads.userId,
      multipartUploadId: assetUploads.uploadId,
      partSizeBytes: assetUploads.partSizeBytes,
      partCount: assetUploads.partCount,
      allowAnyFileType: assetUploads.allowAnyFileType,
      documentId: assetUploads.documentId,
      shareLinkId: assetUploads.shareLinkId,
      expiresAt: assetUploads.expiresAt,
      storageKey: assets.storageKey,
      sizeBytes: assets.sizeBytes,
      kind: assets.kind,
      mimeType: assets.mimeType,
      displayName: assets.displayName,
      originalFilename: assets.originalFilename,
      status: assets.status,
    })
    .from(assetUploads)
    .innerJoin(assets, eq(assets.id, assetUploads.assetId))
    .where(and(eq(assetUploads.assetId, uploadId), eq(assetUploads.userId, userId)))
    .limit(1);

  return row && row.status === "pending" ? row : null;
}
