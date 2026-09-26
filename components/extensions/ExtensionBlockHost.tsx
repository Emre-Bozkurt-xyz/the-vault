"use client";

import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ErrorInfo,
  type LazyExoticComponent,
  type ReactNode,
} from "react";

import type { BlockProps, ExtensionLinks, ExtensionRenderContext } from "@/lib/extension-api";
import { renderModules } from "@/extensions/registry.render";
import {
  extensionBlockKey,
  extensionBlocks,
} from "@/lib/extension-host/blocks";

/**
 * The one component every extension block renders through
 * (`docs/23_EXTENSION_SDK_PLAN.md` §6, §18.5), in Read mode, on public pages
 * and inside Live-mode widgets. It owns three things so no extension has to:
 *
 * - **Lazy loading.** The block's component is its own chunk, fetched only when
 *   a document actually contains the block. This is the only module that
 *   imports render modules, and it is a client module: server code never
 *   reaches a block's `import()`, so no block lands in a page's entry chunk.
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
  links,
}: {
  ctx: ExtensionRenderContext;
  name: string;
  attributes: Record<string, string>;
  source: string;
  links: ExtensionLinks;
}) {
  const definition = extensionBlocks.get(name);

  if (!definition || definition.extensionId !== ctx.extensionId) {
    return <ExtensionBlockFallback source={source} />;
  }

  const Block = lazyBlocks.get(extensionBlockKey(definition.extensionId, definition.name));

  if (!Block) {
    return <ExtensionBlockFallback source={source} />;
  }

  return (
    <ExtensionErrorBoundary extensionId={definition.extensionId} source={source}>
      <Suspense fallback={<div className="vault-extension-block-loading" aria-busy="true" />}>
        {/* eslint-disable-next-line react-hooks/static-components -- `Block` is
            looked up, not created: every entry in `lazyBlocks` is made once at
            module load, which is exactly what the rule asks for. */}
        <Block
          ctx={ctx}
          name={name}
          attributes={attributes}
          source={source}
          links={links}
        />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}

// One lazy component per installed block, created once when this module loads:
// a component created during render would remount the block and re-suspend on
// every render. `lazy()` fetches nothing until a block first renders.
const lazyBlocks: ReadonlyMap<
  string,
  LazyExoticComponent<ComponentType<BlockProps>>
> = new Map(
  renderModules.flatMap((renderModule) =>
    Object.entries(renderModule.blocks).map(([name, contribution]) => [
      extensionBlockKey(renderModule.manifestId, name),
      lazy(contribution.load),
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

class ExtensionErrorBoundary extends Component<
  { extensionId: string; source: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Extension "${this.props.extensionId}" failed to render ${this.props.source}`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      // Loud in development, quiet in production: authors debugging an
      // extension see why; readers just see the block's source.
      return (
        <ExtensionBlockFallback
          source={this.props.source}
          error={
            process.env.NODE_ENV === "production"
              ? undefined
              : `${this.props.extensionId}: ${this.state.error.message}`
          }
        />
      );
    }

    return this.props.children;
  }
}
