import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveMcpUserId } from "@/lib/mcp/user";
import {
  listAgentActionsForUser,
  runAgentActionForUser,
} from "@/server/extensions";

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
 * Registers the generic extension-action dispatcher tools. Rather than a tool per
 * extension, these two tools expose every enabled extension's declared agent
 * actions: `list_extension_actions` is discovery (names, descriptions, and the
 * JSON Schema of each action's input), and `run_extension_action` invokes one.
 * This is how variable, user-toggled, and future hub-sourced extensions become
 * agent-usable without bespoke MCP code per extension.
 */
export function registerVaultExtensionTools(server: McpServer): void {
  server.registerTool(
    "list_extension_actions",
    {
      title: "List extension actions",
      description:
        "List the agent actions exposed by the extensions the current user has enabled. Each entry includes the action id, what it does, its scope ('document' actions need a documentId, 'workspace' actions don't), whether it mutates data, and the JSON Schema of its input. ALWAYS call this first to discover available actions and their exact input shape before calling run_extension_action.",
      inputSchema: {},
    },
    async (_args, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const actions = await listAgentActionsForUser(userId);
        return json({ count: actions.length, actions });
      }),
  );

  server.registerTool(
    "run_extension_action",
    {
      title: "Run an extension action",
      description:
        "Invoke an extension's agent action (discover ids and input shapes via list_extension_actions first). Pass the action id, the input object matching that action's JSON Schema, and — for 'document'-scoped actions — the documentId to act on. The action runs with your account's permissions and only within the targeting extension's own data.",
      inputSchema: {
        actionId: z
          .string()
          .describe("The action id from list_extension_actions."),
        documentId: z
          .string()
          .uuid()
          .optional()
          .describe("Required for 'document'-scoped actions; omit otherwise."),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Input object matching the action's input JSON Schema (from list_extension_actions).",
          ),
      },
    },
    async ({ actionId, documentId, input }, extra) =>
      runTool(async () => {
        const userId = resolveMcpUserId(extra);
        const result = await runAgentActionForUser({
          userId,
          actionId,
          documentId,
          input: input ?? {},
        });
        return json({ ok: true, ...result });
      }),
  );
}
