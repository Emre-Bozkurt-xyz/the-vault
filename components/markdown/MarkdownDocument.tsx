import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema, type Schema } from "hast-util-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MarkdownDocumentProps = {
  markdown: string;
  className?: string;
  compact?: boolean;
  disableLinks?: boolean;
};

const allowedLinkProtocol = /^(https?:|mailto:|\/|#)/i;
const allowedImageProtocol = /^(https?:|\/)/i;

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
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "id",
      "title",
      "className",
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

function createMarkdownComponents(disableLinks: boolean): Components {
  return {
  h1({ children }) {
    return <h1 className="vault-md-h1">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="vault-md-h2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="vault-md-h3">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="vault-md-h4">{children}</h4>;
  },
  h5({ children }) {
    return <h5 className="vault-md-h5">{children}</h5>;
  },
  h6({ children }) {
    return <h6 className="vault-md-h6">{children}</h6>;
  },
  p({ children }) {
    return <p className="vault-md-p">{children}</p>;
  },
  div({ children, className }) {
    return <div className={cn("vault-md-html-block", className)}>{children}</div>;
  },
  span({ children, className }) {
    return <span className={cn("vault-md-html-inline", className)}>{children}</span>;
  },
  section({ children, className }) {
    return <section className={cn("vault-md-section", className)}>{children}</section>;
  },
  article({ children, className }) {
    return <article className={cn("vault-md-section", className)}>{children}</article>;
  },
  aside({ children, className }) {
    return <aside className={cn("vault-md-aside", className)}>{children}</aside>;
  },
  header({ children, className }) {
    return <header className={cn("vault-md-html-block", className)}>{children}</header>;
  },
  footer({ children, className }) {
    return <footer className={cn("vault-md-html-block", className)}>{children}</footer>;
  },
  figure({ children, className }) {
    return <figure className={cn("vault-md-figure", className)}>{children}</figure>;
  },
  figcaption({ children, className }) {
    return <figcaption className={cn("vault-md-figcaption", className)}>{children}</figcaption>;
  },
  details({ children, className }) {
    return <details className={cn("vault-md-details", className)}>{children}</details>;
  },
  summary({ children, className }) {
    return <summary className={cn("vault-md-summary", className)}>{children}</summary>;
  },
  mark({ children, className }) {
    return <mark className={cn("vault-md-mark", className)}>{children}</mark>;
  },
  small({ children, className }) {
    return <small className={cn("vault-md-small", className)}>{children}</small>;
  },
  sub({ children, className }) {
    return <sub className={cn("vault-md-sub", className)}>{children}</sub>;
  },
  sup({ children, className }) {
    return <sup className={cn("vault-md-sup", className)}>{children}</sup>;
  },
  kbd({ children, className }) {
    return <kbd className={cn("vault-md-kbd", className)}>{children}</kbd>;
  },
  abbr({ children, title, className }) {
    return (
      <abbr title={title} className={cn("vault-md-abbr", className)}>
        {children}
      </abbr>
    );
  },
  dl({ children, className }) {
    return <dl className={cn("vault-md-dl", className)}>{children}</dl>;
  },
  dt({ children, className }) {
    return <dt className={cn("vault-md-dt", className)}>{children}</dt>;
  },
  dd({ children, className }) {
    return <dd className={cn("vault-md-dd", className)}>{children}</dd>;
  },
  img({ src, alt, title, className }) {
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
        className={cn("vault-md-img", className)}
      />
    );
  },
  ul({ children, className }) {
    return <ul className={cn("vault-md-ul", className)}>{children}</ul>;
  },
  ol({ children }) {
    return <ol className="vault-md-ol">{children}</ol>;
  },
  li({ children, className }) {
    return <li className={cn("vault-md-li", className)}>{children}</li>;
  },
  blockquote({ children }) {
    return <blockquote className="vault-md-blockquote">{children}</blockquote>;
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
  pre({ children }) {
    return <pre className="vault-md-pre">{children}</pre>;
  },
  code({ children, className }) {
    return <code className={cn("vault-md-code", className)}>{children}</code>;
  },
  strong({ children }) {
    return <strong className="vault-md-strong">{children}</strong>;
  },
  em({ children }) {
    return <em className="vault-md-em">{children}</em>;
  },
  a({ href, children }) {
    if (disableLinks) {
      return <span className="vault-md-link">{children}</span>;
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
        className="vault-md-link"
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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, safeHtmlSchema]]}
        components={createMarkdownComponents(disableLinks)}
      >
        {markdown || "_No content yet._"}
      </ReactMarkdown>
    </div>
  );
}
