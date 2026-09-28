import { extensionDirectiveOwners } from "@/lib/extension-host/blocks";
import {
  planDirectiveParts,
  type DirectiveOwners,
  type DirectivePart,
  type DirectivePlanState,
} from "@/lib/markdown/directive-occurrences";

/**
 * Splits one Markdown run into render parts with the installed claims,
 * appending its occurrences to `state` (see `directive-occurrences.ts`).
 *
 * Its own module because it parses Markdown: `blocks.ts` is imported by client
 * host components, and keeping the parser out of it keeps it out of every
 * public page's entry chunk.
 */
export function planExtensionParts(
  markdown: string,
  state: DirectivePlanState,
  owners: DirectiveOwners = extensionDirectiveOwners,
): DirectivePart[] {
  return planDirectiveParts(markdown, owners, state);
}
