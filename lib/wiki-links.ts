import { parseDocumentMetadata } from "@/lib/content-metadata";
import { definitionPreview } from "@/lib/definitions";

export type WikiLinkResolutionStatus =
  | "resolved"
  | "unresolved"
  | "private"
  | "ambiguous";

export type WikiLinkResolution = {
  status: WikiLinkResolutionStatus;
  source?: "document" | "public" | "guide";
  documentId?: string;
  label?: string;
  href?: string;
  embedMarkdown?: string;
  /**
   * The target is a definition document — it carries the `definition` tag, from
   * its own frontmatter or inherited from a folder (see `lib/definitions.ts`).
   *
   * Resolved server-side and carried here on purpose: folder-inherited tags live
   * only in `document_tags`, never in the Markdown, so a renderer that parsed
   * frontmatter to answer this would miss every definition filed by folder.
   */
  isDefinition?: boolean;
  /**
   * Bounded Markdown for a definition's hover card (summary, else first body
   * block). Only ever set alongside `isDefinition`, so a vault with few
   * definitions pays almost nothing for it.
   */
  preview?: string;
  ownerUsername?: string | null;
  headings?: Array<{
    level: number;
    text: string;
    slug: string;
  }>;
  anchors?: WikiLinkAnchor[];
};

export type WikiLinkAnchor =
  | {
      type: "heading";
      id: string;
      label: string;
      level: number;
    }
  | {
      type: "block";
      id: string;
      label: string;
    }
  | {
      type: "region";
      id: string;
      label: string;
      title: string;
      foldable: boolean;
      collapsed: boolean;
    };

export type WikiLinkResolutionMap = Record<string, WikiLinkResolution>;
/** What the renderer needs to draw one definition's hover card. */
export type WikiLinkDefinition = {
  label: string;
  preview: string;
};
export type WikiDocumentEmbedBlock =
  | {
      type: "markdown";
      markdown: string;
    }
  | {
      type: "region";
      id: string;
      title: string;
      foldable: boolean;
      collapsed: boolean;
      markdown: string;
    }
  | {
      type: "embed";
      target: string;
      label: string;
      fragment: string | null;
      resolution?: WikiLinkResolution;
    };

type WikiLinkParts = {
  embed: boolean;
  target: string;
  label: string;
  fragment: string | null;
};

const wikiLinkPattern = /(!?)\[\[([^\]\n]+)\]\]/g;
const emptyDefinitions: Map<string, WikiLinkDefinition> = new Map();
const definitionsByHrefCache = new WeakMap<
  WikiLinkResolutionMap,
  Map<string, WikiLinkDefinition>
>();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function wikiDocKey(documentId: string) {
  return `doc:${documentId.trim().toLowerCase()}`;
}

export function wikiGuideKey(slug: string) {
  return `guide:${normalizeWikiSlug(slug)}`;
}

export function wikiPublicKey(slug: string) {
  return `public:${normalizeWikiSlug(slug)}`;
}

export function wikiTitleKey(title: string) {
  return `title:${normalizeWikiText(title)}`;
}

export function wikiKeyForTarget(target: string) {
  const { target: normalizedTarget } = splitWikiTargetFragment(target);
  const docId = parseWikiDocTarget(normalizedTarget);
  const guideSlug = parseWikiGuideTarget(normalizedTarget);
  const publicSlug = parseWikiPublicTarget(normalizedTarget);

  if (docId) {
    return wikiDocKey(docId);
  }

  if (guideSlug) {
    return wikiGuideKey(guideSlug);
  }

  if (publicSlug) {
    return wikiPublicKey(publicSlug);
  }

  return wikiTitleKey(normalizedTarget);
}

