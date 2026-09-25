"use client";

import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { codeLanguageLabel } from "@/lib/code/languages";

const subscribeNever = () => () => {};

export function CodeBlock({ children, source, info, className, style }: {
  children: ReactNode;
  source: string;
  info: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  // The embed API renders this tree with `renderToStaticMarkup`, which never
  // hydrates. Copy is progressive enhancement, so it must not appear in markup
  // that can never wire it up — a dead button is worse than no button.
  const interactive = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <div className="vault-md-code-block">
      <div className="vault-md-code-header">
        <span className="vault-code-language">{codeLanguageLabel(info)}</span>
        {interactive ? (
          <Button type="button" variant="ghost" size="xs" aria-label="Copy code" onClick={async () => {
            try {
              await navigator.clipboard.writeText(source);
              setCopied("Copied");
            } catch { setCopied("Copy failed"); }
          }} onBlur={() => setCopied(null)}>
            {copied === "Copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            <span aria-live="polite">{copied ?? "Copy"}</span>
          </Button>
        ) : null}
      </div>
      <pre className={className} style={style}>{children}</pre>
    </div>
  );
}
