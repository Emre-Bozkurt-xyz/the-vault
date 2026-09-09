import { calcValueMarkup } from "@/lib/calc/resolve";
import type { ResolvedCalc } from "@/lib/markdown/calc-document";

/**
 * One inline `:calc[…]` value in Read mode.
 *
 * Renders server-side from a pre-computed result — it never evaluates, so the
 * same figure appears wherever the document is rendered. Its structure comes
 * from `calcValueMarkup`, shared with the CodeMirror widget that draws the same
 * value in Live mode, so the editor and the page cannot drift.
 *
 * The classes are part of the document CSS contract
 * (`docs/CSS_CONTRACT.md`); they are applied here rather than carried through
 * the Markdown tree, which is what keeps them out of the raw-HTML sanitizer's
 * className filter.
 *
 * Deliberately reads as prose, not as a widget. The moment a computed figure
 * looks like a form field, the document has become the spreadsheet this feature
 * exists to avoid.
 */
export function CalcValue({ resolved }: { resolved: ResolvedCalc | null }) {
  if (!resolved) {
    // The key missed the result map — only reachable if author raw HTML wrote a
    // `<vault-calc>` element by hand. Render nothing rather than an error.
    return null;
  }

  const markup = calcValueMarkup(resolved);

  return (
    <span
      className={markup.rootClassName}
      data-calc-state={markup.state}
      title={markup.title}
    >
      {markup.parts.map((part, index) => (
        <span
          key={`${part.className}-${index}`}
          className={part.className}
          aria-hidden={part.decorative ? "true" : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}
