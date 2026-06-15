import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type R2Config = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let cachedClient: S3Client | null = null;

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

export async function getAssetObject(key: string) {
  return getR2Client().send(
    new GetObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
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
