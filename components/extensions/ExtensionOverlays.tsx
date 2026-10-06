"use client";

import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";

import { DocumentOverlayHost } from "@/components/extensions/DocumentOverlayHost";
import { ExtensionErrorBoundary } from "@/components/extensions/ExtensionErrorBoundary";
import { renderModules } from "@/extensions/registry.render";
import {
  createRenderContext,
  type DocumentExtensions,
  type EditorModule,
  type ExtensionLinks,
  type OverlayProps,
} from "@/lib/extension-api";

/**
 * Document overlays (`docs/23_EXTENSION_SDK_PLAN.md` §6, §7): layers drawn over
 * the whole document surface, like stickers. Client-only by design, like
 * `ExtensionBlockHost`: this is the only module that loads overlay components,
 * so none lands in a server page's entry chunk.
 */

type OverlayEntry = {
  extensionId: string;
  overlayId: string;
  Component: LazyExoticComponent<ComponentType<OverlayProps>>;
};

// One lazy component per installed overlay, created once at module load.
const readOnlyOverlays: readonly OverlayEntry[] = renderModules.flatMap((renderModule) =>
  Object.entries(renderModule.overlays).map(([overlayId, contribution]) => ({
    extensionId: renderModule.manifestId,
    overlayId,
    Component: lazy(contribution.load),
  })),
);

/** Whether any overlay would render for this document. */
export function hasExtensionOverlays(
  extensions: DocumentExtensions | null | undefined,
  editorModules: readonly EditorModule[] = [],
): boolean {
  if (!extensions) return false;
  return (
    readOnlyOverlays.some((entry) => extensions.renderIds.includes(entry.extensionId)) ||
    editorModules.some((editorModule) => Object.keys(editorModule.overlays).length > 0)
  );
}

/**
 * The overlays for one document. Rendering follows content: an extension's
 * read-only overlay renders for every reader when the document needs the
 * extension (it has its state, uses its syntax, or the reader enabled it).
 * Authoring follows the user: where an enabled extension's editor module is
 * loaded and the document is editable, its interactive overlay of the same id
 * replaces the read-only one.
 */
export function ExtensionOverlayLayer({
  extensions,
  links,
  editorModules = [],
}: {
  extensions: DocumentExtensions;
  links: ExtensionLinks;
  editorModules?: readonly EditorModule[];
}) {
  const interactive = new Map<string, ComponentType<OverlayProps>>();
  if (extensions.canEdit) {
    for (const editorModule of editorModules) {
      for (const [overlayId, Component] of Object.entries(editorModule.overlays)) {
        interactive.set(`${editorModule.manifestId}:${overlayId}`, Component);
      }
    }
  }

  const shown = readOnlyOverlays.filter(
    (entry) =>
      extensions.renderIds.includes(entry.extensionId) ||
      interactive.has(`${entry.extensionId}:${entry.overlayId}`),
  );

  return (
    <>
      {shown.map((entry) => {
        const key = `${entry.extensionId}:${entry.overlayId}`;
        const Interactive = interactive.get(key);
        const ctx = createRenderContext(extensions, entry.extensionId);
        // Read-only overlays never write, whatever the page allows.
        const readOnlyCtx = { ...ctx, canEdit: false };

        return (
          <ExtensionErrorBoundary
            key={key}
            extensionId={entry.extensionId}
            label={`overlay ${entry.overlayId}`}
            // An overlay that fails simply disappears; the document is intact.
            fallback={() => null}
          >
            <Suspense fallback={null}>
              {Interactive ? (
                <Interactive ctx={ctx} links={links} />
              ) : (
                <entry.Component ctx={readOnlyCtx} links={links} />
              )}
            </Suspense>
          </ExtensionErrorBoundary>
        );
      })}
    </>
  );
}

/**
 * A read view's document wrapped with its overlays: the layer is positioned
 * over `children`. Renders `children` untouched when no overlay applies, so
 * documents without overlays keep their exact markup.
 */
export function ExtensionOverlaySurface({
  extensions,
  links = {},
  children,
}: {
  extensions: DocumentExtensions;
  links?: ExtensionLinks;
  children: ReactNode;
}) {
  if (!hasExtensionOverlays(extensions) || !extensions.documentId) {
    return <>{children}</>;
  }

  return (
    <DocumentOverlayHost
      documentId={extensions.documentId}
      overlays={<ExtensionOverlayLayer extensions={extensions} links={links} />}
    >
      {children}
    </DocumentOverlayHost>
  );
}
