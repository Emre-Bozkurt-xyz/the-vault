import type { AssetKind } from "@/db/schema";

/**
 * How an asset's bytes are presented to the browser. Images and PDFs come from
 * a sniffed allow-list and render inline. `file` assets can be anything
 * (HTML, SVG, scripts), so they are always a sandboxed download with an opaque
 * type: rendering them inline on our origin would be stored XSS.
 */
export function assetDeliveryHeaders(
  asset: {
    kind: AssetKind;
    mimeType: string;
    displayName: string;
  },
  options: { download?: boolean } = {},
): Record<string, string> {
  const filename = escapeHeaderValue(asset.displayName);

  if (asset.kind === "file") {
    return {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    };
  }

  return {
    "Content-Type": asset.mimeType,
    // `?download=1` asks for a save dialog instead of rendering inline.
    "Content-Disposition": `${options.download ? "attachment" : "inline"}; filename="${filename}"`,
    "X-Content-Type-Options": "nosniff",
  };
}

/** Lower-cased extension from a filename, or null when it has none usable. */
export function fileExtensionFromName(filename: string) {
  const match = /\.([A-Za-z0-9]{1,16})$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

function escapeHeaderValue(value: string) {
  return value.replace(/["\\\r\n]/g, "_");
}

/** The asset's content URL with `download=1`, keeping any existing query. */
export function assetDownloadUrl(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}
