import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

import { rehypeSanitizeContent, safeHtmlSchema } from "@/lib/markdown/sanitize";

/**
 * Mirrors the real render pipeline's HTML-security stages (raw -> sanitize ->
 * content filter). remark-gfm/math/katex are irrelevant to the security
 * boundary and omitted for speed.
 */
async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, safeHtmlSchema)
    .use(rehypeSanitizeContent)
    .use(rehypeStringify)
    .process(markdown);

  return String(file);
}

describe("HTML sanitize pipeline", () => {
  it("strips app-chrome and Tailwind utility classes from raw HTML", async () => {
    const out = await render(
      '<div class="fixed inset-0 z-50 bg-background vault-calendar-overlay">x</div>',
    );
    expect(out).not.toContain("fixed");
    expect(out).not.toContain("inset-0");
    expect(out).not.toContain("z-50");
    expect(out).not.toContain("vault-calendar-overlay");
    expect(out).toContain("<div>x</div>");
  });

  it("keeps snippet author hook classes", async () => {
    const out = await render('<div class="snip-hero snip-card">x</div>');
    expect(out).toContain("snip-hero");
    expect(out).toContain("snip-card");
  });

  it("keeps generated asset/wiki content classes but not arbitrary vault-* classes", async () => {
    const out = await render(
      '<span class="vault-asset-embed vault-asset-embed--image vault-calendar-overlay-backdrop">x</span>',
    );
    expect(out).toContain("vault-asset-embed");
    expect(out).toContain("vault-asset-embed--image");
    expect(out).not.toContain("vault-calendar-overlay-backdrop");
  });

  it("removes script tags and event handlers", async () => {
    const out = await render(
      '<div onclick="alert(1)">x</div><script>alert(2)</script>',
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(2)");
  });

  it("drops disallowed inline style properties but keeps allowed ones", async () => {
    const out = await render(
      '<span style="color: red; position: fixed; behavior: url(x)">x</span>',
    );
    expect(out).toContain("color: red");
    expect(out).not.toContain("position");
    expect(out).not.toContain("behavior");
  });

  it("blocks url()/expression() in inline styles", async () => {
    const out = await render(
      '<span style="background: url(https://evil.example/beacon)">x</span>',
    );
    expect(out).not.toContain("url(");
    expect(out).not.toContain("evil.example");
  });

  it("neutralizes javascript: hrefs", async () => {
    const out = await render('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });
});
