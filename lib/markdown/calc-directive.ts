/**
 * Markdown integration for the `:calc` extension: locating occurrences,
 * splitting `:::calc` blocks, and parsing presentation attributes.
 *
 * Boundary: `lib/calc/` owns *meaning* (parse, evaluate, unit algebra) and knows
 * nothing about Markdown or display. This module owns the bridge — everything
 * inside `[…]` goes to the evaluator, everything inside `{…}` stays here.
 *
 * ## The raw-source invariant
 *
 * A directive's `[…]` content is parsed as inline Markdown, so `:calc[a * b * c]`
 * has two asterisks that pair into **emphasis** before an evaluator would ever
 * see them, and `_` in identifiers does the same. Expressions are therefore
 * always sliced out of the original source via `node.position` and the parsed
 * children are discarded. Reading `node.children` silently corrupts expressions;
 * it is the single easiest way to break this feature.
 *
 * Slicing is exact rather than best-effort because the calc grammar contains no
 * brackets or braces at all (see `lib/calc/tokenizer.ts`), so the first `]`
 * always ends the expression.
 */

import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** The directive name, i.e. `:calc[…]` and `:::calc`. */
export const CALC_DIRECTIVE_NAME = "calc";

/** Element name the render plugin emits for an inline value. */
export const CALC_ELEMENT_NAME = "vault-calc";

/** Attribute carrying the lookup key into the pre-computed result map. */
export const CALC_KEY_ATTRIBUTE = "data-calc-key";

/**
 * The Markdown plugins the calc pipeline parses with.
 *
 * Shared deliberately: the pre-pass that collects expressions and the render
 * pass that assigns their lookup keys must walk *identical* trees, or an index
 * assigned during render points at the wrong pre-computed result. Exporting one
 * list makes that agreement structural instead of a convention two call sites
 * have to remember.
 */
export const calcRemarkPlugins = [remarkGfm, remarkMath, remarkDirective];

