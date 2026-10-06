import type { ComponentType } from "react";

import type {
  AnalyzableDocument,
  AnalyzeContribution,
  Analyzer,
  ExtensionRenderContext,
} from "@/lib/extension-api";

/**
 * The `analyze` pre-pass (`docs/23_EXTENSION_SDK_PLAN.md` §6), run for the
 * host components. Client-side by construction: the analyzer is a render-module
 * loader, and only client modules may reach one (plan §14 slice 0). It still
 * runs during server rendering, inside those client components.
 */

type Outcome = { value: unknown } | { error: unknown };

// Once per document object and analyzer: every occurrence on a page reads the
// same result, however many there are. A document object is created per render
// of `MarkdownDocument`, so an edit re-analyzes and nothing stale survives.
const results = new WeakMap<AnalyzableDocument, Map<Analyzer, Outcome>>();

export function analyzeOnce(
  analyzer: Analyzer,
  document: AnalyzableDocument,
  ctx: ExtensionRenderContext,
): unknown {
  let byAnalyzer = results.get(document);
  if (!byAnalyzer) {
    byAnalyzer = new Map();
    results.set(document, byAnalyzer);
  }

  let outcome = byAnalyzer.get(analyzer);
  if (!outcome) {
    try {
      outcome = { value: analyzer(document, ctx) };
    } catch (error) {
      outcome = { error };
    }
    byAnalyzer.set(analyzer, outcome);
  }

  // Rethrown per occurrence, so each falls back to its own source inside its
  // own error boundary rather than one failure blanking the page.
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

type AnalyzedProps = { ctx: ExtensionRenderContext; analysis: unknown };

/**
 * Loads a component together with its extension's analyzer, for `lazy()`. The
 * returned component takes the document in place of `analysis` and supplies
 * the analysis itself. Without an analyzer (or a document), `analysis` is null.
 */
export async function loadAnalyzed<P extends AnalyzedProps>(
  load: () => Promise<{ default: ComponentType<P> }>,
  analyze: AnalyzeContribution | null,
): Promise<{
  default: ComponentType<Omit<P, "analysis"> & { document: AnalyzableDocument | null }>;
}> {
  const [component, analyzer] = await Promise.all([
    load(),
    analyze ? analyze.load() : Promise.resolve(null),
  ]);
  const Component = component.default;

  function Analyzed({
    document,
    ...props
  }: Omit<P, "analysis"> & { document: AnalyzableDocument | null }) {
    const analysis =
      analyzer && document
        ? analyzeOnce(analyzer.default, document, props.ctx)
        : null;

    return <Component {...(props as unknown as P)} analysis={analysis} />;
  }

  return { default: Analyzed };
}
