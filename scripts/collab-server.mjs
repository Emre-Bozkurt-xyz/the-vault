import { createHmac, timingSafeEqual } from "node:crypto";

import nextEnv from "@next/env";
import { Server } from "@hocuspocus/server";
import postgres from "postgres";
import * as Y from "yjs";

nextEnv.loadEnvConfig(process.cwd());

const port = Number(process.env.COLLAB_PORT ?? 1234);
const databaseUrl = process.env.DATABASE_URL;

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
      select markdown, content
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
    ytext.insert(
      0,
      normalizeStoredMarkdown(document.markdown, document.content),
    );

    return ydoc;
  },

  async onStoreDocument({ document, documentName }) {
    const markdown = document.getText("markdown").toString();

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

function normalizeStoredMarkdown(markdown, fallbackContent) {
  if (typeof markdown === "string" && markdown.trim().length > 0) {
    return markdown;
  }

  return proseMirrorToMarkdown(fallbackContent);
}

function proseMirrorToMarkdown(content) {
  if (!content || !Array.isArray(content.content)) {
    return "";
  }

  return content.content
    .map((node) => nodeToMarkdown(node))
    .filter(Boolean)
    .join("\n\n");
}

function nodeToMarkdown(node) {
  const children = inlineChildrenToMarkdown(node.content);

  if (node.type === "heading") {
    const level = node.attrs?.level === 1 ? 1 : node.attrs?.level === 2 ? 2 : 3;
    return `${"#".repeat(level)} ${children}`.trim();
  }

  if (node.type === "bulletList") {
    return listChildrenToMarkdown(node.content, "-");
  }

  if (node.type === "orderedList") {
    return listChildrenToMarkdown(node.content, "1.");
  }

  if (node.type === "listItem") {
    return children;
  }

  if (node.type === "blockquote") {
    return children
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (node.type === "codeBlock") {
    return `\`\`\`txt\n${children}\n\`\`\``;
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  return children;
}

function inlineChildrenToMarkdown(children = []) {
  return children.map((child) => inlineNodeToMarkdown(child)).join("");
}

function inlineNodeToMarkdown(node) {
  if (node.type !== "text") {
    return nodeToMarkdown(node);
  }

  return applyMarkdownMarks(node.text ?? "", node.marks);
}

function applyMarkdownMarks(text, marks = []) {
  return marks.reduce((current, mark) => {
    if (mark.type === "bold") {
      return `**${current}**`;
    }

    if (mark.type === "italic") {
      return `*${current}*`;
    }

    if (mark.type === "code") {
      return `\`${current}\``;
    }

    if (mark.type === "link") {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      return href ? `[${current}](${href})` : current;
    }

    return current;
  }, text);
}

function listChildrenToMarkdown(children = [], marker) {
  return children
    .map((child) => {
      const text = nodeToMarkdown(child)
        .split("\n")
        .map((line, index) => (index === 0 ? line : `  ${line}`))
        .join("\n");

      return `${marker} ${text}`.trimEnd();
    })
    .join("\n");
}
