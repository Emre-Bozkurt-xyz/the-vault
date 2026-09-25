/**
 * Colouring for compiler diagnostics, done here rather than by the compilers.
 *
 * GCC and GHC can emit colour themselves, but only as terminal escape codes,
 * and every escape code is stripped from job output on purpose (see
 * `inertOutput`): it is what stops a program from forging links or rewriting
 * the panel. Re-admitting a subset of escapes would reopen that surface, and
 * javac never colours its output anyway. So the text is parsed instead — the
 * three toolchains share one shape — and the editor renders each piece as a
 * plain span with a class. Nothing here produces markup.
 *
 * The shape, as GHC, gcc/g++ and javac all print it:
 *
 *   Main.hs:3:59: warning: [GHC-18042] [-Wtype-defaults]   location, severity, flags
 *       • Defaulting the type variable …                    message
 *     |
 *   3 |   putStrLn (… show (filter odd [10 .. 20]))          gutter + source excerpt
 *     |                                  ^^^^                gutter + caret
 */

export type DiagnosticKind =
  | "text"
  | "location"
  | "error"
  | "warning"
  | "note"
  | "flag"
  | "gutter"
  | "code"
  | "caret";

export type DiagnosticSpan = { text: string; kind: DiagnosticKind };

type Severity = "error" | "warning" | "note";

// `path.ext:line[:col[-col]]:` — optionally a Windows drive letter first.
const LOCATION = /^((?:[A-Za-z]:)?[^\s:][^:\n]*?\.[A-Za-z0-9]+:\d+(?::\d+(?:-\d+)?)?:)/;
const SEVERITY = /^(\s*)(fatal error|error|warning|note|info)(:?)/i;
// A source excerpt: optional line number, then a `|` gutter.
const GUTTER = /^(\s*\d*\s*\|)(.*)$/;
// A caret line: optional gutter, then only ^ ~ and spaces (javac has no gutter).
const CARET = /^(\s*\d*\s*\|)?(\s*)([\^~][\^~\s]*)$/;
const FLAG = /\[[^\]\n]+\]/g;
// javac's closing tally, e.g. "2 warnings" or "1 error".
const TALLY = /^\s*\d+ (?:errors?|warnings?)\s*$/i;

function severityOf(word: string): Severity {
  const lower = word.toLowerCase();
  if (lower.includes("error")) return "error";
  if (lower === "warning") return "warning";
  return "note";
}

/** Split a message into flag and plain-text pieces. */
function withFlags(text: string, spans: DiagnosticSpan[]) {
  let last = 0;
  for (const match of text.matchAll(FLAG)) {
    if (match.index! > last) spans.push({ text: text.slice(last, match.index), kind: "text" });
    spans.push({ text: match[0], kind: "flag" });
    last = match.index! + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), kind: "text" });
}

/** One array of spans per line. Joining every span's text reproduces the input. */
export function highlightDiagnostics(output: string): DiagnosticSpan[][] {
  // Carets take the colour of the diagnostic they point into.
  let current: Severity = "error";
  return output.split("\n").map((line) => {
    const spans: DiagnosticSpan[] = [];
    if (!line) return spans;

    const caret = CARET.exec(line);
    if (caret && line.trim() !== "|") {
      const [, gutter = "", pad, marks] = caret;
      if (gutter) spans.push({ text: gutter, kind: "gutter" });
      if (pad) spans.push({ text: pad, kind: "text" });
      spans.push({ text: marks, kind: current === "note" ? "caret" : current });
      return spans;
    }

    const gutter = GUTTER.exec(line);
    if (gutter) {
      spans.push({ text: gutter[1], kind: "gutter" });
      if (gutter[2]) spans.push({ text: gutter[2], kind: "code" });
      return spans;
    }

    if (TALLY.test(line)) return [{ text: line, kind: "flag" }];

    let rest = line;
    const location = LOCATION.exec(rest);
    if (location) {
      spans.push({ text: location[1], kind: "location" });
      rest = rest.slice(location[1].length);
    }
    // A severity word only counts at the head of a diagnostic: straight after
    // a location, or at the very start of a line ("error: …" from a tool).
    const severity = location || !/^\s/.test(line) ? SEVERITY.exec(rest) : null;
    if (severity) {
      current = severityOf(severity[2]);
      if (severity[1]) spans.push({ text: severity[1], kind: "text" });
      spans.push({ text: severity[2] + severity[3], kind: current });
      rest = rest.slice(severity[0].length);
    }
    withFlags(rest, spans);
    return spans;
  });
}
