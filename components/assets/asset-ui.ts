"use client";

import { assetDownloadUrl, fileExtensionFromName } from "@/lib/asset-delivery";
import { showWorkspaceToast } from "@/lib/workspace-toast";

type AssetLike = {
  kind: "image" | "pdf" | "file";
  mimeType: string;
  displayName: string;
};

/** Human label for an asset's type: "PNG image", "PDF", "ZIP file". */
export function assetTypeLabel(asset: AssetLike) {
  if (asset.kind === "pdf") return "PDF";

  const extension =
    fileExtensionFromName(asset.displayName) ??
    (asset.mimeType.includes("/") ? asset.mimeType.split("/")[1] : null);
  const tag = extension && extension !== "octet-stream" ? extension.toUpperCase() : null;

  if (asset.kind === "image") return tag ? `${tag} image` : "Image";
  return tag ? `${tag} file` : "File";
}

/** Short badge text for file tiles with no preview: "ZIP", "TXT", "PDF". */
export function assetExtensionBadge(asset: AssetLike) {
  if (asset.kind === "pdf") return "PDF";
  return (fileExtensionFromName(asset.displayName) ?? "file").toUpperCase().slice(0, 5);
}

export function downloadAsset(asset: { url: string; displayName: string }) {
  const link = document.createElement("a");
  link.href = assetDownloadUrl(asset.url);
  link.download = asset.displayName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

export function absoluteAssetUrl(url: string) {
  return new URL(url, window.location.origin).toString();
}

export async function copyWithToast(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    showWorkspaceToast({ message: `${label} copied.`, durationMs: 1800 });
  } catch {
    showWorkspaceToast({ message: `Could not copy ${label.toLowerCase()}.`, tone: "error" });
  }
}
