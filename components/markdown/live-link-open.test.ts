import { describe, expect, it } from "vitest";

import { findLinkAt } from "@/components/markdown/live-link-open";

describe("findLinkAt", () => {
  const line = "See [[Trip Notes#Day 1|the trip]], [the docs](https://example.com/a) and https://vault.example/x.";

  it("finds a wiki link with its fragment", () => {
    expect(findLinkAt(line, line.indexOf("the trip"))).toEqual({ kind: "wiki", target: "Trip Notes", fragment: "Day 1" });
  });

  it("finds a Markdown link's URL", () => {
    expect(findLinkAt(line, line.indexOf("the docs"))).toEqual({ kind: "url", url: "https://example.com/a" });
  });

  it("finds a bare URL without trailing punctuation", () => {
    expect(findLinkAt(line, line.indexOf("vault.example"))).toEqual({ kind: "url", url: "https://vault.example/x" });
  });

  it("finds in-app links, and is null away from links", () => {
    expect(findLinkAt("[local](/docs/x)", 2)).toEqual({ kind: "url", url: "/docs/x" });
    expect(findLinkAt("[odd](javascript:alert(1))", 2)).toBeNull();
    expect(findLinkAt(line, 1)).toBeNull();
  });
});
