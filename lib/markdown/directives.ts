/**
 * Inline directives (`:name[label]{attributes}`) in the Markdown pipeline, for
 * whichever names extensions claim (`docs/23_EXTENSION_SDK_PLAN.md` §6).
 *
 * Two passes walk the same tree: a *collector* that reads each occurrence out
 * before render (the extensions' `analyze` pre-pass needs all of them, in
 * document order), and a *render plugin* that rewrites each one into an element
 * carrying only its key. Both go through {@link visitDirectives}, so the Nth
 * occurrence one finds is the Nth the other keys; agreement is structural, not
 * a convention two call sites keep.
 *
 * ## The raw-source invariant
 *
 * A directive's `[…]` is parsed as inline Markdown, so `:calc[a * b * c]` has two
 * asterisks that pair into emphasis. Labels are therefore always sliced from the
 * source via `node.position` and the parsed children are discarded. Reading
 * `node.children` silently corrupts the label.
 *
 * ## Unclaimed directives
 *
 * `remark-directive` changes parsing for every document: text that merely looks
 * like a directive (`:foo[bar]`, a leaf or container nobody claims) would become
 * a node nothing renders, silently deleting it. Anything unclaimed is put back
 * as the literal text it was written as.
 */

import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * The Markdown plugins documents are parsed with. Shared by the collector and
 * the renderer: they must parse identical trees, or a key assigned during
 * render points at another occurrence.
 */
export const directiveRemarkPlugins = [remarkGfm, remarkMath, remarkDirective];

/** Element the render plugin emits for a claimed inline directive. */
export const EXTENSION_INLINE_ELEMENT = "vault-extension-inline";

/** Attribute carrying the occurrence key on that element. */
export const EXTENSION_INLINE_KEY_ATTRIBUTE = "data-extension-key";

export type InlineDirectiveOccurrence = {
  /** Lowercase directive name. */
  name: string;
  /** The directive as written, e.g. `:calc[rent * 3]{as=USD}`. */
  source: string;
  /** Raw text between the brackets, or null without a `[…]` group. */
  label: string | null;
  attributes: Record<string, string>;
};

type MdastNode = {
  type: string;
  name?: string;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdastNode[];
  data?: Record<string, unknown>;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

const DIRECTIVE_TYPES = new Set([
  "textDirective",
  "leafDirective",
  "containerDirective",
]);

function sliceSource(source: string | null, node: MdastNode): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  return source === null || start === undefined || end === undefined
    ? null
    : source.slice(start, end);
}

/**
 * Pre-order over children, calling `claimed` for each claimed inline directive
 * and `unclaimed` for every other directive. Neither is descended into: a
 * claimed one is replaced by its element, an unclaimed one by its source text.
 * The return value replaces the node when not undefined.
 */
function visitDirectives(
  tree: MdastNode,
  names: ReadonlySet<string>,
  claimed: (node: MdastNode) => MdastNode | undefined,
  unclaimed: (node: MdastNode) => MdastNode | undefined,
): void {
  const visit = (node: MdastNode): void => {
    const children = node.children;
    if (!children) return;

    for (let position = 0; position < children.length; position += 1) {
      const child = children[position];

      if (DIRECTIVE_TYPES.has(child.type)) {
        const isClaimed =
          child.type === "textDirective" &&
          child.name !== undefined &&
          names.has(child.name.toLowerCase());
        const replacement = isClaimed ? claimed(child) : unclaimed(child);

        if (replacement) children[position] = replacement;
        continue;
      }

      visit(child);
    }
  };

  visit(tree);
}

function normaliseAttributes(
  attributes: MdastNode["attributes"],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes ?? {})) {
    result[key] = value ?? "";
  }

  return result;
}

const LABEL = /^:[\w-]+\[([\s\S]*)\](?:\{[^}]*\})?$/;

/** Claimed inline directives in `markdown`, in document order. */
export function collectInlineDirectives(
  markdown: string,
  names: ReadonlySet<string>,
): InlineDirectiveOccurrence[] {
  const found: InlineDirectiveOccurrence[] = [];

  if (names.size === 0 || !markdown.includes(":")) {
    return found;
  }

  const tree = unified()
    .use(remarkParse)
    .use(directiveRemarkPlugins)
    .parse(markdown) as unknown as MdastNode;

  visitDirectives(
    tree,
    names,
    (node) => {
      const source = sliceSource(markdown, node) ?? `:${node.name}`;
      found.push({
        name: (node.name ?? "").toLowerCase(),
        source,
        label: LABEL.exec(source)?.[1] ?? null,
        attributes: normaliseAttributes(node.attributes),
      });
      return undefined;
    },
    () => undefined,
  );

  return found;
}

/**
 * Render plugin: each claimed inline directive becomes an
 * {@link EXTENSION_INLINE_ELEMENT} carrying `<keyPrefix>:<n>` and no children,
 * so the emphasis the parser found inside the brackets never reaches the DOM.
 * Unclaimed directives become their literal text.
 */
export function remarkInlineDirectives(options: {
  names: ReadonlySet<string>;
  keyPrefix: string;
}) {
  // `tree` is `unknown` and narrowed so the transformer stays assignable to
  // unified's `Transformer<Node, Node>`; `MdastNode` is looser than `Node`.
  return function transform(tree: unknown, file?: { value?: unknown }) {
    const source = typeof file?.value === "string" ? file.value : null;
    let index = 0;

    visitDirectives(
      tree as MdastNode,
      options.names,
      (node) => {
        node.data = {
          ...node.data,
          hName: EXTENSION_INLINE_ELEMENT,
          hProperties: {
            [EXTENSION_INLINE_KEY_ATTRIBUTE]: `${options.keyPrefix}:${index}`,
          },
        };
        node.children = [];
        index += 1;
        return undefined;
      },
      (node) => {
        const raw = sliceSource(source, node);
        if (raw === null) return undefined;

        return node.type === "textDirective"
          ? { type: "text", value: raw }
          : { type: "paragraph", children: [{ type: "text", value: raw }] };
      },
    );
  };
}
