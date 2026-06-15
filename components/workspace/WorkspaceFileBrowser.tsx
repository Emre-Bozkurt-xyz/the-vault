import Link from "next/link";
import { FilePlus2, FileText, Globe2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createDocumentAction } from "@/server/documents";
import { cn } from "@/lib/utils";
import type { WorkspaceDocumentItem } from "@/components/workspace/workspace-types";

type WorkspaceFileBrowserProps = {
  owned: WorkspaceDocumentItem[];
  shared: WorkspaceDocumentItem[];
  published: WorkspaceDocumentItem[];
  activeHref?: string;
};

export function WorkspaceFileBrowser({
  owned,
  shared,
  published,
  activeHref,
}: WorkspaceFileBrowserProps) {
  const recent = [...owned, ...shared]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Vault
          </p>
          <h2 className="text-sm font-semibold">Files</h2>
        </div>
        <form action={createDocumentAction}>
          <Button type="submit" variant="ghost" size="icon-sm" title="New document">
            <FilePlus2 className="size-4" />
          </Button>
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <WorkspaceSection
          title="Recent"
          items={recent}
          icon={FileText}
          activeHref={activeHref}
          emptyText="No recent documents"
        />
        <WorkspaceSection
          title="My documents"
          items={owned}
          icon={FileText}
          activeHref={activeHref}
          emptyText="No private documents"
        />
        <WorkspaceSection
          title="Shared with me"
          items={shared}
          icon={Share2}
          activeHref={activeHref}
          emptyText="No shared documents"
        />
        <WorkspaceSection
          title="Published"
          items={published}
          icon={Globe2}
          activeHref={activeHref}
          emptyText="No published documents"
        />
      </div>
    </div>
  );
}

function WorkspaceSection({
  title,
  items,
  icon: Icon,
  activeHref,
  emptyText,
}: {
  title: string;
  items: WorkspaceDocumentItem[];
  icon: typeof FileText;
  activeHref?: string;
  emptyText: string;
}) {
  return (
    <section className="mb-3">
      <div className="flex items-center justify-between px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>{title}</span>
        <span>{items.length}</span>
      </div>
      <div className="grid gap-0.5">
        {items.length > 0 ? (
          items.map((item) => (
            <Link
              key={`${title}-${item.id}`}
              href={item.href}
              className={cn(
                "group flex min-w-0 items-center gap-2 rounded-[5px] px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                activeHref === item.href && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {item.visibility === "public" ? (
                <Globe2 className="size-3 shrink-0 opacity-60" />
              ) : null}
            </Link>
          ))
        ) : (
          <p className="px-2 py-1 text-xs text-muted-foreground/70">{emptyText}</p>
        )}
      </div>
    </section>
  );
}
