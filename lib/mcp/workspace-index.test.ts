import { describe, expect, it } from "vitest";

import {
  countLines,
  documentPath,
  documentPreview,
  outlineWithLines,
  parseSearchTerms,
  scoreDocument,
} from "@/lib/mcp/workspace-index";

describe("documentPath", () => {
  it("joins folder path and title, or returns the bare title at the root", () => {
    expect(documentPath("Courses/CS101", "Todo")).toBe("Courses/CS101/Todo");
    expect(documentPath(null, "Todo")).toBe("Todo");
  });
});

describe("parseSearchTerms", () => {
  it("splits on whitespace, keeps quoted phrases, lowercases, dedupes", () => {
    expect(parseSearchTerms('CS101 "lab report" todo todo')).toEqual([
      "cs101",
      "lab report",
      "todo",
    ]);
    expect(parseSearchTerms("   ")).toEqual([]);
  });
});

describe("scoreDocument", () => {
  const cs101 = {
    title: "Todo",
    folderPath: "Courses/CS101",
    markdown: "# Todo\n\n- [ ] read chapter 3\n- [ ] lab report",
  };
  const ma201 = {
    title: "Todo",
    folderPath: "Courses/MA201",
    markdown: "# Todo\n\n- [ ] problem set",
  };

  it("matches a term through the folder path, telling same-named docs apart", () => {
    expect(scoreDocument(cs101, ["cs101", "todo"])).not.toBeNull();
    expect(scoreDocument(ma201, ["cs101", "todo"])).toBeNull();
  });

  it("requires every term", () => {
    expect(scoreDocument(cs101, ["todo", "calculus"])).toBeNull();
  });

  it("ranks a title hit above a body-only hit", () => {
    const titled = scoreDocument(cs101, ["todo"])!;
    const bodyOnly = scoreDocument(
      { title: "Notes", folderPath: null, markdown: "remember the todo list" },
      ["todo"],
    )!;
    expect(titled.score).toBeGreaterThan(bodyOnly.score);
  });

  it("reports 1-based hit lines", () => {
    expect(scoreDocument(cs101, ["lab"])!.hits).toEqual([
      { line: 4, text: "- [ ] lab report" },
    ]);
  });

  it("clips a long hit line around the term", () => {
    const long = `${"x ".repeat(200)}needle${" y".repeat(200)}`;
    const [hit] = scoreDocument({ title: "t", folderPath: null, markdown: long }, ["needle"])!.hits;
    expect(hit!.text).toContain("needle");
    expect(hit!.text.length).toBeLessThanOrEqual(202);
  });
});

describe("outlineWithLines", () => {
  it("returns headings with 1-based lines, skipping fenced code", () => {
    const markdown = "# One\ntext\n```\n# not a heading\n```\n## Two";
    expect(outlineWithLines(markdown)).toEqual([
      { level: 1, text: "One", slug: "one", line: 1 },
      { level: 2, text: "Two", slug: "two", line: 6 },
    ]);
  });
});

describe("documentPreview and countLines", () => {
  it("skips frontmatter in the preview", () => {
    expect(documentPreview("---\ntags: [a]\n---\nHello   world")).toBe("Hello world");
  });

  it("counts lines the way line ranges do", () => {
    expect(countLines("a\r\nb\nc")).toBe(3);
  });
});
