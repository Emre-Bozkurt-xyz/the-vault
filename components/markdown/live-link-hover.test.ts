import { describe, expect, it } from "vitest";

import {
  findWikiLinkAt,
  isTitleLinkKey,
} from "@/components/markdown/live-link-hover";
import { wikiKeyForTarget } from "@/lib/wiki-links";

describe("findWikiLinkAt", () => {
  const line = "The handler must be [[Idempotence|idempotent]] on retry.";
  const start = line.indexOf("[[");
  const end = line.indexOf("]]") + 2;

  it("finds the link from anywhere inside it", () => {
    for (const offset of [start, start + 2, line.indexOf("idempotent"), end]) {
      expect(findWikiLinkAt(line, offset)).toEqual({
        target: "Idempotence",
        label: "idempotent",
      });
    }
  });

  it("returns null outside the link", () => {
    expect(findWikiLinkAt(line, 0)).toBeNull();
    expect(findWikiLinkAt(line, start - 1)).toBeNull();
    expect(findWikiLinkAt(line, end + 1)).toBeNull();
  });

  it("uses the target as the label when none is given", () => {
    expect(findWikiLinkAt("See [[Retry Policy]].", 8)).toEqual({
      target: "Retry Policy",
      label: "Retry Policy",
    });
  });

  it("splits a fragment off the target", () => {
    expect(findWikiLinkAt("See [[Idempotence#Formal statement]].", 10)).toEqual({
      target: "Idempotence",
      label: "Idempotence",
    });
  });

  it("ignores a transclusion, which is not a link", () => {
    expect(findWikiLinkAt("![[Some document]]", 6)).toBeNull();
  });

  it("picks the link the offset is actually in when a line has several", () => {
    const two = "[[First]] and [[Second]]";

    expect(findWikiLinkAt(two, 3)?.target).toBe("First");
    expect(findWikiLinkAt(two, 18)?.target).toBe("Second");
  });

  it("returns null for a line with no link", () => {
    expect(findWikiLinkAt("Just prose.", 4)).toBeNull();
    expect(findWikiLinkAt("", 0)).toBeNull();
  });
});

describe("isTitleLinkKey", () => {
  it("accepts a link that names a document by title", () => {
    expect(isTitleLinkKey(wikiKeyForTarget("Backpressure"))).toBe(true);
    expect(isTitleLinkKey(wikiKeyForTarget("Retry Policy#Limits"))).toBe(true);
  });

  it("rejects id, public and guide references, which are broken rather than creatable", () => {
    expect(
      isTitleLinkKey(wikiKeyForTarget("doc:11111111-1111-4111-8111-111111111111")),
    ).toBe(false);
    expect(
      isTitleLinkKey(wikiKeyForTarget("11111111-1111-4111-8111-111111111111")),
    ).toBe(false);
    expect(isTitleLinkKey(wikiKeyForTarget("public:some-slug"))).toBe(false);
    expect(isTitleLinkKey(wikiKeyForTarget("guide:getting-started"))).toBe(false);
  });

  it("rejects an empty title key", () => {
    expect(isTitleLinkKey("title:")).toBe(false);
  });
});
