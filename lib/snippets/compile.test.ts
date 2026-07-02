import { describe, expect, it } from "vitest";

import { compileSnippet } from "@/lib/snippets/compile";
import { snippetScopePlaceholder } from "@/lib/snippets/scope";

const SCOPE = `[data-vault-snippet-scope="${snippetScopePlaceholder}"]`;

describe("compileSnippet — scoping", () => {
  it("prefixes every selector with the document scope", () => {
    const { ok, css } = compileSnippet(".vault-md-h1 { color: red }");
    expect(ok).toBe(true);
    expect(css).toContain(`${SCOPE} .vault-md-h1`);
    expect(css).toContain("color: red");
  });

  it("scopes each selector in a list", () => {
    const { css } = compileSnippet(".a, .b { color: red }");
    expect(css).toContain(`${SCOPE} .a`);
    expect(css).toContain(`${SCOPE} .b`);
  });

  it("drops selectors targeting root/html/body", () => {
    expect(compileSnippet(":root { color: red }").css).toBe("");
    expect(compileSnippet("html { color: red }").css).toBe("");
    expect(compileSnippet("body .x { color: red }").css).toBe("");
  });

  it("drops overly deep selectors", () => {
    const deep = Array.from({ length: 12 }, (_, i) => `.c${i}`).join(" ");
    const { css } = compileSnippet(`${deep} { color: red }`);
    expect(css).toBe("");
  });
});

describe("compileSnippet — network blocking", () => {
  it("drops declarations using url()", () => {
    const { css } = compileSnippet(
      ".x { background: url(https://evil.example/beacon); color: red }",
    );
    expect(css).not.toContain("url(");
    expect(css).not.toContain("evil.example");
    expect(css).toContain("color: red");
  });

  it("blocks url() smuggled via escapes", () => {
    const { css } = compileSnippet(".x { background: u\\72 l(https://evil/x) }");
    expect(css).not.toContain("evil");
  });

  it("blocks image-set and element functions", () => {
    expect(
      compileSnippet(".x { background: image-set('a.png' 1x) }").css,
    ).not.toContain("image-set");
    expect(
      compileSnippet(".x { background: element(#a) }").css,
    ).not.toContain("element(");
  });

  it("drops @import and @font-face", () => {
    const { css } = compileSnippet(
      "@import url(evil.css); @font-face { font-family: x; src: url(y.woff) } .a { color: red }",
    );
    expect(css).not.toContain("@import");
    expect(css).not.toContain("@font-face");
    expect(css).toContain("color: red");
  });

  it("allows gradients (no network)", () => {
    const { css } = compileSnippet(
      ".x { background: linear-gradient(red, blue) }",
    );
    expect(css).toContain("linear-gradient");
  });
});

describe("compileSnippet — positioning / escape", () => {
  it("drops position: fixed and sticky, keeps absolute/relative", () => {
    expect(compileSnippet(".x { position: fixed }").css).toBe("");
    expect(compileSnippet(".x { position: sticky }").css).toBe("");
    expect(compileSnippet(".x { position: absolute }").css).toContain(
      "position: absolute",
    );
  });

  it("blocks expression() and javascript:", () => {
    expect(compileSnippet(".x { width: expression(alert(1)) }").css).toBe("");
    expect(
      compileSnippet(".x { background: red; behavior: url(x.htc) }").css,
    ).not.toContain("behavior");
  });
});

describe("compileSnippet — properties", () => {
  it("drops unlisted properties, keeps allowed ones", () => {
    const { css } = compileSnippet(
      ".x { color: red; will-change: transform; contain: strict }",
    );
    expect(css).toContain("color: red");
    expect(css).not.toContain("will-change");
    expect(css).not.toContain("contain");
  });

  it("allows custom property definitions including app theming hooks", () => {
    const { css } = compileSnippet(
      '.callout[data-callout="tip"] { --callout-color: 120, 82, 238; --snip-accent: #f00; color: var(--snip-accent) }',
    );
    expect(css).toContain("--callout-color: 120, 82, 238");
    expect(css).toContain("--snip-accent");
    expect(css).toContain("var(--snip-accent)");
  });

  it("blocks url()/image-set() smuggled inside a custom property value", () => {
    expect(compileSnippet(".x { --c: url(https://evil/x) }").css).not.toContain(
      "url(",
    );
    expect(
      compileSnippet(".x { --c: image-set('a.png' 1x) }").css,
    ).not.toContain("image-set");
    expect(compileSnippet(".x { --c: expression(1) }").css).not.toContain(
      "expression",
    );
  });

  it("preserves !important", () => {
    expect(compileSnippet(".x { color: red !important }").css).toContain(
      "!important",
    );
  });
});

describe("compileSnippet — at-rules", () => {
  it("keeps @media and scopes its inner rules", () => {
    const { css } = compileSnippet(
      "@media (min-width: 600px) { .x { color: red } }",
    );
    expect(css).toMatch(/@media \(min-width:\s?600px\)/);
    expect(css).toContain(`${SCOPE} .x`);
  });
});

describe("compileSnippet — keyframes", () => {
  it("renames keyframes and rewrites animation-name references", () => {
    const { css } = compileSnippet(
      "@keyframes spin { from { opacity: 0 } to { opacity: 1 } } .x { animation-name: spin }",
    );
    expect(css).not.toMatch(/@keyframes spin\b/);
    expect(css).toMatch(/@keyframes snip-[a-z0-9]+-spin/);
    expect(css).toMatch(/animation-name: snip-[a-z0-9]+-spin/);
  });

  it("drops animation referencing an unknown (app) keyframe name", () => {
    const { css } = compileSnippet(".x { animation-name: vault-fade-up }");
    expect(css).not.toContain("vault-fade-up");
  });

  it("appends a reduced-motion reset when motion is used", () => {
    const { css } = compileSnippet(
      ".x { transition: opacity 0.3s ease }",
    );
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

describe("compileSnippet — limits & safety", () => {
  it("errors on oversize input", () => {
    const big = ".x { color: red }\n".repeat(4000);
    const { ok, diagnostics } = compileSnippet(big);
    expect(ok).toBe(false);
    expect(diagnostics.some((d) => /too large/i.test(d.message))).toBe(true);
  });

  it("never emits markup", () => {
    const { css } = compileSnippet('.x::before { content: "</style><b>" }');
    expect(css).not.toContain("<");
    expect(css).not.toContain(">");
  });

  it("recompiles idempotently for allowed CSS", () => {
    const src = ".vault-md-h1 { color: red }";
    expect(compileSnippet(src).css).toEqual(compileSnippet(src).css);
  });
});
