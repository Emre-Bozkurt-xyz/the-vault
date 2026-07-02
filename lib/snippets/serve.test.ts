import { describe, expect, it } from "vitest";

import { compileSnippet } from "@/lib/snippets/compile";
import {
  applySnippetScope,
  snippetScopeAttribute,
} from "@/lib/snippets/scope";

/**
 * End-to-end guarantee of the serve path an attacker would hit:
 * author CSS -> compile -> scope substitution (what DocumentCanvas injects).
 * Proves the served stylesheet is inert and confined to one document.
 */
function serve(source: string, documentId: string) {
  const { css } = compileSnippet(source);
  return applySnippetScope(css, documentId);
}

const DOC = "11111111-1111-1111-1111-111111111111";

describe("snippet serve path", () => {
  it("scopes every rule to the target document and drops escape attempts", () => {
    const attack = `
      /* try to cover the whole app */
      body { background: red }
      :root { --x: 1 }
      .overlay { position: fixed; inset: 0; background: url(https://evil/x); z-index: 99999 }
      html .spoof { content: "sign in" }
      .vault-md-h1 { color: teal }
    `;

    const served = serve(attack, DOC);
    expect(served).not.toBeNull();
    const css = served as string;

    // Only the legitimate rule survives, and it is scoped to this document.
    expect(css).toContain(`[${snippetScopeAttribute}="${DOC}"] .vault-md-h1`);
    expect(css).toContain("color: teal");

    // No escape vectors remain anywhere in the served output.
    expect(css).not.toContain("position: fixed");
    expect(css).not.toContain("url(");
    expect(css).not.toContain("evil");
    expect(css).not.toMatch(/(^|\s|,)body\s*\{/);
    expect(css).not.toMatch(/(^|\s|,):root/);
    expect(css).not.toMatch(/(^|\s|,)html\s/);

    // The scope placeholder is fully substituted (no leftover tokens).
    expect(css).not.toContain("%VAULT_SNIPPET_SCOPE%");
  });

  it("refuses to substitute an unsafe scope value", () => {
    const { css } = compileSnippet(".vault-md-h1 { color: red }");
    expect(applySnippetScope(css, 'x"] , body [y="')).toBeNull();
  });

  it("produces an empty serve when nothing survives compilation", () => {
    expect(serve("body { color: red }", DOC)).toBe("");
  });
});
