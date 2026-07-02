/**
 * Allowlist for the `class` attribute on user-authored raw HTML inside rendered
 * documents.
 *
 * Why this exists: the Markdown pipeline sanitizes tags/attributes but the
 * compiled stylesheet ships app-chrome classes (Tailwind utilities like
 * `fixed`/`inset-0`/`z-50`, and app component classes like
 * `vault-calendar-overlay`). Without a class allowlist, raw HTML in a *public
 * or shared* document could borrow those classes to paint a full-viewport
 * overlay and spoof the UI for other viewers. We therefore keep only:
 *
 *  - `snip-*`            author hook classes for CSS snippets
 *  - `language-*`/`lang-*` code-fence language hints
 *  - the exact generated-content classes our own transforms emit
 *    (asset embeds, wiki links, hidden anchors, wiki regions)
 *
 * Everything else is dropped. This must stay in sync with the class strings
 * produced by `lib/asset-embeds.ts` and `lib/wiki-links.ts`, since that
 * generated HTML flows through the same sanitizer.
 */

const allowedClassPrefixes = [
  "snip-",
  "language-",
  "lang-",
  // Asset embeds (images, file cards, grouped galleries) — layout only, no
  // positioning that could escape the document body.
  "vault-asset-",
  // Wiki links and their state modifiers.
  "vault-md-wiki-link",
];

const allowedExactClasses = new Set([
  "vault-md-hidden-anchor",
  "vault-region",
]);

export function isAllowedContentClass(token: string): boolean {
  if (allowedExactClasses.has(token)) {
    return true;
  }

  return allowedClassPrefixes.some((prefix) => token.startsWith(prefix));
}

/**
 * Filter a raw `class` attribute value (string or hast string[]) down to the
 * allowed tokens. Returns the surviving tokens as an array (hast's canonical
 * shape) or `undefined` when nothing survives.
 */
export function sanitizeClassList(value: unknown): string[] | undefined {
  const tokens =
    typeof value === "string"
      ? value.split(/\s+/)
      : Array.isArray(value)
        ? value.flatMap((entry) =>
            typeof entry === "string" ? entry.split(/\s+/) : [],
          )
        : [];

  const kept = tokens.filter((token) => token && isAllowedContentClass(token));

  return kept.length > 0 ? kept : undefined;
}
