import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { listWikiLinkResolutionsForUser } from "@/server/documents";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const wikiLinks = await listWikiLinkResolutionsForUser(session.user.id, {
    includeEmbeds: false,
  });

  return NextResponse.json(
    { wikiLinks },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
