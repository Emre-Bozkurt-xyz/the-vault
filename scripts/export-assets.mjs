#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";

const outputDir = path.resolve(process.argv[2] ?? "backups/assets-export");
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://vault:vault@localhost:5432/vault";
const bucket = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

try {
  await mkdir(outputDir, { recursive: true });
  const assets = await sql`
    select
      id,
      owner_id,
      uploader_id,
      storage_bucket,
      storage_key,
      original_filename,
      display_name,
      description,
      alt_text,
      mime_type,
      detected_mime_type,
      file_extension,
      size_bytes,
      kind,
      visibility,
      status,
      checksum_sha256,
      created_at,
      updated_at,
      published_at,
      deleted_at
    from assets
    order by created_at asc
  `;

  await writeFile(
    path.join(outputDir, "assets-manifest.json"),
    JSON.stringify(assets, null, 2),
  );

  for (const asset of assets) {
    if (asset.status !== "ready" || asset.deleted_at) {
      continue;
    }

    const objectPath = path.join(outputDir, "objects", safeStoragePath(asset.storage_key));
    await mkdir(path.dirname(objectPath), { recursive: true });
    const response = await r2.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: asset.storage_key,
      }),
    );

    if (!response.Body) {
      console.warn(`Skipping ${asset.id}: R2 object body was empty.`);
      continue;
    }

    await pipeline(toNodeStream(response.Body), createWriteStream(objectPath));
    console.log(`Exported ${asset.storage_key}`);
  }

  console.log(`\nExport complete: ${outputDir}`);
} finally {
  await sql.end();
}

function safeStoragePath(storageKey) {
  return storageKey
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join(path.sep);
}

function toNodeStream(body) {
  if (body instanceof Readable) {
    return body;
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    return Readable.fromWeb(body.transformToWebStream());
  }

  return body;
}
