#!/usr/bin/env node

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

/** Rendition names from lib/asset-renditions.ts (RENDITIONS). */
const RENDITION_NAMES = ["thumb", "display"];

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
  // Current renditions are referenced too (mirrors isReferencedRenditionKey in
  // lib/asset-renditions.ts: same key layout and names; keep them in step).
  for (const asset of assetRows) {
    if (asset.rendition_status === "ready" && asset.rendition_version !== null) {
      for (const name of RENDITION_NAMES) {
        assetKeys.add(
          `users/${asset.owner_id}/renditions/${asset.id}/v${asset.rendition_version}/${name}.webp`,
        );
      }
    }
  }
  // A pending upload has no object until it completes, so it is never "missing".
  const missingObjects = assetRows.filter(
    (asset) => asset.status !== "pending" && !r2Keys.has(asset.storage_key),
  );
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
    select id, owner_id, status, storage_key, size_bytes, rendition_status, rendition_version
    from assets
    -- Binned assets keep their bytes until purge; pending ones are mid-upload.
    -- Either way their objects are not orphans.
    where status in ('ready', 'trashed', 'pending') and deleted_at is null
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
      and a.deleted_at is null
      -- Binned bytes count until purge. In-flight direct uploads hold a
      -- reservation completion does not re-add.
      and (
        a.status in ('ready', 'trashed')
        or (
          a.status = 'pending'
          and exists (select 1 from asset_uploads au where au.asset_id = a.id)
        )
      )
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
        and a.deleted_at is null
        -- Must match readQuotaRows and recalculateUserStorage exactly.
        and (
          a.status in ('ready', 'trashed')
          or (
            a.status = 'pending'
            and exists (select 1 from asset_uploads au where au.asset_id = a.id)
          )
        )
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
