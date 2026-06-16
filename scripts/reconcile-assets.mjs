#!/usr/bin/env node

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const repairQuota = args.has("--repair-quota");
const deleteOrphans = args.has("--delete-orphans");
const dryRun = !args.has("--apply");

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
  const [quotaRows, assetRows, unusedAssetRows, r2Keys] = await Promise.all([
    readQuotaRows(),
    readAssetRows(),
    readUnusedAssetRows(),
    listR2Keys(),
  ]);
  const assetKeys = new Set(assetRows.map((asset) => asset.storage_key));
  const missingObjects = assetRows.filter((asset) => !r2Keys.has(asset.storage_key));
  const orphanedObjects = [...r2Keys].filter((key) => !assetKeys.has(key));
  const quotaDrift = quotaRows.filter(
    (row) => Number(row.storage_used_bytes) !== Number(row.calculated_used_bytes),
  );

  console.log(JSON.stringify({
    dryRun,
    repairQuota,
    deleteOrphans,
    assets: assetRows.length,
    r2Objects: r2Keys.size,
    missingObjects: missingObjects.length,
    orphanedObjects: orphanedObjects.length,
    unusedAssets: unusedAssetRows.length,
    quotaDrift: quotaDrift.length,
  }, null, 2));

  if (missingObjects.length > 0) {
    console.log("\nMissing R2 objects for ready DB assets:");
    for (const asset of missingObjects) {
      console.log(`- ${asset.id} ${asset.storage_key}`);
    }
  }

  if (orphanedObjects.length > 0) {
    console.log("\nOrphaned R2 objects not referenced by active DB assets:");
    for (const key of orphanedObjects) {
      console.log(`- ${key}`);
    }
  }

  if (unusedAssetRows.length > 0) {
    console.log("\nReady private assets not linked to any document:");
    for (const asset of unusedAssetRows) {
      console.log(`- ${asset.id} ${asset.display_name} ${asset.storage_key}`);
    }
  }

  if (quotaDrift.length > 0) {
    console.log("\nQuota drift:");
    for (const row of quotaDrift) {
      console.log(
        `- ${row.id}: stored=${row.storage_used_bytes} calculated=${row.calculated_used_bytes}`,
      );
    }
  }

  if (repairQuota) {
    if (dryRun) {
      console.log("\nDry run: pass --apply with --repair-quota to update user quota fields.");
    } else {
      await repairUserQuota();
      console.log("\nRepaired user quota fields from active asset metadata.");
    }
  }

  if (deleteOrphans) {
    if (dryRun) {
      console.log("\nDry run: pass --apply with --delete-orphans to delete orphaned R2 objects.");
    } else {
      for (const key of orphanedObjects) {
        await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }

      console.log(`\nDeleted ${orphanedObjects.length} orphaned R2 objects.`);
    }
  }
} finally {
  await sql.end();
}

async function readAssetRows() {
  return sql`
    select id, storage_key, size_bytes
    from assets
    where status = 'ready' and deleted_at is null
  `;
}

async function readQuotaRows() {
  return sql`
    select
      u.id,
      u.storage_used_bytes,
      coalesce(sum(a.size_bytes), 0)::bigint as calculated_used_bytes
    from users u
    left join assets a
      on a.owner_id = u.id
      and a.status = 'ready'
      and a.deleted_at is null
    group by u.id, u.storage_used_bytes
  `;
}

async function readUnusedAssetRows() {
  return sql`
    select a.id, a.display_name, a.storage_key, a.created_at
    from assets a
    left join document_assets da on da.asset_id = a.id
    where a.status = 'ready'
      and a.visibility = 'private'
      and a.deleted_at is null
      and da.asset_id is null
    order by a.created_at asc
  `;
}

async function repairUserQuota() {
  await sql`
    update users u
    set storage_used_bytes = calculated.used_bytes,
        updated_at = now()
    from (
      select
        u2.id,
        coalesce(sum(a.size_bytes), 0)::bigint as used_bytes
      from users u2
      left join assets a
        on a.owner_id = u2.id
        and a.status = 'ready'
        and a.deleted_at is null
      group by u2.id
    ) calculated
    where calculated.id = u.id
  `;
}

async function listR2Keys() {
  const keys = new Set();
  let continuationToken;

  do {
    const response = await r2.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (object.Key) {
        keys.add(object.Key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}
