/**
 * Server half of the extension SDK (`docs/23_EXTENSION_SDK_PLAN.md` §8). Only an
 * extension's `server.ts` may import this; its `import "server-only"` keeps the
 * whole module off the client.
 *
 * Handlers never import `db` or server internals. Everything they may touch
 * arrives on the context the host builds per call, gated by the action's
 * declared permissions.
 */
import type { ZodType } from "zod";

import type {
  ExtensionManifest,
  ExtensionStateRow,
  ExtensionSurface,
  JsonValue,
} from "@/lib/extension-api";
import type { FxRateTable } from "@/lib/fx/table";
import type {
  ExtensionStateValue,
  VaultExtensionAgentAction,
} from "@/lib/extensions/types";

export type { FxRateTable } from "@/lib/fx/table";

export type {
  ExtensionAgentActionContext,
  ExtensionAgentActionResult,
  ExtensionAgentActionScope,
  ExtensionAgentDocumentsApi,
  ExtensionAgentDocumentSummary,
  ExtensionAgentDocumentTasksApi,
  ExtensionAgentTask,
  ExtensionAgentTaskQuery,
  ExtensionAgentTaskRef,
  ExtensionAgentTaskStatus,
  ExtensionAgentWorkspaceTasksApi,
} from "@/lib/extensions/types";

// Core document data an extension may read or write through the documents
// service: the reserved `definition` tag, and the frontmatter serializer that
// escapes metadata exactly as the Properties panel does.
export { definitionTagSlug } from "@/lib/definitions";
export { updateDocumentMetadataFrontmatter } from "@/lib/content-metadata";

/**
 * An action, typed against its manifest: the id must sit in the extension's
 * namespace and every permission must be one the manifest declares. Both were
 * runtime-only checks in the registry; they are now compile errors too.
 */
export type ExtensionAction<
  M extends ExtensionManifest,
  TInput = unknown,
> = Omit<VaultExtensionAgentAction<TInput>, "id" | "permissions"> & {
  id: `${M["id"]}.${string}`;
  permissions?: ReadonlyArray<M["permissions"][number]>;
};

export type ExtensionStateDeclaration = {
  /** Exact state key; omitted for the extension's default/only state. */
  key?: string;
  version: number;
  schema: ZodType<ExtensionStateValue>;
};

/**
 * What `loadRenderData` may use (plan §8). The host builds it per page; like an
 * action context, it is the only way in.
 */
export type RenderDataContext = {
  document: { id: string | null; markdown: string };
  surface: ExtensionSurface;
  canEdit: boolean;
  /** The viewer's settings for this extension (schema defaults when disabled). */
  settings: Record<string, unknown>;
  /** This extension's prefetched state rows, already visibility-filtered. */
  state: Record<string, ExtensionStateRow>;
  /** Provider-sourced daily FX rates; `date` is `YYYY-MM-DD`, default today. */
  fx: { getTable: (options?: { date?: string }) => Promise<FxRateTable | null> };
  assets: {
    /** The subset of `assetIds` whose asset is public (safe on anonymous surfaces). */
    filterPublic: (assetIds: readonly string[]) => Promise<string[]>;
  };
};

/**
 * Data a page must fetch before render that is not state (plan §8), returned
 * as JSON so it can cross to the client. Return null when this surface needs
 * nothing.
 */
export type LoadRenderData = (
  context: RenderDataContext,
) => Promise<JsonValue | null>;

export type ExtensionServerModule = {
  manifestId: string;
  state: readonly ExtensionStateDeclaration[];
  actions: readonly VaultExtensionAgentAction[];
  loadRenderData: LoadRenderData | null;
};

export function defineServer<const M extends ExtensionManifest>(
  manifest: M,
  server: {
    state?: readonly ExtensionStateDeclaration[];
    actions?: ReadonlyArray<ExtensionAction<M>>;
    loadRenderData?: LoadRenderData;
  },
): ExtensionServerModule {
  return {
    manifestId: manifest.id,
    state: server.state ?? [],
    // The action's narrowed id/permission types are a compile-time aid only; at
    // runtime it is exactly the registry's action shape.
    actions: (server.actions ?? []) as unknown as VaultExtensionAgentAction[],
    loadRenderData: server.loadRenderData ?? null,
  };
}
