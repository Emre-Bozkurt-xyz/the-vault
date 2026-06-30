import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  archiveDocumentForUser,
  createDocumentForUser,
  getDocumentForUser,
  restoreArchivedDocumentForUser,
  restoreDocumentVersionForUser,
  setDocumentTitleForUser,
} from "@/server/documents";
import {
  normalizeTagList,
  parseDocumentMetadata,
  updateDocumentMetadataFrontmatter,
} from "@/lib/content-metadata";
import { maxMarkdownLength } from "@/lib/markdown";
import { resolveMcpUserId } from "@/lib/mcp/user";
import { withLiveDocumentText } from "@/lib/mcp/collab-write";
import {
  appendMarkdown,
  applyAnchoredEdits,
  insertAtHeading,
  replaceYTextMinimal,
} from "@/lib/mcp/document-edits";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function runTool(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unexpected error.");
  }
}

/**
 * Registers the Phase 2 (write) Vault document tools. Writes go through the
 * collaboration server as a Yjs participant (see {@link withLiveDocumentText}),
 * so they merge conflict-free with anyone editing live and reuse the existing
 * persistence/versioning pipeline. Edits never resend the whole document.
 */
export function registerVaultDocumentWriteTools(server: McpServer): void {
  server.registerTool(
    "create_document",
    {
      title: "Create a document",
      description:
        "Create a new document owned by the current user and return its id. Optionally provide a title and initial markdown body (markdown may include YAML frontmatter for tags/aliases/summary). Use edit_document/append_to_document afterwards to keep editing it.",
      inputSchema: {
        title: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Document title (defaults to 'Untitled document')."),
        markdown: z
          .string()
          .max(maxMarkdownLength)
          .optional()
          .describe("Initial markdown body."),
      },
    },
    async ({ title, markdown }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const { id } = await createDocumentForUser(userId, { title, markdown });

        return json({ ok: true, id });
      }),
  );

  server.registerTool(
    "update_document",
    {
      title: "Update document properties",
      description:
        "Update a document's title and/or frontmatter metadata (tags, summary, status, project, aliases) — the structured 'properties', NOT the body. Use edit_document for body content. Only the fields you pass are changed; pass an empty string/array to clear a field. Tags are normalized to slugs; other frontmatter fields you didn't author are preserved.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        title: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("New title."),
        tags: z
          .array(z.string())
          .optional()
          .describe("Replacement tag list (normalized to slugs). [] clears."),
        summary: z
          .string()
          .max(500)
          .optional()
          .describe("Summary. Empty string clears."),
        status: z
          .string()
          .max(80)
          .optional()
          .describe("Status. Empty string clears."),
        project: z
          .string()
          .max(80)
          .optional()
          .describe("Project. Empty string clears."),
        aliases: z
          .array(z.string())
          .optional()
          .describe("Replacement alias list. [] clears."),
      },
    },
    async (
      { documentId, title, tags, summary, status, project, aliases },
      extra,
    ) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const updated: string[] = [];

        if (title !== undefined) {
          const ok = await setDocumentTitleForUser(userId, documentId, title);

          if (!ok) {
            return failure("Document not found or you cannot edit it.");
          }

          updated.push("title");
        }

        const frontmatterTouched =
          tags !== undefined ||
          summary !== undefined ||
          status !== undefined ||
          project !== undefined ||
          aliases !== undefined;

        if (frontmatterTouched) {
          await withLiveDocumentText(userId, documentId, (ytext) => {
            const current = parseDocumentMetadata(ytext.toString());
            const merged = {
              tags: tags !== undefined ? normalizeTagList(tags) : current.tags,
              aliases:
                aliases !== undefined
                  ? aliases.map((alias) => alias.trim()).filter(Boolean)
                  : current.aliases,
              summary:
                summary !== undefined ? summary.trim() || null : current.summary,
              status:
                status !== undefined ? status.trim() || null : current.status,
              project:
                project !== undefined ? project.trim() || null : current.project,
            };
            const nextMarkdown = updateDocumentMetadataFrontmatter(
              ytext.toString(),
              merged,
            );
            replaceYTextMinimal(ytext, nextMarkdown);
          });

          updated.push("metadata");
        }

        if (updated.length === 0) {
          return failure("Provide at least one field to update.");
        }

        return json({ ok: true, updated });
      }),
  );

  server.registerTool(
    "delete_document",
    {
      title: "Delete a document",
      description:
        "Archive (soft-delete) a document the current user owns. A version snapshot is saved first, so the delete is recoverable from the document's history. Only the owner can delete.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id to delete."),
      },
    },
    async ({ documentId }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const archived = await archiveDocumentForUser(userId, documentId);

        if (!archived) {
          return failure(
            "Document not found, already deleted, or you are not its owner.",
          );
        }

        return json({ ok: true, deleted: true });
      }),
  );

  server.registerTool(
    "restore_document",
    {
      title: "Restore a deleted document",
      description:
        "Un-archive a previously deleted (soft-deleted) document. Owner only. Use this to reverse delete_document.",
      inputSchema: {
        documentId: z.string().uuid().describe("The deleted document id."),
      },
    },
    async ({ documentId }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const restored = await restoreArchivedDocumentForUser(userId, documentId);

        if (!restored) {
          return failure(
            "Document not found, not deleted, or you are not its owner.",
          );
        }

        return json({ ok: true, restored: true });
      }),
  );

  server.registerTool(
    "restore_version",
    {
      title: "Restore a prior version",
      description:
        "Roll a document back to a prior version (from list_versions). Snapshots the current state first, so this is itself reversible. Note: this resets the live editor session for the document.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        versionId: z.string().uuid().describe("The version id to restore."),
      },
    },
    async ({ documentId, versionId }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const ok = await restoreDocumentVersionForUser(
          userId,
          documentId,
          versionId,
        );

        if (!ok) {
          return failure(
            "Document or version not found, or you cannot edit this document.",
          );
        }

        return json({ ok: true, restored: true });
      }),
  );

  server.registerTool(
    "edit_document",
    {
      title: "Edit a document",
      description:
        "Apply one or more anchored search/replace edits to a document. Each edit's `old_string` must match a UNIQUE span of the current text (read it first with read_document/get_outline); include enough surrounding context to be unambiguous. Do not resend the whole document. All edits apply atomically. If an anchor no longer matches (someone edited concurrently), the call fails and you should re-read and retry.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        edits: z
          .array(
            z.object({
              old_string: z
                .string()
                .min(1)
                .describe("Exact unique text to replace."),
              new_string: z.string().describe("Replacement text."),
            }),
          )
          .min(1)
          .describe("Edits applied atomically in one revision."),
      },
    },
    async ({ documentId, edits }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        let applied = 0;

        const { markdown } = await withLiveDocumentText(
          userId,
          documentId,
          (ytext) => {
            applied = applyAnchoredEdits(
              ytext,
              edits.map((edit) => ({
                oldString: edit.old_string,
                newString: edit.new_string,
              })),
            );
          },
        );

        return json({ ok: true, applied, length: markdown.length });
      }),
  );

  server.registerTool(
    "append_to_document",
    {
      title: "Append to a document",
      description:
        "Append markdown to the end of a document (a separating newline is added as needed). Use this for additions that don't need to target a specific location — it can't fail on stale anchors.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        markdown: z.string().min(1).describe("Markdown to append."),
      },
    },
    async ({ documentId, markdown }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const result = await withLiveDocumentText(
          userId,
          documentId,
          (ytext) => appendMarkdown(ytext, markdown),
        );

        return json({ ok: true, length: result.markdown.length });
      }),
  );

  server.registerTool(
    "insert_at_heading",
    {
      title: "Insert under a heading",
      description:
        "Insert markdown into the section owned by a heading (matched by text or slug). `section_start` places it right after the heading line; `section_end` places it at the end of that section. Use get_outline to discover headings.",
      inputSchema: {
        documentId: z.string().uuid().describe("The document id."),
        heading: z.string().min(1).describe("Heading text or slug to target."),
        markdown: z.string().min(1).describe("Markdown to insert."),
        position: z
          .enum(["section_start", "section_end"])
          .default("section_end")
          .describe("Where within the section to insert."),
      },
    },
    async ({ documentId, heading, markdown, position }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);

        // Surface a clear not-found/forbidden before opening a collab session.
        const document = await getDocumentForUser(userId, documentId);

        if (!document) {
          return failure("Document not found or you do not have access.");
        }

        let inserted = false;
        const result = await withLiveDocumentText(
          userId,
          documentId,
          (ytext) => {
            inserted = insertAtHeading(ytext, heading, markdown, position);
          },
        );

        if (!inserted) {
          return failure(`No heading matching "${heading}" was found.`);
        }

        return json({ ok: true, length: result.markdown.length });
      }),
  );
}
