import * as csstree from "css-tree";
import type {
  CssNode,
  Declaration,
  List,
  Rule,
  Atrule,
  Selector,
  SelectorList,
} from "css-tree";

import { SNIPPET_LIMITS } from "@/lib/config/snippet-limits";
import { snippetScopeSelector } from "@/lib/snippets/scope";

/**
 * Server-only CSS snippet compiler. Parses author CSS, drops anything unsafe,
 * scope-prefixes every selector, renames keyframes, and re-serializes from the
 * AST (never echoes source bytes). The output uses the scope placeholder from
 * lib/snippets/scope.ts and is the ONLY thing served to viewers.
 *
 * Safety model (see docs/17_POLISH_AND_CSS_SNIPPETS_PLAN.md §4):
 *  - no network: url()/image-set()/element()/@import/@font-face all removed
 *  - no escape: every selector prefixed under the document scope; :root/html/
 *    body rejected; position:fixed/sticky removed
 *  - no script: only declarative CSS survives; output rejects `<`/`>`
 */

export type SnippetDiagnostic = {
  severity: "error" | "warning";
  message: string;
  line?: number;
  column?: number;
};

export type SnippetCompileResult = {
  ok: boolean;
  css: string;
  diagnostics: SnippetDiagnostic[];
};

const allowedAtRules = new Set([
  "media",
  "supports",
  "container",
  "keyframes",
  "layer",
]);

const blockedValueFunctions = new Set([
  "url",
  "src",
  "image",
  "image-set",
  "-webkit-image-set",
  "cross-fade",
  "-webkit-cross-fade",
  "element",
  "-moz-element",
  "expression",
  "paint",
  "-webkit-canvas",
]);

// Property allowlist (kebab-case). The value scanner is the real safety net for
// url()/functions, so image-bearing properties are permitted here and cleaned
// by value. Perf/containment escape hatches are intentionally excluded.
const allowedProperties = new Set([
  // typography
  "color",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "font-variant-numeric",
  "font-variant-caps",
  "font-feature-settings",
  "font-stretch",
  "font-kerning",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-align-last",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-underline-offset",
  "text-transform",
  "text-indent",
  "text-shadow",
  "text-overflow",
  "text-wrap",
  "white-space",
  "word-break",
  "overflow-wrap",
  "word-wrap",
  "hyphens",
  "writing-mode",
  "direction",
  "unicode-bidi",
  "tab-size",
  "vertical-align",
  "list-style",
  "list-style-type",
  "list-style-position",
  "quotes",
  "content",
  "counter-reset",
  "counter-increment",
  "counter-set",
  "-webkit-text-fill-color",
  "-webkit-text-stroke",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
  "-webkit-background-clip",
  "-webkit-box-orient",
  "-webkit-line-clamp",
  // color / background
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-position-x",
  "background-position-y",
  "background-size",
  "background-repeat",
  "background-clip",
  "background-origin",
  "background-attachment",
  "background-blend-mode",
  "mix-blend-mode",
  "opacity",
  "color-scheme",
  "accent-color",
  "caret-color",
  // box model
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-block",
  "border-inline",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-collapse",
  "border-spacing",
  "outline",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "box-shadow",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "inline-size",
  "block-size",
  "min-inline-size",
  "max-inline-size",
  "min-block-size",
  "max-block-size",
  "aspect-ratio",
  "gap",
  "row-gap",
  "column-gap",
  // layout
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-inline",
  "float",
  "clear",
  "z-index",
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-wrap",
  "visibility",
  "object-fit",
  "object-position",
  "order",
  "flex",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "flex-direction",
  "flex-flow",
  "flex-wrap",
  "justify-content",
  "justify-items",
  "justify-self",
  "align-content",
  "align-items",
  "align-self",
  "place-content",
  "place-items",
  "place-self",
  "grid",
  "grid-template",
  "grid-template-columns",
  "grid-template-rows",
  "grid-template-areas",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-auto-flow",
  "grid-column",
  "grid-row",
  "grid-area",
  "grid-column-start",
  "grid-column-end",
  "grid-row-start",
  "grid-row-end",
  "columns",
  "column-count",
  "column-width",
  "column-gap",
  "column-rule",
  "column-span",
  // effects / motion
  "transform",
  "transform-origin",
  "transform-style",
  "perspective",
  "perspective-origin",
  "backface-visibility",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
  "animation",
  "animation-name",
  "animation-duration",
  "animation-timing-function",
  "animation-delay",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-play-state",
  "filter",
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "clip-path",
  "cursor",
  "pointer-events",
  "user-select",
  "scroll-behavior",
  "resize",
  "isolation",
]);

