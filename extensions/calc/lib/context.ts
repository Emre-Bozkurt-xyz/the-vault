import type { ExtensionRenderContext } from "@/lib/extension-api";
import type { FxRateTable } from "@/lib/extension-api/fx";

/** What calc's `loadRenderData` returns (`server.ts`), as components receive it. */
export type CalcRenderData = { fxTable: FxRateTable | null };

/**
 * The day's FX table from the render context, or null where there is none
 * (embeds and previews render without extension data): conversions then report
 * a missing rate and every same-currency figure still works.
 */
export function fxTableOf(ctx: Pick<ExtensionRenderContext, "data">): FxRateTable | null {
  const data = ctx.data as Partial<CalcRenderData> | null;
  return data?.fxTable ?? null;
}
