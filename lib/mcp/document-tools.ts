import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { extractMarkdownHeadingOptions } from "@/lib/wiki-links";
import {
  getDocumentForUser,
  getDocumentVersionForUser,
  listDocumentVersionsForUser,
  listDocumentsForUser,
  listSharedDocumentsForUser,
  listTagsForDocumentIds,
} from "@/server/documents";
import { listAssetsForUser } from "@/server/assets";
import { normalizeTagList } from "@/lib/content-metadata";
import { resolveMcpUserId } from "@/lib/mcp/user";
import {
  sliceMarkdownByHeading,
  sliceMarkdownByLineRange,
} from "@/lib/mcp/markdown-slice";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2));
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wraps a tool body so unauthenticated/expected errors surface as MCP tool
 * errors (`isError`) rather than crashing the transport.
 */
async function runTool(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unexpected error.",
    );
  }
}

function snippet(markdown: string, length = 200): string {
  const collapsed = markdown.replace(/\s+/g, " ").trim();
  return collapsed.length > length
    ? `${collapsed.slice(0, length)}…`
    : collapsed;
}

/**
 * Registers the Phase 1 (read-only) Vault document tools on an MCP server.
 * Every tool resolves the acting user via {@link resolveMcpUserId} and delegates
 * to the existing permission-checked functions in `server/documents.ts`.
 */
export function registerVaultDocumentTools(server: McpServer): void {
  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "List the documents the current user can access — both owned and shared with them. Returns ids, titles, visibility, and last-updated times. Use search_documents to find by text, get_outline/read_document to read one.",
      inputSchema: {},
    },
    async (_args, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const [owned, shared] = await Promise.all([
          listDocumentsForUser(userId),
          listSharedDocumentsForUser(userId),
        ]);

        return json({
          owned: owned.map((document) => ({
            id: document.id,
            title: document.title,
            visibility: document.visibility,
            updatedAt: document.updatedAt,
          })),
          shared: shared.map((document) => ({
            id: document.id,
            title: document.title,
            role: document.role,
            ownerUsername: document.ownerUsername,
            updatedAt: document.updatedAt,
          })),
        });
      }),
  );

  server.registerTool(
    "search_documents",
    {
      title: "Search documents",
      description:
        "Find documents the current user can access. Filter by free text (matched in title/body), by tags (a document must have all given tags), and/or by scope (owned vs shared). Provide at least a query or tags. Returns ids, titles, tags, and a short snippet.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Text to match in titles and bodies."),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Require all of these tags. Normalized to lowercase slugs (spaces and dashes become underscores, e.g. 'mcp-test' -> 'mcp_test').",
          ),
        scope: z
          .enum(["owned", "shared", "all"])
          .default("all")
          .describe("Limit to owned, shared, or all accessible documents."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum results to return (default 20)."),
      },
    },
    async ({ query, tags, scope, limit }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const needle = query?.trim().toLowerCase() ?? "";
        const requiredTags = tags ? normalizeTagList(tags) : [];

        if (!needle && requiredTags.length === 0) {
          return failure("Provide a query and/or tags to search.");
        }

        const [owned, shared] = await Promise.all([
          listDocumentsForUser(userId),
          listSharedDocumentsForUser(userId),
        ]);

        const candidates = [
          ...(scope !== "shared"
            ? owned.map((document) => ({
                id: document.id,
                title: document.title,
                markdown: document.markdown,
                source: "owned" as const,
              }))
            : []),
          ...(scope !== "owned"
            ? shared.map((document) => ({
                id: document.id,
                title: document.title,
                markdown: document.markdown,
                source: "shared" as const,
              }))
            : []),
        ];

        const tagMap = await listTagsForDocumentIds(
          candidates.map((document) => document.id),
        );

        const matches = candidates
          .filter((document) => {
            if (
              needle &&
              !document.title.toLowerCase().includes(needle) &&
              !document.markdown.toLowerCase().includes(needle)
            ) {
              return false;
            }

            if (requiredTags.length > 0) {
              const documentTags = new Set(tagMap.get(document.id) ?? []);
              if (!requiredTags.every((tag) => documentTags.has(tag))) {
                return false;
              }
            }

            return true;
          })
          .slice(0, limit ?? 20)
          .map((document) => ({
            id: document.id,
            title: document.title,
            source: document.source,
            tags: tagMap.get(document.id) ?? [],
            snippet: snippet(document.markdown),
          }));

        return json({
          query: query ?? null,
          tags: requiredTags,
          scope,
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
        "Return the heading outline (levels, text, slugs) of a document without its full body. Use this to navigate a large document cheaply before pulling a section with read_document.",
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

        return json({
          id: document.id,
          title: document.title,
          updatedAt: document.updatedAt,
          headings: extractMarkdownHeadingOptions(document.markdown),
        });
      }),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read a document",
      description:
        "Read a document's markdown. By default returns the whole body; pass a line range or a heading to read only part of it (cheaper for large docs). The returned `version` (updatedAt) lets you detect concurrent changes.",
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

        let body = document.markdown;
        let slice: string | undefined;

        if (heading) {
          const section = sliceMarkdownByHeading(body, heading);

          if (section === null) {
            return failure(`No heading matching "${heading}" was found.`);
          }

          body = section;
          slice = `heading:${heading}`;
        } else if (startLine) {
          body = sliceMarkdownByLineRange(body, startLine, endLine);
          slice = `lines:${startLine}-${endLine ?? "end"}`;
        }

        return json({
          id: document.id,
          title: document.title,
          version: document.updatedAt,
          slice,
          canEdit: document.access.canEdit,
          markdown: body,
        });
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
        "Find the current user's uploaded assets (images, PDFs) to embed in documents. Filter by free text (matched in name/description/alt text), tags, and kind. Returns each asset's id, name, kind, tags, and size. Pass an id to embed_asset to place it in a document with styling.",
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
        const needle = query?.trim().toLowerCase() ?? "";
        const requiredTags = tags ? normalizeTagList(tags) : [];

        const matches = assets
          .filter((asset) => {
            if (kind && asset.kind !== kind) {
              return false;
            }

            if (needle) {
              const haystack =
                `${asset.displayName} ${asset.description ?? ""} ${asset.altText ?? ""}`.toLowerCase();
              if (!haystack.includes(needle)) {
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
            tags: asset.tags,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
          }));

        return json({ count: matches.length, assets: matches });
      }),
  );
}
