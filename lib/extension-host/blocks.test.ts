import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "@/lib/extension-api";
import type { ExtensionBlockDefinition } from "@/lib/extension-host/blocks";
import {
  buildDirectiveOwners,
  extensionBlocks,
  isInsideExtensionContainer,
  parseDirectiveAttributes,
  parseExtensionBlockLine,
} from "@/lib/extension-host/blocks";
import { planExtensionParts } from "@/lib/extension-host/plan";
import { createDirectivePlanState } from "@/lib/markdown/directive-occurrences";

const blocks: ReadonlyMap<string, ExtensionBlockDefinition> = new Map([
  ["widget", { extensionId: "vault.widget", name: "widget", form: "leaf" }],
  ["sum", { extensionId: "vault.sum", name: "sum", form: "container" }],
]);

function manifest(id: string, syntax: ExtensionManifest["syntax"]): ExtensionManifest {
  return { id, name: id, version: 1, description: "", category: "editor", permissions: [], syntax };
}

const owners = buildDirectiveOwners([
  manifest("vault.widget", { blocks: ["widget"] }),
  manifest("vault.sum", { containers: ["sum"], inline: ["sum"] }),
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

  it("ignores unclaimed names, containers and anything else on the line", () => {
    expect(parseExtensionBlockLine(":::other{id=1}", blocks)).toBeNull();
    expect(parseExtensionBlockLine(":::sum", blocks)).toBeNull();
    expect(parseExtensionBlockLine(":::widget{id=1} trailing", blocks)).toBeNull();
    expect(parseExtensionBlockLine("text :::widget", blocks)).toBeNull();
  });
});

describe("buildDirectiveOwners", () => {
  it("lets one extension claim a name as both container and inline", () => {
    expect(owners.container.get("sum")).toBe("vault.sum");
    expect(owners.inline.get("sum")).toBe("vault.sum");
  });

  it("rejects a leaf and a container sharing a name, and core names", () => {
    expect(() =>
      buildDirectiveOwners([
        manifest("vault.a", { blocks: ["x"] }),
        manifest("vault.b", { containers: ["x"] }),
      ]),
    ).toThrow(/claimed by both/);
    expect(() => buildDirectiveOwners([manifest("vault.a", { blocks: ["assets"] })])).toThrow(
      /core directive/,
    );
  });
});

describe("planExtensionParts", () => {
  it("splits leaf and container blocks and keys every occurrence in order", () => {
    const state = createDirectivePlanState();
    const parts = planExtensionParts(
      "Total :sum[a]\n:::widget{id=1}\n:::sum{collapsed}\na = 1\n:::\nthen :sum[a] and :sum[b]",
      state,
      owners,
    );

    expect(parts.map((part) => part.kind)).toEqual([
      "markdown",
      "leaf",
      "container",
      "markdown",
    ]);
    expect(parts[2]).toMatchObject({ key: "1", body: "a = 1", attributes: { collapsed: "" } });
    expect(state.occurrences.map((found) => [found.kind, found.key])).toEqual([
      ["inline", "0:0"],
      ["block", "1"],
      ["inline", "2:0"],
      ["inline", "2:1"],
    ]);
    expect(state.occurrences[0]).toMatchObject({ label: "a", source: ":sum[a]" });
  });

  it("numbers pieces across runs that share a state", () => {
    const state = createDirectivePlanState();
    planExtensionParts("one :sum[a]", state, owners);
    planExtensionParts("two :sum[b]", state, owners);

    expect(state.occurrences.map((found) => found.key)).toEqual(["0:0", "1:0"]);
  });

  it("never treats fenced code as a block, and leaves an unclosed container open", () => {
    const state = createDirectivePlanState();
    const fenced = "```md\n:::widget{id=1}\n:::sum\n```";

    expect(planExtensionParts(fenced, state, owners)).toEqual([
      { kind: "markdown", markdown: fenced, pieceIndex: 0 },
    ]);
    expect(planExtensionParts(":::sum\na = 1\nb = 2", state, owners)).toMatchObject([
      { kind: "container", body: "a = 1\nb = 2" },
    ]);
  });
});

describe("installed extensions", () => {
  it("include the calendar anchor and calc's container", () => {
    expect(parseExtensionBlockLine(":::calendar{id=abc123}")).toMatchObject({
      extensionId: "vault.calendar",
      attributes: { id: "abc123" },
    });
    expect(extensionBlocks.get("calc")?.form).toBe("container");
    expect(extensionBlocks.has("assets")).toBe(false);
  });

  it("count the closing fence of a container but not the opening one", () => {
    const text = "intro\n:::calc\nrent = 1 CAD\n:::\nafter";

    expect([1, 2, 3, 4, 5].map((line) => isInsideExtensionContainer(text, line))).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });
});
