/**
 * Client hooks of the extension SDK (`docs/23_EXTENSION_SDK_PLAN.md` §6). An
 * extension component receives a serialisable {@link ExtensionRenderContext}
 * as a prop and gets behaviour from these hooks, which take that context, so
 * the same component renders on server pages and in the editor.
 *
 * The context pre-binds the extension id: a hook cannot name another
 * extension's state or actions. That is API hygiene, not a security boundary
 * (plan §3 principle 8); the server re-checks everything.
 */
import { useCallback, useMemo } from "react";
import type { ZodType } from "zod";

import { useDocumentExtensionState } from "@/components/extensions/use-document-extension-state";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import type {
  ExtensionLinks,
  ExtensionRenderContext,
  ExtensionStateValue,
  ExtensionStateVisibility,
} from "@/lib/extension-api";
import {
  runExtensionActionAction,
  type ExtensionActionOutcome,
} from "@/server/extension-actions";

export type { ExtensionActionOutcome } from "@/server/extension-actions";

/**
 * Calls one of this extension's own server actions (plan §8). Document-scoped
 * actions run against `ctx.documentId`.
 */
export function useExtensionAction(
  ctx: Pick<ExtensionRenderContext, "extensionId" | "documentId">,
  actionId: string,
): (input?: unknown) => Promise<ExtensionActionOutcome> {
  if (!actionId.startsWith(`${ctx.extensionId}.`)) {
    throw new Error(
      `"${ctx.extensionId}" cannot call "${actionId}": actions are namespaced per extension.`,
    );
  }

  const { documentId } = ctx;

  return useCallback(
    (input?: unknown) =>
      runExtensionActionAction({
        actionId,
        documentId: documentId ?? undefined,
        input,
      }),
    [actionId, documentId],
  );
}

type StateObject = Record<string, ExtensionStateValue>;

/**
 * Renders Markdown inside an extension component (e.g. a calendar entry's
 * text) with the document's resolved links, through Vault's own renderer and
 * sanitizer. Nested, so it never renders the outer document's extension
 * blocks with the outer document's context.
 */
export function ExtensionMarkdown({
  markdown,
  links,
  className,
}: {
  markdown: string;
  links: ExtensionLinks;
  className?: string;
}) {
  return (
    <MarkdownDocument
      markdown={markdown}
      wikiLinks={links.wikiLinks}
      assetLinks={links.assetLinks}
      contained={false}
      className={className}
    />
  );
}

/**
 * One of this extension's state rows on the current document.
 *
 * A read-only view starts from the page's prefetched row (no fetch). An
 * editable one always loads the current row, because an editor widget can
 * remount long after the page loaded and must not save over newer state with a
 * stale snapshot. Saves are debounced and happen only when `ctx.canEdit`; for a
 * reader `set` is a no-op, so a component can call it unconditionally.
 *
 * `visibility` applies only to a row this creates: an existing row keeps its
 * own on every save.
 */
export function useExtensionState<T extends StateObject>(
  ctx: ExtensionRenderContext,
  stateKey: string | null,
  options: {
    schema: ZodType<T>;
    /** Visibility for a row this call creates; an existing row keeps its own. */
    visibility?: ExtensionStateVisibility;
    version?: number;
  },
) {
  const prefetched = stateKey ? ctx.state[stateKey] : undefined;
  const seed = ctx.canEdit ? undefined : prefetched;
  const initialState = useMemo(
    () =>
      seed && stateKey
        ? {
            extensionId: ctx.extensionId,
            stateKey,
            state: seed.state as StateObject,
            version: seed.version,
            visibility: seed.visibility,
            updatedAt: "",
          }
        : null,
    [ctx.extensionId, seed, stateKey],
  );

  const { state, setState, status, error } = useDocumentExtensionState({
    documentId: ctx.documentId ?? "",
    extensionId: ctx.extensionId,
    stateKey: stateKey ?? undefined,
    initialState,
    version: options.version ?? prefetched?.version ?? 1,
    visibility: prefetched?.visibility ?? options.visibility ?? "private",
    // No document or no key: nothing to load or save. Public surfaces render
    // only from the prefetched row; their visitors cannot call the state action.
    disabled:
      !ctx.documentId ||
      !stateKey ||
      (ctx.surface !== "workspace" && !initialState),
  });

  const { schema } = options;
  const value = useMemo(() => {
    const parsed = schema.safeParse(state ?? {});
    return parsed.success ? parsed.data : null;
  }, [schema, state]);

  const set = useCallback(
    (next: T) => {
      if (ctx.canEdit) setState(next);
    },
    [ctx.canEdit, setState],
  );

  return { value, set, status, error };
}
