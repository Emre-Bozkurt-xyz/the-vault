#!/usr/bin/env node

/**
 * Configures the R2 asset bucket for direct (browser-to-R2) large uploads:
 *
 *  - a CORS rule letting the Vault origin PUT presigned upload parts, and
 *  - a lifecycle rule aborting multipart uploads abandoned for 2 days, so
 *    stranded parts never accrue storage.
 *
 * Existing rules with other IDs are kept. Dry run by default; pass --apply.
 * The origin defaults to NEXTAUTH_URL; pass --origin <url> (repeatable) to
 * override. Needs an R2 token allowed to edit bucket settings ("Admin Read &
 * Write"); an object-only token gets AccessDenied, in which case set the same
 * rules in the Cloudflare dashboard (R2 -> bucket -> Settings).
 */

import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const CORS_RULE_ID = "vault-direct-uploads";
const LIFECYCLE_RULE_ID = "vault-abort-stale-multipart";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const origins = argv
  .flatMap((arg, index) => (arg === "--origin" ? [argv[index + 1]] : []))
  .filter(Boolean);

if (origins.length === 0 && process.env.NEXTAUTH_URL) {
  origins.push(process.env.NEXTAUTH_URL);
}

const bucket = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY.");
  process.exit(1);
}

if (origins.length === 0) {
  console.error("No origin. Set NEXTAUTH_URL or pass --origin https://vault.example.com.");
  process.exit(1);
}

const allowedOrigins = origins.map((origin) => new URL(origin).origin);
const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

const corsRule = {
  ID: CORS_RULE_ID,
  AllowedOrigins: allowedOrigins,
  AllowedMethods: ["PUT"],
  AllowedHeaders: ["content-type"],
  ExposeHeaders: ["ETag"],
  MaxAgeSeconds: 3600,
};

const lifecycleRule = {
  ID: LIFECYCLE_RULE_ID,
  Status: "Enabled",
  Filter: { Prefix: "" },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
};

const existingCors = await readOrEmpty(
  () => r2.send(new GetBucketCorsCommand({ Bucket: bucket })),
  "CORSRules",
);
const existingLifecycle = await readOrEmpty(
  () => r2.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })),
  "Rules",
);

const corsRules = [...existingCors.filter((rule) => rule.ID !== CORS_RULE_ID), corsRule];
const lifecycleRules = [
  ...existingLifecycle.filter((rule) => rule.ID !== LIFECYCLE_RULE_ID),
  lifecycleRule,
];

console.log(`Bucket: ${bucket}`);
console.log("CORS rules:", JSON.stringify(corsRules, null, 2));
console.log("Lifecycle rules:", JSON.stringify(lifecycleRules, null, 2));

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write these rules.");
  process.exit(0);
}

await r2.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: { CORSRules: corsRules },
  }),
);
await r2.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: { Rules: lifecycleRules },
  }),
);
console.log("\nApplied.");

async function readOrEmpty(read, key) {
  try {
    const result = await read();
    return result[key] ?? [];
  } catch (error) {
    const code = error?.name ?? error?.Code;
    if (code === "NoSuchCORSConfiguration" || code === "NoSuchLifecycleConfiguration") {
      return [];
    }
    throw error;
  }
}
