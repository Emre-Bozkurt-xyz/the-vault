import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";

import { OfficialDocEditor } from "@/components/markdown/OfficialDocEditor";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WorkspacePageRegistration } from "@/components/workspace/WorkspaceChrome";
import { cn } from "@/lib/utils";
import { getOfficialDocForAdmin } from "@/server/official-docs";

export default async function AdminOfficialDocEditorPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const doc = await getOfficialDocForAdmin(docId);

  return (
    <>
      <WorkspacePageRegistration
        page={{
          type: "admin",
          title: doc.title,
          href: `/dashboard/admin/docs/${doc.id}`,
        }}
        rightPanel={<OfficialDocContextPanel doc={doc} />}
      />
      <section className="mx-auto grid w-full max-w-[86rem] gap-6 px-4 py-7 md:px-8">
        <header className="border-b border-border/70 pb-5">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Official documentation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight vault-display">
            {doc.title}
          </h1>
        </header>
        <OfficialDocEditor
          id={doc.id}
          title={doc.title}
          slug={doc.slug}
          category={doc.category}
          sortOrder={doc.sortOrder}
          markdown={doc.markdown}
          status={doc.status}
        />
      </section>
    </>
  );
}

type OfficialDocForAdmin = Awaited<ReturnType<typeof getOfficialDocForAdmin>>;

function OfficialDocContextPanel({ doc }: { doc: OfficialDocForAdmin }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <section className="grid gap-3 border-b border-border/70 pb-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Official doc
        </p>
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <p className="font-semibold leading-tight">{doc.title}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{doc.status}</Badge>
          <Badge variant="secondary">{doc.category}</Badge>
          <Badge variant="outline">order {doc.sortOrder}</Badge>
        </div>
      </section>

      <section className="grid gap-3 border-b border-border/70 py-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Slug
          </p>
          <p className="mt-1 break-all font-mono text-xs text-foreground">
            {doc.slug}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Updated
          </p>
          <p className="mt-1 text-muted-foreground">
            {doc.updatedAt.toLocaleString()}
          </p>
        </div>
      </section>

      <section className="grid gap-2 py-4">
        <Link
          href="/dashboard/admin/docs"
          className={cn(buttonVariants({ variant: "outline" }), "justify-start")}
        >
          All official docs
        </Link>
        {doc.status === "published" ? (
          <Link
            href={`/docs/guides/${doc.slug}`}
            className={cn(buttonVariants({ variant: "outline" }), "justify-start")}
          >
            <ExternalLink className="size-4" />
            Public guide page
          </Link>
        ) : null}
      </section>
    </div>
  );
}
