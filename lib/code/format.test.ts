import { describe, expect, it } from "vitest";
import { formatCode } from "./format";
import { MAX_CODE_FORMAT_LENGTH } from "./languages";

describe("browser formatter", () => {
  it.each([
    ["js", "const x={a:1}", "const x = { a: 1 };\n"],
    ["ts", "const x:number=1", "const x: number = 1;\n"],
    ["tsx", "const x=<div a='b'/>", 'const x = <div a="b" />;\n'],
    ["json", '{"a":1}', '{ "a": 1 }\n'],
    ["css", "a{color:red}", "a {\n  color: red;\n}\n"],
    ["yaml", "a: [1,2]", "a: [1, 2]\n"],
    ["html", "<div><b>x</b></div>", "<div><b>x</b></div>\n"],
  ])("formats %s and is idempotent", async (language, source, expected) => {
    const formatted = await formatCode(source, language);
    expect(formatted).toBe(expected);
    expect(await formatCode(formatted, language)).toBe(formatted);
  });
  it("reports malformed source without a replacement", async () => {
    await expect(formatCode("const =", "js")).rejects.toThrow();
  });
  it("does not execute JavaScript while formatting", async () => {
    await expect(formatCode('throw new Error("must not execute")', "js")).resolves.toContain("throw new Error");
  });
  it("rejects unsupported languages and large source", async () => {
    await expect(formatCode("x=1", "python")).rejects.toThrow("not available");
    await expect(formatCode(" ".repeat(MAX_CODE_FORMAT_LENGTH + 1), "js")).rejects.toThrow("too large");
  });
});
