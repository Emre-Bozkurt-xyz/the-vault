import { describe, expect, it } from "vitest";

import { linkForPastedUrl } from "@/components/markdown/paste-link";

describe("linkForPastedUrl", () => {
  it("links the selected words", () => {
    expect(linkForPastedUrl("the docs", "https://example.com/a?b=1")).toBe("[the docs](https://example.com/a?b=1)");
    expect(linkForPastedUrl(" the docs ", " https://example.com \n")).toBe(" [the docs](https://example.com) ");
  });

  it("wraps URLs with parentheses in angle brackets", () => {
    expect(linkForPastedUrl("wiki", "https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "[wiki](<https://en.wikipedia.org/wiki/Foo_(bar)>)",
    );
  });

  it("leaves other pastes alone", () => {
    expect(linkForPastedUrl("", "https://example.com")).toBeNull();
    expect(linkForPastedUrl("words", "not a url")).toBeNull();
    expect(linkForPastedUrl("https://old.example", "https://new.example")).toBeNull();
    expect(linkForPastedUrl("two\nlines", "https://example.com")).toBeNull();
    expect(linkForPastedUrl("[already](x)", "https://example.com")).toBeNull();
  });
});
