import Link from "next/link";
import { FileText } from "lucide-react";

import {
  ContentInteractionControl,
  type ContentInteractionStats,
} from "@/components/content-interaction-control";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";

type WorkspaceDocumentPreviewCardProps = {
  href: string;
  targetId?: string;
  title: string;
  markdown: string;
  meta?: string;
  stats?: ContentInteractionStats;
};

export function WorkspaceDocumentPreviewCard({
  href,
  targetId,
  title,
  markdown,
  meta,
  stats,
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
          <p className="vault-doc-kicker">
            <FileText className="size-3.5" />
            Public document
          </p>
          <h2 className="vault-doc-title text-sm font-semibold">{title}</h2>
          {meta ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
          ) : null}
          {stats ? (
            <ContentInteractionControl
              targetKind="document"
              targetId={targetId ?? href}
              initialStats={stats}
              readOnly
              compact
              className="mt-3"
            />
          ) : null}
        </div>
      </Link>
    </article>
  );
}
