import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { buildFolderPaths } from "@/lib/folder-paths";
import { createMarkdownExcerpt } from "@/lib/markdown";
import {
  listDocumentsForUser,
  listSharedDocumentsForUser,
} from "@/server/documents";
import { listFoldersForUser, listSharedFoldersForUser } from "@/server/folders";

/**
 * Backing query for `GET /api/embed/documents` — the clone picker's source list
 * (docs/DEN_EMBED_BRIDGE.md §4, contract revision 2026-07-27).
 *
 * Deliberately built on the *same* permission-checked helpers the MCP
 * `list_documents`/`search_documents` tools use (`lib/mcp/document-tools.ts`),
 * rather than duplicating their queries or making the calling service speak
 * MCP's JSON-RPC transport. Both surfaces stay thin wrappers over
 * `server/documents.ts`, which remains the single source of truth for what a
 * user can see.
 */

export type EmbedDocumentListItem = {
  id: string;
  title: string;
  folderPath: string | null;
  ownerName: string | null;
  visibility: string;
  updatedAt: string;
  snippet: string;
};

export type EmbedDocumentListScope = "owned" | "shared" | "all";

const snippetLength = 200;

export async function listEmbedDocumentsForUser(input: {
  userId: string;
  scope: EmbedDocumentListScope;
  query?: string;
  limit: number;
}): Promise<EmbedDocumentListItem[]> {
  const wantsOwned = input.scope === "owned" || input.scope === "all";
  const wantsShared = input.scope === "shared" || input.scope === "all";

  const [owned, shared, ownFolders, sharedFolders] = await Promise.all([
    wantsOwned ? listDocumentsForUser(input.userId) : Promise.resolve([]),
    wantsShared ? listSharedDocumentsForUser(input.userId) : Promise.resolve([]),
    listFoldersForUser(input.userId),
    listSharedFoldersForUser(input.userId),
  ]);

  const folderPaths = buildFolderPaths([...ownFolders, ...sharedFolders]);

  const candidates = [
    ...owned.map((row) => ({
      id: row.id,
      title: row.title,
      markdown: row.markdown,
      visibility: row.visibility as string,
      folderId: row.folderId,
      updatedAt: row.updatedAt,
      ownerName: null as string | null,
    })),
    ...shared.map((row) => ({
      id: row.id,
      title: row.title,
      markdown: row.markdown,
      visibility: row.visibility as string,
      folderId: row.folderId,
      updatedAt: row.updatedAt,
      ownerName: row.ownerName ?? row.ownerUsername,
    })),
  ];

  // De-duplicate: a document can arrive from both lists (e.g. owned and also
  // reachable through a shared ancestor folder). Keep the first occurrence,
  // which is the owned row when present.
  const byId = new Map<string, (typeof candidates)[number]>();

  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) {
      byId.set(candidate.id, candidate);
    }
  }

  const deduped = [...byId.values()];
  const groupOwnedIds = await findGroupOwnedIds(deduped.map((row) => row.id));

  const needle = input.query?.trim().toLowerCase() ?? "";

  const filtered = deduped
    // Group-owned documents are excluded from the clone picker by owner
    // decision (2026-07-27): the picker means "documents of yours you could
    // bring into this chat". They are already absent in practice — a group
    // doc's `ownerId` is the service principal, members hold no
    // `document_permissions` row, and group docs carry no `folderId` — but
    // filter explicitly so the guarantee does not rest on three separate
    // implementation details staying true.
    .filter((row) => !groupOwnedIds.has(row.id))
    .filter((row) => {
      if (!needle) {
        return true;
      }

      return (
        row.title.toLowerCase().includes(needle) ||
        row.markdown.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, input.limit);

  return filtered.map((row) => ({
    id: row.id,
    title: row.title,
    folderPath: row.folderId ? (folderPaths.get(row.folderId) ?? null) : null,
    ownerName: row.ownerName,
    visibility: row.visibility,
    updatedAt: row.updatedAt.toISOString(),
    // Never ship the raw body: the underlying list helpers select full
    // `markdown` for their own callers, and passing that through would send
    // every document's complete text on every picker open.
    snippet: createMarkdownExcerpt(row.markdown, snippetLength),
  }));
}

/**
 * Which of these documents are owned by a group. One query rather than
 * threading `owningGroupId` through the shared list helpers, whose row shapes
 * are consumed by the workspace and MCP surfaces too.
 */
async function findGroupOwnedIds(documentIds: string[]): Promise<Set<string>> {
  if (documentIds.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ id: documents.id, owningGroupId: documents.owningGroupId })
    .from(documents)
    .where(inArray(documents.id, documentIds));

  return new Set(
    rows.filter((row) => row.owningGroupId !== null).map((row) => row.id),
  );
}

