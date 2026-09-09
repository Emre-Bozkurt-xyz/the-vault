/**
 * Document-level `:calc` settings, read from YAML frontmatter.
 *
 * ```md
 * ---
 * calc_currency: USD
 * calc_rate_date: 2026-09-08
 * ---
 * ```
 *
 * Frontmatter rather than `document_extension_states`, and the reason is what
 * these settings *are*. A pinned rate date is not a view preference — it is the
 * claim that makes a finance report reproducible and auditable, so it has to
 * travel with the document, survive export, and be visible in the source. Same
 * for the reporting currency: "this report is denominated in USD" is authorial.
 *
 * This does not weaken the invariant that conversion never rewrites the
 * markdown. The authored amounts are untouched; only the lens over them is
 * declared. And `lib/content-metadata.ts` preserves unknown frontmatter keys, so
 * these survive edits made through the Properties UI.
 */

import { isCurrencyCode } from "@/lib/calc/currency";
import { isFxDayKey } from "@/lib/calc/fx";

export type CalcDocumentSettings = {
  /**
   * Currency every value is displayed in unless it carries its own `{as=…}`.
   * Null leaves each value in whatever currency it evaluates to.
   */
  displayCurrency: string | null;
  /**
   * `YYYY-MM-DD` to price the document at. Null uses the latest rates, which
   * means the totals can move between readings — fine for a note, wrong for a
   * report someone is going to cite.
   */
  rateDate: string | null;
};

export const EMPTY_CALC_SETTINGS: CalcDocumentSettings = {
  displayCurrency: null,
  rateDate: null,
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Reads the calc keys from frontmatter. Unparseable values are ignored rather
 * than fatal — a typo in a document-level hint should degrade to the default,
 * never blank the figures it was meant to format.
 */
export function parseCalcSettings(markdown: string): CalcDocumentSettings {
  const block = FRONTMATTER.exec(markdown);

  if (!block) {
    return EMPTY_CALC_SETTINGS;
  }

  let displayCurrency: string | null = null;
  let rateDate: string | null = null;

  for (const line of block[1].split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^["']|["']$/g, "");

    if (key === "calc_currency") {
      const code = value.toUpperCase();
      displayCurrency = isCurrencyCode(code) ? code : null;
      continue;
    }

    if (key === "calc_rate_date") {
      rateDate = isFxDayKey(value) ? value : null;
    }
  }

  return { displayCurrency, rateDate };
}
