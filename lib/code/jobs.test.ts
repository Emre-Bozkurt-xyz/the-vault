import { describe, expect, it } from "vitest";
import {
  boundOutputs,
  formatJobOutcome,
  inertOutput,
  isAllowedProgress,
  isValidRequestId,
  isWorkerReportableTerminal,
  survivesInertOutput,
  truncateUtf8,
  utf8Length,
  validateCodeJobInput,
} from "./jobs";
import { MAX_OUTPUT_BYTES, MAX_SOURCE_BYTES, MAX_STDIN_BYTES } from "@/lib/config/code-execution";

const valid = { requestId: "req_12345678", operation: "run", languageId: "python", source: "print(1)", stdin: "" };

describe("validateCodeJobInput", () => {
  it("accepts a well-formed run", () => {
    expect(validateCodeJobInput(valid)).toBeNull();
  });

  it.each([
    [{ requestId: "short" }, "invalid_request_id"],
    [{ requestId: "has spaces in it" }, "invalid_request_id"],
    [{ requestId: "x".repeat(65) }, "invalid_request_id"],
    [{ operation: "compile" }, "invalid_operation"],
    [{ languageId: "csharp" }, "unsupported_language"],
    // Highlighted, but there is no runtime for it.
    [{ languageId: "typescript" }, "unsupported_language"],
    [{ languageId: undefined }, "unsupported_language"],
    [{ source: "   \n  " }, "empty_source"],
    [{ source: "x".repeat(MAX_SOURCE_BYTES + 1) }, "source_too_large"],
    [{ stdin: "x".repeat(MAX_STDIN_BYTES + 1) }, "stdin_too_large"],
  ])("rejects %j as %s", (override, error) => {
    expect(validateCodeJobInput({ ...valid, ...override })).toBe(error);
  });

  it("measures size in UTF-8 bytes, not UTF-16 code units", () => {
    // 3 bytes each in UTF-8; the character count alone would slip under the limit.
    const wide = "€".repeat(Math.floor(MAX_SOURCE_BYTES / 3) + 1);
    expect(wide.length).toBeLessThan(MAX_SOURCE_BYTES);
    expect(validateCodeJobInput({ ...valid, source: wide })).toBe("source_too_large");
  });

  it("accepts every language slice 3 proved", () => {
    for (const languageId of ["python", "javascript", "java", "haskell", "c", "cpp"]) {
      expect(validateCodeJobInput({ ...valid, languageId })).toBeNull();
    }
  });

  it("does not let C# back in through the catalog", () => {
    for (const hint of ["csharp", "cs", "c#"]) {
      expect(validateCodeJobInput({ ...valid, languageId: hint })).toBe("unsupported_language");
    }
  });
});

describe("isValidRequestId", () => {
  it("accepts uuid-shaped ids", () => {
    expect(isValidRequestId("3f2c1b7e-9a4d-4c21-8f0e-1a2b3c4d5e6f")).toBe(true);
  });
  it("rejects anything that could reach a log line or a query", () => {
    for (const bad of [null, 42, "", "'; drop table code_jobs;--", "a/b/../c1234", "x\ny12345678"]) {
      expect(isValidRequestId(bad)).toBe(false);
    }
  });
});

describe("truncateUtf8", () => {
  it("leaves short text alone", () => {
    expect(truncateUtf8("hello", 10)).toEqual({ text: "hello", truncated: false });
  });

  it("never splits a multi-byte character", () => {
    // "é" is 2 bytes. Cutting at 3 bytes of "aéé" must drop the second é
    // entirely rather than leave half of it to decode as U+FFFD.
    const cut = truncateUtf8("aéé", 4);
    expect(cut.text).toBe("aé");
    expect(cut.truncated).toBe(true);
    expect(cut.text).not.toContain("�");
  });

  it("handles astral characters", () => {
    const cut = truncateUtf8("😀😀", 5);
    expect(cut.text).toBe("😀");
    expect(utf8Length(cut.text)).toBeLessThanOrEqual(5);
  });
});