export function parseWikiDocTarget(target: string) {
  const { target: normalizedTarget } = splitWikiTargetFragment(target);

  if (normalizedTarget.toLowerCase().startsWith("doc:")) {
    const docId = normalizedTarget.slice(4).trim();
    return uuidPattern.test(docId) ? docId.toLowerCase() : null;
  }

  return uuidPattern.test(normalizedTarget)
    ? normalizedTarget.toLowerCase()
    : null;
}

export function parseWikiGuideTarget(target: string) {
  return parseWikiSlugTarget(target, "guide:");
}

export function parseWikiPublicTarget(target: string) {
  return parseWikiSlugTarget(target, "public:");
}

export function escapeWikiLinkLabel(value: string) {
  return value.replace(/[\]\n|]/g, " ").replace(/\s+/g, " ").trim();
}

export function slugifyMarkdownHeading(value: string) {
  const slug = normalizeWikiText(stripInlineMarkdown(value))
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "section";
}

export function extractMarkdownHeadingOptions(markdown: string) {
  return extractMarkdownAnchorOptions(markdown)
    .filter((anchor) => anchor.type === "heading")
    .map((anchor) => ({
      level: anchor.level,
      text: anchor.label,
      slug: anchor.id,
    }));
}

export function extractMarkdownAnchorOptions(markdown: string) {
  const anchors: WikiLinkAnchor[] = [];
  const used = new Map<string, number>();
  let inFence = false;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);

    if (!heading) {
      continue;
    }

    const text = stripInlineMarkdown(heading[2]).trim();
    const baseSlug = slugifyMarkdownHeading(text);
    const count = used.get(baseSlug) ?? 0;
    used.set(baseSlug, count + 1);

    anchors.push({
      type: "heading",
      level: heading[1].length,
      label: text,
      id: count === 0 ? baseSlug : `${baseSlug}-${count}`,
    });
  }

  for (const region of findVaultRegions(lines)) {
    anchors.push({
      type: "region",
      id: regionFragmentId(region.id),
      label: region.title || region.id,
      title: region.title || region.id,
      foldable: region.foldable,
      collapsed: region.collapsed,
    });
  }

  for (const block of findBlockAnchors(lines)) {
    anchors.push({
      type: "block",
      id: blockFragmentId(block.id),
      label: block.label,
    });
  }

  return anchors;
}

export function extractMarkdownTarget(
  markdown: string,
  fragment: string | null,
) {
  if (!fragment) {
    return markdown;
  }

  const normalizedFragment = normalizeFragmentId(fragment);

  if (normalizedFragment.startsWith("@")) {
    return extractMarkdownRegion(markdown, normalizedFragment.slice(1));
  }

  if (normalizedFragment.startsWith("^")) {
    return extractMarkdownBlock(markdown, normalizedFragment.slice(1));
  }

  return extractMarkdownSection(markdown, normalizedFragment);
}

export function extractMarkdownSection(markdown: string, fragment: string | null) {
  if (!fragment) {
    return markdown;
  }

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const targetSlug = normalizeHeadingFragment(fragment);
  const used = new Map<string, number>();
  let inFence = false;
  let startIndex = -1;
  let startLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);

    if (!heading) {
      continue;
    }

    const baseSlug = slugifyMarkdownHeading(heading[2]);
    const count = used.get(baseSlug) ?? 0;
    used.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;

    if (slug === targetSlug) {
      startIndex = index;
      startLevel = heading[1].length;
      break;
    }
  }

  if (startIndex === -1) {
    return markdown;
  }

  inFence = false;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+/);

    if (heading && heading[1].length <= startLevel) {
      return lines.slice(startIndex, index).join("\n").trim();
    }
  }

  return lines.slice(startIndex).join("\n").trim();
}

export function extractWikiLinkTargets(markdown: string) {
  const targets = new Set<string>();

  transformMarkdownText(markdown, (segment) =>
    segment.replace(wikiLinkPattern, (_match, bang: string, body: string) => {
      const parts = parseWikiLinkParts(bang, body);

      if (!parts.embed && parts.target) {
        targets.add(parts.target);
      }

      return "";
    }),
  );

  return Array.from(targets);
}

