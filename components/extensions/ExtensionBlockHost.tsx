"use client";

import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

import { loadAnalyzed } from "@/components/extensions/extension-analysis";
import { useExtensionDocument } from "@/components/extensions/ExtensionDocumentHost";
import { ExtensionErrorBoundary } from "@/components/extensions/ExtensionErrorBoundary";

import type {
  AnalyzableDocument,
  BlockProps,
  ExtensionLinks,
  ExtensionRenderContext,
} from "@/lib/extension-api";
import { renderModules } from "@/extensions/registry.render";
import {
  extensionBlockKey,
  extensionBlocks,
} from "@/lib/extension-host/blocks";

/**
 * The one component every extension block renders through
 * (`docs/23_EXTENSION_SDK_PLAN.md` §6, §18.5): leaf blocks in Read mode, on
 * public pages and inside Live-mode widgets, and container blocks in Read mode.
 * It owns three things so no extension has to:
 *
 * - **Lazy loading.** The block's component (and, for a container, its
 *   extension's `analyze`) is its own chunk, fetched only when a document
 *   actually contains the block. Only client modules import render modules:
 *   server code never reaches a block's `import()`, so no block lands in a
 *   page's entry chunk.
 * - **Suspense.** Server rendering waits for the component; the browser shows
 *   a placeholder only the first time a Live widget needs the chunk.
 * - **Isolation.** A block that throws falls back to its own source; it never
 *   takes the page or the editor down with it.
 */
export function ExtensionBlockHost({
  ctx,
  name,
  attributes,
  source,
  body = null,
  occurrenceKey = null,
  links,
}: {
  ctx: ExtensionRenderContext;
  name: string;
  attributes: Record<string, string>;
  source: string;
  /** A container's body; omitted for a leaf. */
  body?: string | null;
  /** A container's occurrence key; omitted for a leaf. */
  occurrenceKey?: string | null;
  links: ExtensionLinks;
}) {
  const definition = extensionBlocks.get(name);
  // Containers read their document's occurrences from the surrounding
  // `ExtensionDocumentProvider`; a Live-mode leaf widget has none.
  const document = useExtensionDocument(ctx.extensionId);
  const fallbackSource = body === null ? source : `${source}\n${body}\n:::`;

  if (!definition || definition.extensionId !== ctx.extensionId) {
    return <ExtensionBlockFallback source={fallbackSource} />;
  }

  const Block = lazyBlocks.get(extensionBlockKey(definition.extensionId, definition.name));

  if (!Block) {
    return <ExtensionBlockFallback source={fallbackSource} />;
  }

  return (
    <ExtensionErrorBoundary
      extensionId={definition.extensionId}
      label={source}
      fallback={(error) => <ExtensionBlockFallback source={fallbackSource} error={error} />}
    >
      <Suspense fallback={<div className="vault-extension-block-loading" aria-busy="true" />}>
        {/* eslint-disable-next-line react-hooks/static-components -- `Block` is
            looked up, not created: every entry in `lazyBlocks` is made once at
            module load, which is exactly what the rule asks for. */}
        <Block
          ctx={ctx}
          name={name}
          attributes={attributes}
          source={source}
          body={body}
          occurrenceKey={occurrenceKey}
          links={links}
          document={occurrenceKey === null ? null : document}
        />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}

type HostedBlockProps = Omit<BlockProps, "analysis"> & {
  document: AnalyzableDocument | null;
};

// One lazy component per installed block, created once when this module loads:
// a component created during render would remount the block and re-suspend on
// every render. `lazy()` fetches nothing until a block first renders.
const lazyBlocks: ReadonlyMap<
  string,
  LazyExoticComponent<ComponentType<HostedBlockProps>>
> = new Map(
  renderModules.flatMap((renderModule) =>
    Object.entries(renderModule.blocks).map(([name, contribution]) => [
      extensionBlockKey(renderModule.manifestId, name),
      lazy(() =>
        loadAnalyzed<BlockProps>(
          contribution.load,
          // Only containers are occurrences; a leaf never waits on an analyzer.
          contribution.form === "container" ? renderModule.analyze : null,
        ),
      ),
    ]),
  ),
);

/** A block the host cannot render: its source, readable, never an error. */
function ExtensionBlockFallback({
  source,
  error,
}: {
  source: string;
  error?: string;
}) {
  return (
    <div className="vault-extension-block-fallback">
      <code>{source}</code>
      {error ? <p className="vault-extension-block-error">{error}</p> : null}
    </div>
  );
}
