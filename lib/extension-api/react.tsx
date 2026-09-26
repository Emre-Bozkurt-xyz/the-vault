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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ZodType } from "zod";

import { DocumentOverlayItem } from "@/components/extensions/DocumentOverlayHost";
import { useDocumentExtensionState } from "@/components/extensions/use-document-extension-state";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import type {
  ExtensionLinks,
  ExtensionRenderContext,
  ExtensionStateRow,
  ExtensionStateValue,
  ExtensionStateVisibility,
  JsonValue,
} from "@/lib/extension-api";
import { subscribeSessionEvent } from "@/lib/extension-host/session-events";
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
 * An in-memory stand-in for the server's extension state, for documents that
 * do not exist in the database (the extension playground, tests). Provide one
 * with {@link ExtensionStateStoreProvider} and `useExtensionState` reads and
 * writes it instead of calling the server.
 */
export type ExtensionStateStore = {
  get: (extensionId: string, stateKey: string) => ExtensionStateRow | undefined;
  set: (
    extensionId: string,
    stateKey: string,
    state: ExtensionStateValue,
    visibility: ExtensionStateVisibility,
  ) => void;
  subscribe: (listener: () => void) => () => void;
};

const ExtensionStateStoreContext = createContext<ExtensionStateStore | null>(null);

export const ExtensionStateStoreProvider = ExtensionStateStoreContext.Provider;

const noSubscription = () => () => undefined;

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
  const store = useContext(ExtensionStateStoreContext);
  const storeRow = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => (store && stateKey ? store.get(ctx.extensionId, stateKey) : undefined),
    () => (store && stateKey ? store.get(ctx.extensionId, stateKey) : undefined),
  );

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
    // With an in-memory store there is no server to talk to.
    disabled:
      Boolean(store) ||
      !ctx.documentId ||
      !stateKey ||
      (ctx.surface !== "workspace" && !initialState),
  });

  const raw = store ? (storeRow?.state ?? null) : state;
  const { schema } = options;
  const value = useMemo(() => {
    const parsed = schema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : null;
  }, [schema, raw]);

  const createVisibility = options.visibility ?? "private";
  const set = useCallback(
    (next: T) => {
      if (!ctx.canEdit) return;
      if (store && stateKey) {
        store.set(
          ctx.extensionId,
          stateKey,
          next,
          storeRow?.visibility ?? createVisibility,
        );
        return;
      }
      setState(next);
    },
    [ctx.canEdit, ctx.extensionId, createVisibility, setState, stateKey, store, storeRow],
  );

  return { value, set, status, error };
}

/**
 * Receives a session event this extension's commands emit on this document
 * (`context.emit(name, payload)` in an editor command). The handler may change
 * between renders without resubscribing.
 */
export function useSessionEvent(
  ctx: Pick<ExtensionRenderContext, "extensionId" | "documentId">,
  name: string,
  handler: (payload: JsonValue | undefined) => void,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const { extensionId, documentId } = ctx;
  useEffect(
    () =>
      subscribeSessionEvent({ extensionId, documentId }, name, (payload) =>
        handlerRef.current(payload),
      ),
    [documentId, extensionId, name],
  );
}

/**
 * One absolutely positioned item in an overlay, in document-surface
 * coordinates. Items take pointer events; the layer around them does not, so
 * text beneath an overlay stays selectable. Pass `interactive={false}` for
 * display-only items.
 */
export function OverlayItem({
  children,
  className,
  style,
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  interactive?: boolean;
}) {
  return (
    <DocumentOverlayItem
      className={className}
      style={interactive ? style : { ...style, pointerEvents: "none" }}
    >
      {children}
    </DocumentOverlayItem>
  );
}
