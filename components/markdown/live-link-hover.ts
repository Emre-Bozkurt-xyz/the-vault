import {
  MapMode,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { WikiLinkInfo } from "@/lib/extension-api";
import {
  parseWikiLinkParts,
  wikiKeyForTarget,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";

/**
 * Live-mode hover cards for wiki links that an extension previews
 * (`docs/23_EXTENSION_SDK_PLAN.md` §6; the dictionary's definition cards are
 * the first use).
 *
 * The card itself is the same React component the read surfaces use — this
 * module only answers "which link, anchored to which element", and hands that
 * to the editor, which asks the extensions what the card shows. Two things
 * follow from that split:
 *
 * - Nothing here is baked into a decoration. Resolving the target from live
 *   document state on hover is both less code and *more* correct than a
 *   `data-` attribute captured when a decoration was built, which can be stale
 *   by the time the pointer arrives.
 * - The Live-mode link keeps its existing wiki-link styling: a wiki link in the
 *   editor already announces itself.
 */
export type LinkHoverTarget = {
  anchor: HTMLElement;
  link: WikiLinkInfo;
};

/** Class the live-preview pass puts on a rendered wiki link's visible text. */
const wikiLinkClass = "vault-cm-preview-wiki-link";
/** The rendered card, matched to keep it open while the pointer is inside. */
const cardClass = "vault-md-definition-card";

/**
 * The wiki link occupying `offset` within `lineText`, or null.
 *
 * Matched against the whole `[[…]]` span rather than just the visible label: the
 * hovered element's position resolves to somewhere inside the link, and which
 * exact character it lands on depends on how much of the syntax is currently
 * hidden.
 */
export function findWikiLinkAt(
  lineText: string,
  offset: number,
): { target: string; label: string } | null {
  for (const match of lineText.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
    if (match.index === undefined) {
      continue;
    }

    if (offset < match.index || offset > match.index + match[0].length) {
      continue;
    }

    const parts = parseWikiLinkParts("", match[1]);
    return parts.target ? { target: parts.target, label: parts.label } : null;
  }

  return null;
}

/** True for a resolution-map key that names a document by title. */
export function isTitleLinkKey(key: string) {
  return key.startsWith("title:") && key.length > "title:".length;
}

/**
 * The wiki link under the hovered DOM node, or null.
 *
 * An unresolved link is returned (as `resolved: false`) only when it names a
 * document by title: that is something an extension may offer to create, while
 * an unresolved `[[doc:…]]` or `[[public:…]]` is just a broken reference.
 */
export function findLinkAtNode(
  view: EditorView,
  node: EventTarget | null,
  wikiLinks: WikiLinkResolutionMap,
): LinkHoverTarget | null {
  const element = node instanceof Element ? node : null;
  const anchor = element?.closest(`.${wikiLinkClass}`);

  if (!(anchor instanceof HTMLElement)) {
    return null;
  }

  let position: number;

  try {
    position = view.posAtDOM(anchor);
  } catch {
    // The span can be detached between the event and this call.
    return null;
  }

  const line = view.state.doc.lineAt(position);
  const found = findWikiLinkAt(line.text, position - line.from);

  if (!found) {
    return null;
  }

  const key = wikiKeyForTarget(found.target);
  const resolution = wikiLinks[key];

  if (!resolution) {
    return isTitleLinkKey(key)
      ? {
          anchor,
          link: {
            target: found.target,
            label: found.label,
            href: null,
            resolved: false,
            isDefinition: false,
            preview: null,
            occurrence: 0,
          },
        }
      : null;
  }

  return {
    anchor,
    link: {
      target: found.target,
      label: resolution.label ?? found.label,
      href: resolution.href ?? null,
      resolved: true,
      isDefinition: Boolean(resolution.isDefinition),
      preview: resolution.preview ?? null,
      occurrence: 0,
    },
  };
}

/**
 * Hover plumbing for the Live-mode card.
 *
 * Every timer lives in this closure, and the card itself is plain React with no
 * callbacks pointing back here. That split is deliberate: the editor builds its
 * extensions inside a `useMemo`, so anything the extension reads through a React
 * ref becomes a render-time ref access, and a `useMemo` holder is worse still
 * (the compiler treats its result as immutable). One stable `setState` is the
 * only thing that crosses the boundary.
 *
 * Which leaves one question — how does the closure know not to close while the
 * pointer is inside the card, given the card renders in a portal outside the
 * editor's DOM? It asks the DOM: when the close timer fires it checks whether
 * the card is `:hover`ed, and reschedules if so. The card scrolls, so being able
 * to travel into it and stay is not optional.
 */
export function createLinkHoverExtension(options: {
  getWikiLinks: () => WikiLinkResolutionMap;
  /** Whether any extension previews this link; only those open a card. */
  hasPreview: (link: WikiLinkInfo) => boolean;
  /** Stable setter — pass React's `setState`, not a fresh closure per render. */
  onChange: (target: LinkHoverTarget | null) => void;
  openDelayMs?: number;
  closeDelayMs?: number;
}): Extension {
  const openDelay = options.openDelayMs ?? 250;
  const closeDelay = options.closeDelayMs ?? 300;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let current: HTMLElement | null = null;

  const clearTimers = () => {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const closeNow = () => {
    clearTimers();

    if (current) {
      current = null;
      options.onChange(null);
    }
  };

  const scheduleClose = () => {
    clearTimers();
    closeTimer = setTimeout(() => {
      closeTimer = null;

      // Still reading it — check again rather than pulling the card away.
      if (document.querySelector(`.${cardClass}:hover`)) {
        scheduleClose();
        return;
      }

      closeNow();
    }, closeDelay);
  };

  return [
    EditorView.domEventHandlers({
      pointerover(event, view) {
        // Touch has no hover: a tap would open a card the reader cannot dismiss
        // without following the link, so it stays a pointer-device affordance.
        if (event.pointerType !== "mouse") {
          return false;
        }

        const found = findLinkAtNode(view, event.target, options.getWikiLinks());
        const target = found && options.hasPreview(found.link) ? found : null;

        if (!target) {
          if (current) {
            scheduleClose();
          }
          return false;
        }

        if (target.anchor === current) {
          clearTimers();
          return false;
        }

        clearTimers();
        openTimer = setTimeout(() => {
          openTimer = null;
          current = target.anchor;
          options.onChange(target);
        }, openDelay);
        return false;
      },
      pointerleave(event) {
        if (event.pointerType === "mouse") {
          scheduleClose();
        }
        return false;
      },
      // An edit under an open card invalidates what it is pointing at.
      keydown() {
        closeNow();
        return false;
      },
    }),
    EditorView.domEventObservers({
      scroll() {
        closeNow();
      },
    }),
  ];
}

/**
 * A filter on the wiki-link completion opened at one `[[` (an extension's
 * `editor.openLinkCompletion({ filter })`, e.g. the dictionary's `/term`).
 *
 * Lives in editor state rather than in a React store because the editor builds
 * its extensions inside a `useMemo`, and a handler that mutates a memoized
 * object is something the React Compiler refuses to compile around. It is also
 * simply where this belongs: the narrowing is a property of one spot in the
 * document, and `mapPos` keeps it pinned there through edits.
 */
export type LinkCompletionScope = {
  markerFrom: number;
  filter: (link: WikiLinkInfo) => boolean;
};

const setLinkCompletionScope = StateEffect.define<LinkCompletionScope | null>();

export const linkCompletionScopeField = StateField.define<LinkCompletionScope | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLinkCompletionScope)) {
        return effect.value;
      }
    }

    if (value === null) {
      return null;
    }

    // `TrackDel` returns null when the marker's own text was deleted, which is
    // exactly when the narrowing should stop applying.
    const markerFrom = transaction.changes.mapPos(value.markerFrom, -1, MapMode.TrackDel);
    return markerFrom === null ? null : { ...value, markerFrom };
  },
});

/**
 * Narrows the next wiki-link completion at `markerFrom` to links `filter`
 * accepts.
 *
 * Never cleared explicitly: a marker that no longer matches the open completion
 * region simply stops applying, and the next narrowing overwrites it.
 */
export function narrowLinkCompletion(
  view: Pick<EditorView, "dispatch">,
  scope: LinkCompletionScope,
) {
  view.dispatch({ effects: setLinkCompletionScope.of(scope) });
}

/** The completion filter for the `[[` at `markerFrom`, if one applies. */
export function linkCompletionFilterAt(
  state: EditorState,
  markerFrom: number,
): LinkCompletionScope["filter"] | null {
  const scope = state.field(linkCompletionScopeField, false) ?? null;
  return scope && scope.markerFrom === markerFrom ? scope.filter : null;
}
