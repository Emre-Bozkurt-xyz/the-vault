import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, showTooltip, ViewPlugin, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { createRoot } from "react-dom/client";
import { CodeFenceTools } from "./CodeFenceTools";
import { codeFenceAt } from "./code-fences";
import { activeRunsChanged, codeRunExtension } from "./code-run";

function codeLineDecorations(view: EditorView) {
  const lines = new Set<number>();
  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({ from: range.from, to: range.to, enter(node) {
      if (node.name !== "FencedCode") return;
      const first = view.state.doc.lineAt(Math.max(range.from, node.from)).number;
      const last = view.state.doc.lineAt(Math.min(range.to, node.to)).number;
      for (let number = first; number <= last; number++) lines.add(view.state.doc.line(number).from);
      return false;
    } });
  }
  return Decoration.set([...lines].sort((a, b) => a - b).map((from) => Decoration.line({ class: "vault-cm-code-line" }).range(from)));
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
        root.render(<CodeFenceTools view={view} position={selection.head} onFormatBoundary={onFormatBoundary} documentId={documentId} />);
        return { dom, destroy() { window.setTimeout(() => root.unmount(), 0); } };
      },
    };
  }
  const tools = StateField.define<Tooltip | null>({
    create: tooltip,
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) return tooltip(transaction.state);
      // Rebuild when Run becomes available or a run starts or ends — but not on
      // every poll tick, which would remount the toolbar under the cursor
      // several times a second and swallow clicks aimed at it.
      return activeRunsChanged(transaction.startState, transaction.state) ? tooltip(transaction.state) : value;
    },
    provide: (field) => showTooltip.from(field),
  });
  return [
    codeRunExtension(),
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
