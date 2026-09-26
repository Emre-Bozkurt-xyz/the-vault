import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { assets } from "@/db/schema";
import type {
  DocumentExtensions,
  ExtensionStateRow,
  ExtensionSurface,
  JsonValue,
} from "@/lib/extension-api";
import type { RenderDataContext } from "@/lib/extension-api/server";
import { serverExtensionEntries } from "@/lib/extension-host/server";
import { detectSyntaxExtensions } from "@/lib/extension-host/syntax";
import type { ExtensionStateValue } from "@/lib/extensions/types";
import {
  listDocumentExtensionStatesForUser,
  listPublicDocumentExtensionStates,
} from "@/server/document-extensions";
import { getFxRateTable } from "@/server/fx-rates";
import { listUserExtensionSettings } from "@/server/user-settings";

/**
 * The extension host's server runtime (`docs/23_EXTENSION_SDK_PLAN.md` §9):
 * what the viewer has switched on, and what one rendered document needs.
 */

export type ViewerExtensions = {
  enabledIds: string[];
  /** Stored settings while enabled, schema defaults otherwise, per installed extension. */
  settings: Record<string, Record<string, unknown>>;
};

const ANONYMOUS: ViewerExtensions = { enabledIds: [], settings: {} };

function parseSettings(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } } | undefined,
  stored: unknown,
): Record<string, unknown> {
  if (!schema) return {};
  const parsed = schema.safeParse(stored ?? {});
  if (parsed.success) return parsed.data as Record<string, unknown>;
  // A stored value the current schema rejects falls back to the defaults rather
  // than failing the page.
  const defaults = schema.safeParse({});
  return defaults.success ? (defaults.data as Record<string, unknown>) : {};
}

/**
 * One query for every extension setting the viewer has, instead of one per
 * extension. An explicit row wins; otherwise the manifest's `defaultEnabled`.
 * Cached per request: the workspace layout and the page both ask.
 */
export const resolveViewerExtensions = cache(resolveViewerExtensionsUncached);

async function resolveViewerExtensionsUncached(
  userId: string | null,
): Promise<ViewerExtensions> {
  if (!userId) {
    return withDefaults(ANONYMOUS);
  }

  const rows = await listUserExtensionSettings({
    userId,
    allowedExtensionIds: serverExtensionEntries.map((entry) => entry.manifest.id),
  });
  const stored = new Map(rows.map((row) => [row.extensionId, row]));
  const enabledIds: string[] = [];
  const settings: ViewerExtensions["settings"] = {};

  for (const { manifest } of serverExtensionEntries) {
    const row = stored.get(manifest.id);
    const enabled = row?.enabled ?? manifest.defaultEnabled ?? false;
    if (enabled) enabledIds.push(manifest.id);
    // A preference nobody can see must not keep applying: a disabled
    // extension's settings page is hidden, so its stored values are ignored.
    settings[manifest.id] = parseSettings(
      manifest.settings?.schema,
      enabled ? row?.settings : undefined,
    );
  }

  return { enabledIds, settings };
}

function withDefaults(viewer: ViewerExtensions): ViewerExtensions {
  const settings = { ...viewer.settings };
  for (const { manifest } of serverExtensionEntries) {
    settings[manifest.id] ??= parseSettings(manifest.settings?.schema, undefined);
  }
  return { enabledIds: viewer.enabledIds, settings };
}

async function loadStateRows(input: {
  surface: ExtensionSurface;
  documentId: string | null;
  userId: string | null;
}): Promise<DocumentExtensions["state"]> {
  if (!input.documentId) return {};

  // Both readers are the existing permission-checked ones: the public reader
  // also requires the document itself to be public, and the user reader
  // re-checks document access and per-row visibility.
  const rows =
    input.surface === "public"
      ? await listPublicDocumentExtensionStates({ documentId: input.documentId })
      : input.surface === "workspace"
        ? await listDocumentExtensionStatesForUser({
            userId: input.userId,
            documentId: input.documentId,
          })
        : [];

  // Only installed extensions that did not opt out: a row left behind by a
  // removed extension, or a large opted-out state, never reaches the page.
  const prefetched = new Set(
    serverExtensionEntries
      .filter((entry) => entry.manifest.prefetchState !== false)
      .map((entry) => entry.manifest.id),
  );
  const state: DocumentExtensions["state"] = {};
  for (const row of rows) {
    if (!prefetched.has(row.extensionId)) continue;
    const bucket = (state[row.extensionId] ??= {});
    bucket[row.stateKey] = {
      state: row.state as ExtensionStateValue,
      visibility: row.visibility,
      version: row.version,
    } satisfies ExtensionStateRow;
  }
  return state;
}

async function filterPublicAssets(assetIds: readonly string[]): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(inArray(assets.id, [...assetIds]), eq(assets.visibility, "public")));
  return rows.map((row) => row.id);
}

/**
 * Resolves extensions for one rendered document.
 *
 * The render set is: extensions the viewer enabled, those whose syntax the
 * document uses, those with state on it, and `renderAlways` ones. While the
 * document is editable it is every installed extension, because the author can
 * type a new directive and server-fetched data (the FX table) cannot follow.
 *
 * Callers must already have established that the viewer may read the document.
 */
export async function resolveDocumentExtensions(input: {
  surface: ExtensionSurface;
  document: { id: string | null; markdown: string };
  canEdit: boolean;
  userId: string | null;
  /** Pass when the page already resolved it (e.g. to share the query). */
  viewer?: ViewerExtensions;
}): Promise<DocumentExtensions> {
  const viewer = input.viewer ?? (await resolveViewerExtensions(input.userId));
  const state = await loadStateRows({
    surface: input.surface,
    documentId: input.document.id,
    userId: input.userId,
  });

  const manifests = serverExtensionEntries.map((entry) => entry.manifest);
  const used = detectSyntaxExtensions(input.document.markdown, manifests);
  const renderIds = serverExtensionEntries
    .map((entry) => entry.manifest)
    .filter(
      (manifest) =>
        input.canEdit ||
        manifest.renderAlways ||
        viewer.enabledIds.includes(manifest.id) ||
        used.has(manifest.id) ||
        Boolean(state[manifest.id]),
    )
    .map((manifest) => manifest.id);

  let fxCache: Map<string, Promise<Awaited<ReturnType<typeof getFxRateTable>>>> | null = null;
  const fx: RenderDataContext["fx"] = {
    getTable: (options) => {
      fxCache ??= new Map();
      const key = options?.date ?? "";
      let table = fxCache.get(key);
      if (!table) {
        table = getFxRateTable(options?.date ? { date: options.date } : {});
        fxCache.set(key, table);
      }
      return table;
    },
  };

  const data: DocumentExtensions["data"] = {};
  await Promise.all(
    serverExtensionEntries
      .filter(
        (entry) =>
          renderIds.includes(entry.manifest.id) && entry.server?.loadRenderData,
      )
      .map(async ({ manifest, server }) => {
        const result: JsonValue | null = await server!.loadRenderData!({
          document: input.document,
          surface: input.surface,
          canEdit: input.canEdit,
          settings: viewer.settings[manifest.id] ?? {},
          state: state[manifest.id] ?? {},
          fx,
          assets: { filterPublic: filterPublicAssets },
        });
        if (result !== null) data[manifest.id] = result;
      }),
  );

  return {
    surface: input.surface,
    documentId: input.document.id,
    canEdit: input.canEdit,
    renderIds,
    enabledIds: viewer.enabledIds,
    settings: viewer.settings,
    state,
    data,
  };
}