export function transformWikiLinks(
  markdown: string,
  resolutions: WikiLinkResolutionMap = {},
) {
  const anchorMarkdown = transformHiddenAnchorMarkers(markdown);

  return transformMarkdownText(anchorMarkdown, (segment) =>
    segment.replace(wikiLinkPattern, (match, bang: string, body: string) => {
      const parts = parseWikiLinkParts(bang, body);

      if (!parts.target) {
        return match;
      }

      if (parts.embed) {
        return externalImageMarkdown(parts.target, parts.label) ?? match;
      }

      const resolution = resolutions[wikiKeyForTarget(parts.target)];

      if (resolution?.status === "resolved" && resolution.href) {
        return `[${escapeMarkdownLabel(parts.label || resolution.label || parts.target)}](${appendHeadingFragment(resolution.href, parts.fragment)})`;
      }

      const status = resolution?.status ?? "unresolved";
      const title =
        status === "ambiguous"
          ? "Ambiguous wiki link"
          : status === "private"
            ? "Private wiki link"
            : "Unresolved wiki link";

      return `<span class="vault-md-wiki-link vault-md-wiki-link-${status}" title="${escapeHtmlAttribute(title)}">${escapeHtml(parts.label || parts.target)}</span>`;
    }),
  );
}

export function splitWikiDocumentEmbeds(
  markdown: string,
  resolutions: WikiLinkResolutionMap = {},
): WikiDocumentEmbedBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: WikiDocumentEmbedBlock[] = [];
  let currentMarkdown: string[] = [];
  let currentRegion: {
    id: string;
    title: string;
    foldable: boolean;
    collapsed: boolean;
    markdown: string[];
  } | null = null;
  let inFence = false;

  const flushMarkdown = () => {
    if (currentMarkdown.length === 0) {
      return;
    }

    blocks.push({
      type: "markdown",
      markdown: currentMarkdown.join("\n"),
    });
    currentMarkdown = [];
  };

  const flushRegion = () => {
    if (!currentRegion) {
      return;
    }

    blocks.push({
      type: "region",
      id: regionFragmentId(currentRegion.id),
      title: currentRegion.title,
      foldable: currentRegion.foldable,
      collapsed: currentRegion.collapsed,
      markdown: currentRegion.markdown.join("\n").trim(),
    });
    currentRegion = null;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      if (currentRegion) {
        currentRegion.markdown.push(line);
      } else {
        currentMarkdown.push(line);
      }
      continue;
    }

    if (!inFence) {
      if (currentRegion && isVaultRegionEndLine(line)) {
        flushRegion();
        continue;
      }

      if (!currentRegion) {
        const regionStart = parseVaultRegionStart(line);

        if (regionStart) {
          flushMarkdown();
          currentRegion = {
            ...regionStart,
            markdown: [],
          };
          continue;
        }
      }

      const embed = parseStandaloneWikiDocumentEmbed(line, resolutions);

      if (embed && !currentRegion) {
        flushMarkdown();
        blocks.push(embed);
        continue;
      }
    }

    if (currentRegion) {
      currentRegion.markdown.push(line);
    } else {
      currentMarkdown.push(line);
    }
  }

  flushRegion();
  flushMarkdown();

  return blocks.length > 0 ? blocks : [{ type: "markdown", markdown }];
}

export function getWikiDocumentEmbed(
  line: string,
  resolutions: WikiLinkResolutionMap = {},
) {
  return parseStandaloneWikiDocumentEmbed(line, resolutions);
}

