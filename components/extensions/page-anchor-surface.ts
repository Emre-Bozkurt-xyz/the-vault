import { createAnchorNotifier } from "@/components/extensions/anchor-surface-notifier";
import type { OverlayAnchorSurface } from "@/lib/extension-api/anchors";

type Block = { element: HTMLElement; start: number; end: number };

/**
 * Overlay anchoring on a rendered page (read view, public page): lines are
 * found through the `data-source-line` / `data-source-end` tags
 * `MarkdownDocument` puts on the document's blocks. A line inside a block
 * (a paragraph's third source line) is placed proportionally within it.
 *
 * `content` holds the document; `frame` is the element whose size follows
 * it (the overlay host), watched for reflow.
 */
export function createPageAnchorSurface(
  content: HTMLElement,
  frame: HTMLElement,
  markdown: string,
): OverlayAnchorSurface {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let cached: Block[] | null = null;

  const notifier = createAnchorNotifier((notify) => {
    const changed = () => {
      cached = null;
      notify();
    };
    const resize = new ResizeObserver(changed);
    resize.observe(frame);
    const mutations = new MutationObserver(changed);
    mutations.observe(content, { childList: true, subtree: true, characterData: true });
    // Images and fonts settle after the first paint.
    content.addEventListener("load", changed, true);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      content.removeEventListener("load", changed, true);
    };
  });

  function blocks(): Block[] {
    if (cached) return cached;
    const found: Block[] = [];
    for (const element of content.querySelectorAll<HTMLElement>("[data-source-line]")) {
      // Skip anything not laid out (collapsed details, hidden blocks).
      if (element.getClientRects().length === 0) continue;
      const start = Number(element.dataset.sourceLine);
      const end = Number(element.dataset.sourceEnd ?? start);
      if (!Number.isFinite(start)) continue;
      found.push({ element, start, end: Number.isFinite(end) ? Math.max(end, start) : start });
    }
    cached = found;
    return found;
  }

  /** The innermost block holding `line`: the latest start, then the deepest (later in document order). */
  function blockAt(line: number): Block | null {
    let best: Block | null = null;
    for (const block of blocks()) {
      if (block.start <= line && line <= block.end && (!best || block.start >= best.start)) best = block;
    }
    return best;
  }

  return {
    kind: "page",
    lines: () => lines,
    lineTop(line) {
      const block = blockAt(line);
      if (block) {
        const rect = block.element.getBoundingClientRect();
        if (line === block.start) return rect.top;
        return rect.top + (rect.height * (line - block.start)) / (block.end - block.start + 1);
      }
      // Between blocks (a blank line): just under the block before it, else
      // just above the next one.
      let before: Block | null = null;
      let after: Block | null = null;
      for (const candidate of blocks()) {
        if (candidate.end < line && (!before || candidate.end >= before.end)) before = candidate;
        if (candidate.start > line && (!after || candidate.start < after.start)) after = candidate;
      }
      if (before) return before.element.getBoundingClientRect().bottom;
      if (after) return after.element.getBoundingClientRect().top;
      return null;
    },
    lineAt(clientY) {
      // The nearest block starting above the point; an item is anchored to
      // the top of the block it sits beside.
      let best: Block | null = null;
      for (const block of blocks()) {
        if (block.element.getBoundingClientRect().top > clientY) continue;
        if (!best || block.start >= best.start) best = block;
      }
      return (best ?? blocks()[0])?.start ?? null;
    },
    measured: () => true,
    subscribe: notifier.subscribe,
    version: notifier.version,
  };
}
