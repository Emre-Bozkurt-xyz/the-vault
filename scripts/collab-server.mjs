import { createHmac, timingSafeEqual } from "node:crypto";

import nextEnv from "@next/env";
import { Server } from "@hocuspocus/server";
import postgres from "postgres";
import * as Y from "yjs";

nextEnv.loadEnvConfig(process.cwd());

const port = Number(process.env.COLLAB_PORT ?? 1234);
const databaseUrl = process.env.DATABASE_URL;
const automaticVersionIntervalMs = 10 * 60 * 1000;
const significantVersionAbsoluteDiff = 2_000;
const significantVersionRelativeDiff = 0.25;
const assetEmbedPattern =
  /!\[\[asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^\]\n]+))?\]\](?:\{([^}\n]*)\})?/gi;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the collaboration server");
}

const db = postgres(databaseUrl, { max: 5 });

const server = new Server({
  port,
  name: "vault-collab",
  debounce: 1500,
  maxDebounce: 10000,
  quiet: process.env.NODE_ENV === "production",

  async onAuthenticate({ documentName, token }) {
    const payload = verifyCollabToken(token);

    if (!payload || payload.documentId !== documentName) {
      throw new Error("Unauthorized collaboration room");
    }

    const [access] = await db`
      select d.id
      from documents d
      left join document_permissions dp
        on dp.document_id = d.id
       and dp.user_id = ${payload.userId}
      left join document_share_links dsl
        on dsl.id = ${payload.shareLinkId ?? null}
       and dsl.document_id = d.id
      where d.id = ${documentName}
        and d.deleted_at is null
        and (
          d.owner_id = ${payload.userId}
          or dp.role in ('owner', 'editor')
          or (
            dsl.id is not null
            and dsl.enabled = 1
            and dsl.scope = 'members'
            and dsl.role = 'editor'
            and (
              dsl.expires_at is null
              or dsl.expires_at > now()
            )
          )
        )
      limit 1
    `;

    if (!access) {
      throw new Error("Forbidden collaboration room");
    }

    return payload;
  },

  async onLoadDocument({ documentName }) {
    const [document] = await db`
      select d.markdown, dcs.yjs_state
      from documents d
      left join document_collab_states dcs
        on dcs.document_id = d.id
      where d.id = ${documentName}
        and d.deleted_at is null
      limit 1
    `;

    if (!document) {
      throw new Error("Document not found");
    }

    if (document.yjs_state) {
      return document.yjs_state;
    }

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("markdown");
    ytext.insert(0, document.markdown ?? "");
    const seededState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

    await db`
      insert into document_collab_states (document_id, yjs_state)
      values (${documentName}, ${seededState})
      on conflict (document_id) do update
      set yjs_state = excluded.yjs_state,
          updated_at = now()
    `;

    return ydoc;
  },

  async onStoreDocument({ document, documentName }) {
    const markdown = document.getText("markdown").toString();
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(document));

    await maybeCreateAutomaticDocumentVersion(documentName, markdown);

    await db.begin(async (tx) => {
      await tx`
        update documents
        set markdown = ${markdown},
            updated_at = now()
        where id = ${documentName}
          and deleted_at is null
      `;

      await reconcileDocumentAssetLinks(tx, documentName, markdown);

      await tx`
        insert into document_collab_states (document_id, yjs_state)
        values (${documentName}, ${yjsState})
        on conflict (document_id) do update
        set yjs_state = excluded.yjs_state,
            updated_at = now()
      `;
    });
  },
});

await server.listen(port, () => {
  console.log(`Vault collaboration server listening on ${port}`);
});

async function shutdown() {
  await server.destroy();
  await db.end({ timeout: 5 });
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

function verifyCollabToken(token) {
  const [version, encodedPayload, signature] = String(token ?? "").split(".");

  if (version !== "v1" || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getSecret())
    .update(encodedPayload)
    .digest("base64url");

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  );

  if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (payload.role !== "owner" && payload.role !== "editor") {
    return null;
  }

  return payload;
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function getSecret() {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "vault-development-only-auth-secret");

  if (!secret) {
    throw new Error("AUTH_SECRET is required for collaboration tokens");
  }

  return secret;
}

async function maybeCreateAutomaticDocumentVersion(documentId, nextMarkdown) {
  const [currentDocument] = await db`
    select id, title, markdown
    from documents
    where id = ${documentId}
      and deleted_at is null
    limit 1
  `;

  if (!currentDocument || currentDocument.markdown === nextMarkdown) {
    return;
  }

  const [latestVersion] = await db`
    select title, markdown, created_at
    from document_versions
    where document_id = ${documentId}
    order by created_at desc
    limit 1
  `;

  if (
    latestVersion &&
    latestVersion.title === currentDocument.title &&
    latestVersion.markdown === currentDocument.markdown
  ) {
    return;
  }

  const latestAgeMs = latestVersion
    ? Date.now() - new Date(latestVersion.created_at).getTime()
    : Number.POSITIVE_INFINITY;
  const diffSize = Math.abs(currentDocument.markdown.length - nextMarkdown.length);
  const relativeDiff =
    diffSize / Math.max(currentDocument.markdown.length, nextMarkdown.length, 1);
  const shouldSnapshot =
    !latestVersion ||
    latestAgeMs >= automaticVersionIntervalMs ||
    diffSize >= significantVersionAbsoluteDiff ||
    relativeDiff >= significantVersionRelativeDiff;

  if (!shouldSnapshot) {
    return;
  }

  await db`
    insert into document_versions (document_id, title, markdown, reason)
    values (
      ${documentId},
      ${currentDocument.title},
      ${currentDocument.markdown},
      'collab'
    )
  `;
}

async function reconcileDocumentAssetLinks(tx, documentId, markdown) {
  const embeddedAssetIds = extractAssetEmbedIds(markdown);

  if (embeddedAssetIds.length === 0) {
    await tx`
      delete from document_assets
      where document_id = ${documentId}
    `;
    return;
  }

  await tx`
    delete from document_assets
    where document_id = ${documentId}
      and asset_id not in ${tx(embeddedAssetIds)}
  `;
}

function extractAssetEmbedIds(markdown) {
  return [...new Set(
    Array.from(String(markdown ?? "").matchAll(assetEmbedPattern), (match) =>
      match[1].toLowerCase(),
    ),
  )];
}
