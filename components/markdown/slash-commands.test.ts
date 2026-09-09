import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { localExtensionRegistry } from "@/lib/extensions/catalog";

import {
  createDirectiveCompletionSource,
  createSlashCommandCompletionSource,
  type ExtensionSlashCommand,
} from "./slash-commands";

const source = createSlashCommandCompletionSource({
  applyFormat: () => {},
  insertBlock: () => {},
  insertInline: () => {},
});

/**
 * Builds a completion context from a document string where `‸` marks the cursor
 * and runs the given source against it. Forces a full markdown parse so
 * `syntaxTree`-based code exclusion is stable in the headless environment.
 */
function runSourceAt(
  withCursor: string,
  runner = source,
): CompletionResult | null {
  const pos = withCursor.indexOf("‸");
  if (pos < 0) {
    throw new Error("test document is missing a ‸ cursor marker");
  }

  const doc = withCursor.replace("‸", "");
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 5000);

  const result = runner(new CompletionContext(state, pos, false));
  return result as CompletionResult | null;
}

function displayLabels(result: CompletionResult | null): (string | undefined)[] {
  return (result?.options ?? []).map((option) => option.displayLabel);
}

/** The (hidden) searchable label CodeMirror fuzzy-matches the typed query against. */
function searchLabelFor(
  result: CompletionResult | null,
  displayLabel: string,
): string | undefined {
  return result?.options.find((option) => option.displayLabel === displayLabel)
    ?.label;
}

describe("slash command completion source", () => {
  it("opens at the start of a line and lists every command", () => {
    const result = runSourceAt("/‸");
    expect(result).not.toBeNull();
    expect(displayLabels(result)).toContain("Table");
    expect(displayLabels(result)).toContain("Heading 1");
    // `from` sits just past the slash so CodeMirror filters the query, not "/".
    expect(result?.from).toBe(1);
  });

  it("opens after whitespace mid-line, anchored just past the slash", () => {
    const result = runSourceAt("Some text /‸");
    expect(result).not.toBeNull();
    expect(result?.from).toBe("Some text /".length);
  });

  it("assigns no completion section, so ranking is pure fuzzy score", () => {
    // Sections would make CodeMirror order by section position, not match
    // quality (e.g. a fully typed "calendar" stuck under "Blocks").
    const result = runSourceAt("/‸");
    expect(result?.options.every((option) => option.section === undefined)).toBe(
      true,
    );
  });

  it("gives every item an icon type for the tooltip glyph", () => {
    const result = runSourceAt("/‸");
    expect(
      result?.options.every((option) => typeof option.type === "string"),
    ).toBe(true);
  });

  it("carries keywords in the hidden label so fuzzy matching can reach them", () => {
    const result = runSourceAt("/‸");
    // The visible name is short, but the label includes the token + keywords.
    expect(searchLabelFor(result, "Table")).toContain("grid");
    expect(searchLabelFor(result, "Callout")).toContain("note");
    expect(searchLabelFor(result, "Task list")).toContain("todo");
  });

  it("re-filters as the user types instead of reopening (stable selection)", () => {
    const result = runSourceAt("/tab‸");
    expect(result).not.toBeNull();
    // validFor keeps the same open completion alive so Enter/Tab keep a valid
    // selection; a trailing space ends the query and closes the menu.
    expect(result?.validFor).toBeInstanceOf(RegExp);
    const validFor = result?.validFor as RegExp;
    expect(validFor.test("table")).toBe(true);
    expect(validFor.test("table ")).toBe(false);
  });

  it("does not trigger on a slash inside a word", () => {
    expect(runSourceAt("either/or‸")).toBeNull();
  });

  it("does not trigger inside a URL", () => {
    expect(runSourceAt("see https://‸")).toBeNull();
  });

  it("does not trigger inside a leading frontmatter block", () => {
    expect(runSourceAt("---\ntags: /‸\n---\nbody")).toBeNull();
  });

  it("triggers on a body line below frontmatter", () => {
    expect(runSourceAt("---\ntitle: x\n---\n/‸")).not.toBeNull();
  });

  it("does not trigger inside a fenced code block", () => {
    expect(runSourceAt("```\n/‸\n```")).toBeNull();
  });

  it("does not trigger inside inline code", () => {
    expect(runSourceAt("`/‸`")).toBeNull();
  });
});