export function parseWikiLinkParts(bang: string, body: string): WikiLinkParts {
  const [rawTarget = "", rawLabel = ""] = body.split("|", 2);
  const targetParts = splitWikiTargetFragment(rawTarget);
  const labelParts =
    !targetParts.fragment && rawLabel.includes("#")
      ? splitWikiTargetFragment(rawLabel)
      : null;
  const target = targetParts.target;
  const fragment = targetParts.fragment ?? labelParts?.fragment ?? null;
  const label = (labelParts?.target.trim() || rawLabel.trim() || target).trim();

  return {
    embed: bang === "!",
    target,
    label,
    fragment,
  };
}

/**
 * `href -> definition` index for the renderer's anchor override.
 *
 * `transformWikiLinks` turns a resolved link into a plain Markdown link, and a
 * Markdown link cannot carry attributes — so the renderer recovers which links
 * are definitions by looking their href back up here. That is deliberately
 * cheaper than emitting raw HTML with a `data-` attribute, which would mean
 * widening the sanitizer on every surface that renders a document.
 *
 * Only definitions with something to show are included: a card with an empty
 * body is worse than no card.
 *
 * Derivations are cached against the resolution map's own identity, because the
 * renderer asks once per Markdown segment and one document can have many
 * segments while the map (passed down from the page) stays the same object.
 */
export function buildDefinitionsByHref(
  resolutions: WikiLinkResolutionMap | undefined,
): Map<string, WikiLinkDefinition> {
  if (!resolutions) {
    return emptyDefinitions;
  }

  const cached = definitionsByHrefCache.get(resolutions);

  if (cached) {
    return cached;
  }

  const definitions = new Map<string, WikiLinkDefinition>();

  for (const resolution of Object.values(resolutions)) {
    if (!resolution.isDefinition || !resolution.href || !resolution.preview) {
      continue;
    }

    definitions.set(hrefWithoutFragment(resolution.href), {
      label: resolution.label ?? resolution.href,
      preview: resolution.preview,
    });
  }

  definitionsByHrefCache.set(resolutions, definitions);
  return definitions;
}

/**
 * A link's href with any `#fragment` removed. `[[Term#Section]]` resolves to
 * `/docs/<id>#section`, which still points at the same definition.
 */
export function hrefWithoutFragment(href: string) {
  const hashIndex = href.indexOf("#");
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}

/**
 * Turns a set of readable documents into the `[[target]] -> resolution` map every
 * rendering surface consumes. One resolution object is built per document and
 * reused for its `doc:`, `public:`, title and alias keys, so a field added here
 * cannot reach some keys and miss others.
 */
export function buildWikiLinkResolutionMap<
  TDocument extends {
    id: string;
    title: string;
    markdown?: string;
    visibility: string;
    publicSlug: string | null;
    ownerUsername?: string | null;
  },
