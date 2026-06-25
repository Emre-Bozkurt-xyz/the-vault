import { normalizeTagList, normalizeTagSlug } from "@/lib/content-metadata";

export type ContentSearchQuery = {
  raw: string;
  textTerms: string[];
  tagTerms: string[];
  filters: {
    kind?: string;
    owner?: string;
    visibility?: string;
    sort?: string;
  };
};

export type ContentSearchItem = {
  title?: string | null;
  description?: string | null;
  summary?: string | null;
  altText?: string | null;
  mimeType?: string | null;
  ownerName?: string | null;
  ownerUsername?: string | null;
  publicSlug?: string | null;
  kind?: string | null;
  visibility?: string | null;
  tags?: string[] | null;
};

const filterKeys = new Set([
  "kind",
  "owner",
  "sort",
  "tag",
  "tags",
  "type",
  "visibility",
]);

export function parseContentSearchQuery(raw: string): ContentSearchQuery {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const query: ContentSearchQuery = {
    raw,
    textTerms: [],
    tagTerms: [],
    filters: {},
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const tokenMatch = token.match(/^([A-Za-z][A-Za-z-]*):(.*)$/);

    if (!tokenMatch) {
      query.textTerms.push(normalizeSearchTerm(token));
      continue;
    }

    const key = tokenMatch[1].toLowerCase();
    const initialValue = tokenMatch[2].trim();

    if (!filterKeys.has(key)) {
      query.textTerms.push(normalizeSearchTerm(token));
      continue;
    }

    if (key === "tag" || key === "tags") {
      const values = initialValue ? [initialValue] : [];

      while (index + 1 < tokens.length && !isFilterToken(tokens[index + 1] ?? "")) {
        index += 1;
        values.push(tokens[index] ?? "");
      }

      query.tagTerms.push(...normalizeTagList(values.join(" ")));
      continue;
    }

    const value = initialValue || tokens[index + 1] || "";

    if (!initialValue && value) {
      index += 1;
    }

    if (key === "type") {
      query.filters.kind = normalizeSearchTerm(value);
      continue;
    }

    if (key === "kind") {
      query.filters.kind = normalizeSearchTerm(value);
      continue;
    }

    if (key === "owner") {
      query.filters.owner = normalizeOwnerTerm(value);
      continue;
    }

    if (key === "visibility") {
      query.filters.visibility = normalizeSearchTerm(value);
      continue;
    }

    if (key === "sort") {
      query.filters.sort = normalizeSearchTerm(value);
    }
  }

  query.textTerms = uniqueStrings(query.textTerms.filter(Boolean));
  query.tagTerms = uniqueStrings(query.tagTerms.filter(Boolean));

  return query;
}

export function contentSearchIsEmpty(query: ContentSearchQuery) {
  return (
    query.textTerms.length === 0 &&
    query.tagTerms.length === 0 &&
    !query.filters.kind &&
    !query.filters.owner &&
    !query.filters.visibility
  );
}

export function matchesContentSearchQuery(
  item: ContentSearchItem,
  query: ContentSearchQuery,
) {
  if (query.filters.kind && item.kind !== query.filters.kind) {
    return false;
  }

  if (query.filters.visibility && item.visibility !== query.filters.visibility) {
    return false;
  }

  const owner = normalizeOwnerTerm(
    [item.ownerUsername, item.ownerName].filter(Boolean).join(" "),
  );

  if (query.filters.owner && !owner.includes(query.filters.owner)) {
    return false;
  }

  const itemTags = new Set(
    (item.tags ?? []).flatMap((tag) => normalizeTagList(String(tag ?? ""))),
  );

  if (query.tagTerms.some((tag) => !itemTags.has(tag))) {
    return false;
  }

  if (query.textTerms.length === 0) {
    return true;
  }

  const haystack = normalizeSearchTerm(
    [
      item.title,
      item.description,
      item.summary,
      item.altText,
      item.mimeType,
      item.ownerName,
      item.ownerUsername ? `@${item.ownerUsername}` : null,
      item.publicSlug,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return query.textTerms.every((term) => {
    const tagSlug = normalizeTagSlug(term);
    return haystack.includes(term) || Boolean(tagSlug && itemTags.has(tagSlug));
  });
}

export function getContentSearchSummary(query: ContentSearchQuery) {
  const parts: string[] = [];

  if (query.textTerms.length > 0) {
    parts.push(`Text: ${query.textTerms.join(", ")}`);
  }

  if (query.tagTerms.length > 0) {
    parts.push(`Tags: ${query.tagTerms.join(", ")}`);
  }

  if (query.filters.kind) {
    parts.push(`Kind: ${query.filters.kind}`);
  }

  if (query.filters.owner) {
    parts.push(`Owner: ${query.filters.owner}`);
  }

  if (query.filters.visibility) {
    parts.push(`Visibility: ${query.filters.visibility}`);
  }

  return parts;
}

function isFilterToken(token: string) {
  const match = token.match(/^([A-Za-z][A-Za-z-]*):/);
  return Boolean(match && filterKeys.has(match[1].toLowerCase()));
}

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function normalizeOwnerTerm(value: string) {
  return normalizeSearchTerm(value).replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