type MdastNode = {
  type: string;
  name?: string;
  /** Present on `text` nodes, which is what an unhandled directive becomes. */
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdastNode[];
  data?: Record<string, unknown>;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

/** Depth-first, children in order. Both passes must use this same traversal. */
function walk(node: MdastNode, visit: (node: MdastNode) => void): void {
  visit(node);

  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

function isInlineCalcDirective(node: MdastNode): boolean {
  return node.type === "textDirective" && node.name === CALC_DIRECTIVE_NAME;
}

function parseMarkdown(markdown: string): MdastNode {
  return unified()
    .use(remarkParse)
    .use(calcRemarkPlugins)
    .parse(markdown) as unknown as MdastNode;
}

/**
 * Pulls the expression out of the original source. Never reads `node.children`
 * — see the raw-source invariant above.
 *
 * Returns null for a `:calc` with no bracket group (e.g. a bare `:calc{as=USD}`),
 * which the caller surfaces as a syntax error rather than silently dropping.
 */
function sliceInlineExpression(source: string, node: MdastNode): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  if (start === undefined || end === undefined) {
    return null;
  }

  const match = /^:calc\[([^\]]*)\]/.exec(source.slice(start, end));

  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Presentation attributes
// ---------------------------------------------------------------------------

/** How a result is shown. `name` falls back to `expr` on a non-binding. */
export type CalcShowMode = "value" | "name" | "expr";

export type CalcPresentation = {
  show: CalcShowMode | null;
  /** Display decimal places. NEVER affects the stored value — see below. */
  dp: number | null;
  /** Display currency for this one value. */
  as: string | null;
};

export const EMPTY_PRESENTATION: CalcPresentation = {
  show: null,
  dp: null,
  as: null,
};

const SHOW_MODES = new Set<CalcShowMode>(["value", "name", "expr"]);

/** Upper bound on `dp`, matching the evaluator's `round()` ceiling. */
const MAX_DISPLAY_PLACES = 20;

/**
 * Reads `{show=… dp=… as=…}`.
 *
 * `dp` is **display-only and must never change the bound value**. If
 * `:calc[rate = 1/3]{dp=2}` bound `0.33`, every downstream total would drift and
 * the error would be invisible where it was introduced. `round(x, 2)` changes the
 * value and propagates; `{dp=2}` changes one rendering and propagates to nothing.
 *
 * Unknown keys and unparseable values are ignored rather than fatal: a typo in a
 * display hint should never turn a correct figure into an error chip.
 */
export function parseCalcPresentation(
  attributes: Record<string, string | null | undefined> | null | undefined,
): CalcPresentation {
  if (!attributes) {
    return EMPTY_PRESENTATION;
  }

  const rawShow = attributes.show?.trim().toLowerCase();
  const rawDp = attributes.dp?.trim();
  const rawAs = attributes.as?.trim().toUpperCase();

  const dp = rawDp !== undefined && /^\d+$/.test(rawDp) ? Number(rawDp) : null;

  return {
    show:
      rawShow && SHOW_MODES.has(rawShow as CalcShowMode)
        ? (rawShow as CalcShowMode)
        : null,
    dp: dp !== null && dp <= MAX_DISPLAY_PLACES ? dp : null,
    as: rawAs && /^[A-Z]{3}$/.test(rawAs) ? rawAs : null,
  };
}

/**
 * Parses a directive attribute string, e.g. `show=expr dp=2`.
 *
 * Attributes are **space-separated, not comma-separated** — the generic
 * directive syntax the `:::calendar{id=…}` fence already uses. A comma would be
 * swallowed into the preceding value.
 */
export function parseAttributeString(
  raw: string | null | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!raw) {
    return attributes;
  }

  const pattern = /([A-Za-z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+)))?/g;

  for (const match of raw.matchAll(pattern)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

// ---------------------------------------------------------------------------
// Block splitting
// ---------------------------------------------------------------------------

export type CalcBlockLine = {
  /** Raw statement source, e.g. `rent = 1200 CAD`. */
  expression: string;
};

export type CalcSegment =
  | { type: "markdown"; markdown: string }
  | {
      type: "calc-block";
      lines: CalcBlockLine[];
      presentation: CalcPresentation;
      collapsed: boolean;
    };

const CALC_FENCE_OPEN = /^:::calc(?:\{([^}\n]*)\})?\s*$/i;
const CALC_FENCE_CLOSE = /^:::\s*$/;
const CODE_FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Splits markdown into runs of plain markdown interleaved with `:::calc` blocks,
 * so the block renders as a real component outside the Markdown pipeline (the
 * same approach `splitCalendarSegments` takes for `:::calendar`).
 *
 * Unlike that splitter this one is **fenced-code aware**: a `:::calc` inside a
 * ``` block stays code, which is required for the docs to be able to show the
 * syntax without evaluating it.
 */
export function splitCalcBlockSegments(markdown: string): CalcSegment[] {
  const segments: CalcSegment[] = [];
  const lines = markdown.split(/\r?\n/);

  let buffer: string[] = [];
  let codeFence: string | null = null;
  let index = 0;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ type: "markdown", markdown: buffer.join("\n") });
      buffer = [];
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const fence = CODE_FENCE.exec(line);

    if (codeFence) {
      buffer.push(line);
      if (fence && line.trim().startsWith(codeFence)) {
        codeFence = null;
      }
      index += 1;
      continue;
    }

    if (fence) {
      codeFence = fence[1];
      buffer.push(line);
      index += 1;
      continue;
    }

    const open = CALC_FENCE_OPEN.exec(line.trim());

    if (!open) {
      buffer.push(line);
      index += 1;
      continue;
    }

    flush();

    const attributes = parseAttributeString(open[1]);
    const body: CalcBlockLine[] = [];
    index += 1;

    while (index < lines.length && !CALC_FENCE_CLOSE.test(lines[index].trim())) {
      const statement = lines[index].trim();

      if (statement) {
        body.push({ expression: statement });
      }

      index += 1;
    }

    // Skip the closing fence when present; an unterminated block simply runs to
    // the end of the document rather than discarding its declarations.
    if (index < lines.length) {
      index += 1;
    }

    segments.push({
      type: "calc-block",
      lines: body,
      presentation: parseCalcPresentation(attributes),
      collapsed: Object.hasOwn(attributes, "collapsed"),
    });
  }

  flush();

  return segments;
}

// ---------------------------------------------------------------------------
// Inline collection
// ---------------------------------------------------------------------------

export type InlineCalcOccurrence = {
  /** Raw expression source, or null when the `:calc` had no `[…]` group. */
  expression: string | null;
  presentation: CalcPresentation;
};

/**
 * Collects inline `:calc[…]` occurrences in document order.
 *
 * Order is the contract: the render plugin assigns keys by the same traversal
 * over the same tree, so the Nth occurrence here is the Nth occurrence there.
 */
export function collectInlineCalcOccurrences(
  markdown: string,
): InlineCalcOccurrence[] {
  const tree = parseMarkdown(markdown);
  const occurrences: InlineCalcOccurrence[] = [];

  walk(tree, (node) => {
    if (!isInlineCalcDirective(node)) {
      return;
    }

    occurrences.push({
      expression: sliceInlineExpression(markdown, node),
      presentation: parseCalcPresentation(node.attributes),
    });
  });

  return occurrences;
}

/**
 * Render plugin: rewrites each inline `:calc[…]` into a `<vault-calc>` element
 * carrying only its lookup key, and **discards the parsed children** so the
 * emphasis the Markdown parser found inside the brackets can never reach the
 * DOM. The component resolves the key against the pre-computed result map.
 *
 * `keyPrefix` scopes keys to one Markdown segment, since a document is split
 * into several independently rendered segments by wiki embeds and calendars.
 */
const DIRECTIVE_TYPES = new Set([
  "textDirective",
  "leafDirective",
  "containerDirective",
]);

/**
 * Restores a directive node to the literal text it was written as.
 *
 * Adding `remark-directive` to the shared pipeline changes parsing for *every*
 * document: text that merely looks like a directive (`:::calendar{id=…}` where
 * no `documentId` is in scope, a stray `:foo[bar]`) would otherwise become a
 * node nothing handles and render as nothing — silently deleting content that
 * renders fine today. Anything this module does not claim is put back verbatim.
 */
function restoreDirectiveText(
  node: MdastNode,
  source: string | null,
): MdastNode | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  if (source === null || start === undefined || end === undefined) {
    return null;
  }

  const raw = source.slice(start, end);

  return node.type === "textDirective"
    ? { type: "text", value: raw }
    : { type: "paragraph", children: [{ type: "text", value: raw }] };
}

/**
 * Render plugin: rewrites each inline `:calc[…]` into a `<vault-calc>` element
 * carrying only its lookup key, and **discards the parsed children** so the
 * emphasis the Markdown parser found inside the brackets can never reach the
 * DOM. The component resolves the key against the pre-computed result map.
 *
 * `keyPrefix` scopes keys to one Markdown segment, since a document is split
 * into several independently rendered segments by wiki embeds and calendars.
 *
 * Walks children in the same pre-order as {@link collectInlineCalcOccurrences},
 * so the Nth calc directive here is the Nth expression there.
 */
export function remarkCalc(options: { keyPrefix: string }) {
  // `tree` is typed `unknown` and narrowed below so the transformer stays
  // assignable to unified's `Transformer<Node, Node>`; the local `MdastNode`
  // shape is deliberately looser than unified's `Node`.
  return function transform(tree: unknown, file?: { value?: unknown }) {
    const source = typeof file?.value === "string" ? file.value : null;
    let index = 0;

    const visit = (node: MdastNode): void => {
      const children = node.children;

      if (!children) {
        return;
      }

      for (let position = 0; position < children.length; position += 1) {
        const child = children[position];

        if (DIRECTIVE_TYPES.has(child.type)) {
          if (isInlineCalcDirective(child)) {
            child.data = {
              ...child.data,
              hName: CALC_ELEMENT_NAME,
              hProperties: {
                [CALC_KEY_ATTRIBUTE]: `${options.keyPrefix}:${index}`,
              },
            };
            child.children = [];
            index += 1;
            continue;
          }

          const restored = restoreDirectiveText(child, source);

          if (restored) {
            children[position] = restored;
            continue;
          }
        }

        visit(child);
      }
    };

    visit(tree as MdastNode);
  };
}

/** Builds the lookup key for the `n`th inline occurrence of a segment. */
export function inlineCalcKey(keyPrefix: string, index: number): string {
  return `${keyPrefix}:${index}`;
}
