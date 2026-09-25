import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, showTooltip, tooltips, ViewPlugin, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { createRoot } from "react-dom/client";
import { CodeFenceTools } from "./CodeFenceTools";
import { codeFenceAt } from "./code-fences";
import { codeRunExtension, codeToolsStateChanged } from "./code-run";

/**
 * Every line of a fence gets `vault-cm-code-line`; the fence's own first and
 * last lines also get `-first`/`-last`, so the block can be drawn as one
 * rounded surface even though CodeMirror renders it as separate line elements.
 * The edge classes come from the node's true bounds, not the visible range, so
 * a block scrolled half out of view does not grow a false rounded edge.
 */
function codeLineDecorations(view: EditorView) {
  const lines = new Map<number, string>();
  const { doc } = view.state;
  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({ from: range.from, to: range.to, enter(node) {
      if (node.name !== "FencedCode") return;
      const firstOfBlock = doc.lineAt(node.from).number;
      const lastOfBlock = doc.lineAt(node.to).number;
      const first = doc.lineAt(Math.max(range.from, node.from)).number;
      const last = doc.lineAt(Math.min(range.to, node.to)).number;
      for (let number = first; number <= last; number++) {
        let className = "vault-cm-code-line";
        if (number === firstOfBlock) className += " vault-cm-code-first";
        if (number === lastOfBlock) className += " vault-cm-code-last";
        lines.set(doc.line(number).from, className);
      }
      return false;
    } });
  }
  return Decoration.set([...lines].sort(([a], [b]) => a - b).map(([from, className]) => Decoration.line({ class: className }).range(from)));
}

export function createCodeBlockExtension(onFormatBoundary: () => void, documentId: string) {
  function tooltip(state: EditorState): Tooltip | null {
    if (state.readOnly) return null;
    const block = codeFenceAt(state);
    const selection = state.selection.main;
    if (!block || selection.from < block.from || selection.to > block.to) return null;
    return {
      pos: selection.head, above: true, strictSide: false,
      create(view) {
        const dom = document.createElement("div");
        dom.className = "vault-code-tooltip";
        dom.setAttribute("aria-label", "Code tools (Alt+F10)");
        const root = createRoot(dom);
        root.render(<CodeFenceTools view={view} position={selection.head} onFormatBoundary={onFormatBoundary} />);
        return { dom, destroy() { window.setTimeout(() => root.unmount(), 0); } };
      },
    };
  }
  const tools = StateField.define<Tooltip | null>({
    create: tooltip,
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) return tooltip(transaction.state);
      // Rebuild when Run becomes available, a run starts or ends, or an input
      // box opens or closes — but not on every poll tick or input keystroke,
      // which would remount the toolbar under the cursor and swallow clicks.
      return codeToolsStateChanged(transaction.startState, transaction.state) ? tooltip(transaction.state) : value;
    },
    provide: (field) => showTooltip.from(field),
  });
  return [
    // The editor column's formatting row is sticky and translucent, so a
    // tooltip placed "above" a block near the top of the viewport ended up
    // underneath it — greyed out and half unclickable. Treat the row's bottom
    // edge as the top of the usable space; CodeMirror then flips the tooltip
    // below the cursor when there is not room above.
    tooltips({
      tooltipSpace(view) {
        const bar = view.dom.closest(".vault-editor-column")?.querySelector(".vault-editor-toolbar-row");
        const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
        return { top, left: 0, bottom: innerHeight, right: innerWidth };
      },
    }),
    codeRunExtension(documentId),
    syntaxHighlighting(classHighlighter),
    ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = codeLineDecorations(view); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) this.decorations = codeLineDecorations(update.view);
      }
    }, { decorations: (plugin) => plugin.decorations }),
    tools,
    keymap.of([{ key: "Alt-F10", run(view) {
      const control = view.dom.querySelector<HTMLButtonElement>(".vault-code-tools button:not(:disabled)");
      if (!control) return false;
      control.focus();
      return true;
    } }]),
  ];
}
