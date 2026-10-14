import "server-only";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type R2Config = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let cachedClient: S3Client | null = null;
let cachedPresignClient: S3Client | null = null;

function getR2Config(): R2Config {
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 storage environment variables");
  }

  return {
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
  };
}

export function getR2Bucket() {
  return getR2Config().bucket;
}

export function getR2Client() {
  if (cachedClient) {
    return cachedClient;
  }

  const config = getR2Config();

  cachedClient = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return cachedClient;
}

export async function putAssetObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}) {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
    }),
  );
}

export async function getAssetObject(key: string, range?: string) {
  return getR2Client().send(
    new GetObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      Range: range,
    }),
  );
}

export async function headAssetObject(key: string) {
  return getR2Client().send(
    new HeadObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
    }),
  );
}

export async function deleteAssetObject(key: string) {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
    }),
  );
}

/**
 * Client used only to presign browser part uploads. Path-style keeps the URL
 * host equal to `R2_ENDPOINT` (what the bucket CORS rule and CSP allow), and
 * `WHEN_REQUIRED` stops the SDK baking a checksum of an empty body into the
 * signed URL, which R2 would then reject against the real part.
 */
function getR2PresignClient() {
  if (cachedPresignClient) {
    return cachedPresignClient;
  }

  const config = getR2Config();

  cachedPresignClient = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return cachedPresignClient;
}

/** Origin browsers PUT multipart parts to (CORS rule + CSP `connect-src`). */
export function getR2PublicOrigin() {
  const endpoint = process.env.R2_ENDPOINT;

  if (!endpoint) {
    return null;
  }

  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

export async function createAssetMultipartUpload(input: {
  key: string;
  contentType: string;
}) {
  const result = await getR2Client().send(
    new CreateMultipartUploadCommand({
      Bucket: getR2Bucket(),
      Key: input.key,
      ContentType: input.contentType,
    }),
  );

  if (!result.UploadId) {
    throw new Error("R2 did not return a multipart upload id.");
  }

  return result.UploadId;
}

/** Short-lived URL the browser PUTs one part's bytes to. */
export async function presignAssetUploadPart(input: {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds: number;
}) {
  return getSignedUrl(
    getR2PresignClient(),
    new UploadPartCommand({
      Bucket: getR2Bucket(),
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    }),
    { expiresIn: input.expiresInSeconds },
  );
}

/** Every uploaded part, in part-number order (follows ListParts paging). */
export async function listAssetUploadParts(input: { key: string; uploadId: string }) {
  const parts: { partNumber: number; etag: string; sizeBytes: number }[] = [];
  let marker: string | undefined;

  do {
    const page = await getR2Client().send(
      new ListPartsCommand({
        Bucket: getR2Bucket(),
        Key: input.key,
        UploadId: input.uploadId,
        PartNumberMarker: marker,
      }),
    );

    for (const part of page.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          sizeBytes: part.Size ?? 0,
        });
      }
    }

    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);

  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function completeAssetMultipartUpload(input: {
  key: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}) {
  await getR2Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: getR2Bucket(),
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: input.parts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
        })),
      },
    }),
  );
}

export async function abortAssetMultipartUpload(input: { key: string; uploadId: string }) {
  await getR2Client().send(
    new AbortMultipartUploadCommand({
      Bucket: getR2Bucket(),
      Key: input.key,
      UploadId: input.uploadId,
    }),
  );
}

/** First bytes of a stored object, for content sniffing after a direct upload. */
export async function readAssetObjectHead(key: string, bytes: number) {
  const object = await getAssetObject(key, `bytes=0-${bytes - 1}`);
  const body = object.Body;

  if (!body) {
    return Buffer.alloc(0);
  }

  return Buffer.from(await body.transformToByteArray());
}
