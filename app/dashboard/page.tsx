import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  FilePlus2,
  FileText,
  Globe2,
  LockKeyhole,
  Settings,
  Share2,
  Users,
} from "lucide-react";

import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createDocumentAction,
  listDocumentsForUser,
  listPublishedDocumentsForUser,
  listSharedDocumentsForUser,
} from "@/server/documents";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [documentList, sharedDocumentList, publicDocumentList] = await Promise.all([
    listDocumentsForUser(session.user.id),
    listSharedDocumentsForUser(session.user.id),
    listPublishedDocumentsForUser(session.user.id),
  ]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <nav className="flex items-center justify-between border-b border-border pb-5">
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <ArrowLeft className="size-4" />
            Home
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge variant="outline">{session.user.email ?? session.user.name}</Badge>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </nav>

        <section className="grid flex-1 content-center gap-8 py-12 lg:grid-cols-[280px_1fr]">
          <aside className="border border-border bg-card p-5 text-card-foreground">
            <h1 className="text-xl font-semibold">Vault</h1>
            <div className="mt-6 grid gap-1 text-sm text-muted-foreground">
              <a
                href="#my-documents"
                className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
              >
                <FileText className="size-4" />
                My Documents
              </a>
              <a
                href="#shared-with-me"
                className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Share2 className="size-4" />
                Shared With Me
              </a>
              <a
                href="#public-notes"
                className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Globe2 className="size-4" />
                Public Notes
              </a>
              <Link
                href="/dashboard/friends"
                className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Users className="size-4" />
                Friends
              </Link>
              <Link
                href="/dashboard/settings"
                className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Settings className="size-4" />
                Settings
              </Link>
            </div>
          </aside>

          <div className="border border-dashed border-border bg-card p-8 text-card-foreground">
            <div id="my-documents" className="flex scroll-mt-8 items-start justify-between gap-4">
              <div>
                <LockKeyhole className="mb-4 size-8 text-primary" />
                <h2 className="text-3xl font-semibold tracking-tight">
                  My documents
                </h2>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Documents listed here are loaded server-side for the signed-in
                  user. Private document access now goes through Auth.js and the
                  permission helpers.
                </p>
              </div>
              <form action={createDocumentAction}>
                <Button type="submit">
                  <FilePlus2 className="size-4" />
                  New document
                </Button>
              </form>
            </div>

            {documentList.length === 0 ? (
              <div className="mt-8 border border-border bg-background p-5">
                <p className="font-medium">No documents yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create your first private document to verify persistence and
                  owner-only access.
                </p>
              </div>
            ) : (
              <div className="mt-8 grid gap-3">
                {documentList.map((document) => (
                  <Link
                    key={document.id}
                    href={`/docs/${document.id}`}
                    className="flex items-center justify-between border border-border bg-background px-4 py-3 transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-3">
                      <FileText className="size-4 text-primary" />
                      <span className="font-medium">{document.title}</span>
                    </span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {document.visibility === "public" ? (
                        <Badge variant="outline">Public</Badge>
                      ) : null}
                      {document.updatedAt.toLocaleDateString()}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <div id="shared-with-me" className="mt-10 scroll-mt-8">
              <h3 className="text-lg font-semibold">Shared with me</h3>
              {sharedDocumentList.length === 0 ? (
                <div className="mt-3 border border-border bg-background p-5">
                  <p className="font-medium">No shared documents</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Documents shared with you as viewer or editor will appear here.
                  </p>
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {sharedDocumentList.map((document) => (
                    <Link
                      key={document.id}
                      href={`/docs/${document.id}`}
                      className="flex items-center justify-between border border-border bg-background px-4 py-3 transition-colors hover:bg-muted"
                    >
                      <span className="flex items-center gap-3">
                        <FileText className="size-4 text-primary" />
                        <span className="font-medium">{document.title}</span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {document.role}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div id="public-notes" className="mt-10 scroll-mt-8">
              <h3 className="text-lg font-semibold">Public notes</h3>
              {publicDocumentList.length === 0 ? (
                <div className="mt-3 border border-border bg-background p-5">
                  <p className="font-medium">No public notes</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Published documents will appear here with their public route.
                  </p>
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {publicDocumentList.map((document) => (
                    <div
                      key={document.id}
                      className="flex flex-col gap-3 border border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <Link
                        href={`/docs/${document.id}`}
                        className="flex items-center gap-3 transition-colors hover:text-primary"
                      >
                        <Globe2 className="size-4 text-primary" />
                        <span className="font-medium">{document.title}</span>
                      </Link>
                      {document.publicSlug ? (
                        <Link
                          href={`/public/${document.publicSlug}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          Public page
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
