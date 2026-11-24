"use client";

import { dispatchAssetsChanged } from "@/lib/asset-events";
import { showWorkspaceToast } from "@/lib/workspace-toast";

/**
 * Client side of media folders. Every call reports through the workspace
 * toast and tells asset views to refresh; mutations resolve to a value (or
 * null on failure) and never throw, so callers stay simple.
 */

export type MediaFolder = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Something went wrong. Try again.");
  }
  return payload;
}

function fail(error: unknown, fallback: string) {
  showWorkspaceToast({
    message: error instanceof Error ? error.message : fallback,
    tone: "error",
  });
}

/**
 * Creates a folder. Throws with the server's message (e.g. the name is taken)
 * so a dialog can show it inline; `onConflict: "rename"` never conflicts.
 */
export async function createMediaFolder(input: {
  name: string;
  parentId: string | null;
  onConflict?: "error" | "rename";
}) {
  const { folder } = await send<{ folder: MediaFolder }>("/api/assets/folders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  dispatchAssetsChanged();
  return folder;
}

/** Renames a folder; throws with the server's message for inline display. */
export async function renameMediaFolder(folderId: string, name: string) {
  const { folder } = await send<{ folder: MediaFolder }>(`/api/assets/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  dispatchAssetsChanged();
  return folder;
}

/** Moves assets and folders into a folder (null = root). Resolves to whether it worked. */
export async function moveMediaItems(input: {
  assetIds?: string[];
  folderIds?: string[];
  targetFolderId: string | null;
  targetName: string;
}) {
  try {
    const { moved } = await send<{ moved: { assets: string[]; folders: string[] } }>(
      "/api/assets/move",
      {
        method: "POST",
        body: JSON.stringify({
          assetIds: input.assetIds ?? [],
          folderIds: input.folderIds ?? [],
          targetFolderId: input.targetFolderId,
        }),
      },
    );
    dispatchAssetsChanged();
    const count = moved.assets.length + moved.folders.length;
    showWorkspaceToast({
      message:
        count === 0
          ? `Already in ${input.targetName}.`
          : `Moved ${count === 1 ? "1 item" : `${count} items`} to ${input.targetName}.`,
      durationMs: 3000,
    });
    return true;
  } catch (error) {
    fail(error, "Could not move.");
    return false;
  }
}

/** Bins a folder with everything in it, with Undo. Resolves to whether it moved. */
export async function moveFolderToBin(folder: { id: string; name: string }) {
  try {
    const { folder: result } = await send<{ folder: { folders: number; assets: number } }>(
      `/api/assets/folders/${folder.id}`,
      { method: "DELETE" },
    );
    dispatchAssetsChanged();
    const inside = result.assets + Math.max(0, result.folders - 1);
    showWorkspaceToast({
      message: `“${folder.name}”${inside > 0 ? ` and ${inside === 1 ? "1 item" : `${inside} items`} inside` : ""} moved to Bin.`,
      action: { label: "Undo", run: () => void restoreFolder(folder, { quiet: true }) },
      durationMs: 8000,
    });
    return true;
  } catch (error) {
    fail(error, "Could not move to Bin.");
    return false;
  }
}

export async function restoreFolder(
  folder: { id: string; name: string },
  options: { quiet?: boolean } = {},
) {
  try {
    const { folder: result } = await send<{ folder: { name: string; parentId: string | null } }>(
      `/api/assets/folders/${folder.id}/restore`,
      { method: "POST" },
    );
    dispatchAssetsChanged();
    if (!options.quiet) {
      showWorkspaceToast({
        message:
          result.name !== folder.name
            ? `Restored as “${result.name}” (the name was taken).`
            : `“${folder.name}” restored.`,
        durationMs: 3500,
      });
    }
    return true;
  } catch (error) {
    fail(error, "Could not restore.");
    return false;
  }
}

export async function deleteFolderForever(folder: { id: string; name: string }) {
  try {
    await send(`/api/assets/folders/${folder.id}?permanent=1`, { method: "DELETE" });
    dispatchAssetsChanged();
    showWorkspaceToast({ message: `“${folder.name}” deleted for good.`, durationMs: 3000 });
    return true;
  } catch (error) {
    fail(error, "Could not delete.");
    return false;
  }
}
