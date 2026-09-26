import { extensionManifests } from "@/extensions/manifests";

/**
 * The host's view of extension blocks (`docs/23_EXTENSION_SDK_PLAN.md` §6):
 * which `:::name{…}` directives are claimed, how to read one, and how to split
 * a document around them. Used by both Read mode (`MarkdownDocument`) and the
 * Live-mode engine (`live-blocks.ts`), so the two can never disagree about what
 * is a block.
 *
 * Built from manifests alone, never from render modules. `MarkdownDocument`
 * renders on the server, and a server module that can reach a render module's
 * `import("./SomeBlock")` makes Next bundle that client component into the
 * page's entry chunk (plan §14 slice 0). Which names are blocks is grammar, so
 * it is manifest data; the component loaders stay browser-only in
 * `ExtensionBlockHost`.
 */

/** Directive names core owns; an extension may not claim them. */
export const CORE_DIRECTIVE_NAMES: ReadonlySet<string> = new Set(["assets"]);

export type ExtensionBlockDefinition = {
  extensionId: string;
  name: string;
  /** Only single-line (`leaf`) blocks exist so far; container blocks come with calc. */
  form: "leaf";
};

function buildBlockIndex(): ReadonlyMap<string, ExtensionBlockDefinition> {
  const index = new Map<string, ExtensionBlockDefinition>();

  for (const manifest of extensionManifests) {
    for (const name of manifest.syntax?.blocks ?? []) {
      const key = name.toLowerCase();

      if (CORE_DIRECTIVE_NAMES.has(key)) {
        throw new Error(`"${manifest.id}" claims core directive ":::${name}".`);
      }

      const existing = index.get(key);
      if (existing) {
        throw new Error(
          `":::${name}" is claimed by both "${existing.extensionId}" and "${manifest.id}".`,
        );
      }

      index.set(key, { extensionId: manifest.id, name: key, form: "leaf" });
    }
  }

  return index;
}

/** Every claimed extension block, keyed by lowercase directive name. */
export const extensionBlocks = buildBlockIndex();

/** `extensionId:name`, the key block components are registered under. */
export function extensionBlockKey(extensionId: string, name: string): string {
  return `${extensionId}:${name.toLowerCase()}`;
}

const leafDirectivePattern = /^:::\s*([a-z][\w-]*)\s*(?:\{([^}\n]*)\})?\s*$/i;
const attributePattern =
  /([A-Za-z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+)))?/g;

/** `key=value key="v" flag` → `{ key: "value", key: "v", flag: "" }`. */
export function parseDirectiveAttributes(
  raw: string | null | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!raw) return attributes;

  for (const match of raw.matchAll(attributePattern)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

export type ParsedExtensionBlock = {
  extensionId: string;
  name: string;
  attributes: Record<string, string>;
  source: string;
};

/**
 * The claimed leaf block on this line, or null. Surrounding whitespace is
 * ignored, as the calendar anchor always allowed.
 */
export function parseExtensionBlockLine(
  line: string,
  blocks: ReadonlyMap<string, ExtensionBlockDefinition> = extensionBlocks,
): ParsedExtensionBlock | null {
  const trimmed = line.trim();
  const match = leafDirectivePattern.exec(trimmed);
  if (!match) return null;

  const definition = blocks.get(match[1].toLowerCase());
  if (!definition || definition.form !== "leaf") return null;

  return {
    extensionId: definition.extensionId,
    name: definition.name,
    attributes: parseDirectiveAttributes(match[2]),
    source: trimmed,
  };
}

export type ExtensionBlockSegment =
  | { type: "markdown"; markdown: string }
  | ({ type: "block" } & ParsedExtensionBlock);

/**
 * Splits Markdown into runs of plain Markdown and claimed extension blocks, so
 * a renderer can mount each block where its anchor sits. Lines inside fenced
 * code are never blocks.
 */
export function splitExtensionBlocks(
  markdown: string,
  blocks: ReadonlyMap<string, ExtensionBlockDefinition> = extensionBlocks,
): ExtensionBlockSegment[] {
  if (blocks.size === 0) return [{ type: "markdown", markdown }];

  const segments: ExtensionBlockSegment[] = [];
  let buffer: string[] = [];
  let openFence: { marker: string; length: number } | null = null;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ type: "markdown", markdown: buffer.join("\n") });
      buffer = [];
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (openFence) {
      if (
        fence &&
        fence[1][0] === openFence.marker &&
        fence[1].length >= openFence.length &&
        !fence[2].trim()
      ) {
        openFence = null;
      }
      buffer.push(line);
      continue;
    }

    if (fence) {
      openFence = { marker: fence[1][0], length: fence[1].length };
      buffer.push(line);
      continue;
    }

    const block = parseExtensionBlockLine(line, blocks);
    if (block) {
      flush();
      segments.push({ type: "block", ...block });
    } else {
      buffer.push(line);
    }
  }

  flush();
  return segments;
}
