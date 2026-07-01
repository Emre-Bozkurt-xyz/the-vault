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
  ExtensionAgentWorkspaceContext,
  ExtensionPermission,
  ExtensionStateValue,
  VaultExtension,
  VaultExtensionAgentAction,
} from "@/lib/extensions/types";
import { getDocumentAccess } from "@/lib/permissions";
import {
  appendMarkdown,
  applyAnchoredEdits,
  insertAtHeading,
} from "@/lib/mcp/document-edits";
import { withLiveDocumentText } from "@/lib/mcp/collab-write";
import { getAssetForUser } from "@/server/assets";
import { getDocumentForUser } from "@/server/documents";
import {
  deleteDocumentExtensionStateForUser,
  getDocumentExtensionStateForUser,
  listDocumentExtensionStatesForUser,
  listOwnedDocumentExtensionStates,
  upsertDocumentExtensionStateForUser,
} from "@/server/document-extensions";
import { listUserExtensionSettings } from "@/server/user-settings";

/**
 * Permissions for which {@link buildDocumentContext} can currently supply a
 * capability surface. An action that declares anything outside this set is
 * rejected at dispatch with a clear error rather than silently handing the
 * handler an undefined surface. Grow this as surfaces land (see docs/16).
 */
const supportedActionPermissions = new Set<ExtensionPermission>([
  "document:read",
  "document:write",
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
  /** JSON Schema of the action's `data` return, when the action declares one. */
  outputSchema?: unknown;
  /**
   * Present only when discovery was scoped to a document. For document-scoped
   * actions: how many of this extension's state rows exist in that document
   * (0 means the extension has no instance there yet), and whether the action
   * can actually run against it given the user's access.
   */
  documentInstanceCount?: number;
  runnableInDocument?: boolean;
};

export type AgentActionDiscovery = {
  /** Access summary when scoped to a document, so the model knows what it can do. */
  document?: { id: string; canRead: boolean; canEdit: boolean };
  count: number;
  actions: AgentActionDescriptor[];
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
    ...(action.output
      ? { outputSchema: z.toJSONSchema(action.output, { io: "output" }) }
      : {}),
  };
}

/**
 * Lists the agent actions available to a user — only those contributed by
 * extensions the user has enabled. This is the discovery surface dispatcher MCP
 * tools point the model at before invoking a specific action. When `documentId`
 * is given, document-scoped actions are annotated with whether the extension has
 * an instance there and whether the action is runnable given the user's access.
 */
export async function listAgentActionsForUser(
  userId: string,
  documentId?: string,
): Promise<AgentActionDiscovery> {
  const enabled = await resolveEnabledExtensionsForUser(userId);
  const enabledIds = new Set(enabled.map((extension) => extension.id));

  const entries = localExtensionRegistry
    .getAgentActions()
    .filter((entry) => enabledIds.has(entry.extension.id));

  if (!documentId) {
    const actions = entries.map(describeAction);
    return { count: actions.length, actions };
  }

  const access = await getDocumentAccess(userId, documentId);
  const stateCounts = new Map<string, number>();

  if (access.canRead) {
    const rows = await listDocumentExtensionStatesForUser({ userId, documentId });
    for (const row of rows) {
      stateCounts.set(
        row.extensionId,
        (stateCounts.get(row.extensionId) ?? 0) + 1,
      );
    }
  }

  const actions = entries.map((entry) => {
    const descriptor = describeAction(entry);
    if (entry.action.scope !== "document") {
      return descriptor;
    }
    const mutates = entry.action.mutates ?? false;
    return {
      ...descriptor,
      documentInstanceCount: stateCounts.get(entry.extension.id) ?? 0,
      runnableInDocument: access.canRead && (!mutates || access.canEdit),
    };
  });

  return {
    document: {
      id: documentId,
      canRead: access.canRead,
      canEdit: access.canEdit,
    },
    count: actions.length,
    actions,
  };
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

  if (permissions.has("document:read") || permissions.has("document:write")) {
    const markdown: NonNullable<ExtensionAgentDocumentContext["markdown"]> = {};

    if (permissions.has("document:read")) {
      markdown.read = async () => {
        const document = await getDocumentForUser(userId, documentId);
        if (!document) {
          throw new Error("Document not found or you do not have access.");
        }
        return document.markdown;
      };
    }

    if (permissions.has("document:write")) {
      // Mutations go through the collab session (conflict-free, same
      // persistence/versioning path as human edits) — never a raw column write.
      markdown.append = async (md) => {
        const { markdown: next } = await withLiveDocumentText(
          userId,
          documentId,
          (ytext) => appendMarkdown(ytext, md),
        );
        return { length: next.length };
      };
      markdown.insertAtHeading = async (heading, md, position) => {
        let inserted = false;
        await withLiveDocumentText(userId, documentId, (ytext) => {
          inserted = insertAtHeading(ytext, heading, md, position ?? "section_end");
        });
        return { inserted };
      };
      markdown.edit = async (edits) => {
        let applied = 0;
        await withLiveDocumentText(userId, documentId, (ytext) => {
          applied = applyAnchoredEdits(ytext, edits);
        });
        return { applied };
      };
    }

    context.markdown = markdown;
  }

  if (permissions.has("asset:read")) {
    context.assets = {
      async get(assetId) {
        try {
          const asset = await getAssetForUser(userId, assetId);
          return {
            id: asset.id,
            kind: asset.kind,
            displayName: asset.displayName,
            mimeType: asset.mimeType,
            visibility: asset.visibility,
          };
        } catch {
          // getAssetForUser throws when the asset isn't the user's ready asset.
          return null;
        }
      },
    };
  }

  return context;
}

/**
 * Builds the workspace surface for a `scope: "workspace"` action: a cross-document,
 * owner-scoped, extension-bound state reader. Present only with `document:read`.
 */
function buildWorkspaceContext(
  entry: AgentActionEntry,
  userId: string,
): ExtensionAgentWorkspaceContext {
  const permissions = new Set(entry.action.permissions ?? []);
  const context: ExtensionAgentWorkspaceContext = {};

  if (permissions.has("document:read")) {
    context.state = {
      async listAcrossDocuments() {
        const rows = await listOwnedDocumentExtensionStates({
          userId,
          extensionId: entry.extension.id,
        });
        return rows.map((row) => ({
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          stateKey: row.stateKey,
          state: row.state as ExtensionStateValue,
          visibility: row.visibility,
          version: row.version,
        }));
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
  } else {
    context.workspace = buildWorkspaceContext(entry, userId);
  }

  const result = await entry.action.handler(parsedInput, context);

  if (entry.action.output) {
    // Surface a bad handler return as a clear error rather than shipping
    // an off-contract payload to the model.
    const parsed = entry.action.output.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `Action "${actionId}" returned data that does not match its output schema.`,
      );
    }
    return { ...result, data: parsed.data };
  }

  return result;
}
