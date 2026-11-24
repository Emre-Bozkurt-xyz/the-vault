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

import {
  DocumentOverlayItem,
  useOverlayAnchorContext,
} from "@/components/extensions/DocumentOverlayHost";
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
import {
  anchorText,
  resolveAnchorLine,
  type OverlayAnchor,
} from "@/lib/extension-api/anchors";
import {
  consumeExtensionReveal,
  subscribeToExtensionReveals,
} from "@/lib/extension-host/reveal-requests";
import { subscribeSessionEvent } from "@/lib/extension-host/session-events";
import {
  runExtensionActionAction,
  type ExtensionActionOutcome,
} from "@/server/extension-actions";

export type { ExtensionActionOutcome } from "@/server/extension-actions";
export type { OverlayAnchor } from "@/lib/extension-api/anchors";
export { isOverlayAnchor } from "@/lib/extension-api/anchors";

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
 * Receives "show this item" requests for this extension on this document: the
 * `locator` your state's `assetIds` returned (the delete warning links to it).
 * Pass `ready` once the items can be found (state loaded); a request made
 * while navigating here is held until then. Scroll the item into view and
 * make it noticeable.
 */
export function useRevealRequest(
  ctx: Pick<ExtensionRenderContext, "extensionId" | "documentId">,
  handler: (locator: string) => void,
  ready = true,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const { extensionId, documentId } = ctx;
  useEffect(() => {
    if (!ready || !documentId) return;
    const pending = consumeExtensionReveal(documentId, extensionId);
    if (pending) handlerRef.current(pending);
    return subscribeToExtensionReveals((request) => {
      if (request.documentId !== documentId || request.extensionId !== extensionId) return;
      // Claim it, so it isn't replayed when this layer mounts again.
      consumeExtensionReveal(documentId, extensionId);
      handlerRef.current(request.locator);
    });
  }, [documentId, extensionId, ready]);
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

export type OverlayAnchors = {
  /**
   * What the document is laid out by here: `editor` (the source editor, where
   * hand-placed positions from before anchoring were set), `page` (a read or
   * public page), or null when nothing can anchor (the item then keeps its
   * stored position).
   */
  surface: "editor" | "page" | null;
  /** The anchor for an item whose top is at `top` (overlay px), or null. */
  anchorAt(top: number): OverlayAnchor | null;
  /** Where an anchored item's top is now (overlay px), or null when unknown. */
  resolve(anchor: OverlayAnchor): number | null;
  /**
   * Whether the layout at `top` is final: false while the editor has only
   * estimated lines above it or images are loading. Take anchors from
   * stored positions only once it is.
   */
  measuredAt(top: number): boolean;
  /** Increases whenever the layout changes; resolved positions are recomputed. */
  version: number;
};

/**
 * Anchors overlay items to the document's text, so an item (a sticker) sits
 * beside the same words in the editor and on read and public pages, whose
 * spacing differs, and moves with its text as lines are added above it.
 *
 * Store `anchorAt(top)` with the item when it is placed or moved, and render
 * at `resolve(anchor) ?? storedTop`. The component re-renders as the layout
 * changes (typing, resizing, images loading).
 */
export function useOverlayAnchors(): OverlayAnchors {
  const { surface, layer } = useOverlayAnchorContext();
  const version = useSyncExternalStore(
    surface?.subscribe ?? noSubscription,
    () => surface?.version() ?? 0,
    () => 0,
  );

  return useMemo(() => {
    const layerTop = () => layer?.getBoundingClientRect().top ?? null;
    const lineAtTop = (top: number) => {
      const origin = layerTop();
      if (!surface || origin === null) return null;
      return surface.lineAt(origin + top);
    };

    return {
      surface: surface && layer ? surface.kind : null,
      version,
      anchorAt(top) {
        const origin = layerTop();
        const containing = lineAtTop(top);
        if (!surface || origin === null || containing === null) return null;
        const y = origin + top;
        // The nearest line top wins: the line the point is in, or the next
        // non-blank line when the item starts just above it. A small offset
        // survives other layouts (a phone's narrower column rewraps the line
        // before, which would carry a large offset with it).
        const lines = surface.lines();
        let next = containing + 1;
        while (next <= lines.length && next - containing < 50 && !lines[next - 1]?.trim()) next += 1;
        let line = containing;
        let lineTop = surface.lineTop(containing);
        const nextTop = next <= lines.length ? surface.lineTop(next) : null;
        if (nextTop !== null && (lineTop === null || Math.abs(nextTop - y) < Math.abs(y - lineTop))) {
          line = next;
          lineTop = nextTop;
        }
        if (lineTop === null) return null;
        return {
          line,
          text: anchorText(lines[line - 1] ?? ""),
          dy: Math.round((y - lineTop) * 100) / 100,
        };
      },
      resolve(anchor) {
        const origin = layerTop();
        if (!surface || origin === null) return null;
        const lineTop = surface.lineTop(resolveAnchorLine(surface.lines(), anchor));
        return lineTop === null ? null : lineTop - origin + anchor.dy;
      },
      measuredAt(top) {
        const line = lineAtTop(top);
        return Boolean(surface && line !== null && surface.measured(line));
      },
    };
  }, [layer, surface, version]);
}
