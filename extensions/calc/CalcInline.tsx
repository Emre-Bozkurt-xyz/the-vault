import type { InlineProps } from "@/lib/extension-api";

import { CalcValue } from "./CalcValue";
import type { CalcDocument } from "./lib/document";

/** One `:calc[…]` in Read mode: its pre-computed result from `analyze`. */
export default function CalcInline({ occurrence, analysis }: InlineProps) {
  const document = analysis as CalcDocument | null;

  return <CalcValue resolved={document?.results.get(occurrence.key) ?? null} />;
}
