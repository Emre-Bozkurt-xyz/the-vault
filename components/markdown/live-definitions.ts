import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  parseWikiLinkParts,
  wikiKeyForTarget,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";

/**
 * Live-mode hover previews for wiki links that point at a definition document
 * (`docs/20_DICTIONARY_EXTENSION_PLAN.md` slice 3).
 *
 * The card itself is the same React component the read surfaces use — this
 * module only answers "which definition, anchored to which element", and hands
 * that to the editor to render. Two things follow from that split:
 *
 * - Nothing here is baked into a decoration. The plan expected per-target
 *   `data-` attributes on the wiki-link mark, but resolving the target from
 *   live document state on hover is both less code and *more* correct: an
 *   attribute captured when a decoration was built can be stale by the time the
 *   pointer arrives, whereas the document cannot be.
 * - The Live-mode link keeps its existing wiki-link styling. A wiki link in the
 *   editor already announces itself (weight 500 plus a primary-coloured
 *   underline); adding the Read-mode definition weight on top would be
 *   differentiating something that is already distinct.
 */
export type DefinitionHoverTarget = {
  anchor: HTMLElement;
  label: string;
  preview: string;
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

/**
 * Resolves the hovered DOM node to a definition, or null when it is not over a
 * wiki link, the link does not resolve, or the target is not a definition.
 */
export function findDefinitionAtNode(
  view: EditorView,
  node: EventTarget | null,
  wikiLinks: WikiLinkResolutionMap,
): DefinitionHoverTarget | null {
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
  const link = findWikiLinkAt(line.text, position - line.from);

  if (!link) {
    return null;
  }

  const resolution = wikiLinks[wikiKeyForTarget(link.target)];

  if (!resolution?.isDefinition || !resolution.preview) {
    return null;
  }

  return {
    anchor,
    label: resolution.label ?? link.label,
    preview: resolution.preview,
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
export function createDefinitionHoverExtension(options: {
  getWikiLinks: () => WikiLinkResolutionMap;
  /** Stable setter — pass React's `setState`, not a fresh closure per render. */
  onChange: (target: DefinitionHoverTarget | null) => void;
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

        const target = findDefinitionAtNode(
          view,
          event.target,
          options.getWikiLinks(),
        );

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
