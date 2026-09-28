import type { FxRateTable } from "@/lib/calc/fx";
import type { DocumentExtensions } from "@/lib/extension-api";

/**
 * The one place core still reads extension-specific shapes out of
 * {@link DocumentExtensions} (`docs/23_EXTENSION_SDK_PLAN.md` slice 2).
 *
 * Until each extension's rendering moves behind the SDK, the editor, the
 * renderer and the pages need these values under their old names. Keeping every
 * such read here means core names extensions in one file, not across pages, and
 * each later slice deletes its part. Calendar, stickers and the dictionary are
 * gone from it; what remains is calc's (slice 6), after which this file goes.
 */
export type LegacyExtensionProps = {
  fxTable: FxRateTable | null;
  /** Authoring switch: the viewer enabled the extension and can edit. */
  calcEnabled: boolean;
};

type CalcData = { fxTable?: FxRateTable | null };

export function legacyExtensionProps(
  extensions: DocumentExtensions | null | undefined,
): LegacyExtensionProps {
  const calcData = extensions?.data["vault.calc"] as CalcData | undefined;

  return {
    fxTable: calcData?.fxTable ?? null,
    calcEnabled: Boolean(
      extensions?.canEdit && extensions.enabledIds.includes("vault.calc"),
    ),
  };
}
