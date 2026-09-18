import { describe, expect, it } from "vitest";

import { listRepoDocs } from "@/lib/repo-docs";

/**
 * Guards the shipped guides under `content/docs`.
 *
 * The `docs/` folder at the repo root is for people working *on* Vault; the
 * guides here are for people *using* it. A reader has no way to open a repo file,
 * so a guide that points at one is a dead end — and that includes the extension
 * descriptions these guides sit beside.
 */
describe("shipped guides", () => {
  it("never point a reader at a repo-internal document", async () => {
    const offenders = (await listRepoDocs())
      .filter((doc) =>
        /docs\/\d\d_|_PLAN\.md|project-knowledge\.md|AGENTS\.md|CLAUDE\.md/.test(
          doc.markdown,
        ),
      )
      .map((doc) => doc.slug);

    expect(offenders).toEqual([]);
  });

  it("give every guide the frontmatter the docs index needs", async () => {
    for (const doc of await listRepoDocs()) {
      expect(doc.slug, `slug for ${doc.title}`).toMatch(/^[a-z0-9-]+$/);
      expect(doc.title.length, `title for ${doc.slug}`).toBeGreaterThan(0);
      expect(doc.category.length, `category for ${doc.slug}`).toBeGreaterThan(0);
      expect(doc.sortOrder, `order for ${doc.slug}`).toBeGreaterThan(0);
    }
  });

  it("keep slugs unique, since a slug is the guide's URL", async () => {
    const slugs = (await listRepoDocs()).map((doc) => doc.slug);

    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("documents the extensions a reader can switch on", async () => {
    const slugs = (await listRepoDocs()).map((doc) => doc.slug);

    for (const slug of ["extensions-and-settings", "dictionary", "calc", "calendar"]) {
      expect(slugs, `missing guide: ${slug}`).toContain(slug);
    }
  });
});
