import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import { findWikiLinkAt } from "@/components/markdown/live-link-hover";

export type LiveLinkTarget =
  | { kind: "wiki"; target: string; fragment: string | null }
  | { kind: "url"; url: string };

const markdownLinkPattern = /\[([^\]\n]+)\]\((<[^>\n]+>|[^)\s\n]+)(?:\s+"[^"\n]*")?\)/g;
const bareUrlPattern = /<?(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])>?/g;

/** The link at `offset` in a line of Markdown: a wiki link, a `[label](url)`, or a bare URL. */
export function findLinkAt(lineText: string, offset: number): LiveLinkTarget | null {
  const wiki = findWikiLinkAt(lineText, offset);
  if (wiki) return { kind: "wiki", target: wiki.target, fragment: wiki.fragment };
  for (const match of lineText.matchAll(markdownLinkPattern)) {
    const start = match.index ?? 0;
    if (offset < start || offset > start + match[0].length) continue;
    const url = match[2].replace(/^<|>$/g, "");
    return /^(https?:|mailto:|\/(?!\/))/i.test(url) ? { kind: "url", url } : null;
  }
  for (const match of lineText.matchAll(bareUrlPattern)) {
    const start = match.index ?? 0;
    if (offset >= start && offset <= start + match[0].length) return { kind: "url", url: match[1] };
  }
  return null;
}

/** Dispatch after the link map changes, so greyed-out links are checked again. */
export const refreshUnresolvedLinks = StateEffect.define<null>();

const unresolvedMark = Decoration.mark({
  class: "vault-cm-wiki-unresolved",
  attributes: { title: "No document called this yet. Ctrl+click to create it" },
});

/**
 * Following links in Live mode (Ctrl/Cmd+click; middle-click for a new tab),
 * where a plain click keeps editing. Holding Ctrl/Cmd marks links as
 * clickable, and `[[links]]` to documents that don't exist yet are greyed out:
 * following one creates the document (`onOpen` decides what happens).
 */
export function createLiveLinkOpenExtension({
  onOpen,
  isUnresolved,
}: {
  onOpen: (target: LiveLinkTarget, options: { newTab: boolean }) => void;
  /** Whether a `[[target]]` names a document that doesn't exist yet. */
  isUnresolved: (target: string) => boolean;
}) {
  const linkAt = (view: EditorView, event: MouseEvent): LiveLinkTarget | null => {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return null;
    const line = view.state.doc.lineAt(pos);
    return findLinkAt(line.text, pos - line.from);
  };

  const unresolved = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshUnresolvedLinks)));
        if (update.docChanged || update.viewportChanged || refreshed) this.decorations = this.build(update.view);
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos);
            for (const match of line.text.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
              const [target = "", label = ""] = match[1].split("|", 2);
              const cleanTarget = target.split("#")[0].trim();
              if (!cleanTarget || !isUnresolved(cleanTarget)) continue;
              const visible = label.trim() || target.trim();
              const startInMatch = match[0].indexOf(visible);
              if (startInMatch < 0 || match.index === undefined) continue;
              const start = line.from + match.index + startInMatch;
              builder.add(start, start + visible.length, unresolvedMark);
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  // Holding Ctrl/Cmd shows links as clickable.
  const modifierHint = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        window.addEventListener("keydown", this.onKey);
        window.addEventListener("keyup", this.onKey);
        window.addEventListener("blur", this.clear);
      }
      onKey = (event: KeyboardEvent) => {
        this.view.dom.classList.toggle("vault-link-mod-held", event.ctrlKey || event.metaKey);
      };
      clear = () => this.view.dom.classList.remove("vault-link-mod-held");
      destroy() {
        window.removeEventListener("keydown", this.onKey);
        window.removeEventListener("keyup", this.onKey);
        window.removeEventListener("blur", this.clear);
      }
    },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
      const target = linkAt(view, event);
      if (!target) return false;
      event.preventDefault();
      onOpen(target, { newTab: event.shiftKey });
      return true;
    },
    auxclick(event, view) {
      if (event.button !== 1) return false;
      const target = linkAt(view, event);
      if (!target) return false;
      event.preventDefault();
      onOpen(target, { newTab: true });
      return true;
    },
  });

  return [unresolved, modifierHint, clicks];
}
