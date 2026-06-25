export type TagCategory =
  | "general"
  | "topic"
  | "person"
  | "place"
  | "project"
  | "technical";

export type ParsedDocumentMetadata = {
  tags: string[];
  aliases: string[];
  summary: string | null;
  status: string | null;
  project: string | null;
};

const maxTags = 64;
const maxAliases = 32;
const maxTagLength = 64;
const maxAliasLength = 160;
const maxSummaryLength = 500;
const maxPropertyLength = 80;
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseDocumentMetadata(markdown: string): ParsedDocumentMetadata {
  const frontmatter = extractFrontmatter(markdown);

  if (!frontmatter) {
    return emptyDocumentMetadata();
  }

  const fields = parseSimpleYamlFields(frontmatter);

  return {
    tags: normalizeTagList(fields.get("tags")).slice(0, maxTags),
    aliases: normalizeStringList(fields.get("aliases"), maxAliasLength).slice(
      0,
      maxAliases,
    ),
    summary: normalizeOptionalString(fields.get("summary"), maxSummaryLength),
    status: normalizeOptionalString(fields.get("status"), maxPropertyLength),
    project: normalizeOptionalString(fields.get("project"), maxPropertyLength),
  };
}

export function formatTagInput(tags: string[]) {
  return normalizeTagList(tags).join(" ");
}

export function updateDocumentMetadataFrontmatter(
  markdown: string,
  metadata: ParsedDocumentMetadata,
) {
  const existing = markdown.match(frontmatterPattern);
  const existingFrontmatter = existing?.[1] ?? "";
  const body = existing ? markdown.slice(existing[0].length) : markdown;
  const preserved = preserveUnknownFrontmatterLines(existingFrontmatter);
  const supported = serializeSupportedMetadata(metadata);
  const nextFrontmatter = [...preserved, ...supported].filter(Boolean).join("\n");

  if (!nextFrontmatter) {
    return body.replace(/^\r?\n/, "");
  }

  return `---\n${nextFrontmatter}\n---\n\n${body.replace(/^\r?\n/, "")}`;
}

export function stripDocumentFrontmatter(markdown: string) {
  return markdown.replace(frontmatterPattern, "");
}

export function normalizeTagList(value: unknown): string[] {
  const rawTags = Array.isArray(value)
    ? value.flatMap((item) => splitTagInput(String(item ?? "")))
    : splitTagInput(String(value ?? ""));

  return [
    ...new Set(
      rawTags.flatMap((tag) => splitTagInput(normalizeTagSlug(tag))).filter(Boolean),
    ),
  ].slice(0, maxTags);
}

export function normalizeTagSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/-/g, "_")
        .replace(/[^a-z0-9_]/g, "")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, maxTagLength),
    )
    .filter(Boolean)
    .join(" ");
}

export function tagDisplayName(slug: string) {
  return slug
    .split("_")
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractFrontmatter(markdown: string) {
  return markdown.match(frontmatterPattern)?.[1] ?? null;
}

function emptyDocumentMetadata(): ParsedDocumentMetadata {
  return {
    tags: [],
    aliases: [],
    summary: null,
    status: null,
    project: null,
  };
}

function splitTagInput(value: string) {
  return value
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeStringList(value: unknown, maxLength: number) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [
    ...new Set(
      values
        .map((item) => String(item ?? "").trim().slice(0, maxLength))
        .filter(Boolean),
    ),
  ];
}

function normalizeOptionalString(value: unknown, maxLength: number) {
  const normalized = Array.isArray(value)
    ? String(value[0] ?? "").trim()
    : String(value ?? "").trim();

  return normalized ? normalized.slice(0, maxLength) : null;
}

function parseSimpleYamlFields(raw: string) {
  const fields = new Map<string, string | string[]>();
  const lines = raw.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);

    if (!match) {
      index += 1;
      continue;
    }

    const key = match[1].trim();
    const inlineValue = stripYamlQuotes(match[2].trim());

    if (inlineValue) {
      fields.set(key, inlineValue);
      index += 1;
      continue;
    }

    const list: string[] = [];
    let cursor = index + 1;

    while (cursor < lines.length) {
      const listMatch = (lines[cursor] ?? "").match(/^\s*-\s*(.+)$/);

      if (!listMatch) {
        break;
      }

      list.push(stripYamlQuotes(listMatch[1].trim()));
      cursor += 1;
    }

    fields.set(key, list.length > 0 ? list : "");
    index = cursor;
  }

  return fields;
}

function stripYamlQuotes(value: string) {
  return value.replace(/^["']|["']$/g, "");
}

function preserveUnknownFrontmatterLines(raw: string) {
  const lines = raw.split(/\r?\n/);
  const preserved: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:/);
    const key = match?.[1];

    if (!key || !isSupportedMetadataKey(key)) {
      preserved.push(line);
      index += 1;
      continue;
    }

    index += 1;
    while (index < lines.length && /^\s*-\s+/.test(lines[index] ?? "")) {
      index += 1;
    }
  }

  return trimBlankEdges(preserved);
}

function serializeSupportedMetadata(metadata: ParsedDocumentMetadata) {
  const lines: string[] = [];
  const tags = normalizeTagList(metadata.tags);
  const aliases = normalizeStringList(metadata.aliases, maxAliasLength);
  const summary = normalizeOptionalString(metadata.summary, maxSummaryLength);
  const status = normalizeOptionalString(metadata.status, maxPropertyLength);
  const project = normalizeOptionalString(metadata.project, maxPropertyLength);

  if (tags.length > 0) {
    lines.push(`tags: ${tags.join(" ")}`);
  }

  if (aliases.length > 0) {
    lines.push("aliases:");
    for (const alias of aliases) {
      lines.push(`  - ${quoteYamlString(alias)}`);
    }
  }

  if (summary) {
    lines.push(`summary: ${quoteYamlString(summary)}`);
  }

  if (status) {
    lines.push(`status: ${quoteYamlString(status)}`);
  }

  if (project) {
    lines.push(`project: ${quoteYamlString(project)}`);
  }

  return lines;
}

function isSupportedMetadataKey(key: string) {
  return ["tags", "aliases", "summary", "status", "project"].includes(key);
}

function quoteYamlString(value: string) {
  return JSON.stringify(value);
}

function trimBlankEdges(lines: string[]) {
  const next = [...lines];

  while (next.length > 0 && !next[0]?.trim()) {
    next.shift();
  }

  while (next.length > 0 && !next[next.length - 1]?.trim()) {
    next.pop();
  }

  return next;
}
