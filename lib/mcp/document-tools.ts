import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { listTagsForDocumentIds } from "@/server/documents";
import {
  getDocumentForUser,
  getDocumentVersionForUser,
  listArchivedDocumentsForUser,
  listDocumentVersionsForUser,
} from "@/server/documents-data";
import { listAssetsForUser } from "@/server/assets";
import { normalizeTagList } from "@/lib/content-metadata";
import { resolveMcpUserId } from "@/lib/mcp/user";
import {
  sliceMarkdownByHeading,
  sliceMarkdownByLineRange,
} from "@/lib/mcp/markdown-slice";
import { failure, json, runTool } from "@/lib/mcp/tool-result";
import {
  describeDocumentLocation,
  loadWorkspaceSnapshot,
  resolveFolderScope,
  type WorkspaceDocument,
} from "@/lib/mcp/workspace-context";
import {
  countLines,
  documentPreview,
  outlineWithLines,
  parseSearchTerms,
  scoreDocument,
} from "@/lib/mcp/workspace-index";

const folderInput = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Limit to one folder, by id or by path as shown in list_folders (e.g. 'Courses/CS101'; case-insensitive).",
  );

const recursiveInput = z
  .boolean()
  .default(true)
  .describe("With `folder`: include its subfolders (default true).");

const scopeInput = z
  .enum(["owned", "shared", "all"])
  .default("all")
  .describe(
    "owned = documents you own; shared = documents others own that you can open (shared with you, or filed into your folders); all = both.",
  );

const tagsInput = z
  .array(z.string())
  .optional()
  .describe(
    "Require all of these tags. Normalized to lowercase slugs (spaces and dashes become underscores, e.g. 'mcp-test' -> 'mcp_test'). Includes tags inherited from folders.",
  );

/** Narrows a snapshot by scope and folder, the filters every listing shares. */
function filterDocuments(
  documents: WorkspaceDocument[],
  options: {
    scope: "owned" | "shared" | "all";
    folderIds?: Set<string>;
  },
): WorkspaceDocument[] {
  return documents.filter((document) => {
    if (options.scope === "owned" && document.source !== "owned") return false;
    if (options.scope === "shared" && document.source === "owned") return false;
    if (
      options.folderIds &&
      !(document.folderId && options.folderIds.has(document.folderId))
    ) {
      return false;
    }
    return true;
  });
}

/** The fields every listing returns for a document. */
function documentSummary(document: WorkspaceDocument, tags: string[]) {
  return {
    id: document.id,
    title: document.title,
    path: document.path,
    folderId: document.folderId,
    folderPath: document.folderPath,
    source: document.source,
    role: document.role,
    ...(document.ownerUsername ? { ownerUsername: document.ownerUsername } : {}),
    visibility: document.visibility,
    tags,
    updatedAt: document.updatedAt,
  };
}

/**
 * Registers the read-only Vault document tools on an MCP server. Every tool
 * resolves the acting user via {@link resolveMcpUserId} and reads only through
 * permission-checked functions, so a tool can never surface a document or
 * folder the user could not open in the app.
 */
