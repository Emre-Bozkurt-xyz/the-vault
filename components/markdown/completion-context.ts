import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Text } from "@codemirror/state";

/**
 * Position tests shared by the editor's in-document completion sources.
 *
 * The `/` menu, the `:::` menu, and the `:calc` operand menu all have to answer
 * the same two questions before they open — "is this inside code?" and "is this
 * inside the Properties block?" — and all three must answer them the *same* way.
 * A source that disagreed would pop a menu over text another source considers
 * inert, which is how a document that merely *shows* syntax ends up having that
 * syntax completed at the author.
 */

/**
 * True when `pos` sits inside code, where markdown syntax is displayed rather
 * than meant. `InlineCode` counts as much as the fenced kinds: `` `:calc[…]` ``
 * is exactly how the docs quote the syntax without evaluating it.
 */
export function isInsideCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
    pos,
    -1,
  );

  while (node) {
    if (
      node.name === "FencedCode" ||
      node.name === "CodeBlock" ||
      node.name === "InlineCode"
    ) {
      return true;
    }
    node = node.parent;
  }

  return false;
}

/**
 * Line number of the closing `---` of a leading YAML frontmatter block, or `0`
 * when the document does not open with one. Mirrors the editor's own
 * frontmatter scan so no menu opens inside the Properties block.
 */
export function getFrontmatterEndLine(doc: Text): number {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
    return 0;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    if (doc.line(lineNumber).text.trim() === "---") {
      return lineNumber;
    }
  }

  return 0;
}
