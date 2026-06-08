export type WikiLinkResolutionStatus =
  | "resolved"
  | "unresolved"
  | "private"
  | "ambiguous";

export type WikiLinkResolution = {
  status: WikiLinkResolutionStatus;
  documentId?: string;
  label?: string;
  href?: string;
  embedMarkdown?: string;
};

export type WikiLinkResolutionMap = Record<string, WikiLinkResolution>;
export type WikiDocumentEmbedBlock =
  | {
      type: "markdown";
      markdown: string;
    }
  | {
      type: "embed";
      target: string;
      label: string;
      resolution?: WikiLinkResolution;
    };

type WikiLinkParts = {
  embed: boolean;
  target: string;
  label: string;
};

const wikiLinkPattern = /(!?)\[\[([^\]\n]+)\]\]/g;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function wikiDocKey(documentId: string) {
  return `doc:${documentId.trim().toLowerCase()}`;
}

export function wikiTitleKey(title: string) {
  return `title:${normalizeWikiText(title)}`;
}

export function wikiKeyForTarget(target: string) {
  const normalizedTarget = target.trim();
  const docId = parseWikiDocTarget(normalizedTarget);

  if (docId) {
    return wikiDocKey(docId);
  }

  return wikiTitleKey(normalizedTarget);
}

export function parseWikiDocTarget(target: string) {
  const normalizedTarget = target.trim();

  if (normalizedTarget.toLowerCase().startsWith("doc:")) {
    const docId = normalizedTarget.slice(4).trim();
    return uuidPattern.test(docId) ? docId.toLowerCase() : null;
  }

  return uuidPattern.test(normalizedTarget)
    ? normalizedTarget.toLowerCase()
    : null;
}

export function escapeWikiLinkLabel(value: string) {
  return value.replace(/[\]\n|]/g, " ").replace(/\s+/g, " ").trim();
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
  return transformMarkdownText(markdown, (segment) =>
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
        return `[${escapeMarkdownLabel(parts.label || resolution.label || parts.target)}](${resolution.href})`;
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

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      currentMarkdown.push(line);
      continue;
    }

    if (!inFence) {
      const embed = parseStandaloneWikiDocumentEmbed(line, resolutions);

      if (embed) {
        flushMarkdown();
        blocks.push(embed);
        continue;
      }
    }

    currentMarkdown.push(line);
  }

  flushMarkdown();

  return blocks.length > 0 ? blocks : [{ type: "markdown", markdown }];
}

export function getWikiDocumentEmbed(
  line: string,
  resolutions: WikiLinkResolutionMap = {},
) {
  return parseStandaloneWikiDocumentEmbed(line, resolutions);
}

function parseWikiLinkParts(bang: string, body: string): WikiLinkParts {
  const [rawTarget = "", rawLabel = ""] = body.split("|", 2);
  const target = rawTarget.trim();
  const label = (rawLabel.trim() || target).trim();

  return {
    embed: bang === "!",
    target,
    label,
  };
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
