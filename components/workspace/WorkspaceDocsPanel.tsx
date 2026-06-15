import Link from "next/link";
import { BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspaceGuideGroup } from "@/components/workspace/workspace-types";

export function WorkspaceDocsPanel({
  docs,
  activeSlug,
}: {
  docs: WorkspaceGuideGroup[];
  activeSlug?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-3">
        <Link href="/docs" className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" />
          <span>
            <span className="block text-sm font-semibold">Vault Docs</span>
            <span className="block text-xs text-muted-foreground">
              Official guides
            </span>
          </span>
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {docs.length > 0 ? (
          docs.map((group) => (
            <nav key={group.category} className="mb-4 grid gap-1">
              <p className="px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group.category}
              </p>
              {group.docs.map((doc) => (
                <Link
                  key={doc.id}
                  href={doc.href}
                  className={cn(
                    "rounded-[5px] px-2 py-1.5 text-sm transition",
                    doc.slug === activeSlug
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {doc.title}
                </Link>
              ))}
            </nav>
          ))
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No published docs.</p>
        )}
      </div>
    </div>
  );
}
