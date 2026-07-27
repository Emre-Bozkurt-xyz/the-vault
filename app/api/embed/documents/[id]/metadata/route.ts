import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { documents, groups, users } from "@/db/schema";
import { stripDocumentFrontmatter } from "@/lib/content-metadata";
import { resolveBearerToken } from "@/lib/embed-auth";
import { createMarkdownExcerpt } from "@/lib/markdown";
import { getDocumentAccess } from "@/lib/permissions";

// Den Phase 3 (docs/DEN_EMBED_BRIDGE.md §B.3). Contract (§4):
// GET /api/embed/documents/:id/metadata (bearer)
//   -> { id, title, ownerName, snippet, updatedAt, canEdit }
// Unreadable/private -> 404, never 403 (AGENTS.md §4, docs/04 §10): the route
// must not distinguish "doesn't exist" from "exists but you can't read it".
export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const resolved = await resolveBearerToken(request);

  if (!resolved) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Missing or invalid bearer token." },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const parsedId = paramsSchema.safeParse({ id });

  if (!parsedId.success) {
    return notFound();
  }

  const documentId = parsedId.data.id;
  const access = await getDocumentAccess(resolved.userId, documentId);

  if (!access.canRead) {
    return notFound();
  }

  const [document] = await db
    .select({
      id: documents.id,
      title: documents.title,
      markdown: documents.markdown,
      updatedAt: documents.updatedAt,
      ownerName: users.name,
      ownerUsername: users.username,
      groupName: groups.name,
    })
    .from(documents)
    // ownerId is NOT NULL and, even for a group-owned document, always
    // resolves to a real users row (the owning service's principal) — see
    // the schema comment on documents.owningGroupId — so this stays an
    // innerJoin rather than needing to become a leftJoin.
    .innerJoin(users, eq(documents.ownerId, users.id))
    // A group doc's owner is the service principal (e.g. "den-system"), which
    // is meaningless to Den's own users. Prefer the group name — the plan's
    // §C.7 "Design settled" block calls this out explicitly.
    .leftJoin(groups, eq(documents.owningGroupId, groups.id))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (!document) {
    return notFound();
  }

  const ownerName =
    document.groupName ?? document.ownerName ?? document.ownerUsername ?? "Vault user";
  const snippet = createMarkdownExcerpt(
    stripDocumentFrontmatter(document.markdown),
    200,
  );

  return NextResponse.json(
    {
      id: document.id,
      title: document.title,
      ownerName,
      snippet,
      updatedAt: document.updatedAt.toISOString(),
      canEdit: access.canEdit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
