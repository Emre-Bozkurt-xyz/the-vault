import { describe, expect, it } from "vitest";
import { highlightDiagnostics, type DiagnosticKind } from "./diagnostics";

const kinds = (line: { kind: DiagnosticKind; text: string }[]) => line.map((span) => `${span.kind}:${span.text}`);

const GHC = `Main.hs:3:59: warning: [GHC-18042] [-Wtype-defaults]
    • Defaulting the type variable ‘a0’ to type ‘Integer’
  |
3 |   putStrLn (show (filter odd [10 .. 20]))
  |                                  ^^^^`;

const GCC = `main.c: In function 'main':
main.c:1:22: error: 'undefined_thing' undeclared (first use in this function)
    1 | int main(void) { return undefined_thing; }
      |                         ^~~~~~~~~~~~~~~
main.c:1:22: note: each undeclared identifier is reported only once`;

const JAVAC = `Main.java:1: error: incompatible types: String cannot be converted to int
public class Main { public static void main(String[] a) { int x = "no"; } }
                                                                  ^
1 error`;

describe("highlightDiagnostics", () => {
  it("reproduces the input exactly", () => {
    for (const sample of [GHC, GCC, JAVAC, "", "plain\n\nlines"]) {
      const rebuilt = highlightDiagnostics(sample).map((line) => line.map((span) => span.text).join("")).join("\n");
      expect(rebuilt).toBe(sample);
    }
  });

  it("splits a GHC warning into location, severity, flags, excerpt and caret", () => {
    const lines = highlightDiagnostics(GHC);
    expect(kinds(lines[0])).toEqual([
      "location:Main.hs:3:59:", "text: ", "warning:warning:", "text: ", "flag:[GHC-18042]", "text: ", "flag:[-Wtype-defaults]",
    ]);
    expect(lines[1].map((span) => span.kind)).toEqual(["text"]);
    expect(kinds(lines[3])).toEqual(["gutter:3 |", "code:   putStrLn (show (filter odd [10 .. 20]))"]);
    // The caret is coloured by the diagnostic it belongs to.
    expect(lines[4].at(-1)).toEqual({ text: "^^^^", kind: "warning" });
  });

  it("handles gcc errors, notes and ~ underlines", () => {
    const lines = highlightDiagnostics(GCC);
    expect(lines[0].map((span) => span.kind)).toEqual(["text"]);
    expect(lines[1].slice(0, 3).map((span) => span.kind)).toEqual(["location", "text", "error"]);
    expect(lines[3].at(-1)).toEqual({ text: "^~~~~~~~~~~~~~~", kind: "error" });
    expect(lines[4][2]).toEqual({ text: "note:", kind: "note" });
  });

  it("handles javac's gutterless excerpt, caret and tally", () => {
    const lines = highlightDiagnostics(JAVAC);
    expect(lines[0][2]).toEqual({ text: "error:", kind: "error" });
    expect(lines[1].map((span) => span.kind)).toEqual(["text"]);
    expect(lines[2].at(-1)).toEqual({ text: "^", kind: "error" });
    expect(lines[3]).toEqual([{ text: "1 error", kind: "flag" }]);
  });

  it("does not treat the word 'error' inside a message as a new diagnostic", () => {
    const lines = highlightDiagnostics("    • this is not an error: really");
    expect(lines[0].map((span) => span.kind)).toEqual(["text"]);
  });
});