>(
  documentsToLink: TDocument[],
  hrefForDocument: (document: TDocument) => string | null,
  options:
    | boolean
    | {
        includeEmbeds?: boolean;
        includeDocKeys?: boolean;
        includeTitleKeys?: boolean;
        includePublicKeys?: boolean;
        sourceForDocument?: (
          document: TDocument,
        ) => WikiLinkResolution["source"];
        /**
         * Ids of documents carrying the `definition` tag, from
         * `listDefinitionDocumentIds`. Membership must come from the database
         * because the tag may be folder-inherited and therefore absent from the
         * document's own Markdown (`lib/folder-tags.ts`).
         */
        definitionDocumentIds?: Set<string>;
      } = true,
) {
  const normalizedOptions =
    typeof options === "boolean" ? { includeEmbeds: options } : options;
  const includeEmbeds = normalizedOptions.includeEmbeds ?? true;
  const includeDocKeys = normalizedOptions.includeDocKeys ?? true;
  const includeTitleKeys = normalizedOptions.includeTitleKeys ?? true;
  const includePublicKeys = normalizedOptions.includePublicKeys ?? true;
  const definitionDocumentIds = normalizedOptions.definitionDocumentIds;
  const resolutions: WikiLinkResolutionMap = {};
  const byTitle = new Map<string, TDocument[]>();
  const byAlias = new Map<string, TDocument[]>();
  // Built once per document and reused for every key that document claims.
  // Rebuilding it per key would re-scan the same Markdown for headings, anchors
  // and frontmatter three times over on a vault with aliases.
  const byDocumentId = new Map<string, WikiLinkResolution>();

  const resolutionFor = (document: TDocument): WikiLinkResolution => {
    const cached = byDocumentId.get(document.id);

    if (cached) {
      return cached;
    }

    const href = hrefForDocument(document);
    const source = normalizedOptions.sourceForDocument?.(document) ?? "document";

    if (!href) {
      const privateResolution: WikiLinkResolution = {
        status: "private",
        source,
        label: document.title,
        ownerUsername: document.ownerUsername,
      };

      byDocumentId.set(document.id, privateResolution);
      return privateResolution;
    }

    const isDefinition = definitionDocumentIds?.has(document.id) ?? false;
    const resolution: WikiLinkResolution = {
      status: "resolved",
      source,
      documentId: document.id,
      label: document.title,
      href,
      embedMarkdown: includeEmbeds ? document.markdown : undefined,
      // Computed for definitions only: this is what keeps a public page's
      // payload from carrying a preview for every document in the vault.
      ...(isDefinition
        ? { isDefinition, preview: definitionPreview(document.markdown ?? "") }
        : {}),
      ownerUsername: document.ownerUsername,
      headings: extractMarkdownHeadingOptions(document.markdown ?? ""),
      anchors: extractMarkdownAnchorOptions(document.markdown ?? ""),
    };

    byDocumentId.set(document.id, resolution);
    return resolution;
  };

  for (const document of documentsToLink) {
    const resolution = resolutionFor(document);

    if (includeDocKeys) {
      resolutions[wikiDocKey(document.id)] = resolution;
    }

    if (includePublicKeys && document.publicSlug) {
      resolutions[wikiPublicKey(document.publicSlug)] = {
        ...resolution,
        source: "public",
      };
    }

    if (!includeTitleKeys) {
      continue;
    }

    recordClaim(byTitle, wikiTitleKey(document.title), document);

    // Aliases come from the document's own frontmatter, so no join is needed —
    // the row already carries the Markdown.
    for (const alias of parseDocumentMetadata(document.markdown ?? "").aliases) {
      recordClaim(byAlias, wikiTitleKey(alias), document);
    }
  }

  if (!includeTitleKeys) {
    return resolutions;
  }

  for (const [titleKey, matches] of byTitle) {
    resolutions[titleKey] = claimKey(matches);
  }

  // Aliases are resolved after titles and never overwrite one: a real title
  // always beats someone else's "also known as". Two documents claiming the same
  // alias, with no title claim between them, is ambiguous like any other clash.
  for (const [aliasKey, matches] of byAlias) {
    if (resolutions[aliasKey]) {
      continue;
    }

    resolutions[aliasKey] = claimKey(matches);
  }

  return resolutions;

  /**
   * Records a document's claim on a title/alias key, ignoring a repeat of the
   * same document. A join that yields one document twice must not make its own
   * title ambiguous with itself.
   */
  function recordClaim(
    claims: Map<string, TDocument[]>,
    key: string,
    document: TDocument,
  ) {
    const existing = claims.get(key) ?? [];

    if (existing.some((claimed) => claimed.id === document.id)) {
      return;
    }

    claims.set(key, [...existing, document]);
  }

  function claimKey(matches: TDocument[]): WikiLinkResolution {
    if (matches.length !== 1) {
      return {
        status: "ambiguous",
        label: matches[0]?.title,
      };
    }

    return resolutionFor(matches[0]);
  }
}

