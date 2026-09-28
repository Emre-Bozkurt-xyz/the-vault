import { renderModules } from "@/extensions/registry.render";
import {
  createRenderContext,
  type DocumentExtensions,
  type LinkPreview,
  type WikiLinkInfo,
} from "@/lib/extension-api";

/**
 * Link previews (`docs/23_EXTENSION_SDK_PLAN.md` §6): which extension, if any,
 * shows a hover card for a wiki link, and what it shows.
 *
 * Browser-only, like `ExtensionBlockHost`: this imports the render registry,
 * and server code that can reach a render module's lazy `import()` bundles that
 * component into the page's entry chunk. Server-rendered links reach it through
 * the client `ExtensionLinkHost`.
 */

const linkContributions = renderModules.flatMap((renderModule) =>
  renderModule.links
    ? [{ extensionId: renderModule.manifestId, links: renderModule.links }]
    : [],
);

/** Whether any installed extension previews links at all. */
export const hasLinkPreviews = linkContributions.length > 0;

export type ResolvedLinkPreview = {
  extensionId: string;
  preview: LinkPreview;
};

/**
 * The first installed extension's preview for `link`, or null. A preview
 * function that throws counts as no preview: a broken extension must never
 * break a link (§18.5).
 */
export function resolveLinkPreview(
  link: WikiLinkInfo,
  extensions: DocumentExtensions | null | undefined,
): ResolvedLinkPreview | null {
  for (const { extensionId, links } of linkContributions) {
    try {
      const preview = links.preview(link, createRenderContext(extensions, extensionId));
      if (preview) return { extensionId, preview };
    } catch (cause) {
      console.error(`Link preview from "${extensionId}" failed`, cause);
    }
  }
  return null;
}
