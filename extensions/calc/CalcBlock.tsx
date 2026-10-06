import type { BlockProps } from "@/lib/extension-api";

import { CalcValue } from "./CalcValue";
import {
  calcBlockStatements,
  calcRowKey,
  isCollapsed,
  type CalcDocument,
  type ResolvedCalc,
} from "./lib/document";

/** A `:::calc` block in Read mode, from its body and `analyze`'s results. */
export default function CalcBlockHost({
  attributes,
  body,
  occurrenceKey,
  analysis,
}: BlockProps) {
  const document = analysis as CalcDocument | null;
  const rows = calcBlockStatements(body ?? "").map((_statement, row) =>
    occurrenceKey === null
      ? null
      : (document?.results.get(calcRowKey(occurrenceKey, row)) ?? null),
  );

  return <CalcBlock rows={rows} collapsed={isCollapsed(attributes)} />;
}

/**
 * A `:::calc` declarations block.
 *
 * Renders as a visible definition list by default: the inputs of a report are
 * usually the point, not chrome. `:::calc{collapsed}` opens it folded.
 *
 * Collapsing uses native `<details>`, so it needs no JavaScript and no stored
 * state. The `collapsed` flag is the *authored default* — exactly like
 * `<details open>` — while a reader's toggle is ephemeral DOM state that resets
 * on reload. That is the right semantics rather than a limitation: a viewer
 * cannot edit the document, so their fold should not outlive their visit.
 */
export function CalcBlock({
  rows,
  collapsed,
}: {
  rows: Array<ResolvedCalc | null>;
  collapsed: boolean;
}) {
  const body = (
    <div className="vault-calc-block-body">
      {rows.map((row, index) => (
        <div className="vault-calc-block-row" key={row?.key ?? index}>
          <CalcValue resolved={row} />
        </div>
      ))}
    </div>
  );

  if (!collapsed) {
    return <div className="vault-calc-block">{body}</div>;
  }

  return (
    <details className="vault-calc-block vault-calc-block-foldable">
      <summary className="vault-calc-block-summary">
        <span className="vault-calc-block-caret" aria-hidden="true" />
        <span className="vault-calc-block-title">
          {rows.length} value{rows.length === 1 ? "" : "s"}
        </span>
      </summary>
      {body}
    </details>
  );
}
