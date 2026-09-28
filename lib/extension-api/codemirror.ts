/**
 * Editor position tests for extensions' `live` and `completions`
 * contributions (`docs/23_EXTENSION_SDK_PLAN.md` §6, §7). The host's own menus
 * answer "is this inside code?" and "is this in the Properties block?" with
 * these, and an extension's must answer the same way, or a menu opens over text
 * another considers inert.
 */
export {
  getFrontmatterEndLine,
  isInsideCode,
} from "@/components/markdown/completion-context";
