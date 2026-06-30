import "server-only";

import { z } from "zod";

import {
  getLocalExtensionIds,
  localBuiltInExtensions,
  localExtensionRegistry,
} from "@/lib/extensions/catalog";
import type { AgentActionEntry } from "@/lib/extensions/registry";
import type {
  ExtensionAgentActionContext,
  ExtensionAgentActionResult,
  ExtensionAgentDocumentContext,
  ExtensionPermission,
  ExtensionStateValue,
  VaultExtension,
  VaultExtensionAgentAction,
} from "@/lib/extensions/types";
import { getDocumentAccess } from "@/lib/permissions";
import { getDocumentForUser } from "@/server/documents";
import {
  deleteDocumentExtensionStateForUser,
  getDocumentExtensionStateForUser,
  listDocumentExtensionStatesForUser,
  upsertDocumentExtensionStateForUser,
} from "@/server/document-extensions";
import { listUserExtensionSettings } from "@/server/user-settings";

/**
 * Permissions for which {@link buildDocumentContext} can currently supply a
 * capability surface. An action that declares anything outside this set is
 * rejected at dispatch with a clear error rather than silently handing the
 * handler an undefined surface. Grow this as surfaces land (see docs/14 — e.g.
 * markdown mutation behind `document:write`).
 */
const supportedActionPermissions = new Set<ExtensionPermission>([
  "document:read",
  "document:write-extension-state",
  "asset:read",
]);

/**
 * Resolves the set of extension ids enabled for a user: every `core` extension
 * always, plus built-ins the user has turned on (or that default to enabled and
 * have no explicit row yet). Mirrors the settings UI's notion of "enabled".
 */
export async function resolveEnabledExtensionsForUser(
  userId: string,
): Promise<VaultExtension[]> {
  const allowedExtensionIds = getLocalExtensionIds();
  const rows = await listUserExtensionSettings({ userId, allowedExtensionIds });
  const explicit = new Map(rows.map((row) => [row.extensionId, row.enabled]));

  const enabledIds = localBuiltInExtensions
    .filter((extension) => {
      const setting = explicit.get(extension.id);
      return setting ?? extension.defaultEnabled ?? false;
    })
    .map((extension) => extension.id);

  return localExtensionRegistry.getEnabledExtensions(enabledIds);
}

export type AgentActionDescriptor = {
  id: string;
  title: string;
  description: string;
  scope: VaultExtensionAgentAction["scope"];
  mutates: boolean;
  extensionId: string;
  extensionName: string;
  permissions: ExtensionPermission[];
  /** JSON Schema of the action's input, for the model to construct a valid call. */
  inputSchema: unknown;
};

function describeAction(entry: AgentActionEntry): AgentActionDescriptor {
  const { action, extension } = entry;

  return {
    id: action.id,
    title: action.title,
    description: action.description,
    scope: action.scope,
    mutates: action.mutates ?? false,
    extensionId: extension.id,
    extensionName: extension.name,
    permissions: action.permissions ?? [],
    inputSchema: z.toJSONSchema(action.input, { io: "input" }),
  };
}

/**
 * Lists the agent actions available to a user — only those contributed by
 * extensions the user has enabled. This is the discovery surface dispatcher MCP
 * tools point the model at before invoking a specific action.
 */
export async function listAgentActionsForUser(
  userId: string,
): Promise<AgentActionDescriptor[]> {
  const enabled = await resolveEnabledExtensionsForUser(userId);
  const enabledIds = new Set(enabled.map((extension) => extension.id));

  return localExtensionRegistry
    .getAgentActions()
    .filter((entry) => enabledIds.has(entry.extension.id))
    .map(describeAction);
}

export type RunAgentActionInput = {
  userId: string;
  actionId: string;
  documentId?: string;
  input: unknown;
};

/**
 * Builds the extension-id-bound, permission-gated state surface. Every method is
 * pre-scoped to `extensionId` and `documentId`, so a handler can only ever reach
 * its own extension's state on the targeted document — enforced here, not by
 * convention.
 */
function buildBoundStateApi(
  userId: string,
  documentId: string,
  extensionId: string,
): ExtensionAgentDocumentContext["state"] {
  return {
    async get(stateKey) {
      const row = await getDocumentExtensionStateForUser({
        userId,
        documentId,
        extensionId,
        stateKey,
      });
      return (row?.state as ExtensionStateValue | undefined) ?? null;
    },
    async set(state, options) {
      await upsertDocumentExtensionStateForUser({
        userId,
        documentId,
        extensionId,
        stateKey: options?.stateKey,
        state: state as Record<string, unknown>,
        version: options?.version,
        visibility: options?.visibility,
      });
    },
    async list() {
      const rows = await listDocumentExtensionStatesForUser({
        userId,
        documentId,
        extensionId,
      });
      return rows.map((row) => ({
        stateKey: row.stateKey,
        state: row.state as ExtensionStateValue,
        visibility: row.visibility,
        version: row.version,
      }));
    },
    async delete(stateKey) {
      await deleteDocumentExtensionStateForUser({
        userId,
        documentId,
        extensionId,
        stateKey,
      });
    },
  };
}

async function buildDocumentContext(
  entry: AgentActionEntry,
  userId: string,
  documentId: string,
): Promise<ExtensionAgentDocumentContext> {
  const { action, extension } = entry;
  const permissions = new Set(action.permissions ?? []);
  const access = await getDocumentAccess(userId, documentId);

  if (!access.canRead) {
    throw new Error("Document not found or you do not have access.");
  }

  if (action.mutates && !access.canEdit) {
    throw new Error("You do not have permission to edit this document.");
  }

  const context: ExtensionAgentDocumentContext = {
    id: documentId,
    canEdit: access.canEdit,
    state: buildBoundStateApi(userId, documentId, extension.id),
  };

  if (permissions.has("document:read")) {
    context.markdown = {
      async read() {
        const document = await getDocumentForUser(userId, documentId);
        if (!document) {
          throw new Error("Document not found or you do not have access.");
        }
        return document.markdown;
      },
    };
  }

  return context;
}

/**
 * Resolves, authorizes, validates, and runs an agent action. Framework-agnostic:
 * MCP tools, server actions, and a future cowork UI all call through here.
 */
export async function runAgentActionForUser({
  userId,
  actionId,
  documentId,
  input,
}: RunAgentActionInput): Promise<ExtensionAgentActionResult> {
  const entry = localExtensionRegistry.getAgentAction(actionId);

  if (!entry) {
    throw new Error(`Unknown agent action: ${actionId}`);
  }

  const enabled = await resolveEnabledExtensionsForUser(userId);
  if (!enabled.some((extension) => extension.id === entry.extension.id)) {
    throw new Error(
      `The "${entry.extension.name}" extension is not enabled for your account.`,
    );
  }

  for (const permission of entry.action.permissions ?? []) {
    if (!supportedActionPermissions.has(permission)) {
      throw new Error(
        `Action "${actionId}" requires the unsupported capability "${permission}".`,
      );
    }
  }

  const parsedInput = entry.action.input.parse(input ?? {});

  const context: ExtensionAgentActionContext = { user: { id: userId } };

  if (entry.action.scope === "document") {
    if (!documentId) {
      throw new Error(`Action "${actionId}" requires a documentId.`);
    }
    context.document = await buildDocumentContext(entry, userId, documentId);
  }

  return entry.action.handler(parsedInput, context);
}
