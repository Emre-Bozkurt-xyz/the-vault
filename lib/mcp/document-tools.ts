import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { extractMarkdownHeadingOptions } from "@/lib/wiki-links";
import {
  getDocumentForUser,
  listDocumentsForUser,
  listSharedDocumentsForUser,
} from "@/server/documents";
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
        "Find documents the current user can access whose title or body contains the query text. Returns ids, titles, and a short snippet. Read the full body or a section with read_document.",
      inputSchema: {
        query: z.string().min(1).describe("Text to search for in titles and bodies."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum results to return (default 20)."),
      },
    },
    async ({ query, limit }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const [owned, shared] = await Promise.all([
          listDocumentsForUser(userId),
          listSharedDocumentsForUser(userId),
        ]);

        const needle = query.trim().toLowerCase();
        const candidates = [
          ...owned.map((document) => ({
            id: document.id,
            title: document.title,
            markdown: document.markdown,
            source: "owned" as const,
          })),
          ...shared.map((document) => ({
            id: document.id,
            title: document.title,
            markdown: document.markdown,
            source: "shared" as const,
          })),
        ];

        const matches = candidates
          .filter(
            (document) =>
              document.title.toLowerCase().includes(needle) ||
              document.markdown.toLowerCase().includes(needle),
          )
          .slice(0, limit ?? 20)
          .map((document) => ({
            id: document.id,
            title: document.title,
            source: document.source,
            snippet: snippet(document.markdown),
          }));

        return json({ query, count: matches.length, matches });
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
}
