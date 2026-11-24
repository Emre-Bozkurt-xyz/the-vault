import type { EditorView } from "@codemirror/view";

const urlPattern = /^(https?:\/\/|mailto:)[^\s<>]+$/i;

/**
 * The Markdown link for pasting `pasted` over `selected`, or null when this
 * paste isn't "link these words": the clipboard must hold a single URL and
 * the selection a short run of words on one line that isn't itself a URL or
 * already a link.
 */
export function linkForPastedUrl(selected: string, pasted: string): string | null {
  const url = pasted.trim();
  if (!urlPattern.test(url)) return null;
  if (!selected.trim() || selected.includes("\n") || selected.length > 300) return null;
  if (urlPattern.test(selected.trim()) || /[[\]]/.test(selected)) return null;
  // Keep any spaces around the words outside the link.
  const lead = selected.match(/^\s*/)?.[0] ?? "";
  const trail = selected.match(/\s*$/)?.[0] ?? "";
  const words = selected.trim();
  const target = /[()\s]/.test(url) ? `<${url}>` : url;
  return `${lead}[${words}](${target})${trail}`;
}

/** Paste handler half: replaces the selection with a link when {@link linkForPastedUrl} applies. */
export function linkSelectionWithPastedUrl(view: EditorView, pasted: string): boolean {
  const { main } = view.state.selection;
  if (main.empty || view.state.selection.ranges.length > 1) return false;
  const insert = linkForPastedUrl(view.state.sliceDoc(main.from, main.to), pasted);
  if (!insert) return false;
  view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: main.from + insert.length },
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  return true;
}
