import {
  HocuspocusProvider,
  type HocuspocusProviderConfiguration,
} from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { createCollabToken } from "@/lib/collab-token";
import { getDocumentAccess } from "@/lib/permissions";

const syncTimeoutMs = 10_000;
const flushTimeoutMs = 10_000;

/**
 * Opens the document's live Yjs session (exactly like a browser editor), runs
 * `mutate` against the shared `markdown` Y.Text inside one transaction tagged
 * `"mcp"`, waits for the change to flush to the collaboration server, and returns
 * the resulting markdown.
 *
 * Writing through the collaboration layer — rather than the `documents.markdown`
 * column directly — is what makes AI edits conflict-free with anyone editing
 * live: the edit is a CRDT delta merged into the authoritative Y.Doc, and the
 * collab server's existing `onStoreDocument` pipeline performs all persistence
 * (markdown column, version snapshot, asset reconcile, metadata sync).
 */
export async function withLiveDocumentText(
  userId: string,
  documentId: string,
  mutate: (ytext: Y.Text, ydoc: Y.Doc) => void,
): Promise<{ markdown: string }> {
  const access = await getDocumentAccess(userId, documentId);

  if (!access.canEdit) {
    throw new Error("You do not have edit access to this document.");
  }

  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL;

  if (!collabUrl) {
    throw new Error("NEXT_PUBLIC_COLLAB_URL is not configured.");
  }

  const [user] = await db
    .select({
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const token = createCollabToken({
    documentId,
    userId,
    role: access.role === "owner" ? "owner" : "editor",
    name: user?.name ?? null,
    email: user?.email ?? null,
    image: user?.image ?? null,
    shareLinkId: null,
  });

  const ydoc = new Y.Doc();
  // Hocuspocus uses the global WebSocket in browsers; in Node we hand it `ws`.
  // The provider forwards `WebSocketPolyfill` to the socket it creates, but the
  // option is only declared on the websocket-level config type, so we attach it
  // through a typed cast rather than constructing a separate socket (a shared
  // HocuspocusProviderWebsocket does not auto-sync for this one-shot use).
  const provider = new HocuspocusProvider({
    url: collabUrl,
    name: documentId,
    document: ydoc,
    token,
    // We drive presence-free, headless edits; don't broadcast awareness.
    awareness: null,
    WebSocketPolyfill: WebSocket,
  } as HocuspocusProviderConfiguration);

  try {
    await waitForSync(provider);

    const ytext = ydoc.getText("markdown");
    ydoc.transact(() => mutate(ytext, ydoc), "mcp");

    await waitForFlush(provider);

    return { markdown: ytext.toString() };
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
}

function waitForSync(provider: HocuspocusProvider): Promise<void> {
  if (provider.isSynced) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out connecting to the collaboration server."));
    }, syncTimeoutMs);

    const onSynced = () => {
      cleanup();
      resolve();
    };
    const onAuthFailed = () => {
      cleanup();
      reject(new Error("Collaboration server rejected the edit (forbidden)."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      provider.off("synced", onSynced);
      provider.off("authenticationFailed", onAuthFailed);
    };

    provider.on("synced", onSynced);
    provider.on("authenticationFailed", onAuthFailed);
  });
}

async function waitForFlush(provider: HocuspocusProvider): Promise<void> {
  const start = Date.now();

  while (provider.hasUnsyncedChanges) {
    if (Date.now() - start > flushTimeoutMs) {
      throw new Error("Timed out sending the edit to the collaboration server.");
    }

    await delay(50);
  }

  // Small grace so the server-side document has applied the update before we
  // disconnect (the store itself is debounced and happens server-side).
  await delay(150);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
