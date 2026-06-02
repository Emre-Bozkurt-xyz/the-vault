import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema, type Schema } from "hast-util-sanitize";
import remarkGfm from "remark-gfm";

import { inlineStyleToReactStyle, sanitizeInlineStyle } from "@/lib/html-style";
import { cn } from "@/lib/utils";

type MarkdownDocumentProps = {
  markdown: string;
  className?: string;
  compact?: boolean;
  disableLinks?: boolean;
};

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

function createMarkdownComponents(disableLinks: boolean): Components {
  return {
  h1({ children, className, style }) {
    return <h1 {...styledProps("vault-md-h1", className, style)}>{children}</h1>;
  },
  h2({ children, className, style }) {
    return <h2 {...styledProps("vault-md-h2", className, style)}>{children}</h2>;
  },
  h3({ children, className, style }) {
    return <h3 {...styledProps("vault-md-h3", className, style)}>{children}</h3>;
  },
  h4({ children, className, style }) {
    return <h4 {...styledProps("vault-md-h4", className, style)}>{children}</h4>;
  },
  h5({ children, className, style }) {
    return <h5 {...styledProps("vault-md-h5", className, style)}>{children}</h5>;
  },
  h6({ children, className, style }) {
    return <h6 {...styledProps("vault-md-h6", className, style)}>{children}</h6>;
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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safeSrc}
        alt={alt ?? ""}
        title={title}
        loading="lazy"
        {...styledProps("vault-md-img", className, style)}
      />
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

export function MarkdownDocument({
  markdown,
  className,
  compact = false,
  disableLinks = false,
}: MarkdownDocumentProps) {
  return (
    <div
      className={cn(
        "vault-markdown mx-auto max-w-3xl",
        compact ? "vault-markdown-compact" : null,
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, safeHtmlSchema],
          rehypeSanitizeInlineStyles,
        ]}
        components={createMarkdownComponents(disableLinks)}
      >
        {normalizeSelfClosingIframes(markdown || "_No content yet._")}
      </ReactMarkdown>
    </div>
  );
}
