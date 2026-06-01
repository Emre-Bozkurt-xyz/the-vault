import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MarkdownDocumentProps = {
  markdown: string;
  className?: string;
  compact?: boolean;
  disableLinks?: boolean;
};

const allowedLinkProtocol = /^(https?:|mailto:|\/|#)/i;

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
  p({ children }) {
    return <p className="vault-md-p">{children}</p>;
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
        skipHtml
        components={createMarkdownComponents(disableLinks)}
      >
        {markdown || "_No content yet._"}
      </ReactMarkdown>
    </div>
  );
}
