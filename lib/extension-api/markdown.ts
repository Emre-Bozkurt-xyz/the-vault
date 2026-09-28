/**
 * Directive occurrences for code that holds only a document's text — agent
 * actions, tests (`docs/23_EXTENSION_SDK_PLAN.md` §6). Keyed and ordered exactly
 * as a rendered page keys them, so a value an agent reads is the value a reader
 * sees. A subpath because it parses Markdown: only code that needs it pays for
 * the parser.
 */
import type { AnalyzableDocument, ExtensionManifest } from "@/lib/extension-api";
import { collectDirectiveOccurrences } from "@/lib/markdown/directive-occurrences";

/** `manifest`'s occurrences in `markdown`, as its `analyze` would receive them. */
export function collectOccurrences(
  markdown: string,
  manifest: ExtensionManifest,
): AnalyzableDocument {
  const owned = (names: readonly string[] | undefined) =>
    new Map((names ?? []).map((name) => [name.toLowerCase(), manifest.id]));

  const occurrences = collectDirectiveOccurrences(markdown, {
    leaf: owned(manifest.syntax?.blocks),
    container: owned(manifest.syntax?.containers),
    inline: owned(manifest.syntax?.inline),
  }).map((found) => {
    const { owner, ...occurrence } = found;
    void owner;
    return occurrence;
  });

  return { markdown, occurrences };
}
