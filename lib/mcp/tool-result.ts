/** Shared result shaping for the Vault MCP tools. */

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2));
}

export function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wraps a tool body so unauthenticated/expected errors surface as MCP tool
 * errors (`isError`) rather than crashing the transport.
 */
export async function runTool(
  body: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unexpected error.");
  }
}
