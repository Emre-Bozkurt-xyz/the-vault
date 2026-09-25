import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type ChangeSpec } from "@codemirror/state";

export type CodeFence = {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  info: string;
  /** Range of the info string. Empty and collapsed just past `` ``` `` when a fence has none. */
  infoFrom: number;
  infoTo: number;
  source: string;
  prefix: string;
  delimiter: string;
  formatError?: string;
};

/** Resolve the containing Markdown node, even when the cursor is inside a mounted grammar. */
export function codeFenceAt(state: EditorState, position = state.selection.main.head): CodeFence | null {
  let node = syntaxTree(state).resolveInner(position, -1);
  while (node.name !== "FencedCode" && node.parent) node = node.parent;
  if (node.name !== "FencedCode") {
    node = syntaxTree(state).resolveInner(position, 1);
    while (node.name !== "FencedCode" && node.parent) node = node.parent;
  }
  if (node.name !== "FencedCode") return null;
  const marks = node.getChildren("CodeMark");
  const open = marks[0];
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
  if (!open) return null;
  const opener = state.doc.lineAt(open.from);
  const last = close ? state.doc.lineAt(close.from) : state.doc.lineAt(node.to);
  const infoNode = node.getChild("CodeInfo");
  const info = infoNode ? state.doc.sliceString(infoNode.from, infoNode.to) : "";
  const delimiter = state.doc.sliceString(open.from, open.to);
  const openPrefix = state.doc.sliceString(opener.from, open.from);
  const prefix = close ? state.doc.sliceString(last.from, close.from) : openPrefix;
  const bodyFrom = Math.min(opener.to + 1, state.doc.length);
  const bodyTo = close ? last.from : node.to;
  const raw = state.doc.sliceString(bodyFrom, bodyTo);
  const lines = raw ? raw.replace(/\n$/, "").split("\n") : [];
  // Normalize list markers on an opening line to their continuation indentation.
  const continuation = openPrefix.replace(/(?:[-+*]|\d+[.)])\s/g, (match) => " ".repeat(match.length));
  const consistent = continuation === prefix && !prefix.includes("\t") && lines.every((line) => line.startsWith(prefix) || !line.trim());
  return {
    from: node.from, to: node.to, bodyFrom, bodyTo, info, prefix, delimiter,
    infoFrom: infoNode ? infoNode.from : open.to, infoTo: infoNode ? infoNode.to : open.to,
    source: lines.map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join("\n"),
    formatError: !close ? "Close this code fence before formatting." : !consistent ? "This block has mixed Markdown indentation. Use consistent fence and body indentation to format it." : undefined,
  };
}

/** Conservative async guard: reject any intervening document edit, including remote edits. */
export function formattedCodeChange(snapshot: EditorState, current: EditorState, fence: CodeFence, formatted: string): ChangeSpec {
  if (current.doc !== snapshot.doc) throw new Error("The document changed while formatting. Please try again.");
  if (fence.formatError) throw new Error(fence.formatError);
  if (formatted.length > 256 * 1024) throw new Error("The formatted result is too large.");
  // Never let a formatter introduce a Markdown closing delimiter into its own body.
  const marker = fence.delimiter[0];
  const closing = new RegExp("^ {0,3}" + marker + "{" + fence.delimiter.length + ",}\\s*$", "m");
  if (closing.test(formatted)) throw new Error("The formatted code would close its Markdown fence. Use a longer fence and retry.");
  const body = formatted.replace(/\n$/, "");
  const insert = body ? body.split("\n").map((line) => fence.prefix + line).join("\n") + "\n" : "";
  return { from: fence.bodyFrom, to: fence.bodyTo, insert };
}

/**
 * Rewrite only the language word, leaving any fence metadata after it alone —
 * ```` ```js title=example ```` becomes ```` ```python title=example ````, not
 * ```` ```python ````. An empty `language` clears the hint back to plain text.
 */
export function codeLanguageChange(fence: CodeFence, language: string): ChangeSpec {
  const [, lead = "", word = ""] = fence.info.match(/^(\s*)(\S*)/) ?? [];
  const from = fence.infoFrom + lead.length;
  const to = from + word.length;
  // Clearing the only word would otherwise leave the separating space behind.
  if (!language && word && !fence.info.slice(lead.length + word.length).trim()) {
    return { from: fence.infoFrom, to: fence.infoTo, insert: "" };
  }
  return { from, to, insert: language };
}

export function formattedCodeSelection(fence: CodeFence, inserted: string) {
  return EditorSelection.cursor(fence.bodyFrom + Math.min(fence.prefix.length, inserted.length));
}

export type CodeFenceLines = {
  /** Every line of every fenced or indented code block. */
  all: Set<number>;
  /** Only the opening/closing delimiter lines of a fenced block. */
  marks: Set<number>;
};

/**
 * Both sets come from the parser in one walk. A `^```` line scan cannot tell a
 * real delimiter from a literal one nested inside a longer fence, and misses
 * tilde fences entirely.
 */
export function codeFenceLineNumbers(state: EditorState): CodeFenceLines {
  const all = new Set<number>();
  const marks = new Set<number>();
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
    const last = state.doc.lineAt(node.to).number;
    for (let line = state.doc.lineAt(node.from).number; line <= last; line++) all.add(line);
    if (node.name === "FencedCode") {
      for (const mark of node.node.getChildren("CodeMark")) marks.add(state.doc.lineAt(mark.from).number);
    }
    return false;
  } });
  return { all, marks };
}