export function registerVaultDocumentTools(server: McpServer): void {
  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description:
        "Show the folder tree the current user can see — their own folders and folders shared with them — as paths like 'Courses/CS101/Week 3', with ids, access, and how many documents each holds. Call this first when a request is about a place ('the CS101 todo', 'my work notes') so you can tell same-named documents in different folders apart. Pass includeDocuments to also list each folder's documents (titles and ids), i.e. the whole tree.",
      inputSchema: {
        folder: folderInput.describe(
          "Show only this folder's subtree, by id or path.",
        ),
        includeDocuments: z
          .boolean()
          .default(false)
          .describe("Also list the documents inside each folder (and, without `folder`, at the root)."),
      },
    },
    async ({ folder, includeDocuments }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const snapshot = await loadWorkspaceSnapshot(userId);
        const scope = folder
          ? resolveFolderScope(snapshot.folders, folder, true).folderIds
          : null;
        const byFolder = new Map<string, WorkspaceDocument[]>();
        const rootDocuments: WorkspaceDocument[] = [];

        for (const document of snapshot.documents) {
          // A document whose folder the user cannot see shows at the root,
          // matching how its path is reported everywhere else.
          if (document.folderId && document.folderPath !== null) {
            const list = byFolder.get(document.folderId) ?? [];
            list.push(document);
            byFolder.set(document.folderId, list);
          } else {
            rootDocuments.push(document);
          }
        }

        const folders = snapshot.folders
          .filter((entry) => !scope || scope.has(entry.id))
          .map((entry) => {
            const documents = byFolder.get(entry.id) ?? [];
            return {
              id: entry.id,
              path: entry.path,
              parentId: entry.parentId,
              access: entry.access,
              ...(entry.ownerUsername ? { ownerUsername: entry.ownerUsername } : {}),
              documentCount: documents.length,
              ...(includeDocuments
                ? {
                    documents: documents
                      .map((document) => ({ id: document.id, title: document.title }))
                      .sort((a, b) => a.title.localeCompare(b.title)),
                  }
                : {}),
            };
          });

        return json({
          count: folders.length,
          folders,
          ...(scope
            ? {}
            : {
                rootDocumentCount: rootDocuments.length,
                ...(includeDocuments
                  ? {
                      rootDocuments: rootDocuments
                        .map((document) => ({ id: document.id, title: document.title }))
                        .sort((a, b) => a.title.localeCompare(b.title)),
                    }
                  : {}),
              }),
        });
      }),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "List documents the current user can open, newest first (or by path). Each entry has its id, title, full `path` (folder path + title, e.g. 'Courses/CS101/Todo'), folder, whether it is owned or shared, your role, tags, and last update. Filter by folder (with or without subfolders), scope, and tags; page with limit/offset. Use search_documents to find by text.",
      inputSchema: {
        folder: folderInput,
        recursive: recursiveInput,
        scope: scopeInput,
        tags: tagsInput,
        sort: z
          .enum(["updated", "path"])
          .default("updated")
          .describe("updated = most recently changed first; path = alphabetical by path."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum results to return (default 100)."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Skip this many results, for paging (default 0)."),
      },
    },
    async ({ folder, recursive, scope, tags, sort, limit, offset }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const snapshot = await loadWorkspaceSnapshot(userId);
        const folderIds = folder
          ? resolveFolderScope(snapshot.folders, folder, recursive).folderIds
          : undefined;
        let documents = filterDocuments(snapshot.documents, { scope, folderIds });
        const tagMap = await listTagsForDocumentIds(
          documents.map((document) => document.id),
        );
        const requiredTags = tags ? normalizeTagList(tags) : [];

        if (requiredTags.length > 0) {
          documents = documents.filter((document) => {
            const documentTags = new Set(tagMap.get(document.id) ?? []);
            return requiredTags.every((tag) => documentTags.has(tag));
          });
        }

        if (sort === "path") {
          documents = [...documents].sort((a, b) => a.path.localeCompare(b.path));
        }

        const start = offset ?? 0;
        const page = documents.slice(start, start + (limit ?? 100));

        return json({
          total: documents.length,
          offset: start,
          count: page.length,
          documents: page.map((document) =>
            documentSummary(document, tagMap.get(document.id) ?? []),
          ),
        });
      }),
  );

  server.registerTool(
    "search_documents",
    {
      title: "Search documents",
      description:
        "Find documents the current user can open. The query is split into words (use \"double quotes\" for a phrase); a document matches when every word appears in its title, its folder path, or its body — so 'cs101 todo' finds the Todo note inside a CS101 folder. Results are ranked (title and folder hits first) and each includes its full path, tags, and the matching body lines with 1-based line numbers, ready for read_document's startLine/endLine. Filter by tags, folder (with subfolders by default), and scope. Provide at least a query, tags, or folder.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Words to match in titles, folder paths, and bodies."),
        tags: tagsInput,
        folder: folderInput,
        recursive: recursiveInput,
        scope: scopeInput,
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum results to return (default 20)."),
      },
    },
    async ({ query, tags, folder, recursive, scope, limit }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const terms = parseSearchTerms(query ?? "");
        const requiredTags = tags ? normalizeTagList(tags) : [];

        if (terms.length === 0 && requiredTags.length === 0 && !folder) {
          return failure("Provide a query, tags, and/or a folder to search.");
        }

        const snapshot = await loadWorkspaceSnapshot(userId);
        const folderIds = folder
          ? resolveFolderScope(snapshot.folders, folder, recursive).folderIds
          : undefined;
        const candidates = filterDocuments(snapshot.documents, { scope, folderIds });
        const tagMap = await listTagsForDocumentIds(
          candidates.map((document) => document.id),
        );

        const ranked = candidates
          .flatMap((document) => {
            if (requiredTags.length > 0) {
              const documentTags = new Set(tagMap.get(document.id) ?? []);
              if (!requiredTags.every((tag) => documentTags.has(tag))) return [];
            }

            const scored = scoreDocument(document, terms);
            return scored ? [{ document, ...scored }] : [];
          })
          // Stable sort keeps the snapshot's newest-first order among ties.
          .sort((a, b) => b.score - a.score);

        const matches = ranked.slice(0, limit ?? 20).map((match) => ({
          ...documentSummary(match.document, tagMap.get(match.document.id) ?? []),
          ...(match.hits.length > 0
            ? { hits: match.hits }
            : { preview: documentPreview(match.document.markdown) }),
        }));

        return json({
          query: query ?? null,
          tags: requiredTags,
          folder: folder ?? null,
          scope,
          total: ranked.length,
          count: matches.length,
          matches,
        });
      }),
  );

  server.registerTool(
    "get_outline",
    {
      title: "Get document outline",
      description:
        "Return a document's location (path, folder), tags, line count, and heading outline (level, text, slug, 1-based line) without its body. Use this to navigate a large document cheaply before reading a section with read_document (by heading, or by startLine/endLine from the outline).",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
      },
    },
    async ({ documentId }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const document = await getDocumentForUser(userId, documentId);

        if (!document) {
          return failure("Document not found or you do not have access.");
        }

        const [location, tagMap] = await Promise.all([
          describeDocumentLocation(userId, document),
          listTagsForDocumentIds([document.id]),
        ]);

        return json({
          id: document.id,
          title: document.title,
          ...location,
          tags: tagMap.get(document.id) ?? [],
          canEdit: document.access.canEdit,
          version: document.updatedAt,
          lineCount: countLines(document.markdown),
          headings: outlineWithLines(document.markdown),
        });
      }),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read a document",
      description:
        "Read a document's markdown, with its path (folder + title), tags, and total line count. By default returns the whole body; pass startLine/endLine (1-based, inclusive) or a heading to read only part of it (cheaper for large docs) — the response says which lines were returned. The returned `version` (updatedAt) lets you detect concurrent changes.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based first line to return (with optional endLine)."),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based last line to return (inclusive)."),
        heading: z
          .string()
          .optional()
          .describe(
            "Return only the section under this heading (matched by text or slug), up to the next same/higher-level heading.",
          ),
      },
    },
    async ({ documentId, startLine, endLine, heading }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const document = await getDocumentForUser(userId, documentId);

        if (!document) {
          return failure("Document not found or you do not have access.");
        }

        const lineCount = countLines(document.markdown);
        let body = document.markdown;
        let lines: { startLine: number; endLine: number } | undefined;

        if (heading) {
          const section = sliceMarkdownByHeading(body, heading);

          if (section === null) {
            return failure(
              `No heading matching "${heading}" was found. Use get_outline to list headings.`,
            );
          }

          body = section.markdown;
          lines = { startLine: section.startLine, endLine: section.endLine };
        } else if (startLine) {
          if (endLine !== undefined && endLine < startLine) {
            return failure("endLine must be greater than or equal to startLine.");
          }

          body = sliceMarkdownByLineRange(body, startLine, endLine);
          lines = {
            startLine,
            endLine: Math.min(endLine ?? lineCount, lineCount),
          };
        }

        const [location, tagMap] = await Promise.all([
          describeDocumentLocation(userId, document),
          listTagsForDocumentIds([document.id]),
        ]);

        return json({
          id: document.id,
          title: document.title,
          ...location,
          tags: tagMap.get(document.id) ?? [],
          version: document.updatedAt,
          canEdit: document.access.canEdit,
          lineCount,
          ...(lines ? { lines } : {}),
          markdown: body,
        });
      }),
  );

  server.registerTool(
    "list_deleted_documents",
    {
      title: "List deleted documents",
      description:
        "List documents the current user owns that are in the Bin (soft-deleted), newest deletion first, with ids to pass to restore_document.",
      inputSchema: {},
    },
    async (_args, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const deleted = await listArchivedDocumentsForUser(userId);

        return json({ count: deleted.length, documents: deleted });
      }),
  );

  server.registerTool(
    "list_versions",
    {
      title: "List document versions",
      description:
        "List a document's recent saved versions (history) — ids, reasons, timestamps, and a short preview. Pair with read_version to fetch a version's full content or restore_version to roll back. Requires edit access.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
      },
    },
    async ({ documentId }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const versions = await listDocumentVersionsForUser(documentId, userId);

        return json({ documentId, count: versions.length, versions });
      }),
  );

  server.registerTool(
    "read_version",
    {
      title: "Read a document version",
      description:
        "Fetch the full title and markdown of a specific prior version (from list_versions). Useful for diffing against the current document before deciding whether to restore_version.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        versionId: z.string().uuid().describe("The version id."),
      },
    },
    async ({ documentId, versionId }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const version = await getDocumentVersionForUser(
          userId,
          documentId,
          versionId,
        );

        if (!version) {
          return failure("Version not found or you do not have access.");
        }

        return json(version);
      }),
  );

  server.registerTool(
    "search_assets",
    {
      title: "Search assets",
      description:
        "Find the current user's uploaded assets (images, PDFs) to embed in documents. Filter by free text (matched in name/description/alt text), tags, and kind. Returns each asset's id, name, kind, description, alt text, tags, and size. Pass an id to embed_asset to place it in a document with styling.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Text to match in asset name, description, or alt text."),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Require all of these tags. Normalized to lowercase slugs (dashes become underscores).",
          ),
        kind: z
          .enum(["image", "pdf"])
          .optional()
          .describe("Filter by asset kind."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum results to return (default 20)."),
      },
    },
    async ({ query, tags, kind, limit }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const assets = await listAssetsForUser(userId);
        const terms = parseSearchTerms(query ?? "");
        const requiredTags = tags ? normalizeTagList(tags) : [];

        const matches = assets
          .filter((asset) => {
            if (kind && asset.kind !== kind) {
              return false;
            }

            if (terms.length > 0) {
              const haystack =
                `${asset.displayName} ${asset.description ?? ""} ${asset.altText ?? ""}`.toLowerCase();
              if (!terms.every((term) => haystack.includes(term))) {
                return false;
              }
            }

            if (requiredTags.length > 0) {
              const assetTags = new Set(asset.tags);
              if (!requiredTags.every((tag) => assetTags.has(tag))) {
                return false;
              }
            }

            return true;
          })
          .slice(0, limit ?? 20)
          .map((asset) => ({
            id: asset.id,
            name: asset.displayName,
            kind: asset.kind,
            description: asset.description ?? null,
            altText: asset.altText ?? null,
            tags: asset.tags,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
          }));

        return json({ count: matches.length, assets: matches });
      }),
  );
}
