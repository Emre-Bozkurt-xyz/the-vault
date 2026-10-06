import "server-only";

import { serverExtensionEntries } from "@/lib/extension-host/server";
import type { WorkspaceAgendaEvent } from "@/lib/extension-api/server";
import type { ExtensionStateValue } from "@/lib/extensions/types";
import { listOwnedDocumentExtensionStates } from "@/server/document-extensions";
import { resolveViewerExtensions } from "@/server/extension-runtime";

/** Collect dated items from enabled extensions without interpreting their state in core. */
export async function listWorkspaceAgendaEvents(userId: string, from: string, to: string): Promise<WorkspaceAgendaEvent[]> {
  const viewer = await resolveViewerExtensions(userId);
  const entries = serverExtensionEntries.filter(({ manifest, server }) =>
    viewer.enabledIds.includes(manifest.id) && manifest.permissions.includes("document:read") && server?.loadWorkspaceAgendaEvents,
  );
  const groups = await Promise.all(entries.map(async ({ manifest, server }) => {
    const rows = await listOwnedDocumentExtensionStates({ userId, extensionId: manifest.id });
    return server!.loadWorkspaceAgendaEvents!({ rows: rows.map((row) => ({
      documentId: row.documentId, documentTitle: row.documentTitle,
      stateKey: row.stateKey, state: row.state as ExtensionStateValue,
    })), from, to });
  }));
  return groups.flat().sort((a, b) =>
    a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "") || a.text.localeCompare(b.text),
  );
}