describe("extension slash commands", () => {
  const calendarCommand: ExtensionSlashCommand = {
    id: "vault.calendar.slash",
    label: "calendar",
    title: "Calendar",
    section: "Calendar",
    keywords: "month tasks events",
    insert: { markdown: "```calendar\nid: test\n```" },
  };

  it("appends enabled extension items after the core items", () => {
    const withExtension = createSlashCommandCompletionSource({
      applyFormat: () => {},
      insertBlock: () => {},
      insertInline: () => {},
      extensionCommands: [calendarCommand],
    });

    const result = runSourceAt("/‸", withExtension);
    expect(displayLabels(result)).toContain("Calendar");
    // The extension item carries its keywords into the fuzzy-match label.
    expect(searchLabelFor(result, "Calendar")).toContain("month");
    // Extension items get the shared extension icon glyph.
    const calendar = result?.options.find((o) => o.displayLabel === "Calendar");
    expect(calendar?.type).toBe("vault-extension");
    // Core items are still present and ordered first.
    const names = displayLabels(result);
    expect(names.indexOf("Table")).toBeLessThan(names.indexOf("Calendar"));
  });

  it("omits extension items when none are enabled", () => {
    // The default source has no extension commands.
    expect(displayLabels(runSourceAt("/‸"))).not.toContain("Calendar");
  });

  /**
   * Routing an insertion to the wrong helper is silent and destructive: an
   * inline `:calc[…]` sent through `insertBlock` gets `\n\n` prepended and a
   * `\n` appended, so "The total is /calc" becomes a broken paragraph with the
   * value stranded on its own line. These assert the two paths stay distinct.
   */
  describe("insertion placement", () => {
    function insertionFor(command: ExtensionSlashCommand) {
      const calls: Array<{ kind: string; text: string; offset: number | null }> =
        [];
      const record =
        (kind: string) => (_view: unknown, text: string, offset: number | null) =>
          void calls.push({ kind, text, offset });
      const runner = createSlashCommandCompletionSource({
        applyFormat: () => {},
        insertBlock: record("block"),
        insertInline: record("inline"),
        extensionCommands: [command],
      });
      const result = runSourceAt("The total is /‸", runner);
      const option = result?.options.find(
        (candidate) => candidate.displayLabel === command.title,
      );

      if (typeof option?.apply !== "function") {
        throw new Error(`no applicable option for ${command.title}`);
      }

      // `apply` dispatches once to drop the `/query`, then hands off to the
      // item's `run`; a stub view is enough because neither helper is real here.
      option.apply(
        { dispatch: () => {} } as never,
        option,
        "The total is /".length,
        "The total is /".length,
      );

      return calls;
    }

    it("sends a block contribution to insertBlock", () => {
      expect(insertionFor(calendarCommand)).toEqual([
        { kind: "block", text: "```calendar\nid: test\n```", offset: null },
      ]);
    });

    it("sends an inline contribution to insertInline, with its cursor offset", () => {
      expect(
        insertionFor({
          id: "vault.calc.slash",
          label: "calc",
          title: "Calc value",
          section: "Calc",
          insert: { markdown: ":calc[]", cursorOffset: 6, placement: "inline" },
        }),
      ).toEqual([{ kind: "inline", text: ":calc[]", offset: 6 }]);
    });
  });
});

describe("registry slash contributions", () => {
  it("exposes the calendar contribution tagged with its source extension", () => {
    const contributions = localExtensionRegistry.getSlashCommandContributions();
    const calendar = contributions.find(
      (contribution) => contribution.id === "vault.calendar.slash",
    );

    expect(calendar).toBeDefined();
    expect(calendar?.sourceExtensionId).toBe("vault.calendar");
    expect(calendar?.label).toBe("calendar");
    expect(typeof calendar?.insert.markdown).toBe("function");
  });

  it("declares a directive on the two contributions that open one", () => {
    // The `:::` menu is built from this field alone, so a missing declaration is
    // an item silently absent from a menu rather than a type error.
    const byId = new Map(
      localExtensionRegistry
        .getSlashCommandContributions()
        .map((contribution) => [contribution.id, contribution]),
    );

    expect(byId.get("vault.calc.slash-block")?.directive).toBe("calc");
    expect(byId.get("vault.calendar.slash")?.directive).toBe("calendar");
    // The inline value is not a block and must not be reachable from `:::`.
    expect(byId.get("vault.calc.slash")?.directive).toBeUndefined();
  });
});

