import {
  parseWikiLinkParts,
  wikiDocKey,
  wikiKeyForTarget,
  wikiTitleKey,
} from "@/lib/wiki-links";

/** A document the backlinks are found for: its id, title and aliases. */
export type BacklinkTarget = { id: string; title: string; aliases?: readonly string[] };

/** One line of another document that links to (or embeds) the target. */
export type BacklinkMention = {
  /** 1-based line in the linking document. */
  line: number;
  /** The line's text, trimmed, for context and to find it again. */
  text: string;
  embed: boolean;
};

const wikiLinkPattern = /(!?)\[\[([^\]\n]+)\]\]/g;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})/;

/** Every `[[…]]` key that resolves to the target: its id, its title, each alias. */
export function backlinkKeys(target: BacklinkTarget): Set<string> {
  const keys = new Set([wikiDocKey(target.id)]);
  if (target.title.trim()) keys.add(wikiTitleKey(target.title));
  for (const alias of target.aliases ?? []) if (alias.trim()) keys.add(wikiTitleKey(alias));
  return keys;
}

/**
 * Lines of `markdown` holding a wiki link or embed whose target is one of
 * `keys`. Fenced code and inline code don't count, as everywhere else links
 * are read (`countWikiLinkTargets`).
 */
export function findBacklinkMentions(markdown: string, keys: Set<string>): BacklinkMention[] {
  const mentions: BacklinkMention[] = [];
  let fence: string | null = null;
  const lines = markdown.split("\n");

  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    const opener = line.match(fencePattern)?.[1];
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      return;
    }
    if (opener) {
      fence = opener;
      return;
    }
    if (!line.includes("[[")) return;

    const withoutCode = line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
    let embed: boolean | null = null;
    for (const match of withoutCode.matchAll(wikiLinkPattern)) {
      const parts = parseWikiLinkParts(match[1], match[2]);
      if (!parts.target || !keys.has(wikiKeyForTarget(parts.target))) continue;
      // A line that links (not only embeds) counts as a link.
      embed = embed === false ? false : parts.embed;
    }
    if (embed !== null) mentions.push({ line: index + 1, text: line.trim(), embed });
  });

  return mentions;
}
