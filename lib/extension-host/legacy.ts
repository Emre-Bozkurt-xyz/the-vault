import type { FxRateTable } from "@/lib/calc/fx";
import type { DocumentExtensions } from "@/lib/extension-api";

/**
 * The one place core still reads extension-specific shapes out of
 * {@link DocumentExtensions} (`docs/23_EXTENSION_SDK_PLAN.md` slice 2).
 *
 * Until each extension's rendering moves behind the SDK, the editor, the
 * renderer and the pages need these values under their old names. Keeping every
 * such read here means core names extensions in one file, not across pages, and
 * each later slice deletes its part:
 *
 * - dictionary (slice 5): `definitionEmphasis`
 * - calc (slice 6): `fxTable`
 */
export type LegacyExtensionProps = {
  fxTable: FxRateTable | null;
  definitionEmphasis: "every" | "first";
  /** Authoring switch: the viewer enabled the extension and can edit. */
  calcEnabled: boolean;
  dictionaryEnabled: boolean;
};

type CalcData = { fxTable?: FxRateTable | null };

export function legacyExtensionProps(
  extensions: DocumentExtensions | null | undefined,
): LegacyExtensionProps {
  const data = (id: string) => extensions?.data[id] as unknown;
  const settings = (id: string) => extensions?.settings[id] ?? {};
  const authoring = (id: string) =>
    Boolean(extensions?.canEdit && extensions.enabledIds.includes(id));

  const emphasis = settings("vault.dictionary").definitionEmphasis;

  return {
    fxTable: (data("vault.calc") as CalcData | undefined)?.fxTable ?? null,
    definitionEmphasis: emphasis === "first" ? "first" : "every",
    calcEnabled: authoring("vault.calc"),
    // Unlike the others, not gated on `canEdit`: besides `/def` it carries the
    // viewer's reading preference, which applies in the read view too.
    dictionaryEnabled: Boolean(extensions?.enabledIds.includes("vault.dictionary")),
  };
}