const animationKeywords = new Set([
  "none",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
  "infinite",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
]);

type Ctx = {
  diagnostics: SnippetDiagnostic[];
  ruleCount: number;
  keyframeRenames: Map<string, string>;
  usesMotion: boolean;
  keyframePrefix: string;
  aborted: boolean;
};

function warn(ctx: Ctx, message: string, node?: CssNode) {
  const loc = node?.loc?.start;
  ctx.diagnostics.push({
    severity: "warning",
    message,
    line: loc?.line,
    column: loc?.column,
  });
}

function error(ctx: Ctx, message: string, node?: CssNode) {
  const loc = node?.loc?.start;
  ctx.diagnostics.push({
    severity: "error",
    message,
    line: loc?.line,
    column: loc?.column,
  });
}

function listToArray<T extends CssNode>(list: List<T> | null | undefined): T[] {
  return list ? list.toArray() : [];
}

// Resource-loading / dangerous function names, matched by identifier so escapes
// and Raw custom-property values are covered even when the AST doesn't classify
// them as typed nodes.
const blockedFunctionPattern =
  /(?:^|[^\w-])(url|src|image|image-set|-webkit-image-set|cross-fade|-webkit-cross-fade|element|-moz-element|expression|paint|-webkit-canvas)\s*\(/i;

/** Validate a value node subtree: no url()/blocked functions/`<`/`>`. */
function valueIsSafe(value: CssNode, property: string): boolean {
  const isCustomProperty = property.startsWith("--");
  let safe = true;

  csstree.walk(value, (node) => {
    if (node.type === "Url") {
      safe = false;
    } else if (node.type === "Function") {
      if (blockedValueFunctions.has(node.name.toLowerCase())) {
        safe = false;
      }
    }
  });

  if (!safe) {
    return false;
  }

  const serialized = csstree.generate(value);

  if (serialized.includes("<") || serialized.includes(">")) {
    return false;
  }

  // Defense-in-depth against escape-smuggled tokens the AST didn't classify.
  if (/expression\s*\(|javascript:|-moz-binding|behavior\s*:/i.test(serialized)) {
    return false;
  }

  // Custom-property values are parsed as Raw (unwalked), so the AST scan above
  // cannot see url()/image-set() inside them — string-scan as a fallback.
  if (isCustomProperty && blockedFunctionPattern.test(serialized)) {
    return false;
  }

  // position: fixed | sticky can escape the document body region.
  if (property === "position" && /\b(fixed|sticky)\b/i.test(serialized)) {
    return false;
  }

  return true;
}

function rewriteAnimationNames(value: CssNode, ctx: Ctx): boolean {
  // Rename identifiers that reference this snippet's own keyframes; reject the
  // declaration if it references an unknown (possibly app) keyframe name.
  let ok = true;

  csstree.walk(value, (node) => {
    if (node.type !== "Identifier") {
      return;
    }

    const name = node.name;
    const lower = name.toLowerCase();

    if (ctx.keyframeRenames.has(name)) {
      node.name = ctx.keyframeRenames.get(name) as string;
      return;
    }

    if (animationKeywords.has(lower)) {
      return;
    }

    // Timing functions like cubic-bezier are Function nodes, not identifiers.
    // A bare identifier that isn't a keyword or our keyframe is an unknown
    // (potentially app) animation name — reject to prevent hijacking.
    ok = false;
  });

  return ok;
}

function processDeclaration(decl: Declaration, ctx: Ctx): string | null {
  const property = decl.property.toLowerCase();

  // Custom-property definitions (--foo) are allowed — including app theming
  // hooks like --callout-color — because a variable is inert until read by an
  // allowlisted property; the value is still scanned below.
  if (!property.startsWith("--") && !allowedProperties.has(property)) {
    warn(ctx, `Dropped declaration "${decl.property}" (property not allowed)`, decl);
    return null;
  }

  if (!valueIsSafe(decl.value, property)) {
    warn(ctx, `Dropped "${decl.property}" (value not allowed)`, decl);
    return null;
  }

  if (property === "animation" || property === "animation-name") {
    if (!rewriteAnimationNames(decl.value, ctx)) {
      warn(ctx, `Dropped "${decl.property}" (unknown animation name)`, decl);
      return null;
    }
  }

  if (property === "transition" || property.startsWith("transition") || property.startsWith("animation")) {
    ctx.usesMotion = true;
  }

  const value = csstree.generate(decl.value).trim();
  return `${decl.property}: ${value}${decl.important ? " !important" : ""}`;
}

function processDeclarationBlock(block: CssNode | null, ctx: Ctx): string {
  const parts: string[] = [];

  for (const child of listToArray((block as { children?: List<CssNode> })?.children)) {
    if (child.type === "Declaration") {
      const out = processDeclaration(child, ctx);
      if (out) {
        parts.push(out);
      }
    } else if (child.type === "Rule") {
      // Nested style rules are not supported in V1 (scoping correctness).
      warn(ctx, "Dropped nested rule (not supported)", child);
    }
    // Atrules nested in a declaration block are dropped silently.
  }

  return parts.join("; ");
}

function selectorIsSafe(selector: Selector, ctx: Ctx): boolean {
  let safe = true;
  let combinatorCount = 0;

  csstree.walk(selector, (node) => {
    if (node.type === "Combinator") {
      combinatorCount += 1;
    } else if (node.type === "TypeSelector") {
      const name = node.name.toLowerCase();
      if (name === "html" || name === "body") {
        safe = false;
      }
    } else if (node.type === "PseudoClassSelector") {
      const name = node.name.toLowerCase();
      if (name === "root" || name === "host" || name === "host-context") {
        safe = false;
      }
    }
  });

  if (!safe) {
    warn(ctx, "Dropped selector (targets root/html/body)", selector);
    return false;
  }

  if (combinatorCount + 1 > SNIPPET_LIMITS.maxSelectorDepth) {
    warn(ctx, "Dropped selector (too complex)", selector);
    return false;
  }

  return true;
}

function scopeSelectorList(list: SelectorList, ctx: Ctx): string | null {
  const scoped: string[] = [];

  for (const selector of listToArray<Selector>(
    (list as { children?: List<Selector> }).children,
  )) {
    if (selector.type !== "Selector") {
      continue;
    }
    if (!selectorIsSafe(selector, ctx)) {
      continue;
    }
    scoped.push(`${snippetScopeSelector} ${csstree.generate(selector)}`);
  }

  return scoped.length > 0 ? scoped.join(", ") : null;
}

function processRule(rule: Rule, ctx: Ctx): string | null {
  ctx.ruleCount += 1;
  if (ctx.ruleCount > SNIPPET_LIMITS.maxRules) {
    error(ctx, `Too many rules (max ${SNIPPET_LIMITS.maxRules})`, rule);
    ctx.aborted = true;
    return null;
  }

  const prelude = rule.prelude;
  if (!prelude || prelude.type !== "SelectorList") {
    return null;
  }

  const selector = scopeSelectorList(prelude, ctx);
  if (!selector) {
    return null;
  }

  const body = processDeclarationBlock(rule.block, ctx);
  if (!body) {
    return null;
  }

  return `${selector} { ${body} }`;
}

function processKeyframes(atrule: Atrule, ctx: Ctx): string | null {
  const originalName =
    atrule.prelude && atrule.prelude.type === "AtrulePrelude"
      ? csstree.generate(atrule.prelude).trim()
      : "";

  if (!originalName) {
    return null;
  }

  const newName = ctx.keyframeRenames.get(originalName);
  if (!newName) {
    return null;
  }

  const frames: string[] = [];
  for (const frame of listToArray((atrule.block as { children?: List<CssNode> })?.children)) {
    if (frame.type !== "Rule") {
      continue;
    }
    const selectorText = frame.prelude
      ? csstree.generate(frame.prelude)
      : "";
    const body = processDeclarationBlock(frame.block, ctx);
    if (selectorText && body) {
      frames.push(`${selectorText} { ${body} }`);
    }
  }

  if (frames.length === 0) {
    return null;
  }

  return `@keyframes ${newName} { ${frames.join(" ")} }`;
}

function processAtrule(atrule: Atrule, ctx: Ctx): string | null {
  const name = atrule.name.toLowerCase();

  if (!allowedAtRules.has(name)) {
    warn(ctx, `Dropped @${atrule.name} (at-rule not allowed)`, atrule);
    return null;
  }

  if (name === "keyframes") {
    return processKeyframes(atrule, ctx);
  }

  // media / supports / container / layer: keep prelude, recurse into block.
  const prelude = atrule.prelude ? csstree.generate(atrule.prelude) : "";

  if (!atrule.block) {
    // e.g. `@layer a, b;` statement — harmless, but drop for simplicity.
    return null;
  }

  const inner = processNodeList((atrule.block as { children?: List<CssNode> }).children, ctx);
  if (!inner || ctx.aborted) {
    return null;
  }

  const head = prelude ? `@${atrule.name} ${prelude}` : `@${atrule.name}`;
  return `${head} { ${inner} }`;
}

function processNodeList(
  list: List<CssNode> | undefined,
  ctx: Ctx,
): string {
  const parts: string[] = [];

  for (const node of listToArray(list)) {
    if (ctx.aborted) {
      break;
    }
    if (node.type === "Rule") {
      const out = processRule(node, ctx);
      if (out) {
        parts.push(out);
      }
    } else if (node.type === "Atrule") {
      const out = processAtrule(node, ctx);
      if (out) {
        parts.push(out);
      }
    }
    // Raw, Comment, and anything else are dropped.
  }

  return parts.join("\n");
}

function collectKeyframeNames(ast: CssNode, ctx: Ctx) {
  csstree.walk(ast, (node) => {
    if (node.type === "Atrule" && node.name.toLowerCase() === "keyframes") {
      const name =
        node.prelude && node.prelude.type === "AtrulePrelude"
          ? csstree.generate(node.prelude).trim()
          : "";
      if (name && !ctx.keyframeRenames.has(name)) {
        ctx.keyframeRenames.set(name, `snip-${ctx.keyframePrefix}-${name}`);
      }
    }
  });
}

function randomPrefix(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join("").slice(0, 8);
}

export function compileSnippet(source: string): SnippetCompileResult {
  const diagnostics: SnippetDiagnostic[] = [];

  const bytes = new TextEncoder().encode(source).length;
  if (bytes > SNIPPET_LIMITS.maxSourceBytes) {
    return {
      ok: false,
      css: "",
      diagnostics: [
        {
          severity: "error",
          message: `Snippet too large (${bytes} bytes; max ${SNIPPET_LIMITS.maxSourceBytes})`,
        },
      ],
    };
  }

  let ast: CssNode;
  try {
    ast = csstree.parse(source, {
      positions: true,
      onParseError(err) {
        diagnostics.push({
          severity: "error",
          message: err.message,
          line: (err as { line?: number }).line,
          column: (err as { column?: number }).column,
        });
      },
    });
  } catch (err) {
    return {
      ok: false,
      css: "",
      diagnostics: [
        {
          severity: "error",
          message: err instanceof Error ? err.message : "Failed to parse CSS",
        },
      ],
    };
  }

  if (ast.type !== "StyleSheet") {
    return {
      ok: false,
      css: "",
      diagnostics: [{ severity: "error", message: "Invalid stylesheet" }],
    };
  }

  const ctx: Ctx = {
    diagnostics,
    ruleCount: 0,
    keyframeRenames: new Map(),
    usesMotion: false,
    keyframePrefix: randomPrefix(),
    aborted: false,
  };

  collectKeyframeNames(ast, ctx);

  let css = processNodeList(
    (ast as { children?: List<CssNode> }).children,
    ctx,
  );

  if (ctx.usesMotion && css) {
    // Honor prefers-reduced-motion regardless of snippet content (invariant S6).
    css += `\n@media (prefers-reduced-motion: reduce) { ${snippetScopeSelector} *, ${snippetScopeSelector} *::before, ${snippetScopeSelector} *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; } }`;
  }

  const bytesOut = new TextEncoder().encode(css).length;
  if (bytesOut > SNIPPET_LIMITS.maxCompiledBytes) {
    error(ctx, `Compiled output too large (${bytesOut} bytes)`);
  }

  // Final belt-and-braces: compiled output must never contain markup.
  if (css.includes("<") || css.includes(">")) {
    return {
      ok: false,
      css: "",
      diagnostics: [
        ...diagnostics,
        { severity: "error", message: "Compiled output contained markup" },
      ],
    };
  }

  const ok = !diagnostics.some((d) => d.severity === "error");

  return { ok, css: ok ? css : "", diagnostics };
}
