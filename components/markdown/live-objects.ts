import { parseAssetEmbedSource, type ParsedAssetEmbed } from "@/lib/asset-embeds";

/**
 * Pure helpers for Live mode's "rendered objects": the links, wiki links and
 * images that Live mode draws rendered instead of as Markdown source.
 *
 * Live mode's rule for these is **rendered by default, source on intent**:
 * moving the caret or a selection through the document never flips an object
 * between its rendered form and its source (which re-wraps the line or
 * collapses a whole image, so the page jumps). Source appears only when the
 * author edits the object's syntax, double-clicks it, steps into it with
 * ←/→, or asks for it from the object toolbar. The reveal bookkeeping lives in
 * `live-blocks.ts` (`liveRevealField`); this file only answers "what object is
 * at this offset" for both the reveal logic and the toolbar.
 */

export type InlineObjectKind = "link" | "wikiLink" | "image";

/**
 * An inline object in one line of Markdown. Offsets are relative to the line.
 * `labelFrom..labelTo` is the part Live mode keeps visible (a link's label);
 * everything else in `from..to` is hidden syntax. An image has no visible
 * text, so its label range is empty.
 */
export type InlineObject = {
  kind: InlineObjectKind;
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
};

// Mirrors the Live preview pass in MarkdownEditor (`addLinkDecorations`,
// `addWikiLinkDecorations`, `addWikiImageDecorations`): an object is found here
// exactly when that pass would hide its syntax.
const markdownLinkPattern = /\[([^\]\n]+)]\(([^)\n]+)\)/g;
const wikiLinkPattern = /(?<!!)\[\[([^\]\n]+)\]\]/g;
const wikiImagePattern = /!\[\[([^\]\n]+)\]\]/g;
const inlineCodePattern = /`([^`\n]+)`/g;

export function inlineCodeRanges(text: string) {
  const ranges: Array<{ from: number; to: number }> = [];

  for (const match of text.matchAll(inlineCodePattern)) {
    if (match.index !== undefined) {
      ranges.push({ from: match.index, to: match.index + match[0].length });
    }
  }

  return ranges;
}

/** Every inline object on a line, outside inline code. */
export function findInlineObjects(text: string): InlineObject[] {
  const code = inlineCodeRanges(text);
  const overlapsCode = (from: number, to: number) =>
    code.some((range) => from < range.to && to > range.from);
  const objects: InlineObject[] = [];

  for (const match of text.matchAll(wikiImagePattern)) {
    if (match.index === undefined) continue;
    const from = match.index;
    const to = from + match[0].length;
    const target = match[1].split("|", 2)[0]?.trim() ?? "";
    if (!safeExternalImageSrc(target) || overlapsCode(from, to)) continue;
    objects.push({ kind: "image", from, to, labelFrom: from, labelTo: from });
  }

  for (const match of text.matchAll(markdownLinkPattern)) {
    if (match.index === undefined) continue;
    const from = match.index;
    const to = from + match[0].length;
    if (overlapsCode(from, to)) continue;
    objects.push({ kind: "link", from, to, labelFrom: from + 1, labelTo: from + 1 + match[1].length });
  }

  for (const match of text.matchAll(wikiLinkPattern)) {
    if (match.index === undefined) continue;
    const from = match.index;
    const to = from + match[0].length;
    if (overlapsCode(from, to)) continue;
    const [target = "", label = ""] = match[1].split("|", 2);
    const visible = label.trim() || target.trim();
    const visibleStart = visible ? match[0].indexOf(visible) : -1;
    if (visibleStart < 0) continue;
    objects.push({
      kind: "wikiLink",
      from,
      to,
      labelFrom: from + visibleStart,
      labelTo: from + visibleStart + visible.length,
    });
  }

  return objects.sort((a, b) => a.from - b.from);
}

/** The inline object whose span contains `offset` (inclusive of both ends). */
export function findInlineObjectAt(text: string, offset: number): InlineObject | null {
  return (
    findInlineObjects(text).find(
      (object) => offset >= object.from && offset <= object.to,
    ) ?? null
  );
}

/**
 * Whether `offset` sits inside the object's *hidden* syntax: a caret there is
 * invisible unless the source is shown, so the object must reveal.
 */
export function isInsideHiddenSyntax(object: InlineObject, offset: number) {
  if (object.kind === "image") {
    return offset > object.from && offset < object.to;
  }

  return (
    (offset > object.from && offset < object.labelFrom) ||
    (offset > object.labelTo && offset < object.to)
  );
}

/** Whether `offset` is in an object's visible label, either end included. */
export function isInLabel(object: InlineObject, offset: number) {
  return object.kind !== "image" && offset >= object.labelFrom && offset <= object.labelTo;
}

export type StandaloneImage =
  | { variant: "asset"; parsed: ParsedAssetEmbed }
  | {
      variant: "external";
      syntax: "wiki" | "markdown";
      src: string;
      alt: string;
    };

const standaloneWikiImagePattern = /^!\[\[([^\]\n]+)\]\]$/;
const standaloneMarkdownImagePattern =
  /^!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)\n]+)(?:\s+"[^"\n]*")?\s*\)$/;

/**
 * A line that is only an image: `![[asset:id|label]]{…}`, `![[https://…]]`, or
 * `![alt](url)`. These render in Live mode as a block the author selects and
 * formats, never collapsing back to a line of source while the caret passes.
 */
export function parseStandaloneImageLine(text: string): StandaloneImage | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith("![")) {
    return null;
  }

  const asset = parseAssetEmbedSource(trimmed);

  if (asset) {
    return { variant: "asset", parsed: asset };
  }

  const wiki = trimmed.match(standaloneWikiImagePattern);

  if (wiki) {
    const [target = "", alt = ""] = wiki[1].split("|", 2);
    const src = safeExternalImageSrc(target.trim());
    return src
      ? { variant: "external", syntax: "wiki", src, alt: alt.trim() || target.trim() }
      : null;
  }

  const markdown = trimmed.match(standaloneMarkdownImagePattern);

  if (markdown) {
    const src = markdown[2].replace(/^<|>$/g, "");
    // The same protocols Read mode renders (`allowedImageProtocol`).
    return /^(https?:|\/(?!\/))/i.test(src)
      ? { variant: "external", syntax: "markdown", src, alt: markdown[1].trim() }
      : null;
  }

  return null;
}

