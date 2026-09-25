"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { codeLanguageLabel } from "@/lib/code/languages";

const subscribeNever = () => () => {};

/**
 * The embed API renders documents with `renderToStaticMarkup`, which never
 * hydrates. Copy is progressive enhancement, so it must not appear in markup
 * that can never wire it up — a dead button is worse than no button.
 */
function useInteractive() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

function CopyButton({ read, className, label }: { read: () => string; className: string; label: string }) {
  const [copied, setCopied] = useState<"Copied" | "Copy failed" | null>(null);
  return (
    <button
      type="button"
      className={className}
      aria-label={copied ?? label}
      title={copied ?? "Copy"}
      data-copied={copied === "Copied" ? "true" : undefined}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(read());
          setCopied("Copied");
        } catch {
          setCopied("Copy failed");
        }
        window.setTimeout(() => setCopied(null), 1400);
      }}
    >
      {copied === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

export function CodeBlock({ children, source, info, className, style }: {
  children: ReactNode;
  source: string;
  info: string;
  className?: string;
  style?: CSSProperties;
}) {
  const interactive = useInteractive();
  return (
    <div className="vault-md-code-block">
      <div className="vault-md-code-header">
        {/* The fence body ends in a newline; Live mode copies without it, and so does this. */}
        {interactive ? <CopyButton read={() => source.replace(/\n$/, "")} className="vault-md-code-copy" label="Copy code" /> : null}
        <span className="vault-code-language">{codeLanguageLabel(info)}</span>
      </div>
      <pre className={className} style={style}>{children}</pre>
    </div>
  );
}

/**
 * Inline code with a copy button that appears over its end on hover. Before
 * hydration — and forever, in the static embed — it is exactly the `<code>`
 * it always was.
 */
export function InlineCode({ children, className, style }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const interactive = useInteractive();
  const ref = useRef<HTMLElement>(null);
  // Inline code inside a link, button or summary gets no button of its own: a
  // button there is invalid HTML, and its click would also follow the link.
  const [nested, setNested] = useState(true);
  useEffect(() => {
    setNested(!!ref.current?.parentElement?.closest("a, button, summary, label"));
  }, [interactive]);
  if (!interactive) return <code className={className} style={style}>{children}</code>;
  return (
    <span className="vault-md-inline-code">
      <code ref={ref} className={className} style={style}>{children}</code>
      {nested ? null : <CopyButton read={() => ref.current?.textContent ?? ""} className="vault-md-inline-copy" label="Copy inline code" />}
    </span>
  );
}
