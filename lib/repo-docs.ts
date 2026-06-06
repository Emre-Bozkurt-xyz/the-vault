import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { slugify } from "@/lib/slug";

export type RepoDoc = {
  source: "repo";
  id: string;
  slug: string;
  title: string;
  category: string;
  sortOrder: number;
  markdown: string;
  updatedAt: Date;
  publishedAt: Date | null;
  status: "published";
  editable: false;
  filePath: string;
};

export type RepoMarkdownPage = {
  title: string;
  markdown: string;
  updatedAt: Date;
  filePath: string;
};

const docsRoot = path.join(process.cwd(), "content", "docs");
const legalRoot = path.join(process.cwd(), "content", "legal");

export async function listRepoDocs(): Promise<RepoDoc[]> {
  const files = await listMarkdownFiles(docsRoot);
  const docs = await Promise.all(files.map(readRepoDocFile));

  return docs
    .filter((doc): doc is RepoDoc => Boolean(doc))
    .sort(compareDocs);
}

export async function getRepoDocBySlug(slug: string) {
  const docs = await listRepoDocs();
  return docs.find((doc) => doc.slug === slug) ?? null;
}

export async function getRepoDocSlugSet() {
  const docs = await listRepoDocs();
  return new Set(docs.map((doc) => doc.slug));
}

export async function getTermsPage(): Promise<RepoMarkdownPage | null> {
  const filePath = path.join(legalRoot, "terms.md");

  try {
    const [raw, metadata] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    const { frontmatter, body } = parseFrontmatter(raw);

    return {
      title: frontmatter.title ?? "Terms and Conditions",
      markdown: body.trim(),
      updatedAt: metadata.mtime,
      filePath: path.relative(process.cwd(), filePath),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function readRepoDocFile(filePath: string): Promise<RepoDoc | null> {
  const [raw, metadata] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  const { frontmatter, body } = parseFrontmatter(raw);

  if (frontmatter.public === "false") {
    return null;
  }

  const relativePath = path.relative(docsRoot, filePath);
  const slug =
    frontmatter.slug ??
    slugify(
      relativePath
        .replace(/\\/g, "/")
        .replace(/\/index\.md$/i, "")
        .replace(/\.md$/i, ""),
    );
  const title = frontmatter.title ?? titleFromSlug(slug);
  const category = frontmatter.category ?? "Guides";
  const sortOrder = Number.parseInt(frontmatter.order ?? "0", 10);

  return {
    source: "repo",
    id: `repo:${slug}`,
    slug,
    title,
    category,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    markdown: body.trim(),
    updatedAt: metadata.mtime,
    publishedAt: metadata.mtime,
    status: "published",
    editable: false,
    filePath: path.relative(process.cwd(), filePath),
  };
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return listMarkdownFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
    }),
  );

  return nested.flat();
}

function parseFrontmatter(raw: string) {
  if (!raw.startsWith("---")) {
    return { frontmatter: {} as Record<string, string>, body: raw };
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {} as Record<string, string>, body: raw };
  }

  const frontmatter = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(":");

        if (separatorIndex === -1) {
          return [line, ""];
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line
          .slice(separatorIndex + 1)
          .trim()
          .replace(/^["']|["']$/g, "");

        return [key, value];
      }),
  );

  return {
    frontmatter,
    body: match[2],
  };
}

function compareDocs(
  docA: Pick<RepoDoc, "category" | "sortOrder" | "title">,
  docB: Pick<RepoDoc, "category" | "sortOrder" | "title">,
) {
  return (
    docA.category.localeCompare(docB.category) ||
    docA.sortOrder - docB.sortOrder ||
    docA.title.localeCompare(docB.title)
  );
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
