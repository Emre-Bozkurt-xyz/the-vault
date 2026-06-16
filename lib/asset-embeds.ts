import type { AssetKind } from "@/db/schema";

export type AssetEmbedResolution = {
  id: string;
  kind: AssetKind;
  url: string;
  altText: string | null;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
};

export type AssetEmbedResolutionMap = Record<string, AssetEmbedResolution>;

export type AssetEmbedLayout = "block" | "wrap" | "inline";
export type AssetEmbedAlign = "left" | "center" | "right";
export type AssetEmbedWidthPreset = "small" | "medium" | "large" | "full";

export type AssetEmbedAttributes = {
  layout: AssetEmbedLayout;
  align: AssetEmbedAlign;
  width: AssetEmbedWidthPreset;
  customWidth: string | null;
  caption: string | null;
  alt: string | null;
};

export type ParsedAssetEmbed = {
  assetId: string;
  label: string | null;
  attributes: AssetEmbedAttributes;
  source: string;
};

const ASSET_EMBED_PATTERN =
  /!\[\[asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^\]\n]+))?\]\](?:\{([^}\n]*)\})?/gi;

const ASSET_EMBED_SOURCE_PATTERN =
  /^!\[\[asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^\]\n]+))?\]\](?:\{([^}\n]*)\})?$/i;

const defaultAssetEmbedAttributes: AssetEmbedAttributes = {
  layout: "block",
  align: "center",
  width: "large",
  customWidth: null,
  caption: null,
  alt: null,
};

export function transformAssetEmbeds(
  markdown: string,
  resolutions: AssetEmbedResolutionMap = {},
) {
  return markdown.replace(
    ASSET_EMBED_PATTERN,
    (match, assetId: string, label?: string, rawAttributes?: string) => {
      const normalizedAssetId = assetId.toLowerCase();
      const asset = resolutions[normalizedAssetId];
      const parsedLabel = label?.trim() || null;
      const attributes = parseAssetEmbedAttributes(rawAttributes);
      const fallbackLabel = parsedLabel || "Private asset";

      if (!asset) {
        return `<span class="vault-asset-embed vault-asset-embed--missing">${escapeHtml(
          fallbackLabel,
        )}</span>`;
      }

      const alt = attributes.alt || asset.altText || parsedLabel || asset.displayName;
      const url = encodeURI(asset.url);

      if (asset.kind === "image") {
        const caption = attributes.caption;
        const figureStyle = getAssetEmbedStyle(attributes);
        const containerTag = attributes.layout === "inline" ? "span" : "figure";
        const renderCaption = attributes.layout !== "inline" && caption;

        return [
          `<${containerTag} class="${getAssetEmbedClassName(
            attributes,
            "vault-asset-embed vault-asset-embed--image",
          )}"${figureStyle ? ` style="${figureStyle}"` : ""}>`,
          `<img class="vault-asset-embed-image" src="${escapeHtml(url)}" alt="${escapeHtml(
            alt,
          )}" loading="lazy" />`,
          renderCaption
            ? `<figcaption class="vault-asset-embed-caption">${escapeHtml(
                caption,
              )}</figcaption>`
            : "",
          `</${containerTag}>`,
        ].join("");
      }

      return `<a class="vault-asset-embed vault-asset-embed--file" href="${escapeHtml(
        asset.url,
      )}" target="_blank" rel="noreferrer">${escapeHtml(
        parsedLabel || asset.displayName,
      )}</a>`;
    },
  );
}

export function extractAssetEmbedIds(markdown: string) {
  return Array.from(markdown.matchAll(ASSET_EMBED_PATTERN), (match) =>
    match[1].toLowerCase(),
  );
}

export function parseAssetEmbedSource(source: string): ParsedAssetEmbed | null {
  const match = source.trim().match(ASSET_EMBED_SOURCE_PATTERN);

  if (!match) {
    return null;
  }

  return {
    assetId: match[1].toLowerCase(),
    label: match[2]?.trim() || null,
    attributes: parseAssetEmbedAttributes(match[3]),
    source: match[0],
  };
}

