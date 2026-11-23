"use client";

import { dispatchAssetsChanged } from "@/lib/asset-events";
import { formatBytes } from "@/lib/format";
import { showWorkspaceToast } from "@/lib/workspace-toast";

/**
 * Client side of the asset Bin. Every call goes through the bulk route, whose
 * transitions are conditional on the current status, so repeating one (a
 * double click, an Undo pressed twice) is harmless. Each reports through the
 * workspace toast and tells every asset view to refresh.
 */

type NamedAsset = { id: string; displayName: string };

async function runBulk(action: "trash" | "restore" | "delete", assetIds: string[]) {
  const response = await fetch("/api/assets/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, assetIds }),
  });
  const payload = (await response.json().catch(() => null)) as {
    affected?: string[];
    error?: string;
  } | null;

  if (!response.ok || !payload?.affected) {
    throw new Error(payload?.error ?? "Something went wrong. Try again.");
  }

  return payload.affected;
}

function describe(assets: NamedAsset[], count: number) {
  if (count === 1 && assets.length === 1) return `“${assets[0].displayName}”`;
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/**
 * Moves assets to the Bin, with Undo. Resolves to the ids that moved, so the
 * caller can drop them from its list right away; never throws.
 */
export async function moveAssetsToBin(assets: NamedAsset[]): Promise<string[]> {
  if (assets.length === 0) return [];

  try {
    const moved = await runBulk(
      "trash",
      assets.map((asset) => asset.id),
    );
    dispatchAssetsChanged();

    if (moved.length > 0) {
      const movedAssets = assets.filter((asset) => moved.includes(asset.id));
      showWorkspaceToast({
        message: `${describe(assets, moved.length)} moved to Bin.`,
        action: {
          label: "Undo",
          run: () => void restoreAssets(movedAssets, { quiet: true }),
        },
        durationMs: 8000,
      });
    }

    return moved;
  } catch (error) {
    showWorkspaceToast({
      message: error instanceof Error ? error.message : "Could not move to Bin.",
      tone: "error",
    });
    return [];
  }
}

/** Takes assets out of the Bin. `quiet` skips the confirmation toast (Undo). */
export async function restoreAssets(
  assets: NamedAsset[],
  options: { quiet?: boolean } = {},
): Promise<string[]> {
  if (assets.length === 0) return [];

  try {
    const restored = await runBulk(
      "restore",
      assets.map((asset) => asset.id),
    );
    dispatchAssetsChanged();

    if (!options.quiet && restored.length > 0) {
      showWorkspaceToast({
        message: `${describe(assets, restored.length)} restored.`,
        durationMs: 3000,
      });
    }

    return restored;
  } catch (error) {
    showWorkspaceToast({
      message: error instanceof Error ? error.message : "Could not restore.",
      tone: "error",
    });
    return [];
  }
}

/** Deletes binned assets for good. Callers confirm first; there is no Undo. */
export async function deleteAssetsForever(assets: NamedAsset[]): Promise<string[]> {
  if (assets.length === 0) return [];

  try {
    const deleted = await runBulk(
      "delete",
      assets.map((asset) => asset.id),
    );
    dispatchAssetsChanged();

    if (deleted.length > 0) {
      showWorkspaceToast({
        message: `${describe(assets, deleted.length)} deleted for good.`,
        durationMs: 3000,
      });
    }

    return deleted;
  } catch (error) {
    showWorkspaceToast({
      message: error instanceof Error ? error.message : "Could not delete.",
      tone: "error",
    });
    return [];
  }
}

/** Empty Bin. Resolves to whether it succeeded. */
export async function emptyAssetBin(): Promise<boolean> {
  try {
    const response = await fetch("/api/assets/bin", { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as {
      deleted?: number;
      freedBytes?: number;
      error?: string;
    } | null;

    if (!response.ok || typeof payload?.deleted !== "number") {
      throw new Error(payload?.error ?? "Could not empty the Bin.");
    }

    dispatchAssetsChanged();
    showWorkspaceToast({
      message:
        payload.deleted === 0
          ? "The Bin was already empty."
          : `Bin emptied. ${formatBytes(payload.freedBytes ?? 0)} freed.`,
      durationMs: 3000,
    });
    return true;
  } catch (error) {
    showWorkspaceToast({
      message: error instanceof Error ? error.message : "Could not empty the Bin.",
      tone: "error",
    });
    return false;
  }
}
