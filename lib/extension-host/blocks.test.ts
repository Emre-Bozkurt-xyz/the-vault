import { describe, expect, it } from "vitest";

import type { ExtensionBlockDefinition } from "@/lib/extension-host/blocks";
import {
  extensionBlocks,
  parseDirectiveAttributes,
  parseExtensionBlockLine,
  splitExtensionBlocks,
} from "@/lib/extension-host/blocks";

const blocks: ReadonlyMap<string, ExtensionBlockDefinition> = new Map([
  [
    "widget",
    { extensionId: "vault.widget", name: "widget", form: "leaf" },
  ],
]);

describe("parseDirectiveAttributes", () => {
  it("reads bare, quoted and flag attributes", () => {
    expect(parseDirectiveAttributes(`id=abc title="Two words" alt='x' open`)).toEqual({
      id: "abc",
      title: "Two words",
      alt: "x",
      open: "",
    });
  });
});

describe("parseExtensionBlockLine", () => {
  it("parses a claimed leaf directive with or without attributes", () => {
    expect(parseExtensionBlockLine("  :::widget{id=w1}  ", blocks)).toEqual({
      extensionId: "vault.widget",
      name: "widget",
      attributes: { id: "w1" },
      source: ":::widget{id=w1}",
    });
    expect(parseExtensionBlockLine(":::Widget", blocks)?.attributes).toEqual({});
  });

  it("ignores unclaimed names and anything else on the line", () => {
    expect(parseExtensionBlockLine(":::other{id=1}", blocks)).toBeNull();
    expect(parseExtensionBlockLine(":::widget{id=1} trailing", blocks)).toBeNull();
    expect(parseExtensionBlockLine("text :::widget", blocks)).toBeNull();
  });
});

describe("splitExtensionBlocks", () => {
  it("splits around blocks and keeps the Markdown between them", () => {
    expect(splitExtensionBlocks("# A\n:::widget{id=1}\ntext", blocks)).toEqual([
      { type: "markdown", markdown: "# A" },
      { type: "block", extensionId: "vault.widget", name: "widget", attributes: { id: "1" }, source: ":::widget{id=1}" },
      { type: "markdown", markdown: "text" },
    ]);
  });

  it("never treats a line inside fenced code as a block", () => {
    const markdown = "```md\n:::widget{id=1}\n```\n~~~\n:::widget\n~~~";
    expect(splitExtensionBlocks(markdown, blocks)).toEqual([
      { type: "markdown", markdown },
    ]);
  });
});

describe("installed extension blocks", () => {
  it("include the calendar anchor", () => {
    expect(parseExtensionBlockLine(":::calendar{id=abc123}")).toMatchObject({
      extensionId: "vault.calendar",
      attributes: { id: "abc123" },
    });
    expect(extensionBlocks.has("assets")).toBe(false);
  });
});

describe("container directives", () => {
  // `:::calc` opens a container that core renders until calc moves behind the
  // SDK; treating its opening line as a leaf block would orphan its body.
  it("are never host leaf blocks", () => {
    expect(parseExtensionBlockLine(":::calc")).toBeNull();
    expect(splitExtensionBlocks(":::calc\nrent = 1 CAD\n:::")).toEqual([
      { type: "markdown", markdown: ":::calc\nrent = 1 CAD\n:::" },
    ]);
  });
});
