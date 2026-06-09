import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  listPublicWikiLinkResolutions,
  listWikiLinkResolutionsForUser,
} from "@/server/documents";
import { listOfficialDocWikiLinkResolutions } from "@/server/official-docs";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const [readableWikiLinks, guideWikiLinks, publicWikiLinks] =
    await Promise.all([
      listWikiLinkResolutionsForUser(session.user.id, {
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
