import { defaultSchema, type Schema } from "hast-util-sanitize";

import { sanitizeClassList } from "@/lib/html-class";
import { sanitizeInlineStyle } from "@/lib/html-style";

/**
 * HTML sanitize schema for rendered document content. This is the app's primary
 * content security boundary: user-authored raw HTML (from markdown) is
 * restricted to this tag/attribute allowlist. The `className` and inline
 * `style` attributes are additionally filtered by `rehypeSanitizeContent`
 * (below), which must run AFTER `rehype-sanitize`.
 */
export const safeHtmlSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "article",
    "aside",
    "section",
    "header",
    "footer",
    "main",
    "nav",
    "figure",
    "figcaption",
    "details",
    "summary",
    "mark",
    "small",
    "sub",
    "sup",
    "kbd",
    "samp",
    "var",
    "abbr",
    "address",
    "dl",
    "dt",
    "dd",
    "time",
    "div",
    "span",
    "br",
    "img",
    "iframe",
    // Emitted by `remarkCalc` for each inline `:calc[…]`, and mapped to the
    // `CalcValue` component by react-markdown. It must survive sanitization to
    // reach that mapping, so it is allowed as a tag — but it carries no content
    // of its own, only the lookup key below.
    "vault-calc",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "id",
      "title",
      "className",
      "style",
      "aria-label",
      "aria-describedby",
      "aria-hidden",
      "role",
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      "href",
      "title",
      "target",
      "rel",
    ],
    abbr: [...(defaultSchema.attributes?.abbr ?? []), "title"],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "src",
      "alt",
      "title",
      "width",
      "height",
      "loading",
    ],
    iframe: [
      "src",
      "title",
      "width",
      "height",
      "allow",
      "allowFullScreen",
      "allowfullscreen",
      "frameBorder",
      "frameborder",
      "loading",
      "referrerPolicy",
      "referrerpolicy",
      "sandbox",
      "style",
    ],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      "type",
      "checked",
      "disabled",
    ],
    time: [...(defaultSchema.attributes?.time ?? []), "dateTime"],
    // Scoped to the calc element rather than added to `"*"`: the key is only
    // meaningful on this tag, and widening the wildcard would let any authored
    // element carry it. Worst case for authored raw HTML is re-displaying a
    // value already computed elsewhere in the *same* document — the lookup map
    // is built per render, so it reaches no private or cross-document data.
    "vault-calc": ["data-calc-key", "dataCalcKey"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
  clobberPrefix: "vault-user-content-",
};

type HastNode = {
  type?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function visitHastNode(node: HastNode, visitor: (node: HastNode) => void) {
  if (node.type === "element") {
    visitor(node);
  }

  for (const child of node.children ?? []) {
    visitHastNode(child, visitor);
  }
}

/**
 * Post-sanitize pass that filters the surviving `style` and `className`
 * attributes down to their respective allowlists. Must run AFTER
 * `rehype-sanitize` so it operates on the already tag/attribute-filtered tree.
 */
export function rehypeSanitizeContent() {
  return function transform(tree: HastNode) {
    visitHastNode(tree, (node) => {
      const style = sanitizeInlineStyle(node.properties?.style);

      if (style) {
        node.properties = { ...node.properties, style };
      } else if (node.properties && "style" in node.properties) {
        delete node.properties.style;
      }

      if (node.properties && "className" in node.properties) {
        const className = sanitizeClassList(node.properties.className);

        if (className) {
          node.properties.className = className;
        } else {
          delete node.properties.className;
        }
      }
    });
  };
}
