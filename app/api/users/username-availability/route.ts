import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { checkUsernameAvailability } from "@/server/profile";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username") ?? "";
  const result = await checkUsernameAvailability(username, session.user.id);

  return NextResponse.json(result);
}
