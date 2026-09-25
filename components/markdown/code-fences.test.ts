import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { codeFenceAt, codeFenceLineNumbers, codeLanguageChange, formattedCodeChange } from "./code-fences";
import { fencedCodeLanguage } from "./code-languages";
import { codeLanguages, resolveCodeLanguage } from "@/lib/code/languages";

const stateFor = (doc: string) => EditorState.create({ doc, extensions: [markdown(), history()] });

describe("code fence editing", () => {
  it.each([
    ["```js\nconst x=1\n```", "const x=1", ""],
    ["~~~~ts title=test\nconst x=1\n~~~~", "const x=1", ""],
    ["> ```js\n> const x=1\n> ```", "const x=1", "> "],
    ["- item\n\n  ```js\n  const x=1\n  ```", "const x=1", "  "],
    ["- ```js\n  const x=1\n  ```", "const x=1", "  "],
    ["```js\n```", "", ""],
  ])("formats the body while retaining containers: %s", (doc, source, prefix) => {
    const state = stateFor(doc);
    const block = codeFenceAt(state, doc.lastIndexOf("```") >= 0 ? doc.length - 1 : 5)!;
    expect(block).not.toBeNull();
    expect(block.source).toBe(source);
    expect(block.formatError).toBeUndefined();
    const change = formattedCodeChange(state, state, block, "const x = 1;\n");
    const result = state.update({ changes: change }).state.doc.toString();
    expect(result).toBe(doc.slice(0, block.bodyFrom) + prefix + "const x = 1;\n" + doc.slice(block.bodyTo));
  });

  it("keeps shorter fences and Markdown-looking lines inside a longer fence", () => {
    const doc = "````markdown\n```js\n# literal\n```\n````\nafter";
    const state = stateFor(doc);
    expect(codeFenceAt(state, doc.indexOf("literal"))?.source).toBe("```js\n# literal\n```");
    expect([...codeFenceLineNumbers(state).all]).toEqual([1, 2, 3, 4, 5]);
    // Only the outer ```` pair delimits; the inner ``` lines are literal content.
    expect([...codeFenceLineNumbers(state).marks]).toEqual([1, 5]);
    expect(codeFenceAt(state, doc.length)).toBeNull();
  });

  it("reports delimiter lines for tilde, nested and unclosed fences", () => {
    expect([...codeFenceLineNumbers(stateFor("~~~py\nx = 1\n~~~")).marks]).toEqual([1, 3]);
    expect([...codeFenceLineNumbers(stateFor("> ```js\n> const x=1\n> ```")).marks]).toEqual([1, 3]);
    expect([...codeFenceLineNumbers(stateFor("```js\nconst x=1")).marks]).toEqual([1]);
    // An indented code block has no delimiters to hide.
    const indented = codeFenceLineNumbers(stateFor("text\n\n    const x=1\n"));
    expect([...indented.all]).toEqual([3]);
    expect([...indented.marks]).toEqual([]);
  });

  it("never treats inline code as a fenced block", () => {
    expect(codeFenceAt(stateFor("text `const x=1`"), 10)).toBeNull();
  });

  it("rejects unclosed and ambiguously indented fences", () => {
    const open = stateFor("```js\nconst x=1");
    expect(codeFenceAt(open, open.doc.length)?.formatError).toContain("Close");
    const mixed = stateFor("  ```js\nconst x=1\n```");
    expect(codeFenceAt(mixed, 10)?.formatError).toContain("indentation");
  });

  it("rejects stale results even if the user changes source and then changes it back", () => {
    const original = stateFor("```js\nconst x=1\n```");
    const block = codeFenceAt(original, 9)!;
    const changed = original.update({ changes: { from: 6, insert: " " } }).state;
    const reverted = changed.update({ changes: { from: 6, to: 7 } }).state;
    expect(() => formattedCodeChange(original, reverted, block, "const x = 1;\n")).toThrow("changed");
  });

  it("rejects output which introduces a closing fence", () => {
    const state = stateFor("```js\nconst x=1\n```");
    expect(() => formattedCodeChange(state, state, codeFenceAt(state, 9)!, "```\n")).toThrow("close");
  });

  it("isolates formatting from the previous local undo event", () => {
    let state = stateFor("```js\nconst x=1\n```");
    state = state.update({ changes: { from: 14, insert: "\n" }, annotations: Transaction.userEvent.of("input.type") }).state;
    const before = state.doc.toString();
    state = state.update({ changes: formattedCodeChange(state, state, codeFenceAt(state, 9)!, "const x = 1;\n"), annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.format")] }).state;
    undo({ state, dispatch: (transaction) => { state = transaction.state; } });
    expect(state.doc.toString()).toBe(before);
  });
});

describe("changing a fence's language", () => {
  const relabel = (doc: string, language: string, at = 7) => {
    const state = stateFor(doc);
    const fence = codeFenceAt(state, at)!;
    return state.update({ changes: codeLanguageChange(fence, language) }).state.doc.toString();
  };

  it.each([
    ["```js\nx\n```", "python", "```python\nx\n```"],
    ["```\nx\n```", "python", "```python\nx\n```"],
    ["~~~js\nx\n~~~", "python", "~~~python\nx\n~~~"],
    ["> ```js\n> x\n> ```", "python", "> ```python\n> x\n> ```"],
  ])("rewrites the hint in %s", (doc, language, expected) => {
    expect(relabel(doc, language, doc.indexOf("x"))).toBe(expected);
  });

  it("preserves fence metadata after the language word", () => {
    expect(relabel("```js title=example\nx\n```", "python", 21))
      .toBe("```python title=example\nx\n```");
  });

  it("clears the hint, and its separating space, back to plain text", () => {
    expect(relabel("```js\nx\n```", "", 7)).toBe("```\nx\n```");
    expect(relabel("```js title=example\nx\n```", "", 21))
      .toBe("``` title=example\nx\n```");
  });

  it("does not disturb the body or the closing fence", () => {
    const doc = "```js\nconst ```x = 1;\n```\ntrailing";
    expect(relabel(doc, "typescript", doc.indexOf("const")))
      .toBe("```typescript\nconst ```x = 1;\n```\ntrailing");
  });
});

describe("shared language catalog", () => {
  it.each(["py", "JS", "c++", "cs", "c#", "hs", "tsx"])("resolves aliases and the info string: %s", (alias) => {
    expect(resolveCodeLanguage(alias + " title=example")).toBeDefined();
    expect(fencedCodeLanguage(alias)).not.toBeNull();
  });
  it("does not guess unknown or plain text languages", () => {
    for (const hint of ["", "txt", "text", "not-a-language"]) expect(fencedCodeLanguage(hint)).toBeNull();
  });
  it.each(codeLanguages)("loads the $label editor grammar", async (language) => {
    expect(await fencedCodeLanguage(language.id)!.load()).toBeDefined();
  });
});
