/**
 * Shared constants for CSS snippet scoping. The compiler rewrites every snippet
 * selector to be a descendant of `[data-vault-snippet-scope="<token>"]`, using
 * the placeholder token below. At render time the placeholder is replaced with
 * the concrete document id, which is also set as the attribute value on the
 * document canvas — so a snippet can only ever match inside its own document.
 */

export const snippetScopeAttribute = "data-vault-snippet-scope";

/** Placeholder used in stored compiled CSS; substituted per render. */
export const snippetScopePlaceholder = "%VAULT_SNIPPET_SCOPE%";

export const snippetScopeSelector = `[${snippetScopeAttribute}="${snippetScopePlaceholder}"]`;

/** A concrete scope value must be a plain document id (uuid-ish, safe chars). */
export function isValidSnippetScope(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

/**
 * Substitute the placeholder in compiled CSS with a concrete, validated scope
 * value. Returns null if the scope value is unsafe (never inject user text).
 */
export function applySnippetScope(
  compiledCss: string,
  scope: string,
): string | null {
  if (!isValidSnippetScope(scope)) {
    return null;
  }

  return compiledCss.split(snippetScopePlaceholder).join(scope);
}
