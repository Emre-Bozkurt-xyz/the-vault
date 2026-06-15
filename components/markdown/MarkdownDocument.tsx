import {
  AlertTriangle,
  Bug,
  Check,
  CheckCircle2,
  Flame,
  FileText,
  HelpCircle,
  Info,
  Lightbulb,
  ListTodo,
  Quote,
  type LucideIcon,
  Pencil,
  XCircle,
} from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema, type Schema } from "hast-util-sanitize";
import remarkGfm from "remark-gfm";

import { inlineStyleToReactStyle, sanitizeInlineStyle } from "@/lib/html-style";
import { cn } from "@/lib/utils";
import {
  extractMarkdownTarget,
  normalizeWikiFragmentForHref,
  splitWikiDocumentEmbeds,
  slugifyMarkdownHeading,
  transformWikiLinks,
  type WikiDocumentEmbedBlock,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";

type MarkdownDocumentProps = {
  markdown: string;
  className?: string;
  compact?: boolean;
  contained?: boolean;
  disableLinks?: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  embedDepth?: number;
  embedTrail?: string[];
};

const maxWikiEmbedDepth = 2;

const allowedLinkProtocol = /^(https?:|mailto:|\/|#)/i;
const allowedImageProtocol = /^(https?:|\/)/i;
const iframeSandbox =
  "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
const iframeAllow =
  "accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share";
const allowedIframeProviders = [
  {
    hosts: new Set(["www.youtube.com", "youtube.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["www.youtube-nocookie.com", "youtube-nocookie.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["open.spotify.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["embed.tidal.com"]),
    path: /^\/(tracks|albums|playlists|mixes|videos)\//,
  },
  {
    hosts: new Set(["player.vimeo.com"]),
    path: /^\/video\//,
  },
  {
    hosts: new Set(["w.soundcloud.com"]),
    path: /^\/player\//,
  },
  {
    hosts: new Set(["embed.music.apple.com"]),
    path: /^\//,
  },
  {
    hosts: new Set<string>(),
    hostPattern: /(^|\.)bandcamp\.com$/,
    path: /^\/EmbeddedPlayer\//,
  },
] as const;

type CalloutDefinition = {
  type: string;
  title: string;
  icon: LucideIcon;
  iconName: string;
};

const calloutDefinitions = {
  note: {
    type: "note",
    title: "Note",
    icon: Pencil,
    iconName: "lucide-pencil",
  },
  abstract: {
    type: "abstract",
    title: "Abstract",
    icon: ListTodo,
    iconName: "lucide-list",
  },
  info: {
    type: "info",
    title: "Info",
    icon: Info,
    iconName: "lucide-info",
  },
  todo: {
    type: "todo",
    title: "Todo",
    icon: CheckCircle2,
    iconName: "lucide-check-circle-2",
  },
  tip: {
    type: "tip",
    title: "Tip",
    icon: Lightbulb,
    iconName: "lucide-lightbulb",
  },
  success: {
    type: "success",
    title: "Success",
    icon: Check,
    iconName: "lucide-check",
  },
  question: {
    type: "question",
    title: "Question",
    icon: HelpCircle,
    iconName: "lucide-help-circle",
  },
  warning: {
    type: "warning",
    title: "Warning",
    icon: AlertTriangle,
    iconName: "lucide-alert-triangle",
  },
  failure: {
    type: "failure",
    title: "Failure",
    icon: XCircle,
    iconName: "lucide-x-circle",
  },
  danger: {
    type: "danger",
    title: "Danger",
    icon: Flame,
    iconName: "lucide-flame",
  },
  bug: {
    type: "bug",
    title: "Bug",
    icon: Bug,
    iconName: "lucide-bug",
  },
  example: {
    type: "example",
    title: "Example",
    icon: ListTodo,
    iconName: "lucide-list",
  },
  quote: {
    type: "quote",
    title: "Quote",
    icon: Quote,
    iconName: "lucide-quote",
  },
} satisfies Record<string, CalloutDefinition>;

const calloutAliases = new Map<string, keyof typeof calloutDefinitions>([
  ["summary", "abstract"],
  ["tldr", "abstract"],
  ["hint", "tip"],
  ["important", "tip"],
  ["check", "success"],
  ["done", "success"],
  ["help", "question"],
  ["faq", "question"],
  ["caution", "warning"],
  ["attention", "warning"],
  ["fail", "failure"],
  ["missing", "failure"],
  ["error", "danger"],
  ["cite", "quote"],
]);

const safeHtmlSchema: Schema = {
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

function rehypeSanitizeInlineStyles() {
  return function transform(tree: HastNode) {
    visitHastNode(tree, (node) => {
      const style = sanitizeInlineStyle(node.properties?.style);

      if (style) {
        node.properties = { ...node.properties, style };
        return;
      }

      if (node.properties && "style" in node.properties) {
        delete node.properties.style;
        const properties = node.properties;
        node.properties = properties;
      }
    });
  };
}

function visitHastNode(node: HastNode, visitor: (node: HastNode) => void) {
  if (node.type === "element") {
    visitor(node);
  }

  for (const child of node.children ?? []) {
    visitHastNode(child, visitor);
  }
}

function styledProps(
  baseClassName: string,
  className?: string,
  style?: unknown,
) {
  return {
    className: cn(baseClassName, className),
    style: inlineStyleToReactStyle(style),
  };
}

function safeIframeSrc(src: unknown) {
  if (typeof src !== "string") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = allowedIframeProviders.some((provider) => {
    const hostMatches =
      provider.hosts.has(hostname) ||
      ("hostPattern" in provider && provider.hostPattern.test(hostname));

    return hostMatches && provider.path.test(url.pathname);
  });

  return allowed ? url.toString() : null;
}

function iframeDimension(value: unknown, fallback: number, max: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeSelfClosingIframes(markdown: string) {
  return markdown.replace(/<iframe\b([^>]*)\/>/gi, "<iframe$1></iframe>");
}

function createMarkdownComponents(
  disableLinks: boolean,
  headingIds: Map<string, number>,
): Components {
  const headingProps = (
    children: ReactNode,
    baseClassName: string,
    className?: string,
    style?: unknown,
  ) => {
    const baseSlug = slugifyMarkdownHeading(reactNodeToText(children));
    const count = headingIds.get(baseSlug) ?? 0;
    headingIds.set(baseSlug, count + 1);

    return {
      id: count === 0 ? baseSlug : `${baseSlug}-${count}`,
      ...styledProps(baseClassName, className, style),
    };
  };

  return {
  h1({ children, className, style }) {
    return <h1 {...headingProps(children, "vault-md-h1", className, style)}>{children}</h1>;
  },
  h2({ children, className, style }) {
    return <h2 {...headingProps(children, "vault-md-h2", className, style)}>{children}</h2>;
  },
  h3({ children, className, style }) {
    return <h3 {...headingProps(children, "vault-md-h3", className, style)}>{children}</h3>;
  },
  h4({ children, className, style }) {
    return <h4 {...headingProps(children, "vault-md-h4", className, style)}>{children}</h4>;
  },
  h5({ children, className, style }) {
    return <h5 {...headingProps(children, "vault-md-h5", className, style)}>{children}</h5>;
  },
  h6({ children, className, style }) {
    return <h6 {...headingProps(children, "vault-md-h6", className, style)}>{children}</h6>;
  },
  p({ children, className, style }) {
    return <p {...styledProps("vault-md-p", className, style)}>{children}</p>;
  },
  div({ children, className, style }) {
    return <div {...styledProps("vault-md-html-block", className, style)}>{children}</div>;
  },
  span({ children, className, style }) {
    return <span {...styledProps("vault-md-html-inline", className, style)}>{children}</span>;
  },
  section({ children, className, style }) {
    return <section {...styledProps("vault-md-section", className, style)}>{children}</section>;
  },
  article({ children, className, style }) {
    return <article {...styledProps("vault-md-section", className, style)}>{children}</article>;
  },
  aside({ children, className, style }) {
    return <aside {...styledProps("vault-md-aside", className, style)}>{children}</aside>;
  },
  header({ children, className, style }) {
    return <header {...styledProps("vault-md-html-block", className, style)}>{children}</header>;
  },
  footer({ children, className, style }) {
    return <footer {...styledProps("vault-md-html-block", className, style)}>{children}</footer>;
  },
  figure({ children, className, style }) {
    return <figure {...styledProps("vault-md-figure", className, style)}>{children}</figure>;
  },
  figcaption({ children, className, style }) {
    return <figcaption {...styledProps("vault-md-figcaption", className, style)}>{children}</figcaption>;
  },
  details({ children, className, style }) {
    return <details {...styledProps("vault-md-details", className, style)}>{children}</details>;
  },
  summary({ children, className, style }) {
    return <summary {...styledProps("vault-md-summary", className, style)}>{children}</summary>;
  },
  mark({ children, className, style }) {
    return <mark {...styledProps("vault-md-mark", className, style)}>{children}</mark>;
  },
  small({ children, className, style }) {
    return <small {...styledProps("vault-md-small", className, style)}>{children}</small>;
  },
  sub({ children, className, style }) {
    return <sub {...styledProps("vault-md-sub", className, style)}>{children}</sub>;
  },
  sup({ children, className, style }) {
    return <sup {...styledProps("vault-md-sup", className, style)}>{children}</sup>;
  },
  kbd({ children, className, style }) {
    return <kbd {...styledProps("vault-md-kbd", className, style)}>{children}</kbd>;
  },
  abbr({ children, title, className, style }) {
    return (
      <abbr title={title} {...styledProps("vault-md-abbr", className, style)}>
        {children}
      </abbr>
    );
  },
  dl({ children, className, style }) {
    return <dl {...styledProps("vault-md-dl", className, style)}>{children}</dl>;
  },
  dt({ children, className, style }) {
    return <dt {...styledProps("vault-md-dt", className, style)}>{children}</dt>;
  },
  dd({ children, className, style }) {
    return <dd {...styledProps("vault-md-dd", className, style)}>{children}</dd>;
  },
  img({ src, alt, title, className, style }) {
    const safeSrc =
      typeof src === "string" && allowedImageProtocol.test(src) ? src : null;

    if (!safeSrc) {
      return null;
    }

    return (
      <span className="vault-md-image-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={safeSrc}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          decoding="async"
          {...styledProps("vault-md-img", className, style)}
        />
        <span className="vault-md-image-fallback">
          Image unavailable
        </span>
      </span>
    );
  },
  iframe({ src, title, width, height, className, style }) {
    const safeSrc = safeIframeSrc(src);

    if (!safeSrc) {
      return null;
    }

    const embedWidth = iframeDimension(width, 560, 1200);
    const embedHeight = iframeDimension(height, 315, 900);

    return (
      <iframe
        src={safeSrc}
        title={typeof title === "string" ? title : "Embedded media"}
        width={embedWidth}
        height={embedHeight}
        allow={iframeAllow}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox={iframeSandbox}
        {...styledProps("vault-md-iframe", className, style)}
      />
    );
  },
  ul({ children, className, style }) {
    return <ul {...styledProps("vault-md-ul", className, style)}>{children}</ul>;
  },
  ol({ children, className, style }) {
    return <ol {...styledProps("vault-md-ol", className, style)}>{children}</ol>;
  },
  li({ children, className, style }) {
    return <li {...styledProps("vault-md-li", className, style)}>{children}</li>;
  },
  blockquote({ children, className, style }) {
    const callout = parseCalloutChildren(children);

    if (callout) {
      return <Callout {...callout} />;
    }

    return <blockquote {...styledProps("vault-md-blockquote", className, style)}>{children}</blockquote>;
  },
  hr() {
    return <hr className="vault-md-hr" />;
  },
  table({ children }) {
    return (
      <div className="vault-md-table-wrap">
        <table className="vault-md-table">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="vault-md-th">{children}</th>;
  },
  td({ children }) {
    return <td className="vault-md-td">{children}</td>;
  },
  pre({ children, className, style }) {
    return <pre {...styledProps("vault-md-pre", className, style)}>{children}</pre>;
  },
  code({ children, className, style }) {
    return <code {...styledProps("vault-md-code", className, style)}>{children}</code>;
  },
  strong({ children, className, style }) {
    return <strong {...styledProps("vault-md-strong", className, style)}>{children}</strong>;
  },
  em({ children, className, style }) {
    return <em {...styledProps("vault-md-em", className, style)}>{children}</em>;
  },
  a({ href, children, className, style }) {
    if (disableLinks) {
      return <span {...styledProps("vault-md-link", className, style)}>{children}</span>;
    }

    const safeHref = href && allowedLinkProtocol.test(href) ? href : "#";

    return (
      <a
        href={safeHref}
        rel="noreferrer"
        target={
          safeHref.startsWith("/") || safeHref.startsWith("#")
            ? undefined
            : "_blank"
        }
        {...styledProps("vault-md-link", className, style)}
      >
        {children}
      </a>
    );
  },
  input(props) {
    return <input {...props} className="vault-md-checkbox" disabled />;
  },
  };
}

function Callout({
  inputType,
  canonicalType,
  metadata,
  title,
  body,
}: {
  inputType: string;
  canonicalType: string;
  metadata: string;
  title: string;
  body: ReactNode[];
}) {
  const definition =
    calloutDefinitions[canonicalType as keyof typeof calloutDefinitions] ??
    calloutDefinitions.note;
  const Icon = definition.icon;
  const header = (
    <div className="callout-title">
      <span
        className="callout-icon"
        data-callout-icon={definition.iconName}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="callout-title-inner">{title || definition.title}</span>
    </div>
  );

  if (metadata === "+" || metadata === "-") {
    return (
      <details
        className="callout"
        data-callout={inputType}
        data-callout-fold={metadata}
        data-callout-resolved={definition.type}
        open={metadata === "+"}
      >
        <summary className="callout-summary">{header}</summary>
        {body.length > 0 ? <div className="callout-content">{body}</div> : null}
      </details>
    );
  }

  return (
    <div
      className="callout"
      data-callout={inputType}
      data-callout-resolved={definition.type}
    >
      {header}
      {body.length > 0 ? <div className="callout-content">{body}</div> : null}
    </div>
  );
}

function parseCalloutChildren(children: ReactNode) {
  const childArray = Children.toArray(children);
  const firstElementIndex = childArray.findIndex((child) => isValidElement(child));
  const firstChild = childArray[firstElementIndex];
  const restChildren = childArray.slice(firstElementIndex + 1);

  if (!isValidElement(firstChild)) {
    return null;
  }

  const firstParagraphChildren = getElementChildren(firstChild);
  const rawFirstParagraphText = reactNodeToText(firstParagraphChildren);
  const markerOffset =
    rawFirstParagraphText.length - rawFirstParagraphText.trimStart().length;
  const firstParagraphText = rawFirstParagraphText.slice(markerOffset);
  const [markerLine = "", ...sameParagraphBodyLines] =
    firstParagraphText.split(/\r?\n/);
  const match = markerLine.match(/^\[!([^\]\s]+)\]([+-])?\s*(.*)$/i);

  if (!match) {
    return null;
  }

  const inputType = normalizeCalloutType(match[1]);
  const metadata = match[2] ?? "";
  const canonicalType = calloutAliases.get(inputType) ?? inputType;
  const definition =
    calloutDefinitions[canonicalType as keyof typeof calloutDefinitions] ??
    calloutDefinitions.note;
  const title = match[3]?.trim() || definition.title;
  const sameParagraphBody = trimLeadingWhitespaceFromNodes(
    extractReactNodesAfterTextOffset(
      firstParagraphChildren,
      markerOffset + markerLine.length,
    ),
  );

  return {
    inputType,
    canonicalType,
    metadata,
    title,
    body: [
      ...createCalloutBodyFromMarkerParagraph(
        sameParagraphBodyLines,
        sameParagraphBody,
      ),
      ...restChildren,
    ],
  };
}

function createCalloutBodyFromMarkerParagraph(
  bodyLines: string[],
  preservedBodyChildren: ReactNode[],
) {
  if (preservedBodyChildren.length > 0) {
    const lines = splitReactNodesByLine(preservedBodyChildren)
      .map((line) => trimLeadingWhitespaceFromNodes(line))
      .filter((line) => reactNodeToText(line).trim().length > 0);

    if (lines.length > 0) {
      return lines.map((line, index) => (
        <p key={`callout-body-${index}`} className="vault-md-p">
          {line}
        </p>
      ));
    }
  }

  const bodyText = bodyLines.join("\n").trim();

  if (!bodyText) {
    return [];
  }

  return bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => (
      <p key={`callout-body-${index}`} className="vault-md-p">
        {line}
      </p>
    ));
}

function splitReactNodesByLine(nodes: ReactNode[]) {
  const lines: ReactNode[][] = [[]];

  const pushNode = (node: ReactNode) => {
    lines[lines.length - 1].push(node);
  };

  const pushLineBreaks = (parts: string[]) => {
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }

      if (part) {
        pushNode(part);
      }
    });
  };

  nodes.forEach((node) => {
    if (node === null || node === undefined || typeof node === "boolean") {
      return;
    }

    if (typeof node === "string" || typeof node === "number") {
      pushLineBreaks(String(node).split(/\r?\n/));
      return;
    }

    pushNode(node);
  });

  return lines;
}

function getElementChildren(element: ReactElement) {
  return (element.props as { children?: ReactNode }).children;
}

function extractReactNodesAfterTextOffset(node: ReactNode, offset: number) {
  const extracted: ReactNode[] = [];
  let consumed = 0;

  const visit = (child: ReactNode) => {
    if (child === null || child === undefined || typeof child === "boolean") {
      return;
    }

    if (typeof child === "string" || typeof child === "number") {
      const text = String(child);
      const nextConsumed = consumed + text.length;

      if (nextConsumed > offset) {
        extracted.push(consumed < offset ? text.slice(offset - consumed) : child);
      }

      consumed = nextConsumed;
      return;
    }

    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }

    if (isValidElement(child)) {
      const childText = reactNodeToText(getElementChildren(child));
      const nextConsumed = consumed + childText.length;

      if (nextConsumed <= offset) {
        consumed = nextConsumed;
        return;
      }

      if (consumed >= offset) {
        extracted.push(child);
        consumed = nextConsumed;
        return;
      }

      const nestedChildren = extractReactNodesAfterTextOffset(
        getElementChildren(child),
        offset - consumed,
      );
      extracted.push(
        cloneElement(
          child as ReactElement<{ children?: ReactNode }>,
          undefined,
          ...nestedChildren,
        ),
      );
      consumed = nextConsumed;
    }
  };

  Children.toArray(node).forEach(visit);

  return extracted;
}

function trimLeadingWhitespaceFromNodes(nodes: ReactNode[]) {
  let foundContent = false;
  const trimmed: ReactNode[] = [];

  for (const node of nodes) {
    if (foundContent) {
      trimmed.push(node);
      continue;
    }

    if (typeof node === "string" || typeof node === "number") {
      const value = String(node).replace(/^\s+/, "");

      if (value) {
        foundContent = true;
        trimmed.push(value);
      }

      continue;
    }

    if (isValidElement(node)) {
      const children = getElementChildren(node);
      const trimmedChildren = trimLeadingWhitespaceFromNodes(
        Children.toArray(children),
      );

      if (trimmedChildren.length > 0) {
        foundContent = true;
        trimmed.push(
          cloneElement(
            node as ReactElement<{ children?: ReactNode }>,
            undefined,
            ...trimmedChildren,
          ),
        );
      }

      continue;
    }

    trimmed.push(node);
    foundContent = true;
  }

  return trimmed;
}

function reactNodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(reactNodeToText).join("");
  }

  if (isValidElement(node)) {
    return reactNodeToText(getElementChildren(node));
  }

  return "";
}

