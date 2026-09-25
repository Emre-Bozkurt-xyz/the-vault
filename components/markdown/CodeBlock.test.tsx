import { renderToStaticMarkup } from "react-dom/server.node";
import { describe, expect, it } from "vitest";
import { CodeBlock, InlineCode } from "./CodeBlock";

/**
 * `GET /api/embed/documents/:id/rendered` builds its HTML with
 * `renderToStaticMarkup` and serves it to clients that never hydrate it, so a
 * code block must degrade to something useful with no JavaScript at all.
 *
 * `CodeBlock` is the only part of the code-block pipeline whose output depends
 * on whether the render will hydrate — `rehypeCodeHighlight` is pure and is
 * covered by `lib/markdown/code-highlight.test.ts`. Rendering the whole
 * `MarkdownDocument` here is not an option: it reaches `auth.ts` transitively,
 * which cannot load under vitest (same constraint that keeps testable logic in
 * `lib/` rather than `server/`).
 */
const renderStatic = (info: string, source: string) =>
  renderToStaticMarkup(<CodeBlock info={info} source={source}>{source}</CodeBlock>);

describe("code block in a static (non-hydrating) render", () => {
  it("ships no Copy button, because nothing could ever wire it up", () => {
    const html = renderStatic("js", "const x = 1;");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Copy");
  });

  it("still labels the language and renders the source", () => {
    const html = renderStatic("py", "print('hello')");
    expect(html).toContain("vault-md-code-block");
    expect(html).toContain("Python");
    expect(html).toContain("print(&#x27;hello&#x27;)");
  });

  it("falls back to a readable label for an unknown or absent language", () => {
    expect(renderStatic("", "x")).toContain("Plain text");
    expect(renderStatic("not-a-language", "x")).toContain("not-a-language");
  });
});

describe("inline code in a static render", () => {
  it("is exactly the <code> it always was: no wrapper, no button", () => {
    const html = renderToStaticMarkup(<p>run <InlineCode className="vault-md-code">npm test</InlineCode> now</p>);
    expect(html).toBe('<p>run <code class="vault-md-code">npm test</code> now</p>');
  });
});