/**
 * Rewrites an external image line with a new alt text or URL, keeping the
 * syntax the author used.
 */
export function formatExternalImageSource(
  image: Extract<StandaloneImage, { variant: "external" }>,
  next: { src?: string; alt?: string },
) {
  const src = next.src ?? image.src;
  const alt = next.alt ?? image.alt;

  if (image.syntax === "wiki") {
    return alt && alt !== src ? `![[${src}|${alt}]]` : `![[${src}]]`;
  }

  return `![${alt}](${/[\s()]/.test(src) ? `<${src}>` : src})`;
}

export function safeExternalImageSrc(target: string) {
  let url: URL;

  try {
    url = new URL(target);
  } catch {
    return null;
  }

  return url.protocol === "https:" || url.protocol === "http:"
    ? url.toString()
    : null;
}

/**
 * Natural sizes of images this tab has loaded, by URL, so an image that leaves
 * the viewport (CodeMirror drops off-screen DOM) or is re-rendered after an
 * edit reserves its exact space again instead of starting at 0px and pushing
 * the document down when it loads.
 */
const naturalImageSizes = new Map<string, { width: number; height: number }>();
const maxRememberedImages = 500;

export function rememberImageSize(src: string, width: number, height: number) {
  if (!src || !(width > 0) || !(height > 0)) return;
  naturalImageSizes.delete(src);
  naturalImageSizes.set(src, { width, height });

  if (naturalImageSizes.size > maxRememberedImages) {
    const oldest = naturalImageSizes.keys().next().value;
    if (oldest !== undefined) naturalImageSizes.delete(oldest);
  }
}

export function knownImageSize(src: string) {
  return naturalImageSizes.get(src) ?? null;
}

/** Last rendered height of a block widget, by a key of what it shows. */
const renderedBlockHeights = new Map<string, number>();

export function rememberBlockHeight(key: string, height: number) {
  if (!(height > 0)) return;
  renderedBlockHeights.delete(key);
  renderedBlockHeights.set(key, height);

  if (renderedBlockHeights.size > maxRememberedImages) {
    const oldest = renderedBlockHeights.keys().next().value;
    if (oldest !== undefined) renderedBlockHeights.delete(oldest);
  }
}

export function knownBlockHeight(key: string) {
  return renderedBlockHeights.get(key) ?? -1;
}
