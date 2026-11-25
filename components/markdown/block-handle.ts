import { startCompletion } from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { findBlock, moveBlockWithSpacing, type MarkdownBlock } from "@/lib/markdown/blocks";

/** What the block menu needs: the block and where its handle sits on screen. */
export type BlockMenuRequest = { view: EditorView; block: MarkdownBlock; anchor: DOMRect };

const linesCache = new WeakMap<Text, string[]>();
function docLines(doc: Text): string[] {
  let lines = linesCache.get(doc);
  if (!lines) {
    lines = doc.toString().split("\n");
    linesCache.set(doc, lines);
  }
  return lines;
}

/** Replaces the document with `next` as one minimal edit. */
export function replaceDocument(view: EditorView, next: string, userEvent = "input.block") {
  const current = view.state.doc.toString();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start += 1;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }
  view.dispatch({ changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) }, userEvent });
}

/**
 * Live mode's block handle: hovering a block (a paragraph, a list item with
 * its children, a heading, a code block, a table, a quote) shows `+` and `⋮⋮`
 * in the margin beside its first line. `+` adds a line below and opens the
 * slash menu; `⋮⋮` opens the block menu (`onOpenMenu`), or, dragged, moves the
 * whole block to where it's dropped. Hidden on touch screens (no hover).
 */
export function createBlockHandleExtension(onOpenMenu: (request: BlockMenuRequest) => void) {
  return ViewPlugin.fromClass(
    class {
      handle: HTMLDivElement;
      indicator: HTMLDivElement;
      block: MarkdownBlock | null = null;
      hideTimer = 0;
      dragging: { block: MarkdownBlock; before: number | null; startY: number; moved: boolean } | null = null;

      constructor(readonly view: EditorView) {
        this.handle = document.createElement("div");
        this.handle.className = "vault-block-handle";
        this.handle.setAttribute("aria-hidden", "false");
        this.handle.innerHTML =
          '<button type="button" class="vault-block-handle-add" aria-label="Add a block below" title="Add below">+</button>' +
          '<button type="button" class="vault-block-handle-grip" aria-label="Block menu (drag to move)" title="Drag to move · click for options">⋮⋮</button>';
        this.handle.hidden = true;
        this.indicator = document.createElement("div");
        this.indicator.className = "vault-block-drop-indicator";
        this.indicator.hidden = true;
        view.dom.append(this.handle, this.indicator);

        view.dom.addEventListener("mousemove", this.onMove);
        view.dom.addEventListener("mouseleave", this.onLeave);
        this.handle.addEventListener("mouseenter", this.cancelHide);
        this.handle.querySelector(".vault-block-handle-add")!.addEventListener("click", this.onAdd);
        this.handle.querySelector(".vault-block-handle-grip")!.addEventListener("pointerdown", this.onGripDown as EventListener);
      }

      update() {
        // Text or layout changed: the handle is placed again on the next move.
        if (!this.dragging) this.hide();
      }

      destroy() {
        this.view.dom.removeEventListener("mousemove", this.onMove);
        this.view.dom.removeEventListener("mouseleave", this.onLeave);
        window.removeEventListener("pointermove", this.onDragMove);
        window.removeEventListener("pointerup", this.onDragEnd);
        this.handle.remove();
        this.indicator.remove();
      }

      lineTop(line: number): number {
        const { view } = this;
        const doc = view.state.doc;
        const pos = line >= doc.lines ? doc.length : doc.line(line + 1).from;
        const block = view.lineBlockAt(pos);
        const top = line >= doc.lines ? block.bottom : block.top;
        return top + view.documentTop - view.dom.getBoundingClientRect().top;
      }

      blockAtY(clientY: number): MarkdownBlock | null {
        const { view } = this;
        const content = view.contentDOM.getBoundingClientRect();
        const pos = view.posAtCoords({ x: content.left + 40, y: clientY }, false);
        const line = view.state.doc.lineAt(pos).number - 1;
        return findBlock(docLines(view.state.doc), line);
      }

      onMove = (event: MouseEvent) => {
        if (this.dragging || this.handle.contains(event.target as Node)) return;
        const block = this.blockAtY(event.clientY);
        if (!block) return;
        this.cancelHide();
        this.block = block;
        const content = this.view.contentDOM.getBoundingClientRect();
        const dom = this.view.dom.getBoundingClientRect();
        this.handle.style.top = `${this.lineTop(block.start)}px`;
        this.handle.style.left = `${content.left - dom.left - 44}px`;
        this.handle.hidden = false;
      };

      onLeave = () => {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => this.hide(), 250);
      };

      cancelHide = () => window.clearTimeout(this.hideTimer);

      hide() {
        this.handle.hidden = true;
        this.block = null;
      }

      onAdd = (event: Event) => {
        event.preventDefault();
        const { view, block } = this;
        if (!block) return;
        const doc = view.state.doc;
        const lastLine = doc.line(block.end);
        const lines = docLines(doc);
        // A list keeps going as a list; anything else gets a new paragraph.
        const listPrefix = block.kind === "list" ? lines[block.start].match(/^(\s*)([-*+]|\d+[.)])\s(\[[ xX/-]\]\s)?/)?.[0] : null;
        const insert = listPrefix ? `\n${listPrefix.replace(/\[[xX/-]\]/, "[ ]")}` : "\n\n/";
        view.dispatch({
          changes: { from: lastLine.to, insert },
          selection: { anchor: lastLine.to + insert.length },
          scrollIntoView: true,
          userEvent: "input.block",
        });
        view.focus();
        if (!listPrefix) startCompletion(view);
        this.hide();
      };

      onGripDown = (event: PointerEvent) => {
        if (event.button !== 0 || !this.block) return;
        event.preventDefault();
        this.dragging = { block: this.block, before: null, startY: event.clientY, moved: false };
        window.addEventListener("pointermove", this.onDragMove);
        window.addEventListener("pointerup", this.onDragEnd);
      };

      onDragMove = (event: PointerEvent) => {
        const drag = this.dragging;
        if (!drag) return;
        if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
        drag.moved = true;
        this.view.dom.classList.add("vault-block-dragging");
        const target = this.blockAtY(event.clientY);
        if (!target) return;
        const top = this.lineTop(target.start);
        const bottom = this.lineTop(target.end);
        const domTop = this.view.dom.getBoundingClientRect().top;
        const before = event.clientY - domTop < (top + bottom) / 2 ? target.start : target.end;
        drag.before = before;
        const content = this.view.contentDOM.getBoundingClientRect();
        const dom = this.view.dom.getBoundingClientRect();
        this.indicator.style.top = `${(before === target.start ? top : bottom) - 1}px`;
        this.indicator.style.left = `${content.left - dom.left}px`;
        this.indicator.style.width = `${content.width}px`;
        this.indicator.hidden = false;
      };

      onDragEnd = () => {
        window.removeEventListener("pointermove", this.onDragMove);
        window.removeEventListener("pointerup", this.onDragEnd);
        const drag = this.dragging;
        this.dragging = null;
        this.indicator.hidden = true;
        this.view.dom.classList.remove("vault-block-dragging");
        if (!drag) return;
        if (!drag.moved) {
          onOpenMenu({ view: this.view, block: drag.block, anchor: this.handle.getBoundingClientRect() });
          return;
        }
        if (drag.before === null) return;
        const lines = docLines(this.view.state.doc);
        replaceDocument(this.view, moveBlockWithSpacing(lines, drag.block, drag.before).join("\n"));
        this.hide();
      };
    },
  );
}
