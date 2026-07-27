import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { verifyEmbedSessionToken } from "@/lib/embed-session-token";
import {
  listPublicWikiLinkResolutions,
  listWikiLinkResolutionsForUser,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";

export async function GET(request: Request) {
  const userId = await resolveWikiLinksUserId(request);

  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
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
