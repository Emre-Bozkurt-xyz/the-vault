import Link from "next/link";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";

type WorkspaceDocumentPreviewCardProps = {
  href: string;
  title: string;
  markdown: string;
  meta?: string;
};

export function WorkspaceDocumentPreviewCard({
  href,
  title,
  markdown,
  meta,
}: WorkspaceDocumentPreviewCardProps) {
  return (
    <article className="vault-doc-card">
      <Link href={href} className="vault-doc-link" aria-label={`Open ${title}`}>
        <div className="vault-doc-preview">
          <div className="vault-doc-preview-sheet">
            <div className="vault-doc-preview-edge" />
            <div className="vault-doc-preview-content">
              <MarkdownDocument
                markdown={markdown || " "}
                compact
                contained={false}
                disableLinks
              />
            </div>
            <div className="vault-doc-preview-fade" />
          </div>
        </div>
        <div className="vault-doc-body">
          <h2 className="vault-doc-title text-sm font-semibold">{title}</h2>
          {meta ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
