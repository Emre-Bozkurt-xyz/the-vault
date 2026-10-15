import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { verifyEmbedSessionToken } from "@/lib/embed-session-token";
import {
  listPublicWikiLinkResolutions,
} from "@/server/documents";
import {
  listWikiLinkResolutionsForUser,
} from "@/server/documents-data";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";
import {
  pruneWikiEmbedBodiesForKeys,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";

const maxEmbedKeys = 20;

export async function GET(request: Request) {
  const userId = await resolveWikiLinksUserId(request);

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // `?embed=<key>` (repeatable): bodies for embeds an open editor gained after
  // its page loaded. Pages only carry bodies their document transcluded then.
  const embedKeys = new URL(request.url).searchParams
    .getAll("embed")
    .slice(0, maxEmbedKeys);

  if (embedKeys.length > 0) {
    return NextResponse.json(
      { wikiLinks: await loadEmbedBodies(userId, embedKeys) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [readableWikiLinks, guideWikiLinks, publicWikiLinks] =
    await Promise.all([
      listWikiLinkResolutionsForUser(userId, {
        includeEmbeds: false,
      }),
      listOfficialDocWikiLinkResolutions({ includeEmbeds: false }),
      listPublicWikiLinkResolutions({
        includeEmbeds: false,
        includeDocKeys: false,
        includeTitleKeys: false,
        includePublicKeys: true,
      }),
    ]);
  const wikiLinks = {
    ...readableWikiLinks,
    ...guideWikiLinks,
    ...publicWikiLinks,
  };

  return NextResponse.json(
    { wikiLinks },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * The entries carrying a body for `embedKeys` and their nested embeds — the
 * same readable/public/guide maps the document page builds, so this can never
 * return a body that page would not have rendered.
 */
async function loadEmbedBodies(
  userId: string,
  embedKeys: string[],
): Promise<WikiLinkResolutionMap> {
  const [readableWikiLinks, publicWikiLinks, guideWikiLinks] = await Promise.all([
    listWikiLinkResolutionsForUser(userId),
    listPublicWikiLinkResolutions(),
    listOfficialDocWikiLinkResolutions(),
  ]);
  const pruned = pruneWikiEmbedBodiesForKeys(
    { ...readableWikiLinks, ...publicWikiLinks, ...guideWikiLinks },
    embedKeys,
  );

  return Object.fromEntries(
    Object.entries(pruned).filter(
      ([, resolution]) => typeof resolution.embedMarkdown === "string",
    ),
  );
}

/**
 * Resolves the acting user's id from the Vault session cookie first (the
 * normal `/docs/[docId]` editor), falling back to an embed session bearer
 * token when there is no cookie session (the embed editor, framed
 * cross-origin, gets none — docs/DEN_EMBED_BRIDGE.md). The resolved id is
 * only ever used to scope `listWikiLinkResolutionsForUser`'s own DB-level
 * read-access filtering below, so this substitution grants nothing beyond
 * what a normal login already would.
 */
async function resolveWikiLinksUserId(request: Request): Promise<string | null> {
  const session = await auth();

  if (session?.user?.id) {
    return session.user.id;
  }

  const header =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    return null;
  }

  return verifyEmbedSessionToken(token)?.vaultUserId ?? null;
}
