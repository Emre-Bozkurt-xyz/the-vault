import { describe, expect, it } from "vitest";

import { inlineStyleToReactStyle, sanitizeInlineStyle } from "@/lib/html-style";

describe("sanitizeInlineStyle", () => {
  it("keeps allowlisted properties", () => {
    expect(sanitizeInlineStyle("color: red; text-align: center")).toBe(
      "color: red; text-align: center",
    );
  });

  it("drops unlisted properties", () => {
    expect(sanitizeInlineStyle("position: fixed; color: red")).toBe(
      "color: red",
    );
  });

  it("rejects declarations with url()/expression()/import/data/js", () => {
    expect(
      sanitizeInlineStyle("background: url(https://x/y)"),
    ).toBeUndefined();
    expect(sanitizeInlineStyle("width: expression(alert(1))")).toBeUndefined();
    expect(sanitizeInlineStyle("color: red; background: @import x")).toBe(
      "color: red",
    );
    expect(
      sanitizeInlineStyle("background-color: javascript:alert(1)"),
    ).toBeUndefined();
  });

  it("returns undefined for non-strings and empty results", () => {
    expect(sanitizeInlineStyle(42)).toBeUndefined();
    expect(sanitizeInlineStyle("nonsense")).toBeUndefined();
    expect(sanitizeInlineStyle("")).toBeUndefined();
  });
});

describe("inlineStyleToReactStyle", () => {
  it("converts kebab-case to camelCase react style", () => {
    expect(inlineStyleToReactStyle("text-align: center; color: red")).toEqual({
      textAlign: "center",
      color: "red",
    });
  });

  it("passes through existing object styles", () => {
    const style = { color: "red" };
    expect(inlineStyleToReactStyle(style)).toBe(style);
  });

  it("returns undefined when nothing is allowed", () => {
    expect(inlineStyleToReactStyle("position: fixed")).toBeUndefined();
  });
});
