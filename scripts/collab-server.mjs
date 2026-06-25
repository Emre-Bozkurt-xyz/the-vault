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
      await syncDocumentMetadata(tx, documentName, markdown);

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

async function syncDocumentMetadata(tx, documentId, markdown) {
  const metadata = parseDocumentMetadata(markdown);

  await tx`
    insert into document_metadata (
      document_id,
      aliases,
      summary,
      status,
      project
    )
    values (
      ${documentId},
      ${JSON.stringify(metadata.aliases)}::jsonb,
      ${metadata.summary},
      ${metadata.status},
      ${metadata.project}
    )
    on conflict (document_id) do update
    set aliases = excluded.aliases,
        summary = excluded.summary,
        status = excluded.status,
        project = excluded.project,
        updated_at = now()
  `;

  await tx`
    delete from document_tags
    where document_id = ${documentId}
  `;

  if (metadata.tags.length === 0) {
    return;
  }

  const tagRows = metadata.tags.map((slug) => ({
    slug,
    display_name: tagDisplayName(slug),
  }));

  await tx`
    insert into tags ${tx(tagRows, "slug", "display_name")}
    on conflict (slug) do nothing
  `;

  const existingTags = await tx`
    select id, slug
    from tags
    where slug in ${tx(metadata.tags)}
  `;
  const tagIds = metadata.tags
    .map((slug) => existingTags.find((tag) => tag.slug === slug)?.id)
    .filter(Boolean);

  if (tagIds.length === 0) {
    return;
  }

  await tx`
    insert into document_tags ${tx(
      tagIds.map((tagId) => ({ document_id: documentId, tag_id: tagId })),
      "document_id",
      "tag_id",
    )}
    on conflict do nothing
  `;
}

function parseDocumentMetadata(markdown) {
  const frontmatter = String(markdown ?? "").match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  )?.[1];

  if (!frontmatter) {
    return emptyDocumentMetadata();
  }

  const fields = parseSimpleYamlFields(frontmatter);
  return {
    tags: normalizeTagList(fields.get("tags")),
    aliases: normalizeStringList(fields.get("aliases"), 160).slice(0, 32),
    summary: normalizeOptionalString(fields.get("summary"), 500),
    status: normalizeOptionalString(fields.get("status"), 80),
    project: normalizeOptionalString(fields.get("project"), 80),
  };
}

function emptyDocumentMetadata() {
  return {
    tags: [],
    aliases: [],
    summary: null,
    status: null,
    project: null,
  };
}

function normalizeTagList(value) {
  const rawTags = Array.isArray(value)
    ? value.flatMap((item) => splitTagInput(String(item ?? "")))
    : splitTagInput(String(value ?? ""));

  return [...new Set(
    rawTags
      .map((tag) =>
        tag
          .trim()
          .toLowerCase()
          .replace(/,/g, " ")
          .replace(/\s+/g, " ")
          .split(" ")
          .filter(Boolean)
          .map((part) =>
            part
              .replace(/-/g, "_")
              .replace(/[^a-z0-9_]/g, "")
              .replace(/_+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 64),
          )
          .filter(Boolean)
          .join(" "),
      )
      .flatMap(splitTagInput)
      .filter(Boolean),
  )].slice(0, 64);
}

function splitTagInput(value) {
  return value
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeStringList(value, maxLength) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(
    values
      .map((item) => String(item ?? "").trim().slice(0, maxLength))
      .filter(Boolean),
  )];
}

function normalizeOptionalString(value, maxLength) {
  const normalized = Array.isArray(value)
    ? String(value[0] ?? "").trim()
    : String(value ?? "").trim();

  return normalized ? normalized.slice(0, maxLength) : null;
}

function parseSimpleYamlFields(raw) {
  const fields = new Map();
  const lines = raw.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);

    if (!match) {
      index += 1;
      continue;
    }

    const key = match[1].trim();
    const inlineValue = stripYamlQuotes(match[2].trim());

    if (inlineValue) {
      fields.set(key, inlineValue);
      index += 1;
      continue;
    }

    const list = [];
    let cursor = index + 1;

    while (cursor < lines.length) {
      const listMatch = (lines[cursor] ?? "").match(/^\s*-\s*(.+)$/);

      if (!listMatch) {
        break;
      }

      list.push(stripYamlQuotes(listMatch[1].trim()));
      cursor += 1;
    }

    fields.set(key, list.length > 0 ? list : "");
    index = cursor;
  }

  return fields;
}

function stripYamlQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}

function tagDisplayName(slug) {
  return slug
    .split("_")
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}
