import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { codeLanguageCompletionSource, codeLanguageCompletionSpec, openingFenceWordAt } from "./code-language-completions";

const stateFor = (doc: string) => EditorState.create({ doc, extensions: [markdown()] });

/** Apply choosing `languageId` with the cursor at `pos`; return the doc and selected text. */
function choose(doc: string, pos: number, languageId: string) {
  const state = stateFor(doc);
  const target = openingFenceWordAt(state, pos);
  if (!target) throw new Error("no target");
  const next = state.update(codeLanguageCompletionSpec(state, target, languageId)).state;
  const { from, to } = next.selection.main;
  return { doc: next.doc.toString(), selected: next.sliceDoc(from, to), cursor: from };
}

function optionsAt(doc: string, pos = doc.length, explicit = false) {
  const result = codeLanguageCompletionSource(new CompletionContext(stateFor(doc), pos, explicit));
  return result?.options.map((option) => option.label) ?? null;
}

describe("openingFenceWordAt", () => {
  it("finds the word being typed on an opening fence", () => {
    const target = openingFenceWordAt(stateFor("```hask"), 7);
    expect(target && { from: target.from, to: target.to, word: target.word }).toEqual({ from: 3, to: 7, word: "hask" });
  });

  it("ignores a closing fence, inline code and ordinary text", () => {
    expect(openingFenceWordAt(stateFor("```js\nx\n```"), 11)).toBeNull();
    expect(openingFenceWordAt(stateFor("use ```js inline"), 9)).toBeNull();
    expect(openingFenceWordAt(stateFor("python"), 6)).toBeNull();
  });

  it("only completes at the end of the line", () => {
    expect(openingFenceWordAt(stateFor("```js title=x"), 5)).toBeNull();
  });
});

describe("codeLanguageCompletionSource", () => {
  it("does not open for a bare fence unless asked", () => {
    expect(optionsAt("```")).toBeNull();
    expect(optionsAt("```", 3, true)?.length).toBeGreaterThan(10);
  });

  it("ranks an exact alias first", () => {
    expect(optionsAt("```js")?.[0]).toBe("javascript");
    expect(optionsAt("```py")?.[0]).toBe("python");
    expect(optionsAt("```hs")?.[0]).toBe("haskell");
  });

  it("filters by prefix of id, label or alias", () => {
    expect(optionsAt("```hask")).toEqual(["haskell"]);
    expect(optionsAt("```zzz")).toBeNull();
  });
});

describe("codeLanguageCompletionSpec", () => {
  it("closes a just-typed fence and inserts the starter program with the greeting selected", () => {
    const result = choose("```hask", 7, "haskell");
    expect(result.doc).toBe('```haskell\nmain :: IO ()\nmain = putStrLn "Hello, world!"\n```');
    expect(result.selected).toBe("Hello, world!");
  });

  it("closes the fence before text that follows it", () => {
    const result = choose("```py\nafter", 5, "python");
    expect(result.doc.endsWith('    main()\n```\nafter')).toBe(true);
  });

  it("fills an empty closed fence without adding a second delimiter", () => {
    const result = choose("```\n\n```", 3, "java");
    expect(result.doc).toBe("```java\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello, world!\");\n  }\n}\n```");
    expect(result.selected).toBe("Hello, world!");
  });

  it("leaves existing code alone and only changes the language", () => {
    expect(choose("```\nx = 1\n```", 3, "python").doc).toBe("```python\nx = 1\n```");
  });

  it("gives a language without a template an empty body to type into", () => {
    const result = choose("```js", 5, "json");
    expect(result.doc).toBe("```json\n\n```");
    expect(result.cursor).toBe(8);
  });

  it("keeps blockquote and list containers on every inserted line", () => {
    expect(choose("> ```hs", 7, "haskell").doc).toBe('> ```haskell\n> main :: IO ()\n> main = putStrLn "Hello, world!"\n> ```');
    expect(choose("- ```c", 6, "c").doc.split("\n").slice(1).every((line) => line === "" || line.startsWith("  "))).toBe(true);
  });
});