export function parseAssetEmbedAttributes(rawAttributes?: string) {
  const attributes: AssetEmbedAttributes = { ...defaultAssetEmbedAttributes };

  if (!rawAttributes) {
    return attributes;
  }

  const tokens = rawAttributes.matchAll(
    /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)/g,
  );

  for (const token of tokens) {
    const key = token[1].toLowerCase();
    const value = (token[3] ?? token[4] ?? token[2] ?? "").trim();

    if (!value) {
      continue;
    }

    if (key === "layout" && isAssetEmbedLayout(value)) {
      attributes.layout = value;
      continue;
    }

    if (key === "align" && isAssetEmbedAlign(value)) {
      attributes.align = value;
      continue;
    }

    if (key === "width") {
      const width = parseAssetEmbedWidth(value);

      if (width) {
        attributes.width = width.preset;
        attributes.customWidth = width.customWidth;
      }

      continue;
    }

    if (key === "caption") {
      attributes.caption = value.slice(0, 240);
      continue;
    }

    if (key === "alt") {
      attributes.alt = value.slice(0, 240);
    }
  }

  return attributes;
}

export function formatAssetEmbedSource(
  parsed: Pick<ParsedAssetEmbed, "assetId" | "label">,
  attributes: AssetEmbedAttributes,
) {
  const label = parsed.label ? `|${parsed.label}` : "";
  const attributeSource = [
    `layout=${attributes.layout}`,
    `align=${attributes.align}`,
    `width=${attributes.customWidth ?? attributes.width}`,
    attributes.caption ? `caption=${quoteAttributeValue(attributes.caption)}` : null,
    attributes.alt ? `alt=${quoteAttributeValue(attributes.alt)}` : null,
  ]
    .filter((attribute): attribute is string => Boolean(attribute))
    .join(" ");

  return `![[asset:${parsed.assetId}${label}]]{${attributeSource}}`;
}

export function getAssetEmbedClassName(
  attributes: AssetEmbedAttributes,
  baseClassName = "vault-asset-embed",
) {
  return [
    baseClassName,
    `vault-asset-layout-${attributes.layout}`,
    `vault-asset-align-${attributes.align}`,
    attributes.customWidth ? "vault-asset-width-custom" : `vault-asset-width-${attributes.width}`,
  ].join(" ");
}

export function getAssetEmbedStyle(attributes: AssetEmbedAttributes) {
  if (!attributes.customWidth) {
    return "";
  }

  return `max-width: ${attributes.customWidth}`;
}

function isAssetEmbedLayout(value: string): value is AssetEmbedLayout {
  return value === "block" || value === "wrap" || value === "inline";
}

function isAssetEmbedAlign(value: string): value is AssetEmbedAlign {
  return value === "left" || value === "center" || value === "right";
}

function parseAssetEmbedWidth(value: string) {
  const normalized = value.toLowerCase();

  if (isAssetEmbedWidthPreset(normalized)) {
    return { preset: normalized, customWidth: null };
  }

  const pixelMatch = normalized.match(/^(\d{2,4})(px)?$/);

  if (pixelMatch) {
    const width = Math.min(Math.max(Number(pixelMatch[1]), 80), 1600);

    return { preset: "medium" as const, customWidth: `${width}px` };
  }

  const percentMatch = normalized.match(/^(\d{1,3})%$/);

  if (percentMatch) {
    const width = Math.min(Math.max(Number(percentMatch[1]), 10), 100);

    return { preset: "medium" as const, customWidth: `${width}%` };
  }

  return null;
}

function isAssetEmbedWidthPreset(value: string): value is AssetEmbedWidthPreset {
  return (
    value === "small" ||
    value === "medium" ||
    value === "large" ||
    value === "full"
  );
}

function quoteAttributeValue(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized.includes('"')) {
    return `"${normalized}"`;
  }

  if (!normalized.includes("'")) {
    return `'${normalized}'`;
  }

  return `"${normalized.replace(/"/g, "'")}"`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
