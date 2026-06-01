import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
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
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { cn } from "@/lib/utils";
import { normalizeStoredMarkdown } from "@/lib/markdown";
import {
  createDocumentAction,
  listDocumentsForUser,
  listPublishedDocumentsForUser,
  listSharedDocumentsForUser,
} from "@/server/documents";

type DashboardTab = "owned" | "shared" | "public";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: DashboardTab }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [documentList, sharedDocumentList, publicDocumentList] = await Promise.all([
    listDocumentsForUser(session.user.id),
    listSharedDocumentsForUser(session.user.id),
    listPublishedDocumentsForUser(session.user.id),
  ]);

  const { tab } = await searchParams;
  const activeTab: DashboardTab =
    tab === "shared" ? "shared" : tab === "public" ? "public" : "owned";
  const userLabel = session.user.name ?? session.user.email ?? "Vault user";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-8">
        <header className="flex flex-col gap-6 border-b border-border/60 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="vault-fade-up flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
              <span className="size-2 rounded-full bg-primary/70" />
              Vault workspace
            </div>
            <div className="vault-fade-up vault-delay-1 space-y-3">
              <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl vault-display">
                Dashboard
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Organize your private vault, track shared collaborations, and
                publish selected notes as clean public pages.
              </p>
            </div>
            <div className="vault-fade-up vault-delay-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{userLabel}</Badge>
              <Badge variant="secondary">{documentList.length} owned</Badge>
              <Badge variant="secondary">{sharedDocumentList.length} shared</Badge>
              <Badge variant="secondary">{publicDocumentList.length} public</Badge>
            </div>
          </div>
          <div className="vault-fade-up vault-delay-2 flex flex-wrap items-center gap-2">
            <form action={createDocumentAction}>
              <Button type="submit" size="lg" className="gap-2">
                <FilePlus2 className="size-4" />
                New document
              </Button>
            </form>
            <ThemeToggle />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button type="submit" variant="outline" size="lg">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[260px_1fr]">
          <aside className="flex flex-col gap-6">
            <div className="vault-fade-up vault-delay-1 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Navigation
              </h2>
              <div className="mt-4 grid gap-1 text-sm">
                <Link
                  href="/dashboard?tab=owned"
                  className={cn(
                    "flex items-center justify-between rounded-2xl px-3 py-2 transition",
                    activeTab === "owned"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <LockKeyhole className="size-4" />
                    My documents
                  </span>
                  <span className="text-xs">{documentList.length}</span>
                </Link>
                <Link
                  href="/dashboard?tab=shared"
                  className={cn(
                    "flex items-center justify-between rounded-2xl px-3 py-2 transition",
                    activeTab === "shared"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Share2 className="size-4" />
                    Shared with me
                  </span>
                  <span className="text-xs">{sharedDocumentList.length}</span>
                </Link>
                <Link
                  href="/dashboard?tab=public"
                  className={cn(
                    "flex items-center justify-between rounded-2xl px-3 py-2 transition",
                    activeTab === "public"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Globe2 className="size-4" />
                    Public notes
                  </span>
                  <span className="text-xs">{publicDocumentList.length}</span>
                </Link>
                <Link
                  href="/dashboard/friends"
                  className="flex items-center gap-2 rounded-2xl px-3 py-2 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                >
                  <Users className="size-4" />
                  Friends
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex items-center gap-2 rounded-2xl px-3 py-2 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                >
                  <Settings className="size-4" />
                  Settings
                </Link>
              </div>
            </div>

            <div className="vault-fade-up vault-delay-2 rounded-3xl border border-border/60 bg-card/80 p-5 text-card-foreground shadow-[0_18px_60px_-50px_rgba(0,0,0,0.6)] backdrop-blur">
              <h3 className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Workspace stats
              </h3>
              <div className="mt-4 grid gap-3">
                <StatRow icon={FileText} label="Owned documents" value={documentList.length} />
                <StatRow icon={Share2} label="Shared with you" value={sharedDocumentList.length} />
                <StatRow icon={Globe2} label="Public notes" value={publicDocumentList.length} />
              </div>
            </div>
          </aside>

          <div className="vault-fade-up vault-delay-1 rounded-3xl border border-border/60 bg-card/80 p-6 text-card-foreground shadow-[0_25px_90px_-70px_rgba(0,0,0,0.6)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  {activeTab === "owned"
                    ? "My documents"
                    : activeTab === "shared"
                      ? "Shared with me"
                      : "Public notes"}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight vault-display">
                  {activeTab === "owned"
                    ? "Your private library"
                    : activeTab === "shared"
                      ? "Collaborations"
                      : "Published vault"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-full border border-border/70 bg-background/70 p-1">
                <TabButton active={activeTab === "owned"} href="/dashboard?tab=owned">
                  Owned
                </TabButton>
                <TabButton active={activeTab === "shared"} href="/dashboard?tab=shared">
                  Shared
                </TabButton>
                <TabButton active={activeTab === "public"} href="/dashboard?tab=public">
                  Public
                </TabButton>
              </div>
            </div>

            <div className="mt-8">
              {activeTab === "owned" ? (
                documentList.length === 0 ? (
                  <EmptyState
                    title="No documents yet"
                    description="Create your first private document to start capturing ideas."
                    action={
                      <form action={createDocumentAction}>
                        <Button type="submit" size="sm">
                          New document
                        </Button>
                      </form>
                    }
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {documentList.map((document) => (
                      <DocCard
                        key={document.id}
                        href={`/docs/${document.id}`}
                        title={document.title}
                        meta={`Updated ${document.updatedAt.toLocaleDateString()}`}
                        icon={FileText}
                        badge={
                          <Badge variant="outline">
                            {document.visibility === "public" ? "Public" : "Private"}
                          </Badge>
                        }
                        preview={normalizeStoredMarkdown(
                          document.markdown,
                          document.content,
                        )}
                      />
                    ))}
                  </div>
                )
              ) : null}

              {activeTab === "shared" ? (
                sharedDocumentList.length === 0 ? (
                  <EmptyState
                    title="No shared documents"
                    description="When collaborators share a vault document, it will appear here."
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {sharedDocumentList.map((document) => (
                      <DocCard
                        key={document.id}
                        href={`/docs/${document.id}`}
                        title={document.title}
                        meta="Shared workspace"
                        icon={Share2}
                        badge={<Badge variant="secondary">{document.role}</Badge>}
                        preview={normalizeStoredMarkdown(
                          document.markdown,
                          document.content,
                        )}
                      />
                    ))}
                  </div>
                )
              ) : null}

              {activeTab === "public" ? (
                publicDocumentList.length === 0 ? (
                  <EmptyState
                    title="No public notes"
                    description="Publish a document to generate a clean public page."
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {publicDocumentList.map((document) => (
                      <DocCard
                        key={document.id}
                        href={`/docs/${document.id}`}
                        title={document.title}
                        meta={`Updated ${document.updatedAt.toLocaleDateString()}`}
                        icon={Globe2}
                        badge={<Badge variant="outline">Public</Badge>}
                        preview={normalizeStoredMarkdown(
                          document.markdown,
                          document.content,
                        )}
                        action={
                          document.publicSlug ? (
                            <Link
                              href={`/public/${document.publicSlug}`}
                              className={buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })}
                            >
                              Public page
                            </Link>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function TabButton({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function StatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/60 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4 text-primary" />
        {label}
      </div>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border/70 bg-background/60 p-6 text-sm text-muted-foreground">
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-md">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function DocCard({
  href,
  title,
  meta,
  icon: Icon,
  badge,
  action,
  preview,
}: {
  href: string;
  title: string;
  meta: string;
  icon: ComponentType<{ className?: string }>;
  badge?: ReactNode;
  action?: ReactNode;
  preview?: string;
}) {
  return (
    <article className="vault-doc-card group">
      <Link href={href} className="vault-doc-link">
        {preview ? (
          <div className="vault-doc-preview">
            <div className="vault-doc-preview-sheet">
              <span className="vault-doc-preview-edge" aria-hidden="true" />
              <div className="vault-doc-preview-content">
                <MarkdownDocument markdown={preview} compact disableLinks />
              </div>
              <div className="vault-doc-preview-fade" />
            </div>
          </div>
        ) : null}
        <div className="vault-doc-body">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 rounded-md border border-border/60 bg-background/80 p-1.5 text-foreground">
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0">
                <span className="vault-doc-title text-base font-semibold leading-tight">
                  {title}
                </span>
                <p className="mt-1 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                  {meta}
                </p>
              </div>
            </div>
            {badge}
          </div>
        </div>
      </Link>
      {action ? <div className="pt-3">{action}</div> : null}
    </article>
  );
}
