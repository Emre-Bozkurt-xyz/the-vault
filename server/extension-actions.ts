"use server";

import { z } from "zod";

import { requireActiveUser } from "@/server/authz";
import { runAgentActionForUser } from "@/server/extensions";

const runExtensionActionSchema = z.object({
  actionId: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
  documentId: z.string().uuid().optional(),
  input: z.unknown().optional(),
});

export type ExtensionActionOutcome =
  | { ok: true; data?: unknown; message?: string }
  | { ok: false; error: string };

/**
 * The one server entry point for an extension's own UI
 * (`docs/23_EXTENSION_SDK_PLAN.md` §8, §16 decision 3). It runs the same
 * dispatcher MCP uses — enablement, permission, document-access and schema
 * checks included — so there are no extension-specific server actions to audit.
 * The only difference from an agent call is that `agent: false` actions are
 * allowed here.
 *
 * Returns an outcome instead of throwing, so a refused call reaches the
 * component as a message rather than an error boundary.
 */
export async function runExtensionActionAction(
  raw: unknown,
): Promise<ExtensionActionOutcome> {
  const user = await requireActiveUser();
  const parsed = runExtensionActionSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, error: "Invalid extension action request." };
  }

  try {
    const result = await runAgentActionForUser({
      userId: user.id,
      actionId: parsed.data.actionId,
      documentId: parsed.data.documentId,
      input: parsed.data.input ?? {},
      caller: "extension",
    });
    return { ok: true, ...result };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "The action failed.",
    };
  }
}
