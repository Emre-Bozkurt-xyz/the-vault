import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { localExtensionRegistry } from "@/lib/extensions/catalog";

import {
  createSlashCommandCompletionSource,
  type ExtensionSlashCommand,
} from "./slash-commands";

const source = createSlashCommandCompletionSource({
  applyFormat: () => {},
  insertBlock: () => {},
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
});
