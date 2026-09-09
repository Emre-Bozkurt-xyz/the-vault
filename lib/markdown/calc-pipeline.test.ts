import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { calcRemarkPlugins, remarkCalc } from "@/lib/markdown/calc-directive";
import { rehypeSanitizeContent, safeHtmlSchema } from "@/lib/markdown/sanitize";

/**
 * Integration guard for the rehype half of the calc render path.
 *
 * `MarkdownDocument` maps a `<vault-calc>` element to the `CalcValue` component,
 * but that mapping only ever runs if the element survives `rehypeSanitize` and
 * `rehypeSanitizeContent` first. Both are allowlists, so the natural failure is
 * silent: the tag or its key is dropped and every computed value in every
 * document renders as nothing.
 *
 * Mirrors the plugin list in `MarkdownDocument.tsx`; if that list changes, this
 * should change with it.
 */
function render(markdown: string): string {
  return unified()
    .use(remarkParse)
    .use(calcRemarkPlugins)
    .use(remarkCalc, { keyPrefix: "0" })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, safeHtmlSchema)
    .use(rehypeSanitizeContent)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .processSync(markdown)
    .toString();
}

describe("the calc element survives sanitization", () => {
  it("keeps the tag and its lookup key", () => {
    const html = render("Total :calc[1 + 1] today.");

    expect(html).toContain("<vault-calc");
    expect(html).toContain('data-calc-key="0:0"');
  });

  it("keeps distinct keys for each occurrence", () => {
    const html = render(":calc[a] and :calc[b]");

    expect(html).toContain('data-calc-key="0:0"');
    expect(html).toContain('data-calc-key="0:1"');
  });

  it("emits no children, so bracket emphasis cannot reach the DOM", () => {
    const html = render(":calc[a * b * c]");

    expect(html).toContain("<vault-calc");
    expect(html).not.toContain("<em>");
    // The expression text itself must not be rendered either — the component
    // supplies the display value from the pre-computed result.
    expect(html).not.toContain("a * b * c");
  });

  it("leaves an unhandled directive as literal text", () => {
    // Adding remark-directive to the shared pipeline must not delete content.
    expect(render("See :foo[bar] here.")).toContain(":foo[bar]");
    expect(render(":::calendar{id=abc}\n:::")).toContain(":::calendar{id=abc}");
  });

  it("does not treat a :calc inside inline code as an element", () => {
    const html = render("Write `:calc[1 + 1]` to compute.");

    expect(html).not.toContain("<vault-calc");
    expect(html).toContain("<code>");
  });

  it("still strips a genuinely unknown tag from authored HTML", () => {
    // Confirms the schema addition was narrow: only `vault-calc` was allowed.
    const html = render("<vault-danger>x</vault-danger>");

    expect(html).not.toContain("<vault-danger");
  });

  it("keeps existing markdown rendering intact", () => {
    const html = render("# Title\n\n**bold** and `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |");

    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<table>");
  });
});
