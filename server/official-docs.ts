"use server";

import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { officialDocs } from "@/db/schema";
import { maxMarkdownLength } from "@/lib/markdown";
import {
  getRepoDocBySlug,
  getRepoDocSlugSet,
  listRepoDocs,
  type RepoDoc,
} from "@/lib/repo-docs";
import { slugify } from "@/lib/slug";
import { requireAdmin } from "@/server/authz";

const officialDocIdSchema = z.string().uuid();
const officialDocStatusSchema = z.enum(["draft", "published", "archived"]);
const officialDocMutationSchema = z.object({
  id: officialDocIdSchema,
  title: z.string().trim().min(1, "Title is required.").max(200),
  category: z.string().trim().min(1, "Category is required.").max(80),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required.")
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a URL-safe slug."),
  markdown: z.string().max(maxMarkdownLength),
  status: officialDocStatusSchema,
});

type DatabaseOfficialDoc = {
  source: "database";
  id: string;
  slug: string;
  title: string;
  category: string;
  sortOrder: number;
  markdown: string;
  updatedAt: Date;
  publishedAt: Date | null;
  status: "draft" | "published" | "archived";
  editable: true;
  collidesWithRepo: boolean;
};

export type OfficialDocListItem = RepoDoc | DatabaseOfficialDoc;

export async function listPublishedOfficialDocs() {
  const [repoDocs, databaseDocs] = await Promise.all([
    listRepoDocs(),
    db
    .select({
      id: officialDocs.id,
      slug: officialDocs.slug,
      title: officialDocs.title,
      category: officialDocs.category,
      sortOrder: officialDocs.sortOrder,
      markdown: officialDocs.markdown,
      updatedAt: officialDocs.updatedAt,
      publishedAt: officialDocs.publishedAt,
    })
    .from(officialDocs)
    .where(eq(officialDocs.status, "published"))
    .orderBy(asc(officialDocs.category), asc(officialDocs.sortOrder), asc(officialDocs.title)),
  ]);
  const repoSlugs = new Set(repoDocs.map((doc) => doc.slug));
  const visibleDatabaseDocs = databaseDocs
    .filter((doc) => !repoSlugs.has(doc.slug))
    .map((doc) => toDatabaseListItem(doc));

  return [...repoDocs, ...visibleDatabaseDocs].sort(compareOfficialDocs);
}

export async function getPublishedOfficialDocBySlug(slug: string) {
  const repoDoc = await getRepoDocBySlug(slug);

  if (repoDoc) {
    return repoDoc;
  }

  const [doc] = await db
    .select({
      id: officialDocs.id,
      slug: officialDocs.slug,
      title: officialDocs.title,
      category: officialDocs.category,
      sortOrder: officialDocs.sortOrder,
      markdown: officialDocs.markdown,
      updatedAt: officialDocs.updatedAt,
      publishedAt: officialDocs.publishedAt,
    })
    .from(officialDocs)
    .where(and(eq(officialDocs.slug, slug), eq(officialDocs.status, "published")))
    .limit(1);

  return doc ? toDatabaseListItem(doc) : null;
}

export async function listOfficialDocsForAdmin() {
  await requireAdmin();
  const [repoDocs, databaseDocs] = await Promise.all([
    listRepoDocs(),
    db
      .select({
        id: officialDocs.id,
        slug: officialDocs.slug,
        title: officialDocs.title,
        category: officialDocs.category,
        sortOrder: officialDocs.sortOrder,
        markdown: officialDocs.markdown,
        status: officialDocs.status,
        updatedAt: officialDocs.updatedAt,
        publishedAt: officialDocs.publishedAt,
      })
      .from(officialDocs)
      .orderBy(asc(officialDocs.category), asc(officialDocs.sortOrder), asc(officialDocs.title)),
  ]);
  const repoSlugs = new Set(repoDocs.map((doc) => doc.slug));
  const docs = [
    ...repoDocs,
    ...databaseDocs.map((doc) => toDatabaseListItem(doc, repoSlugs.has(doc.slug))),
  ];

  return docs.sort(compareOfficialDocs);
}

