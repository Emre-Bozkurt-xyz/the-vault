import type { ExtensionManifest } from "@/lib/extension-api";

/**
 * Which installed extensions a document's Markdown uses, by their declared
 * syntax claims (`docs/23_EXTENSION_SDK_PLAN.md` §3 principle 4, §9).
 *
 * A cheap line scan, not a parse. It errs toward inclusion: a false positive
 * only loads a module that then renders nothing, while a false negative would
 * leave content unrendered. Text inside fenced code is skipped, except that a
 * fence's own language is exactly what a fence claim matches.
 */
export function detectSyntaxExtensions(
  markdown: string,
  manifests: readonly ExtensionManifest[],
): Set<string> {
  const blockOwners = new Map<string, string>();
  const inlineOwners = new Map<string, string>();
  const fenceOwners = new Map<string, string>();

  for (const manifest of manifests) {
    for (const name of [
      ...(manifest.syntax?.blocks ?? []),
      ...(manifest.syntax?.containers ?? []),
    ]) {
      blockOwners.set(name.toLowerCase(), manifest.id);
    }
    for (const name of manifest.syntax?.inline ?? []) {
      inlineOwners.set(name.toLowerCase(), manifest.id);
    }
    for (const name of manifest.syntax?.fences ?? []) {
      fenceOwners.set(name.toLowerCase(), manifest.id);
    }
  }

  const found = new Set<string>();

  if (blockOwners.size + inlineOwners.size + fenceOwners.size === 0) {
    return found;
  }

  let openFence: { marker: string; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})\s*([^\s`{]*)/.exec(line);

    if (openFence) {
      if (
        fence &&
        fence[1][0] === openFence.marker &&
        fence[1].length >= openFence.length &&
        !fence[2]
      ) {
        openFence = null;
      }
      continue;
    }

    if (fence) {
      openFence = { marker: fence[1][0], length: fence[1].length };
      const owner = fenceOwners.get(fence[2].toLowerCase());
      if (owner) found.add(owner);
      continue;
    }

    const block = /^ {0,3}:::\s*([a-z][\w-]*)/i.exec(line);
    if (block) {
      const owner = blockOwners.get(block[1].toLowerCase());
      if (owner) found.add(owner);
    }

    if (inlineOwners.size > 0) {
      for (const match of line.matchAll(/(?<![:\w]):([a-z][\w-]*)\[/gi)) {
        const owner = inlineOwners.get(match[1].toLowerCase());
        if (owner) found.add(owner);
      }
    }
  }

  return found;
}
