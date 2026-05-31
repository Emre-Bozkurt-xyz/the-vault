import { createHmac, timingSafeEqual } from "node:crypto";

import { Server } from "@hocuspocus/server";
import { getSchema } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import {
  prosemirrorJSONToYDoc,
  yDocToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import postgres from "postgres";

const port = Number(process.env.COLLAB_PORT ?? 1234);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the collaboration server");
}

const db = postgres(databaseUrl, { max: 5 });
const schema = getSchema([
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
    },
    link: false,
    undoRedo: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    defaultProtocol: "https",
  }),
]);

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
      select content
      from documents
      where id = ${documentName}
        and deleted_at is null
      limit 1
    `;

    if (!document) {
      throw new Error("Document not found");
    }

    return prosemirrorJSONToYDoc(schema, document.content, "default");
  },

  async onStoreDocument({ document, documentName }) {
    const content = yDocToProsemirrorJSON(document, "default");

    await db`
      update documents
      set content = ${JSON.stringify(content)}::jsonb,
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
