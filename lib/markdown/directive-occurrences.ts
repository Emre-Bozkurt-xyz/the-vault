import { splitDirectiveBlocks } from "@/lib/markdown/directive-blocks";
import { collectInlineDirectives } from "@/lib/markdown/directives";

/**
 * Plans a document into render parts and collects every claimed directive
 * occurrence in document order (`docs/23_EXTENSION_SDK_PLAN.md` §6 "Pre-pass").
 *
 * ## Keys
 *
 * A document is cut into *pieces*: runs of Markdown and container blocks, each
 * numbered in order. A container's key is its piece number; an inline
 * directive's is `<piece>:<n>`, its ordinal among claimed inline directives in
 * that run. Ordinals rather than offsets on purpose: the renderer rewrites wiki
 * links and asset embeds before parsing, which shifts every offset but cannot
 * add or remove a directive. Leaf blocks are parts but not pieces: they carry
 * no occurrence and take no number.
 *
 * Pure, and used both by the renderer (through the host's claims) and by
 * `@/lib/extension-api/markdown` for code that holds only text, so a value an
 * agent reads is keyed and ordered exactly as the page renders it.
 */

/** Directive names mapped to the id of the extension that owns them. */
export type DirectiveOwners = {
  leaf: ReadonlyMap<string, string>;
  container: ReadonlyMap<string, string>;
  inline: ReadonlyMap<string, string>;
};

export type DirectiveOccurrence =
  | {
      kind: "inline";
      owner: string;
      key: string;
      name: string;
      source: string;
      label: string | null;
      attributes: Record<string, string>;
    }
  | {
      kind: "block";
      owner: string;
      key: string;
      name: string;
      source: string;
      body: string;
      attributes: Record<string, string>;
    };

export type DirectivePart =
  | { kind: "markdown"; markdown: string; pieceIndex: number }
  | {
      kind: "leaf";
      owner: string;
      name: string;
      attributes: Record<string, string>;
      source: string;
    }
  | {
      kind: "container";
      owner: string;
      key: string;
      name: string;
      attributes: Record<string, string>;
      source: string;
      body: string;
    };

/** Shared across every `planDirectiveParts` call of one document render. */
export type DirectivePlanState = {
  nextPiece: number;
  occurrences: DirectiveOccurrence[];
};

export function createDirectivePlanState(): DirectivePlanState {
  return { nextPiece: 0, occurrences: [] };
}

function nameSet(owners: ReadonlyMap<string, string>): ReadonlySet<string> {
  return new Set(owners.keys());
}

/**
 * Splits one Markdown run into parts, appending its occurrences to `state`.
 * Callers rendering several runs (a document split around wiki embeds) share
 * one state, so piece numbers stay unique across the document.
 */
export function planDirectiveParts(
  markdown: string,
  owners: DirectiveOwners,
  state: DirectivePlanState,
): DirectivePart[] {
  const parts: DirectivePart[] = [];
  const inlineNames = nameSet(owners.inline);
  const segments = splitDirectiveBlocks(markdown, {
    leaf: nameSet(owners.leaf),
    container: nameSet(owners.container),
  });

  for (const segment of segments) {
    if (segment.type === "leaf") {
      parts.push({
        kind: "leaf",
        owner: owners.leaf.get(segment.name) as string,
        name: segment.name,
        attributes: segment.attributes,
        source: segment.source,
      });
      continue;
    }

    const pieceIndex = state.nextPiece;
    state.nextPiece += 1;

    if (segment.type === "container") {
      const owner = owners.container.get(segment.name) as string;
      const key = String(pieceIndex);

      state.occurrences.push({
        kind: "block",
        owner,
        key,
        name: segment.name,
        source: segment.source,
        body: segment.body,
        attributes: segment.attributes,
      });
      parts.push({
        kind: "container",
        owner,
        key,
        name: segment.name,
        attributes: segment.attributes,
        source: segment.source,
        body: segment.body,
      });
      continue;
    }

    collectInlineDirectives(segment.markdown, inlineNames).forEach(
      (found, index) => {
        state.occurrences.push({
          kind: "inline",
          owner: owners.inline.get(found.name) as string,
          key: `${pieceIndex}:${index}`,
          ...found,
        });
      },
    );
    parts.push({ kind: "markdown", markdown: segment.markdown, pieceIndex });
  }

  return parts;
}

/** Every claimed occurrence in `markdown`, keyed as a whole-document render keys them. */
export function collectDirectiveOccurrences(
  markdown: string,
  owners: DirectiveOwners,
): DirectiveOccurrence[] {
  const state = createDirectivePlanState();
  planDirectiveParts(markdown, owners, state);
  return state.occurrences;
}
