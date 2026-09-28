import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import {
  collectInlineDirectives,
  directiveRemarkPlugins,
  remarkInlineDirectives,
} from "@/lib/markdown/directives";
import { rehypeSanitizeContent, safeHtmlSchema } from "@/lib/markdown/sanitize";

const names = new Set(["calc"]);

/**
 * Integration guard for the rehype half of the inline-directive render path.
 *
 * `MarkdownDocument` maps the emitted element to `ExtensionInlineHost`, but
 * only if the element survives `rehypeSanitize` and `rehypeSanitizeContent`
 * first. Both are allowlists, so the natural failure is silent: the tag or its
 * key is dropped and every inline directive in every document renders as
 * nothing. Mirrors the plugin list in `MarkdownDocument.tsx`.
 */
function render(markdown: string): string {
  return unified()
    .use(remarkParse)
    .use(directiveRemarkPlugins)
    .use(remarkInlineDirectives, { names, keyPrefix: "0" })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, safeHtmlSchema)
    .use(rehypeSanitizeContent)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .processSync(markdown)
    .toString();
}

describe("the inline directive element survives sanitization", () => {
  it("keeps the tag and its key", () => {
    const html = render("Total :calc[1 + 1] today.");

    expect(html).toContain("<vault-extension-inline");
    expect(html).toContain('data-extension-key="0:0"');
  });

  it("keeps distinct keys for each occurrence", () => {
    const html = render(":calc[a] and :calc[b]");

    expect(html).toContain('data-extension-key="0:0"');
    expect(html).toContain('data-extension-key="0:1"');
  });

  it("emits no children, so bracket emphasis cannot reach the DOM", () => {
    const html = render(":calc[a * b * c]");

    expect(html).toContain("<vault-extension-inline");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("a * b * c");
  });

  it("leaves unclaimed directives as literal text", () => {
    // Adding remark-directive to the shared pipeline must not delete content.
    expect(render("See :foo[bar] here.")).toContain(":foo[bar]");
    expect(render(":::calendar{id=abc}\n:::")).toContain(":::calendar{id=abc}");
  });

  it("does not treat a directive inside inline code as an element", () => {
    const html = render("Write `:calc[1 + 1]` to compute.");

    expect(html).not.toContain("<vault-extension-inline");
    expect(html).toContain("<code>");
  });

  it("still strips a genuinely unknown tag from authored HTML", () => {
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

describe("collectInlineDirectives", () => {
  it("slices labels from the source, never from the parsed children", () => {
    expect(collectInlineDirectives("x :calc[a * b * c]{dp=2 as=USD} y", names)).toEqual([
      {
        name: "calc",
        source: ":calc[a * b * c]{dp=2 as=USD}",
        label: "a * b * c",
        attributes: { dp: "2", as: "USD" },
      },
    ]);
  });

  it("reports a directive without brackets with a null label", () => {
    expect(collectInlineDirectives(":calc{as=USD}", names)[0]?.label).toBeNull();
  });

  it("finds exactly what the render plugin keys, in the same order", () => {
    // A claimed directive nested inside an unclaimed one is restored as text by
    // the renderer, so the collector must not count it either.
    const markdown = "a :calc[1] :foo[:calc[2]] `:calc[3]` **:calc[4]**";

    expect(collectInlineDirectives(markdown, names).map((found) => found.label)).toEqual([
      "1",
      "4",
    ]);
    expect(render(markdown).match(/data-extension-key/g)).toHaveLength(2);
  });
});
