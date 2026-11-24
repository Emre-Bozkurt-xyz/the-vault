import type { Text } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

import { createAnchorNotifier } from "@/components/extensions/anchor-surface-notifier";
import type { OverlayAnchorSurface } from "@/lib/extension-api/anchors";

export type EditorAnchorSurface = OverlayAnchorSurface & {
  /** The editor view to measure, or null while none is mounted. */
  attach(view: EditorView | null): void;
  /** Add to the editor's extensions: reports layout changes. */
  extension: ReturnType<typeof EditorView.updateListener.of>;
};

/**
 * Overlay anchoring in the source editor (`docs/23_EXTENSION_SDK_PLAN.md`):
 * line positions come from CodeMirror's height map, so they hold in every
 * mode (source, live, split) and for lines scrolled out of view.
 *
 * CodeMirror only draws lines near the viewport and estimates the rest, so a
 * line is `measured` once every line above it has been drawn (tracked here as
 * the document range drawn contiguously from the top) and the editor's
 * images have loaded.
 */
export function createEditorAnchorSurface(): EditorAnchorSurface {
  let view: EditorView | null = null;
  let linesOf: Text | null = null;
  let lines: string[] = [];
  // Document position up to which lines have been drawn, contiguously from 0.
  let drawnUntil = -1;
  const notifier = createAnchorNotifier();

  function track(update: ViewUpdate) {
    const { from, to } = update.view.viewport;
    if (update.docChanged) {
      let limit = update.changes.mapPos(Math.max(drawnUntil, 0), -1);
      // A change outside the drawn viewport (a collaborator's) is estimated again.
      update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (fromB < from || toB > to) limit = Math.min(limit, fromB);
      });
      drawnUntil = drawnUntil < 0 ? -1 : limit;
    }
    if (from <= Math.max(drawnUntil, 0) + 1) drawnUntil = Math.max(drawnUntil, to);
  }

  return {
    kind: "editor",
    attach(next) {
      if (view === next) return;
      view = next;
      drawnUntil = -1;
      if (next) track({ view: next, docChanged: false } as ViewUpdate);
      notifier.notify();
    },
    extension: EditorView.updateListener.of((update) => {
      if (update.view !== view) return;
      track(update);
      if (update.docChanged || update.geometryChanged || update.viewportChanged || update.heightChanged) {
        notifier.notify();
      }
    }),
    lines() {
      if (!view) return [];
      if (view.state.doc !== linesOf) {
        linesOf = view.state.doc;
        lines = linesOf.toString().split("\n");
      }
      return lines;
    },
    lineTop(line) {
      if (!view) return null;
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return null;
      return view.lineBlockAt(doc.line(line).from).top + view.documentTop;
    },
    lineAt(clientY) {
      if (!view) return null;
      const block = view.lineBlockAtHeight(clientY - view.documentTop);
      return view.state.doc.lineAt(block.from).number;
    },
    measured(line) {
      if (!view) return false;
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines || doc.line(line).to > drawnUntil) return false;
      for (const image of view.contentDOM.querySelectorAll("img")) {
        if (!image.complete) return false;
      }
      return true;
    },
    subscribe: notifier.subscribe,
    version: notifier.version,
  };
}
