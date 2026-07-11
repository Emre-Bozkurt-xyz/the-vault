import { describe, expect, it } from "vitest";

import { rankCommands, type RankableCommand } from "./command-ranking";

const commands: RankableCommand[] = [
  { slug: "publish", label: "Publish document", group: "This document", keywords: "public share web" },
  { slug: "unpublish", label: "Unpublish document", group: "This document", keywords: "private hide public" },
  { slug: "copy-link", label: "Copy public link", group: "This document", keywords: "url share clipboard" },
  { slug: "share", label: "Share document", group: "This document", keywords: "collaborators invite link access" },
  { slug: "settings", label: "Open settings", group: "Settings", keywords: "preferences config" },
  { slug: "home", label: "Go to workspace", group: "Go to", keywords: "workspace" },
];

function slugsFor(query: string): string[] {
  return rankCommands(commands, query).map((command) => command.slug);
}

describe("rankCommands", () => {
  it("returns every command unchanged for an empty query", () => {
    expect(rankCommands(commands, "")).toEqual(commands);
    expect(rankCommands(commands, "   ")).toEqual(commands);
  });

  it("ranks an exact slug match first", () => {
    expect(slugsFor("share")[0]).toBe("share");
  });

  it("ranks a token prefix above a mere substring or keyword hit", () => {
    // "pub" prefixes "publish"; it only appears mid-word / in keywords elsewhere.
    expect(slugsFor("pub")[0]).toBe("publish");
  });

  it("distinguishes a fully typed token from a prefix-sharing sibling", () => {
    // "unpublish" and "publish" both contain "publish"; typing the whole word
    // must not let the shorter sibling outrank the exact one.
    expect(slugsFor("unpublish")[0]).toBe("unpublish");
  });

  it("matches at word boundaries inside hyphenated/multi-word fields", () => {
    // "link" is a boundary hit in "copy-link" and in the label "... link".
    const ranked = slugsFor("link");
    expect(ranked).toContain("copy-link");
    expect(ranked).toContain("share");
    // The slug-boundary match (copy-link) outranks the label/keyword-only match.
    expect(ranked.indexOf("copy-link")).toBeLessThan(ranked.indexOf("share"));
  });

  it("excludes commands that do not contain every term", () => {
    expect(slugsFor("share zzz")).toEqual([]);
  });

  it("keeps declaration order for equally scored commands", () => {
    // Both match "document" only via their label at the same tier.
    const ranked = rankCommands(commands, "document").map((c) => c.slug);
    expect(ranked.indexOf("publish")).toBeLessThan(ranked.indexOf("unpublish"));
  });
});
