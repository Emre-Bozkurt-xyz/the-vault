import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { codeLanguages } from "@/lib/code/languages";
import { codeTemplate } from "@/lib/code/templates";
import { codeFenceAt, type CodeFence } from "./code-fences";

/**
 * Language completion on a fence's opening line: typing ```` ```hask ```` offers
 * Haskell, and picking a language on a new, empty block also fills in a
 * starter program (`lib/code/templates.ts`). It rides the editor's existing
 * autocomplete, so it looks and behaves like every other menu.
 *
 * Two rules keep it from completing text the author meant literally:
 * - A bare ```` ``` ```` never opens the menu on its own. Otherwise typing a
 *   fence and pressing Enter would accept the first language and paste a
 *   template in. It opens once a letter is typed, or when asked for
 *   explicitly (the `/code` command and the toolbar button do that).
 * - An exact id or alias ranks first, so ```` ```js ```` means JavaScript, not
 *   JSON, even though both start with "js".
 */

// Blockquote and list-item prefixes, then the delimiter, then the word typed so far.
const OPENING = /^((?:[ \t]*>)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(`{3,}|~{3,})([\w+#.-]*)$/;

export type FenceWordTarget = {
  /** The language word being typed. */
  from: number;
  to: number;
  word: string;
  fence: CodeFence;
};

/** The opening fence's language word ending at `pos`, or null anywhere else. */
export function openingFenceWordAt(state: EditorState, pos: number): FenceWordTarget | null {
  const line = state.doc.lineAt(pos);
  // Only at the end of the line: completing into the middle of `title=…`
  // metadata would be a guess about what the author is editing.
  if (pos !== line.to) return null;
  const match = OPENING.exec(line.text);
  if (!match) return null;
  const [, lead, , word] = match;
  // A closing delimiter looks identical; it has to be the fence's first line.
  const fence = codeFenceAt(state, line.from + lead.length + 1);
  if (!fence || state.doc.lineAt(fence.from).number !== line.number) return null;
  return { from: pos - word.length, to: pos, word, fence };
}

/** A list marker on the opening line becomes plain indentation on the body. */
function continuation(openPrefix: string): string {
  return openPrefix.replace(/(?:[-+*]|\d+[.)])\s/g, (marker) => " ".repeat(marker.length));
}

function indentLines(text: string, prefix: string): string {
  // Blank lines keep a blockquote's `>` but not trailing spaces.
  return text.split("\n").map((line) => (line ? prefix + line : prefix.trimEnd())).join("\n");
}

/**
 * The edit for choosing `languageId` on `target`'s fence:
 * - an unclosed fence (the author just typed ```` ```lang ````) gets a body and
 *   its closing delimiter;
 * - an empty closed fence gets the starter program;
 * - a fence that already has code only has its language word replaced.
 */
export function codeLanguageCompletionSpec(
  state: EditorState,
  target: FenceWordTarget,
  languageId: string,
): TransactionSpec {
  const { fence, from, to } = target;
  const opening = state.doc.lineAt(fence.from);
  const shift = languageId.length - (to - from);
  const template = codeTemplate(languageId);
  const changes: ChangeSpec[] = [{ from, to, insert: languageId }];

  // Where the new body text starts after all changes, and what it contains.
  let bodyStart: number;
  let body: string;
  if (!fence.closed) {
    const prefix = continuation(state.sliceDoc(opening.from, fence.from));
    body = template ? indentLines(template.body, prefix) : prefix;
    changes.push({ from: opening.to, insert: `\n${body}\n${prefix}${fence.delimiter}` });
    bodyStart = opening.to + shift + 1;
  } else if (!fence.source.trim()) {
    body = template ? indentLines(template.body, fence.prefix) : fence.prefix;
    changes.push({ from: fence.bodyFrom, to: fence.bodyTo, insert: `${body}\n` });
    bodyStart = fence.bodyFrom + shift;
  } else {
    return {
      changes,
      selection: EditorSelection.cursor(to + shift),
      userEvent: "input.complete",
    };
  }

  const greeting = template ? body.indexOf(template.select) : -1;
  const selection = greeting >= 0
    ? EditorSelection.range(bodyStart + greeting, bodyStart + greeting + template!.select.length)
    : EditorSelection.cursor(bodyStart + body.length);
  return { changes, selection, userEvent: "input.complete", scrollIntoView: true };
}

function matches(language: (typeof codeLanguages)[number], word: string) {
  const names = [language.id, language.label.toLowerCase(), ...language.aliases];
  return {
    exact: names.includes(word),
    prefix: names.some((name) => name.startsWith(word)),
  };
}

export function codeLanguageCompletionSource(context: CompletionContext): CompletionResult | null {
  const target = openingFenceWordAt(context.state, context.pos);
  if (!target) return null;
  const word = target.word.toLowerCase();
  if (!word && !context.explicit) return null;

  const ranked = codeLanguages
    .map((language, index) => ({ language, index, ...matches(language, word) }))
    .filter((entry) => !word || entry.prefix)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.index - b.index);
  if (!ranked.length) return null;

  const options: Completion[] = ranked.map(({ language }) => ({
    label: language.id,
    displayLabel: language.label,
    detail: codeTemplate(language.id) ? "starter code" : undefined,
    type: "text",
    apply(view: EditorView, _completion: Completion, _from: number, applyTo: number) {
      const current = openingFenceWordAt(view.state, applyTo);
      if (current) view.dispatch(codeLanguageCompletionSpec(view.state, current, language.id));
    },
  }));

  // Filtering and ranking are done here, so CodeMirror must not re-filter by
  // its fuzzy label match — that is what put JSON above JavaScript for "js".
  return { from: target.from, to: target.to, options, filter: false };
}