describe("inertOutput", () => {
  it("strips colour and cursor-movement escapes", () => {
    expect(inertOutput("\u001b[31mred\u001b[0m and \u001b[2J\u001b[Hcleared")).toBe("red and cleared");
  });

  it("strips OSC sequences, including hyperlinks that could disguise a URL", () => {
    const link = "\u001b]8;;https://evil.example\u0007looks safe\u001b]8;;\u0007";
    expect(inertOutput(link)).toBe("looks safe");
    expect(inertOutput("\u001b]0;new window title\u0007x")).toBe("x");
  });

  it("keeps tabs, newlines and carriage returns but drops other controls", () => {
    expect(inertOutput("a\tb\r\nc\u0000d\u0007e\u007f")).toBe("a\tb\r\ncde");
  });

  it("leaves HTML-looking text as text — React escapes it, this does not need to", () => {
    expect(inertOutput("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("boundOutputs", () => {
  it("shares one byte budget across channels, compiler output first", () => {
    const huge = "x".repeat(MAX_OUTPUT_BYTES);
    const out = boundOutputs({ compilerOutput: "error: missing ;", stdout: huge, stderr: "" });
    expect(out.compilerOutput).toBe("error: missing ;");
    expect(out.truncated).toBe(true);
    expect(utf8Length(out.compilerOutput) + utf8Length(out.stdout) + utf8Length(out.stderr))
      .toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });

  it("neutralises escapes on every channel", () => {
    const out = boundOutputs({ compilerOutput: "\u001b[1mc", stdout: "\u001b[1ms", stderr: "\u001b[1me" });
    expect(out).toMatchObject({ compilerOutput: "c", stdout: "s", stderr: "e", truncated: false });
  });
});

describe("isAllowedProgress", () => {
  it("allows forward progress through a run", () => {
    expect(isAllowedProgress("run", "preparing", "running")).toBe(true);
    expect(isAllowedProgress("run", "preparing", "compiling")).toBe(true);
    expect(isAllowedProgress("run", "compiling", "running")).toBe(true);
  });

  it("refuses to move a job backwards or sideways", () => {
    expect(isAllowedProgress("run", "running", "compiling")).toBe(false);
    expect(isAllowedProgress("run", "running", "preparing")).toBe(false);
    expect(isAllowedProgress("run", "preparing", "formatting")).toBe(false);
  });

  it("keeps format jobs on their own path", () => {
    expect(isAllowedProgress("format", "preparing", "formatting")).toBe(true);
    expect(isAllowedProgress("format", "preparing", "running")).toBe(false);
  });

  it("never lets heartbeat jump to a terminal state", () => {
    expect(isAllowedProgress("run", "running", "succeeded")).toBe(false);
  });
});

describe("isWorkerReportableTerminal", () => {
  it("accepts terminal states and rejects in-flight or invented ones", () => {
    expect(isWorkerReportableTerminal("succeeded")).toBe(true);
    expect(isWorkerReportableTerminal("timed_out")).toBe(true);
    expect(isWorkerReportableTerminal("running")).toBe(false);
    expect(isWorkerReportableTerminal("queued")).toBe(false);
    expect(isWorkerReportableTerminal("exploded")).toBe(false);
  });
});

describe("survivesInertOutput", () => {
  it("keeps ordinary source, tabs and CRLF line endings", () => {
    expect(survivesInertOutput("int main() {\r\n\treturn 0;\r\n}\n")).toBe(true);
  });
  it("refuses source the output filter would change", () => {
    expect(survivesInertOutput("x = '\u001b[31m'")).toBe(false);
    expect(survivesInertOutput("page\fbreak")).toBe(false);
  });
});

describe("formatJobOutcome", () => {
  const result = (patch: Partial<{ compilerOutput: string; stdout: string; truncated: boolean }> = {}) =>
    ({ compilerOutput: "", stdout: "x = 1\n", truncated: false, ...patch });

  it("returns the formatted source from a clean success", () => {
    expect(formatJobOutcome({ state: "succeeded", result: result() })).toEqual({ ok: true, formatted: "x = 1\n" });
  });

  it("never applies a truncated result", () => {
    expect(formatJobOutcome({ state: "succeeded", result: result({ truncated: true }) }).ok).toBe(false);
  });

  it("never applies an empty result", () => {
    expect(formatJobOutcome({ state: "succeeded", result: result({ stdout: "\n" }) }).ok).toBe(false);
    expect(formatJobOutcome({ state: "succeeded", result: null }).ok).toBe(false);
  });

  it("surfaces the formatter's first line on a parse error", () => {
    const outcome = formatJobOutcome({
      state: "runtime_error",
      result: result({ stdout: "", compilerOutput: "\nerror: Failed to parse main.py:1:7: Expected ')'\n  |\n1 | print(\n" }),
    });
    expect(outcome).toEqual({ ok: false, message: "Could not format: error: Failed to parse main.py:1:7: Expected ')'" });
  });

  it("clips a long formatter message", () => {
    const outcome = formatJobOutcome({ state: "runtime_error", result: result({ compilerOutput: "e".repeat(500) }) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message.length).toBeLessThan(230);
  });

  it.each(["timed_out", "cancelled", "infrastructure_error", "resource_limit"] as const)("fails %s without text", (state) => {
    expect(formatJobOutcome({ state, result: result() }).ok).toBe(false);
  });
});
