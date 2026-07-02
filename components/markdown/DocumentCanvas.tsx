import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  applySnippetScope,
  isValidSnippetScope,
  snippetScopeAttribute,
} from "@/lib/snippets/scope";

type DocumentCanvasProps = {
  /** The document whose body this canvas wraps. Used as the snippet scope. */
  documentId?: string;
  /**
   * Compiled, sanitized snippet CSS (with the scope placeholder). When present
   * and `documentId` is valid, it is scoped to this document and injected as a
   * single nonce'd <style>, and the containment scope attribute is applied.
   */
  snippetCss?: string | null;
  /** CSP nonce for the injected <style> element (from middleware). */
  nonce?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * Shared wrapper for rendered document bodies across every read surface
 * (workspace doc view, /public, /workspace/public, /share). It is the single
 * anchor point for CSS snippet application: it applies the scope attribute and
 * injects the scoped stylesheet, and its CSS establishes containment so snippet
 * styling can never paint or position outside the document body.
 *
 * With no snippet CSS it is a transparent wrapper (no containment cost).
 */
export function DocumentCanvas({
  documentId,
  snippetCss,
  nonce,
  className,
  style,
  children,
}: DocumentCanvasProps) {
  const scopeActive =
    Boolean(snippetCss) &&
    typeof documentId === "string" &&
    isValidSnippetScope(documentId);

  const scopedCss =
    scopeActive && snippetCss
      ? applySnippetScope(snippetCss, documentId as string)
      : null;

  return (
    <div
      className={cn("vault-document-canvas", className)}
      {...(scopeActive
        ? { [snippetScopeAttribute]: documentId as string }
        : {})}
      style={style}
    >
      {scopedCss ? (
        <style
          data-vault-snippets=""
          nonce={nonce}
          // Compiled CSS is AST-re-serialized and rejects `<`/`>`; safe to inline.
          dangerouslySetInnerHTML={{ __html: scopedCss }}
        />
      ) : null}
      {children}
    </div>
  );
}
