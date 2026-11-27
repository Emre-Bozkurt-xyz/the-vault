import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  deleteBlockTransaction,
  getMarkdownLiveBlocks,
  isBlockActive,
  isLiveSourceRevealed,
  liveRevealField,
  revealLiveSource,
  selectedLiveBlock,
} from "@/components/markdown/live-blocks";
import {
  findInlineObjectAt,
  formatExternalImageSource,
  isInsideHiddenSyntax,
  parseStandaloneImageLine,
} from "@/components/markdown/live-objects";

const assetId = "0b0e2a3c-1111-4222-8333-944455556666";

describe("findInlineObjectAt", () => {
  it("finds a markdown link and its visible label", () => {
    const text = "see [the docs](https://example.com) here";
    const link = findInlineObjectAt(text, 8);
    expect(link).toMatchObject({ kind: "link", from: 4, to: 35, labelFrom: 5, labelTo: 13 });
    expect(isInsideHiddenSyntax(link!, 20)).toBe(true);
    expect(isInsideHiddenSyntax(link!, 13)).toBe(false);
  });

  it("uses a wiki link's label as its visible text", () => {
    const text = `[[doc:${assetId}|Plans]]`;
    const link = findInlineObjectAt(text, text.length - 3);
    expect(link?.kind).toBe("wikiLink");
    expect(text.slice(link!.labelFrom, link!.labelTo)).toBe("Plans");
  });

  it("ignores links inside inline code", () => {
    expect(findInlineObjectAt("`[a](b)`", 3)).toBeNull();
  });

  it("finds inline external images", () => {
    expect(findInlineObjectAt("a ![[https://x.test/a.png]] b", 5)?.kind).toBe("image");
  });
});

describe("parseStandaloneImageLine", () => {
  it("parses asset embeds with attributes", () => {
    const image = parseStandaloneImageLine(`  ![[asset:${assetId}|Photo]]{width=small}`);
    expect(image?.variant).toBe("asset");
  });

  it("parses external wiki and markdown images", () => {
    expect(parseStandaloneImageLine("![[https://x.test/a.png|Alt]]")).toMatchObject({
      variant: "external",
      syntax: "wiki",
      alt: "Alt",
    });
    expect(parseStandaloneImageLine("![A cat](/api/assets/1/content)")).toMatchObject({
      variant: "external",
      syntax: "markdown",
      src: "/api/assets/1/content",
      alt: "A cat",
    });
  });

  it("rejects document embeds, unsafe URLs and images inside text", () => {
    expect(parseStandaloneImageLine("![[Some note]]")).toBeNull();
    expect(parseStandaloneImageLine("![x](javascript:alert(1))")).toBeNull();
    expect(parseStandaloneImageLine("text ![x](https://x.test/a.png)")).toBeNull();
  });

  it("rewrites alt text and URL in the author's syntax", () => {
    const wiki = parseStandaloneImageLine("![[https://x.test/a.png]]");
    const markdown = parseStandaloneImageLine("![old](https://x.test/a.png)");
    if (wiki?.variant !== "external" || markdown?.variant !== "external") throw new Error("parse");
    expect(formatExternalImageSource(wiki, { alt: "New" })).toBe("![[https://x.test/a.png|New]]");
    expect(formatExternalImageSource(markdown, { src: "https://x.test/b c.png" })).toBe(
      "![old](<https://x.test/b c.png>)",
    );
  });
});

function editor(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [liveRevealField],
  });
}

function apply(state: EditorState, spec: TransactionSpec) {
  return state.update(spec).state;
}

describe("Live reveal: rendered by default, source on intent", () => {
  const image = "![[https://x.test/a.png]]";
  const doc = `Intro\n${image}\nAfter`;
  const imageFrom = "Intro\n".length;
  const imageTo = imageFrom + image.length;

  it("selects, rather than reveals, a block the caret only arrives at", () => {
    const state = editor(doc, imageTo);
    const [block] = getMarkdownLiveBlocks(state);
    expect(block.kind).toBe("image");
    expect(isBlockActive(state, block)).toBe(false);
    expect(selectedLiveBlock(state)?.from).toBe(imageFrom);
  });

  it("does not reveal a block a selection covers whole", () => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [liveRevealField],
    });
    expect(isBlockActive(state, getMarkdownLiveBlocks(state)[0])).toBe(false);
  });

  it("reveals when the caret lands inside the source, until it leaves the block", () => {
    let state = editor(doc, 0);
    state = apply(state, { selection: EditorSelection.cursor(imageFrom + 4) });
    const block = getMarkdownLiveBlocks(state)[0];
    expect(isBlockActive(state, block)).toBe(true);

    // On the edge it stays revealed: the author is working on it.
    state = apply(state, { selection: EditorSelection.cursor(imageTo) });
    expect(isBlockActive(state, getMarkdownLiveBlocks(state)[0])).toBe(true);

    state = apply(state, { selection: EditorSelection.cursor(doc.length) });
    expect(isBlockActive(state, getMarkdownLiveBlocks(state)[0])).toBe(false);
  });

  it("reveals on request", () => {
    let state = editor(doc, imageTo);
    state = apply(state, { effects: revealLiveSource.of(imageFrom) });
    expect(isBlockActive(state, getMarkdownLiveBlocks(state)[0])).toBe(true);
  });

  it("reveals a block the author's typing creates", () => {
    let state = editor("![[https://x.test/a.png]", "![[https://x.test/a.png]".length);
    state = apply(state, {
      changes: { from: state.doc.length, insert: "]" },
      selection: EditorSelection.cursor(state.doc.length + 1),
      userEvent: "input.type",
    });
    expect(isBlockActive(state, getMarkdownLiveBlocks(state)[0])).toBe(true);
  });

  it("leaves a block rendered for edits that are not typing (toolbar, collaborators)", () => {
    let state = editor(doc, imageTo);
    state = apply(state, { changes: { from: imageFrom + 2, insert: "" } });
    state = apply(state, { changes: { from: 0, insert: "Hi " } });
    expect(isBlockActive(state, getMarkdownLiveBlocks(state)[0])).toBe(false);
  });

  it("keeps a link rendered while its label is edited, and reveals one being written", () => {
    const line = "go [here](https://x.test) now";
    let state = editor(line, 6);
    state = apply(state, {
      changes: { from: 6, insert: "r" },
      selection: EditorSelection.cursor(7),
      userEvent: "input.type",
    });
    expect(isLiveSourceRevealed(state, 3, 3 + "[herre](https://x.test)".length)).toBe(false);

    let typing = editor("go [here](https://x.test", "go [here](https://x.test".length);
    typing = apply(typing, {
      changes: { from: typing.doc.length, insert: ")" },
      selection: EditorSelection.cursor(typing.doc.length + 1),
      userEvent: "input.type",
    });
    expect(isLiveSourceRevealed(typing, 3, typing.doc.length)).toBe(true);

    // Typing on past it hides the syntax again.
    typing = apply(typing, {
      changes: { from: typing.doc.length, insert: " " },
      selection: EditorSelection.cursor(typing.doc.length + 1),
      userEvent: "input.type",
    });
    expect(isLiveSourceRevealed(typing, 3, typing.doc.length - 1)).toBe(false);
  });

  it("deletes a block with one of its line breaks", () => {
    const state = editor(doc, imageTo);
    const next = apply(state, deleteBlockTransaction(state, getMarkdownLiveBlocks(state)[0]));
    expect(next.doc.toString()).toBe("Intro\nAfter");
  });
});
