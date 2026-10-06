"use client";

import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";

import { loadAnalyzed } from "@/components/extensions/extension-analysis";
import { ExtensionErrorBoundary } from "@/components/extensions/ExtensionErrorBoundary";
import { renderModules } from "@/extensions/registry.render";
import {
  createRenderContext,
  type AnalyzableDocument,
  type DocumentExtensions,
  type InlineOccurrence,
  type InlineProps,
} from "@/lib/extension-api";
import { extensionBlockKey } from "@/lib/extension-host/blocks";

/**
 * One rendered document's extension occurrences (`docs/23_EXTENSION_SDK_PLAN.md`
 * §6), shared with every inline directive and container block inside it.
 *
 * Built by `MarkdownDocument`, which may run on the server, and handed over
 * once here rather than per occurrence: a page with a hundred `:calc` values
 * carries the document's data once, not a hundred times.
 */
type DocumentHostValue = {
  extensions: DocumentExtensions | null;
  documents: Readonly<Record<string, AnalyzableDocument>>;
  inline: ReadonlyMap<string, { extensionId: string; occurrence: InlineOccurrence }>;
};

const DocumentHostContext = createContext<DocumentHostValue | null>(null);

export function ExtensionDocumentProvider({
  extensions,
  documents,
  children,
}: {
  extensions: DocumentExtensions | null;
  /** Per extension id, only for extensions with occurrences in this document. */
  documents: Record<string, AnalyzableDocument>;
  children: ReactNode;
}) {
  const value = useMemo<DocumentHostValue>(() => {
    const inline = new Map<string, { extensionId: string; occurrence: InlineOccurrence }>();

    for (const [extensionId, document] of Object.entries(documents)) {
      for (const occurrence of document.occurrences) {
        if (occurrence.kind === "inline") {
          inline.set(occurrence.key, { extensionId, occurrence });
        }
      }
    }

    return { extensions, documents, inline };
  }, [extensions, documents]);

  return (
    <DocumentHostContext.Provider value={value}>{children}</DocumentHostContext.Provider>
  );
}

/** This document's occurrences for one extension, for a container block. */
export function useExtensionDocument(extensionId: string): AnalyzableDocument | null {
  return useContext(DocumentHostContext)?.documents[extensionId] ?? null;
}

type HostedInlineProps = Omit<InlineProps, "analysis"> & {
  document: AnalyzableDocument | null;
};

// One lazy component per installed inline directive, made once at module load
// (a component created during render would remount and re-suspend every time).
const lazyInline: ReadonlyMap<
  string,
  LazyExoticComponent<ComponentType<HostedInlineProps>>
> = new Map(
  renderModules.flatMap((renderModule) =>
    Object.entries(renderModule.inline).map(([name, contribution]) => [
      extensionBlockKey(renderModule.manifestId, name),
      lazy(() => loadAnalyzed<InlineProps>(contribution.load, renderModule.analyze)),
    ]),
  ),
);

/**
 * One inline directive (`:name[…]`) in Read mode: the element the Markdown
 * pipeline emits in its place is mapped here. Lazy, suspending and isolated like
 * `ExtensionBlockHost`: a directive that cannot render shows its own source.
 * Always read-only, as Read mode is.
 */
export function ExtensionInlineHost({ occurrenceKey }: { occurrenceKey: string | undefined }) {
  const host = useContext(DocumentHostContext);
  const entry = occurrenceKey ? host?.inline.get(occurrenceKey) : undefined;

  if (!host || !entry) {
    // Only reachable if authored raw HTML wrote the element by hand.
    return null;
  }

  const { extensionId, occurrence } = entry;
  const Inline = lazyInline.get(extensionBlockKey(extensionId, occurrence.name));
  const fallback = <code className="vault-extension-inline-fallback">{occurrence.source}</code>;

  if (!Inline) return fallback;

  return (
    <ExtensionErrorBoundary
      extensionId={extensionId}
      label={occurrence.source}
      fallback={() => fallback}
    >
      <Suspense fallback={fallback}>
        {/* eslint-disable-next-line react-hooks/static-components -- `Inline`
            is looked up, not created: every entry in `lazyInline` is made once
            at module load, which is exactly what the rule asks for. */}
        <Inline
          ctx={{ ...createRenderContext(host.extensions, extensionId), canEdit: false }}
          occurrence={occurrence}
          document={host.documents[extensionId] ?? null}
        />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}