function normalizeCalloutType(type: string) {
  return type.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function MarkdownDocument({
  markdown,
  className,
  compact = false,
  contained = true,
  disableLinks = false,
  wikiLinks,
  embedDepth = 0,
  embedTrail = [],
}: MarkdownDocumentProps) {
  const sourceMarkdown = normalizeSelfClosingIframes(markdown || "_No content yet._");
  const blocks = splitWikiDocumentEmbeds(sourceMarkdown, wikiLinks);
  const headingIds = new Map<string, number>();

  return (
    <div
      className={cn(
        "vault-markdown",
        contained ? "mx-auto max-w-3xl" : null,
        compact ? "vault-markdown-compact" : null,
        className,
      )}
    >
      {blocks.map((block, index) =>
        block.type === "markdown" ? (
          <MarkdownSegment
            key={`markdown-${index}`}
            markdown={block.markdown}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            headingIds={headingIds}
          />
        ) : block.type === "region" ? (
          <VaultRegion
            key={`region-${index}-${block.id}`}
            block={block}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            embedDepth={embedDepth}
            embedTrail={embedTrail}
          />
        ) : (
          <WikiDocumentEmbed
            key={`embed-${index}-${block.target}`}
            block={block}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            embedDepth={embedDepth}
            embedTrail={embedTrail}
          />
        ),
      )}
    </div>
  );
}

function VaultRegion({
  block,
  disableLinks,
  wikiLinks,
  embedDepth,
  embedTrail,
}: {
  block: Extract<WikiDocumentEmbedBlock, { type: "region" }>;
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  embedDepth: number;
  embedTrail: string[];
}) {
  const body = block.markdown ? (
    <MarkdownDocument
      markdown={block.markdown}
      wikiLinks={wikiLinks}
      disableLinks={disableLinks}
      embedDepth={embedDepth}
      embedTrail={embedTrail}
      contained={false}
      className="vault-md-region-body"
    />
  ) : null;

  if (block.foldable) {
    return (
      <details
        id={block.id}
        className="vault-md-region vault-md-region-foldable"
        data-region-id={block.id}
        open={!block.collapsed}
      >
        <summary className="vault-md-region-summary">
          <span className="vault-md-region-caret" aria-hidden="true" />
          <span className="vault-md-region-title">{block.title}</span>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section
      id={block.id}
      className="vault-md-region vault-md-region-static"
      data-region-id={block.id}
    >
      {body}
    </section>
  );
}

function MarkdownSegment({
  markdown,
  disableLinks,
  wikiLinks,
  headingIds,
}: {
  markdown: string;
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  headingIds: Map<string, number>;
}) {
  const renderedMarkdown = transformWikiLinks(markdown, wikiLinks);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, safeHtmlSchema],
        rehypeSanitizeInlineStyles,
      ]}
      components={createMarkdownComponents(disableLinks, headingIds)}
    >
      {renderedMarkdown}
    </ReactMarkdown>
  );
}