function parseStandaloneWikiDocumentEmbed(
  line: string,
  resolutions: WikiLinkResolutionMap,
): Extract<WikiDocumentEmbedBlock, { type: "embed" }> | null {
  const match = line.trim().match(/^!\[\[([^\]\n]+)\]\]$/);

  if (!match) {
    return null;
  }

  const parts = parseWikiLinkParts("!", match[1]);

  if (!parts.target || externalImageMarkdown(parts.target, parts.label)) {
    return null;
  }

  return {
    type: "embed",
    target: parts.target,
    label: parts.label,
    fragment: parts.fragment,
    resolution: resolutions[wikiKeyForTarget(parts.target)],
  };
}

function externalImageMarkdown(target: string, label: string) {
  let url: URL;

  try {
    url = new URL(target);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  return `![${escapeMarkdownLabel(label)}](${url.toString()})`;
}

function transformMarkdownText(
  markdown: string,
  transformSegment: (segment: string) => string,
) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  return lines
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      return transformOutsideInlineCode(line, transformSegment);
    })
    .join("\n");
}

function transformOutsideInlineCode(
  line: string,
  transformSegment: (segment: string) => string,
) {
  const parts = line.split(/(`[^`]*`)/g);

  return parts
    .map((part) => (part.startsWith("`") ? part : transformSegment(part)))
    .join("");
}

function normalizeWikiText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeWikiSlug(value: string) {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseWikiSlugTarget(target: string, prefix: "guide:" | "public:") {
  const { target: normalizedTarget } = splitWikiTargetFragment(target);

  if (!normalizedTarget.toLowerCase().startsWith(prefix)) {
    return null;
  }

  const slug = normalizeWikiSlug(normalizedTarget.slice(prefix.length));
  return slug || null;
}

function splitWikiTargetFragment(value: string) {
  const trimmed = value.trim();
  const hashIndex = trimmed.lastIndexOf("#");

  if (hashIndex <= 0 || hashIndex === trimmed.length - 1) {
    return {
      target: trimmed,
      fragment: null,
    };
  }

  return {
    target: trimmed.slice(0, hashIndex).trim(),
    fragment: trimmed.slice(hashIndex + 1).trim(),
  };
}

function appendHeadingFragment(href: string, fragment: string | null) {
  if (!fragment) {
    return href;
  }

  return `${href}#${encodeURIComponent(normalizeWikiFragmentForHref(fragment))}`;
}

export function normalizeWikiFragmentForHref(fragment: string) {
  return normalizeFragmentId(fragment);
}

function normalizeHeadingFragment(fragment: string) {
  return slugifyMarkdownHeading(decodeURIComponent(fragment).replace(/^#/, ""));
}

function normalizeFragmentId(fragment: string) {
  const decoded = decodeURIComponent(fragment).replace(/^#/, "").trim();

  if (decoded.startsWith("^")) {
    return blockFragmentId(decoded.slice(1));
  }

  if (decoded.startsWith("@")) {
    return regionFragmentId(decoded.slice(1));
  }

  return slugifyMarkdownHeading(decoded);
}

function blockFragmentId(value: string) {
  return `^${normalizeAnchorId(value)}`;
}

function regionFragmentId(value: string) {
  return `@${normalizeAnchorId(value)}`;
}

function normalizeAnchorId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

type VaultRegion = {
  id: string;
  title: string;
  foldable: boolean;
  collapsed: boolean;
  startLine: number;
  endLine: number;
};

type BlockAnchor = {
  id: string;
  line: number;
  label: string;
  standalone: boolean;
};

function findVaultRegions(lines: string[]) {
  const regions: VaultRegion[] = [];
  let inFence = false;
  const stack: Array<Omit<VaultRegion, "endLine">> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const start = parseVaultRegionStart(line);

    if (start) {
      stack.push({ ...start, startLine: index });
      continue;
    }

    if (isVaultRegionEndLine(line)) {
      const region = stack.pop();

      if (region) {
        regions.push({ ...region, endLine: index });
      }
    }
  }

  return regions;
}

function parseVaultRegionStart(line: string) {
  const match = line.match(/^\s*<!--\s*vault-region\b([\s\S]*?)-->\s*$/i);

  if (!match) {
    return null;
  }

  const attrs = parseRegionAttributes(match[1]);
  const id = normalizeAnchorId(attrs.get("id") ?? "");

  if (!id) {
    return null;
  }

  return {
    id,
    title: attrs.get("title")?.trim() || id,
    foldable: attrs.has("foldable"),
    collapsed: attrs.has("collapsed"),
  };
}

function isVaultRegionEndLine(line: string) {
  return /^\s*<!--\s*\/vault-region\s*-->\s*$/i.test(line);
}

function parseRegionAttributes(source: string) {
  const attrs = new Map<string, string>();
  const pattern = /([A-Za-z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attrs;
}

function findBlockAnchors(lines: string[]) {
  const anchors: BlockAnchor[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const inline = line.match(/(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/);

    if (!inline) {
      continue;
    }

    const standalone = line.trim() === `^${inline[1]}`;
    const label = standalone
      ? previousBlockLabel(lines, index)
      : stripInlineMarkdown(line.replace(/(?:^|\s)\^[A-Za-z0-9_-]+\s*$/, "")).trim();
    const id = normalizeAnchorId(inline[1]);

    if (id && label) {
      anchors.push({ id, line: index, label, standalone });
    }
  }

  return anchors;
}

function previousBlockLabel(lines: string[], markerIndex: number) {
  const block = previousBlockLines(lines, markerIndex);
  return stripInlineMarkdown(block.join(" ")).replace(/\s+/g, " ").trim();
}

function previousBlockLines(lines: string[], markerIndex: number) {
  let end = markerIndex - 1;

  while (end >= 0 && !lines[end].trim()) {
    end -= 1;
  }

  if (end < 0) {
    return [];
  }

  let start = end;

  while (start > 0 && lines[start - 1].trim()) {
    start -= 1;
  }

  return lines.slice(start, end + 1);
}

function extractMarkdownRegion(markdown: string, rawId: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const id = normalizeAnchorId(rawId);
  const region = findVaultRegions(lines).find((candidate) => candidate.id === id);

  if (!region) {
    return markdown;
  }

  return lines
    .slice(region.startLine + 1, region.endLine)
    .filter((line) => !isVaultRegionMarkerLine(line))
    .join("\n")
    .trim();
}

function extractMarkdownBlock(markdown: string, rawId: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const id = normalizeAnchorId(rawId);
  const anchor = findBlockAnchors(lines).find((candidate) => candidate.id === id);

  if (!anchor) {
    return markdown;
  }

  if (!anchor.standalone) {
    return lines[anchor.line].replace(/(?:^|\s)\^[A-Za-z0-9_-]+\s*$/, "").trim();
  }

  return previousBlockLines(lines, anchor.line).join("\n").trim();
}

function transformHiddenAnchorMarkers(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  return lines
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      const region = parseVaultRegionStart(line);

      if (region) {
        return hiddenAnchorSpan(regionFragmentId(region.id));
      }

      if (isVaultRegionEndLine(line)) {
        return "";
      }

      const block = line.match(/(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/);

      if (!block) {
        return line;
      }

      const id = blockFragmentId(block[1]);

      if (line.trim() === `^${block[1]}`) {
        return hiddenAnchorSpan(id);
      }

      return `${line.replace(/(?:^|\s)\^[A-Za-z0-9_-]+\s*$/, "")}${hiddenAnchorSpan(id)}`;
    })
    .join("\n");
}

function isVaultRegionMarkerLine(line: string) {
  return Boolean(parseVaultRegionStart(line)) || isVaultRegionEndLine(line);
}

function hiddenAnchorSpan(id: string) {
  return `<span id="${escapeHtmlAttribute(id)}" class="vault-md-hidden-anchor" aria-hidden="true"></span>`;
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
