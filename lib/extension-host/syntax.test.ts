import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "@/lib/extension-api";
import { detectSyntaxExtensions } from "@/lib/extension-host/syntax";

function manifest(
  id: string,
  syntax: ExtensionManifest["syntax"],
): ExtensionManifest {
  return {
    id,
    name: id,
    version: 1,
    description: "",
    category: "editor",
    permissions: [],
    syntax,
  };
}

const manifests = [
  manifest("vault.calendar", { blocks: ["calendar"] }),
  manifest("vault.calc", { containers: ["calc"], inline: ["calc"] }),
  manifest("vault.diagram", { fences: ["mermaid"] }),
];

const detect = (markdown: string) =>
  [...detectSyntaxExtensions(markdown, manifests)].sort();

describe("detectSyntaxExtensions", () => {
  it("finds block, inline and fence claims", () => {
    expect(detect(":::calendar{id=abc}")).toEqual(["vault.calendar"]);
    expect(detect("Total :calc[rent * 3] here.")).toEqual(["vault.calc"]);
    expect(detect(":::calc\nrent = 1\n:::")).toEqual(["vault.calc"]);
    expect(detect("```mermaid\ngraph TD\n```")).toEqual(["vault.diagram"]);
  });

  it("ignores claims inside fenced code", () => {
    expect(detect("```md\n:::calendar{id=x}\n:calc[1]\n```")).toEqual([]);
    expect(detect("~~~\n:::calc\n~~~\nafter")).toEqual([]);
  });

  it("resumes after a fence closes", () => {
    expect(detect("```\ncode\n```\n:::calendar")).toEqual(["vault.calendar"]);
  });

  it("does not treat a longer or other-marker fence line as a close", () => {
    expect(detect("````\n```\n:::calendar\n````")).toEqual([]);
    expect(detect("```\n~~~\n:::calendar\n```")).toEqual([]);
  });

  it("does not match unclaimed names or lookalikes", () => {
    expect(detect(":::assets\n:::note")).toEqual([]);
    expect(detect("see https://x.test/a:calc[1] and a::calc[2]")).toEqual([]);
  });

  it("finds nothing when no extension declares syntax", () => {
    expect([...detectSyntaxExtensions(":::calendar", [])]).toEqual([]);
  });
});
