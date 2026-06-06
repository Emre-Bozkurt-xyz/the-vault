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
      where d.id = ${documentName}
        and d.deleted_at is null
        and (
          d.owner_id = ${payload.userId}
          or dp.role in ('owner', 'editor')
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
      select markdown
      from documents
      where id = ${documentName}
        and deleted_at is null
      limit 1
    `;

    if (!document) {
      throw new Error("Document not found");
    }

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("markdown");
    ytext.insert(0, document.markdown ?? "");

    return ydoc;
  },

  async onStoreDocument({ document, documentName }) {
    const markdown = await protectAgainstRepeatedAppend(
      documentName,
      document.getText("markdown").toString(),
    );

    await maybeCreateAutomaticDocumentVersion(documentName, markdown);

    await db`
      update documents
      set markdown = ${markdown},
          updated_at = now()
      where id = ${documentName}
        and deleted_at is null
    `;
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

async function protectAgainstRepeatedAppend(documentId, nextMarkdown) {
  const [currentDocument] = await db`
    select markdown
    from documents
    where id = ${documentId}
      and deleted_at is null
    limit 1
  `;

  const currentMarkdown = currentDocument?.markdown ?? "";

  if (!isExactRepeatedAppend(currentMarkdown, nextMarkdown)) {
    return nextMarkdown;
  }

  console.warn(
    [
      "Blocked suspicious collaboration store:",
      `document=${documentId}`,
      `currentLength=${currentMarkdown.length}`,
      `incomingLength=${nextMarkdown.length}`,
    ].join(" "),
  );

  return currentMarkdown;
}

function isExactRepeatedAppend(currentMarkdown, nextMarkdown) {
  if (
    !currentMarkdown ||
    nextMarkdown.length <= currentMarkdown.length ||
    nextMarkdown.length % currentMarkdown.length !== 0
  ) {
    return false;
  }

  for (
    let offset = 0;
    offset < nextMarkdown.length;
    offset += currentMarkdown.length
  ) {
    if (
      nextMarkdown.slice(offset, offset + currentMarkdown.length) !==
      currentMarkdown
    ) {
      return false;
    }
  }

  return true;
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