export async function getOfficialDocForAdmin(id: string) {
  await requireAdmin();
  const parsedId = officialDocIdSchema.parse(id);

  const [doc] = await db
    .select({
      id: officialDocs.id,
      slug: officialDocs.slug,
      title: officialDocs.title,
      category: officialDocs.category,
      sortOrder: officialDocs.sortOrder,
      markdown: officialDocs.markdown,
      status: officialDocs.status,
      updatedAt: officialDocs.updatedAt,
      publishedAt: officialDocs.publishedAt,
    })
    .from(officialDocs)
    .where(eq(officialDocs.id, parsedId))
    .limit(1);

  if (!doc) {
    notFound();
  }

  return doc;
}

export async function createOfficialDocAction() {
  const admin = await requireAdmin();
  const title = "New official doc";
  const slug = `${slugify(title)}-${Date.now().toString(36)}`;

  const [doc] = await db
    .insert(officialDocs)
    .values({
      title,
      slug,
      category: "Getting started",
      sortOrder: 0,
      markdown: "# New official doc\n\nStart writing the user-facing guide here.",
      status: "draft",
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: officialDocs.id });

  redirect(`/dashboard/admin/docs/${doc.id}`);
}

export async function saveOfficialDocAction(input: unknown): Promise<
  | { ok: true; updatedAt: string; message: string }
  | { ok: false; message: string }
> {
  const admin = await requireAdmin();
  const parsed = officialDocMutationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Check the official doc fields and try again.",
    };
  }

  const repoSlugs = await getRepoDocSlugSet();

  if (repoSlugs.has(parsed.data.slug)) {
    return {
      ok: false,
      message:
        "That slug belongs to a repo-backed canonical doc. Choose another slug before saving.",
    };
  }

  try {
    const values: {
      title: string;
      slug: string;
      category: string;
      sortOrder: number;
      markdown: string;
      status: "draft" | "published" | "archived";
      updatedBy: string;
      updatedAt: SQL;
      publishedAt?: Date | null | SQL;
    } = {
      title: parsed.data.title,
      slug: parsed.data.slug,
      category: parsed.data.category,
      sortOrder: parsed.data.sortOrder,
      markdown: parsed.data.markdown,
      status: parsed.data.status,
      updatedBy: admin.id,
      updatedAt: sql`now()`,
    };

    if (parsed.data.status === "published") {
      values.publishedAt = sql`coalesce(${officialDocs.publishedAt}, now())`;
    }

    if (parsed.data.status === "draft") {
      values.publishedAt = null;
    }

    await db
      .update(officialDocs)
      .set(values)
      .where(eq(officialDocs.id, parsed.data.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: "That docs slug is already in use.",
      };
    }

    throw error;
  }

  revalidatePath("/docs");
  revalidatePath(`/docs/guides/${parsed.data.slug}`);
  revalidatePath("/dashboard/admin/docs");

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    message: "Official doc saved.",
  };
}

function toDatabaseListItem(
  doc: {
    id: string;
    slug: string;
    title: string;
    category: string;
    sortOrder: number;
    markdown: string;
    status?: "draft" | "published" | "archived";
    updatedAt: Date;
    publishedAt: Date | null;
  },
  collidesWithRepo = false,
): DatabaseOfficialDoc {
  return {
    source: "database",
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    sortOrder: doc.sortOrder,
    markdown: doc.markdown,
    updatedAt: doc.updatedAt,
    publishedAt: doc.publishedAt,
    status: doc.status ?? "published",
    editable: true,
    collidesWithRepo,
  };
}

function compareOfficialDocs(
  docA: Pick<OfficialDocListItem, "category" | "sortOrder" | "title">,
  docB: Pick<OfficialDocListItem, "category" | "sortOrder" | "title">,
) {
  return (
    docA.category.localeCompare(docB.category) ||
    docA.sortOrder - docB.sortOrder ||
    docA.title.localeCompare(docB.title)
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  return "cause" in error && isUniqueViolation(error.cause);
}
