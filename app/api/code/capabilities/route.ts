import { NextResponse } from "next/server";

import { codeLanguages } from "@/lib/code/languages";
import { currentCodeUser } from "@/server/code-api";
import { executionEnabled, listRuntimeProfiles } from "@/server/code-runtime";

export const runtime = "nodejs";

/**
 * What this user can run, so the editor shows Run only where it will work.
 * Exposes each profile's language and human-readable version — never an image
 * name, digest or argv. When execution is off or an admin has not granted this user code execution
 * the answer is simply "nothing", which is also what an anonymous caller gets.
 */
export async function GET() {
  const user = await currentCodeUser();
  const enabled = executionEnabled() && !!user?.mayExecute;

  if (!enabled) {
    return NextResponse.json({ enabled: false, languages: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const labels = new Map(codeLanguages.map((language) => [language.id, language.label]));
  const languages = listRuntimeProfiles().map((profile) => ({
    id: profile.languageId,
    label: labels.get(profile.languageId) ?? profile.languageId,
    version: profile.version,
    canRun: profile.runArgv.length > 0,
    canFormatOnRunner: profile.formatArgv !== null,
  }));

  return NextResponse.json({ enabled: true, languages }, { headers: { "Cache-Control": "no-store" } });
}
