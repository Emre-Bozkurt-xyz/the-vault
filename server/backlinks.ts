"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { backlinkKeys, findBacklinkMentions } from "@/lib/backlinks";
import { parseDocumentMetadata } from "@/lib/content-metadata";
import { getDocumentAccess } from "@/lib/permissions";
import { requireActiveUser } from "@/server/authz";
import {
  listDocumentsForUser,
  listDocumentsInOwnedFoldersFromOthersWithBody,
  listSharedDocumentsForUser,
} from "@/server/documents-data";

/** A document that links to the one being viewed, with its first linking line. */
export type DocumentBacklink = {
  id: string;
  title: string;
  /** First linking line (1-based) and its text, to jump to. */
  line: number;
  text: string;
  /** How many of its lines link here. */
  count: number;
  /** Only embeds the document (`![[…]]`), never links to it. */
  embedOnly: boolean;
};

/**
 * Documents that link to (or embed) this one, among those the viewer can read:
 * their own, ones shared with them (directly or through a folder), and others'
 * filed in their folders — the same set the AI tools search. Found when asked
 * rather than kept in an index, so links written anywhere (the editor, live
 * collaboration, the AI tools) count at once. Null when the viewer can't read
 * the document.
 */
export async function getDocumentBacklinksAction(input: unknown): Promise<DocumentBacklink[] | null> {
  const user = await requireActiveUser();
  const parsed = z.object({ documentId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return null;
  const documentId = parsed.data.documentId.toLowerCase();

  const access = await getDocumentAccess(user.id, documentId);
  if (!access.canRead) return null;

  const [target] = await db
    .select({ id: documents.id, title: documents.title, markdown: documents.markdown })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (!target) return null;

  const keys = backlinkKeys({
    id: target.id,
    title: target.title,
    aliases: parseDocumentMetadata(target.markdown).aliases,
  });

  const [owned, shared, filed] = await Promise.all([
    listDocumentsForUser(user.id),
    listSharedDocumentsForUser(user.id),
    listDocumentsInOwnedFoldersFromOthersWithBody(user.id),
  ]);

  const seen = new Set<string>([target.id]);
  const backlinks: (DocumentBacklink & { updatedAt: number })[] = [];
  for (const source of [...owned, ...shared, ...filed]) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const markdown = (source as { markdown?: string }).markdown ?? "";
    if (!markdown.includes("[[")) continue;
    const mentions = findBacklinkMentions(markdown, keys);
    if (mentions.length === 0) continue;
    backlinks.push({
      id: source.id,
      title: source.title,
      line: mentions[0].line,
      text: mentions[0].text,
      count: mentions.length,
      embedOnly: mentions.every((mention) => mention.embed),
      updatedAt: new Date(source.updatedAt).getTime(),
    });
  }

  return backlinks
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((backlink) => ({
      id: backlink.id,
      title: backlink.title,
      line: backlink.line,
      text: backlink.text,
      count: backlink.count,
      embedOnly: backlink.embedOnly,
    }));
}