function WikiDocumentEmbed({
  block,
  disableLinks,
  wikiLinks,
  embedDepth,
  embedTrail,
}: {
  block: Extract<WikiDocumentEmbedBlock, { type: "embed" }>;
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  embedDepth: number;
  embedTrail: string[];
}) {
  const resolution = block.resolution;
  const title = resolution?.label || block.label || block.target;
  const documentId = resolution?.documentId;
  const href =
    resolution?.href && block.fragment
      ? `${resolution.href}#${encodeURIComponent(normalizeWikiFragmentForHref(block.fragment))}`
      : resolution?.href;
  const isRecursive = Boolean(documentId && embedTrail.includes(documentId));
  const canRender =
    resolution?.status === "resolved" &&
    typeof resolution.embedMarkdown === "string" &&
    !isRecursive &&
    embedDepth < maxWikiEmbedDepth;

  return (
    <section
      className={cn(
        "vault-md-document-embed",
        canRender ? null : "vault-md-document-embed-unavailable",
      )}
      data-embed-status={resolution?.status ?? "unresolved"}
    >
      <div className="vault-md-document-embed-header">
        <span className="vault-md-document-embed-icon" aria-hidden="true">
          <FileText className="size-4" />
        </span>
        {href && !disableLinks ? (
          <a className="vault-md-document-embed-title" href={href}>
            {title}
          </a>
        ) : (
          <span className="vault-md-document-embed-title">{title}</span>
        )}
      </div>
      {canRender ? (
        <MarkdownDocument
          markdown={extractMarkdownTarget(
            resolution.embedMarkdown ?? "",
            block.fragment,
          )}
          wikiLinks={wikiLinks}
          disableLinks={disableLinks}
          embedDepth={embedDepth + 1}
          embedTrail={documentId ? [...embedTrail, documentId] : embedTrail}
          contained={false}
          className="vault-md-document-embed-body"
        />
      ) : (
        <p className="vault-md-document-embed-message">
          {isRecursive
            ? "Recursive embed skipped."
            : embedDepth >= maxWikiEmbedDepth
              ? "Embed depth limit reached."
              : resolution?.status === "private"
                ? "Document is private or unavailable here."
                : resolution?.status === "ambiguous"
                  ? "Ambiguous document embed."
                  : "Document embed could not be resolved."}
        </p>
      )}
    </section>
  );
}
