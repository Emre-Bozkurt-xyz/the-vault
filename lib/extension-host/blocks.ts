import { extensionManifests } from "@/extensions/manifests";
import type { ExtensionManifest } from "@/lib/extension-api";
import {
  isInsideContainerBlock,
  parseDirectiveAttributes,
  scanContainerBlocks,
  type ContainerBlockScan,
} from "@/lib/markdown/directive-blocks";
import type { DirectiveOwners } from "@/lib/markdown/directive-occurrences";

export { parseDirectiveAttributes };

/**
 * The host's view of extension directives (`docs/23_EXTENSION_SDK_PLAN.md` §6):
 * which `:::name` blocks and `:name[…]` inline directives are claimed, by whom,
 * and how a document splits around them. Read mode (`MarkdownDocument`), the
 * Live-mode engine (`live-blocks.ts`, the editor's container exclusion) and the
 * `:::` menu all ask here, so they can never disagree about what is a block.
 *
 * Light on purpose: client host components import it, so it must never reach
 * the Markdown parser (`plan.ts` does that, for the renderer).
 *
 * Built from manifests alone, never from render modules. `MarkdownDocument`
 * renders on the server, and a server module that can reach a render module's
 * `import("./SomeBlock")` makes Next bundle that client component into the
 * page's entry chunk (plan §14 slice 0). Which names are directives is grammar,
 * so it is manifest data; the component loaders stay browser-only in the host
 * components.
 */

/** Directive names core owns; an extension may not claim them. */
export const CORE_DIRECTIVE_NAMES: ReadonlySet<string> = new Set(["assets"]);

export type ExtensionBlockDefinition = {
  extensionId: string;
  name: string;
  /** `leaf`: `:::name{…}` alone. `container`: `:::name{…}` … `:::` with a body. */
  form: "leaf" | "container";
  includeDocumentSource?: boolean;
};

const documentSourceBlocks = new Set(
  extensionManifests.flatMap((manifest) =>
    (manifest.syntax?.documentSourceBlocks ?? []).map((name) => `${manifest.id}:${name.toLowerCase()}`),
  ),
);

/** Builds the owner maps from manifests; throws on a collision. */
export function buildDirectiveOwners(
  manifests: readonly ExtensionManifest[],
): DirectiveOwners {
  const leaf = new Map<string, string>();
  const container = new Map<string, string>();
  const inline = new Map<string, string>();

  const claim = (
    map: Map<string, string>,
    others: ReadonlyArray<Map<string, string>>,
    name: string,
    owner: string,
    written: string,
  ) => {
    const key = name.toLowerCase();

    if (CORE_DIRECTIVE_NAMES.has(key)) {
      throw new Error(`"${owner}" claims core directive "${written}".`);
    }

    const existing = map.get(key) ?? others.map((other) => other.get(key)).find(Boolean);
    if (existing) {
      throw new Error(`"${written}" is claimed by both "${existing}" and "${owner}".`);
    }

    map.set(key, owner);
  };

  for (const manifest of manifests) {
    // A leaf and a container are both written `:::name`, so the two share one
    // namespace. Inline `:name[…]` is its own.
    for (const name of manifest.syntax?.blocks ?? []) {
      claim(leaf, [container], name, manifest.id, `:::${name}`);
    }
    for (const name of manifest.syntax?.containers ?? []) {
      claim(container, [leaf], name, manifest.id, `:::${name}`);
    }
    for (const name of manifest.syntax?.inline ?? []) {
      claim(inline, [], name, manifest.id, `:${name}[…]`);
    }
  }

  return { leaf, container, inline };
}

/** Every installed extension's directive claims. */
export const extensionDirectiveOwners = buildDirectiveOwners(extensionManifests);

/** Every claimed `:::name` block, leaf or container, keyed by lowercase name. */
export const extensionBlocks: ReadonlyMap<string, ExtensionBlockDefinition> = new Map<
  string,
  ExtensionBlockDefinition
>([
  ...[...extensionDirectiveOwners.leaf].map(
    ([name, extensionId]): [string, ExtensionBlockDefinition] => [
      name,
      { extensionId, name, form: "leaf", includeDocumentSource: documentSourceBlocks.has(`${extensionId}:${name}`) },
    ],
  ),
  ...[...extensionDirectiveOwners.container].map(
    ([name, extensionId]): [string, ExtensionBlockDefinition] => [
      name,
      { extensionId, name, form: "container", includeDocumentSource: false },
    ],
  ),
]);

/** Claimed container names, for the Live-mode scans. */
export const extensionContainerNames: readonly string[] = [
  ...extensionDirectiveOwners.container.keys(),
];

/** `extensionId:name`, the key block components are registered under. */
export function extensionBlockKey(extensionId: string, name: string): string {
  return `${extensionId}:${name.toLowerCase()}`;
}

const leafDirectivePattern = /^:::\s*([a-z][\w-]*)\s*(?:\{([^}\n]*)\})?\s*$/i;

export type ParsedExtensionBlock = {
  extensionId: string;
  name: string;
  attributes: Record<string, string>;
  source: string;
  includeDocumentSource: boolean;
};

/**
 * The claimed leaf block on this line, or null (Live mode). Surrounding
 * whitespace is ignored, as the calendar anchor always allowed. A container's
 * opening line is never a leaf: treating it as one would orphan its body.
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
    includeDocumentSource: Boolean(definition.includeDocumentSource),
  };
}

/** Installed container blocks in `text`, in CodeMirror coordinates. */
export function scanExtensionContainers(text: string): ContainerBlockScan[] {
  return extensionContainerNames.length === 0
    ? []
    : scanContainerBlocks(text, extensionContainerNames);
}

/** Whether 1-based `line` is inside an installed container (closing fence included). */
export function isInsideExtensionContainer(text: string, line: number): boolean {
  return (
    extensionContainerNames.length > 0 &&
    isInsideContainerBlock(text, line, extensionContainerNames)
  );
}