describe("directive completion source", () => {
  const calcBlockCommand: ExtensionSlashCommand = {
    id: "vault.calc.slash-block",
    label: "calcblock",
    title: "Calc declarations",
    section: "Calc",
    keywords: "money variables",
    directive: "calc",
    insert: { markdown: ":::calc\n\n:::", cursorOffset: 8 },
  };

  const directiveSource = createDirectiveCompletionSource({
    applyFormat: () => {},
    insertBlock: () => {},
    insertInline: () => {},
    extensionCommands: [calcBlockCommand],
  });

  const run = (withCursor: string) => runSourceAt(withCursor, directiveSource);

  it("opens on a bare `:::` fence, anchored just past it", () => {
    const result = run(":::‸");
    expect(result).not.toBeNull();
    expect(displayLabels(result)).toContain("Calc declarations");
    // `from` past the fence so the typed name filters, not the colons.
    expect(result?.from).toBe(3);
  });

  it("keeps filtering while the directive name is typed", () => {
    const result = run(":::cal‸");
    expect(result).not.toBeNull();
    expect(result?.from).toBe(3);
    expect(displayLabels(result)).toContain("Calc declarations");
  });

  it("offers only items that open a directive block", () => {
    const labels = displayLabels(run(":::‸"));
    // Core items reachable from `/` but meaningless after `:::`.
    expect(labels).not.toContain("Table");
    expect(labels).not.toContain("Heading 1");
    // The one core item that *is* a directive.
    expect(labels).toContain("Asset group");
  });

  it("matches on the directive name, not the slash token", () => {
    // `/calcblock` vs `:::calc` — the fence menu is filtered by what follows the
    // colons, so the searchable label has to lead with the directive name.
    expect(searchLabelFor(run(":::‸"), "Calc declarations")).toMatch(/^calc\b/);
  });

  it("does not trigger on `:::` mid-sentence", () => {
    // A directive fence is line-level; three colons in prose are prose.
    expect(run("see :::‸")).toBeNull();
  });

  it("does not trigger inside a fenced code block", () => {
    expect(run("```\n:::‸\n```")).toBeNull();
  });

  it("does not trigger inside frontmatter", () => {
    expect(run("---\nx: :::‸\n---\nbody")).toBeNull();
  });

  /**
   * The hazard that makes this menu safe to type: inside a block body `:::` is
   * how you *close* the block, and an open menu would turn the Enter that
   * follows into a nested block insertion.
   */
  it("stays shut on the line that closes an open `:::calc`", () => {
    expect(run(":::calc\nrent = 1200 CAD\n:::‸")).toBeNull();
  });

  it("stays shut when the close is typed part-way down a body", () => {
    // The statements below are about to be orphaned, but the intent is still
    // "close this block" — never "open a nested one".
    expect(run(":::calc\nrent = 1200 CAD\n:::‸\ndomains = 42 CAD\n:::")).toBeNull();
  });

  it("opens again below a closed block", () => {
    expect(run(":::calc\nrent = 1200 CAD\n:::\n\n:::‸")).not.toBeNull();
  });

  it("clears the typed fence before inserting, so it cannot double up", () => {
    const inserted: Array<{ text: string; offset: number | null }> = [];
    const runner = createDirectiveCompletionSource({
      applyFormat: () => {},
      insertBlock: (_view, text, offset) => void inserted.push({ text, offset }),
      insertInline: () => {},
      extensionCommands: [calcBlockCommand],
    });
    const result = runSourceAt(":::cal‸", runner);
    const option = result?.options.find(
      (candidate) => candidate.displayLabel === "Calc declarations",
    );

    if (typeof option?.apply !== "function") {
      throw new Error("no applicable option for Calc declarations");
    }

    const dispatched: Array<{
      changes: { from: number; to: number };
      selection: { from: number; to: number };
    }> = [];
    option.apply(
      { dispatch: (spec: never) => void dispatched.push(spec) } as never,
      option,
      3,
      ":::cal".length,
    );

    // Reaches back over the three colons the author typed, leaving an empty line
    // with the cursor on it.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].changes).toEqual({ from: 0, to: 6 });
    expect(dispatched[0].selection.from).toBe(0);
    expect(dispatched[0].selection.to).toBe(0);
    // Then inserts the *same* markdown `/calcblock` would, cursor on the middle
    // line, ready for the first binding.
    expect(inserted).toEqual([{ text: ":::calc\n\n:::", offset: 8 }]);
  });
});
