import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type ViewUpdate,
} from "@codemirror/view";
import katex from "katex";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { ExtensionBlockHost } from "@/components/extensions/ExtensionBlockHost";
import {
  getAssetEmbedClassName,
  getAssetEmbedStyle,
  getAssetGroupClassName,
  parseAssetEmbedSource,
  parseAssetGroupAttributes,
  type AssetEmbedResolutionMap,
  type AssetGroupAttributes,
  type ParsedAssetEmbed,
} from "@/lib/asset-embeds";
import {
  getWikiDocumentEmbed,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";
import {
  createRenderContext,
  type DocumentExtensions,
} from "@/lib/extension-api";
import {
  ExtensionStateStoreProvider,
  type ExtensionStateStore,
} from "@/lib/extension-api/react";
import { parseExtensionBlockLine } from "@/lib/extension-host/blocks";
import type {
  LiveBlockScanContext,
  LiveBlockSpec,
  LiveBlockWidgetContext,
} from "@/lib/extensions/types";
import {
  findInlineObjectAt,
  isInLabel,
  isInsideHiddenSyntax,
  knownBlockHeight,
  knownImageSize,
  parseStandaloneImageLine,
  rememberBlockHeight,
  rememberImageSize,
  type InlineObject,
  type StandaloneImage,
} from "@/components/markdown/live-objects";

export type LiveAssetGroupLineKind = "first" | "middle" | "last" | "single";

export type LiveAssetGroupChild = {
  lineNumber: number;
  from: number;
  to: number;
  assetId: string;
  source: string;
  parsed: ParsedAssetEmbed;
};

export type LiveAssetGroupBlock = {
  kind: "assetGroup";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
  attributes: AssetGroupAttributes;
  children: LiveAssetGroupChild[];
};

export type LiveCalloutBlock = {
  kind: "callout";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
};

export type LiveDocumentEmbedBlock = {
  kind: "documentEmbed";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
};

export type LiveTableBlock = {
  kind: "table";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
};

export type LiveMathBlock = {
  kind: "mathBlock";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
};

/** A `:::name{…}` block claimed by an installed extension. */
export type LiveExtensionBlock = {
  kind: "extensionBlock";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
  documentMarkdown?: string;
  extensionId: string;
  name: string;
  attributes: Record<string, string>;
};

/**
 * A line that is only an image (asset embed, `![[https://…]]`, `![alt](url)`).
 * Unlike the other blocks it stays rendered while revealed: its source line is
 * shown *above* the picture instead of in place of it.
 */
export type LiveImageBlock = {
  kind: "image";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
  image: StandaloneImage;
};

export type LiveBlock =
  | LiveAssetGroupBlock
  | LiveCalloutBlock
  | LiveDocumentEmbedBlock
  | LiveTableBlock
  | LiveMathBlock
  | LiveExtensionBlock
  | LiveImageBlock;
export type LiveAssetGroupSelection = Pick<
  LiveAssetGroupBlock,
  "from" | "to" | "startLine" | "endLine" | "source" | "attributes"
> & {
  childCount: number;
};
export type LiveBlockOptions = {
  assetLinks: AssetEmbedResolutionMap;
  wikiLinks?: WikiLinkResolutionMap;
  onConfigureAssetGroup?: (selection: LiveAssetGroupSelection) => void;
  /**
   * The page's resolved extensions, from which extension-block widgets get
   * their context (document, `canEdit`, settings). Absent (the Den embed
   * editor), blocks render document-less and read-only.
   */
  extensions?: DocumentExtensions | null;
  /**
   * An in-memory state store for extension widgets (the extension playground).
   * Widgets mount in their own React roots, which do not inherit context, so
   * the engine provides it to each root itself.
   */
  extensionStateStore?: ExtensionStateStore | null;
};
type LiveBlockWidgetOptions = LiveBlockOptions & LiveBlockWidgetContext;

type SyntaxRange = {
  from: number;
  to: number;
};

const assetGroupFenceCapturePattern = /^:::assets(?:\s*\{([^}\n]*)\})?\s*$/i;
const calloutStartPattern = /^>\s?\[!([^\]\s]+)\]([+-])?\s*/i;
const assetGroupFirstLine = Decoration.line({
  class: "vault-cm-asset-group-source vault-cm-asset-group-source-first",
});
const assetGroupMiddleLine = Decoration.line({
  class: "vault-cm-asset-group-source vault-cm-asset-group-source-middle",
});
const assetGroupLastLine = Decoration.line({
  class: "vault-cm-asset-group-source vault-cm-asset-group-source-last",
});
const assetGroupSingleLine = Decoration.line({
  class:
    "vault-cm-asset-group-source vault-cm-asset-group-source-first vault-cm-asset-group-source-last",
});

const coreMarkdownLiveBlockSpecs = [
  {
    id: "assetGroup",
    priority: 10,
    scan: (state, context) =>
      getLiveAssetGroupBlocks(state, context.syntaxExclusions),
    widget: (block, context) =>
      new AssetGroupBlockWidget(block as LiveAssetGroupBlock, context),
    activeDecorations: (state, block) =>
      getAssetGroupSourceDecorations(state, block as LiveAssetGroupBlock),
  },
  {
    id: "callout",
    priority: 20,
    scan: (state, context) =>
      getLiveCalloutBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new CalloutBlockWidget(block as LiveCalloutBlock, context),
  },
  {
    // Before document embeds: `![[asset:id|label]]` also parses as a wiki
    // embed, and an asset line must render (and format) as the image it is.
    id: "image",
    priority: 25,
    scan: (state, context) => getLiveImageBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new ImageBlockWidget(block as LiveImageBlock, context),
    activeDecorations: (_state, block, context) => [
      // Revealed, the source line shows above the picture, which stays put.
      Decoration.widget({
        block: true,
        side: 1,
        widget: new ImageBlockWidget(block as LiveImageBlock, context, true),
      }).range(block.to),
    ],
  },
  {
    id: "documentEmbed",
    priority: 30,
    scan: (state, context) =>
      getLiveDocumentEmbedBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new DocumentEmbedBlockWidget(block as LiveDocumentEmbedBlock, context),
  },
  {
    id: "table",
    priority: 40,
    scan: (state, context) => getLiveTableBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new TableBlockWidget(block as LiveTableBlock, context),
  },
  {
    id: "mathBlock",
    priority: 50,
    scan: (state, context) =>
      getLiveMathBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new MathBlockWidget(block as LiveMathBlock, context),
    activeDecorations: (_state, block, context) =>
      getActiveMathBlockPreviewDecorations(
        block as LiveMathBlock,
        context,
      ),
  },
  {
    // Every installed extension's `:::name{…}` blocks, through one spec: the
    // engine never names an extension (docs/23_EXTENSION_SDK_PLAN.md §6).
    id: "extensionBlock",
    priority: 15,
    scan: (state, context) =>
      getLiveExtensionBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new ExtensionBlockWidget(block as LiveExtensionBlock, context),
  },
] satisfies LiveBlockSpecForEditor[];

// Extensions contribute through the one `extensionBlock` spec above, never a
// spec of their own, so this list is complete.
const liveBlockSpecs: readonly LiveBlockSpecForEditor[] = coreMarkdownLiveBlockSpecs;

type LiveBlockSpecForEditor =
  Omit<
    LiveBlockSpec<LiveBlock, LiveBlockWidgetOptions>,
    "activeExtensions" | "widget"
  > & {
    widget: (block: LiveBlock, context: LiveBlockWidgetOptions) => WidgetType;
  };
type RangeLike = ReturnType<Decoration["range"]>;

export function createLiveBlockDecorationExtension(
  options: LiveBlockOptions,
) {
  return [
    liveRevealField,
    createLiveBlockDecorationField(options),
    Prec.highest(keymap.of(createLiveBlockNavigationKeymap())),
    liveObjectInputHandler,
    liveObjectMouseHandlers,
    liveObjectSelectionPlugin,
  ];
}

export function getMarkdownLiveBlocks(state: EditorState): LiveBlock[] {
  return getLiveBlocks(state);
}

export function getAssetGroupLineKinds(state: EditorState) {
  const lineKinds = new Map<number, LiveAssetGroupLineKind>();

  for (const block of getLiveAssetGroupBlocks(state)) {
    for (
      let lineNumber = block.startLine;
      lineNumber <= block.endLine;
      lineNumber += 1
    ) {
      const isFirst = lineNumber === block.startLine;
      const isLast = lineNumber === block.endLine;
      lineKinds.set(
        lineNumber,
        isFirst && isLast
          ? "single"
          : isFirst
            ? "first"
            : isLast
              ? "last"
              : "middle",
      );
    }
  }

  return lineKinds;
}

export function getLiveBlockLineNumbers(state: EditorState) {
  const lineNumbers = new Set<number>();

  for (const block of getLiveBlocks(state)) {
    for (
      let lineNumber = block.startLine;
      lineNumber <= block.endLine;
      lineNumber += 1
    ) {
      lineNumbers.add(lineNumber);
    }
  }

  return lineNumbers;
}

// ---------------------------------------------------------------------------
// Rendered by default, source on intent.
//
// Live mode used to swap any rendered object for its source the moment the
// caret touched it, so arrowing or clicking through a document collapsed
// images, re-flowed tables and re-wrapped links: the page jumped under the
// reader. Now an object shows its source only when the author shows intent to
// edit it:
//
// - they edit its syntax (typing that creates or changes the object — but not
//   typing inside a link's visible label, which edits the label in place);
// - the caret lands inside its hidden syntax (a search jump, undo), where a
//   caret would otherwise be invisible;
// - they double-click it, step into it with ←/→, or choose "Edit source" on the
//   object toolbar (`revealLiveSource`).
//
// Each reveal is a *point* in the document, mapped through edits, that keeps
// the object containing it revealed until no caret is on that object any more.
// Navigation that only *arrives* at an object (↑/↓, a click, a selection
// spanning it) selects it instead: a ring and a toolbar, no layout change.
// ---------------------------------------------------------------------------

/** Show the source of the object containing this document position. */
export const revealLiveSource = StateEffect.define<number>();

export type LiveObjectAt =
  | { kind: "block"; from: number; to: number; block: LiveBlock }
  | {
      kind: "inline";
      from: number;
      to: number;
      object: InlineObject;
      lineFrom: number;
    };

/**
 * The rendered object at a document position: a Live block containing it, or
 * an inline link/wiki link/image on its line (either end inclusive).
 */
export function liveObjectAt(state: EditorState, position: number): LiveObjectAt | null {
  const block = getLiveBlocks(state).find(
    (candidate) => position >= candidate.from && position <= candidate.to,
  );

  if (block) {
    return { kind: "block", from: block.from, to: block.to, block };
  }

  const line = state.doc.lineAt(position);

  if (!line.text.includes("[") || isInsideSyntaxRange(line.from, getSyntaxExclusionRanges(state))) {
    return null;
  }

  const object = findInlineObjectAt(line.text, position - line.from);

  return object
    ? {
        kind: "inline",
        from: line.from + object.from,
        to: line.from + object.to,
        object,
        lineFrom: line.from,
      }
    : null;
}

function isRevealWorthyEdit(transaction: Transaction) {
  // Typing and deleting only: a toolbar command, a collaborator's change, an
  // upload, or an accepted completion should leave the object rendered.
  return (
    (transaction.isUserEvent("input") && !transaction.isUserEvent("input.complete")) ||
    transaction.isUserEvent("delete")
  );
}

function isCaretInsideHiddenSyntax(target: LiveObjectAt, position: number) {
  if (target.kind === "block") {
    return position > target.from && position < target.to;
  }

  return isInsideHiddenSyntax(target.object, position - target.lineFrom);
}

/** Whether an edit only changed a link's visible label, leaving it intact. */
function isLabelEdit(transaction: Transaction, after: LiveObjectAt) {
  if (after.kind !== "inline" || after.object.kind === "image") {
    return false;
  }

  const head = transaction.state.selection.main.head;
  const startHead = transaction.startState.selection.main.head;
  const before = liveObjectAt(transaction.startState, startHead);

  return Boolean(
    before &&
      before.kind === "inline" &&
      before.object.kind === after.object.kind &&
      isInLabel(before.object, startHead - before.lineFrom) &&
      isInLabel(after.object, head - after.lineFrom),
  );
}

export const liveRevealField = StateField.define<readonly number[]>({
  create: () => [],
  update(points, transaction) {
    const hasRevealEffect = transaction.effects.some((effect) =>
      effect.is(revealLiveSource),
    );

    if (!transaction.docChanged && !transaction.selection && !hasRevealEffect) {
      return points;
    }

    const state = transaction.state;
    const next = transaction.docChanged
      ? points.map((point) => transaction.changes.mapPos(point, -1))
      : [...points];

    for (const effect of transaction.effects) {
      if (effect.is(revealLiveSource)) {
        next.push(Math.min(Math.max(effect.value, 0), state.doc.length));
      }
    }

    if (transaction.docChanged && isRevealWorthyEdit(transaction)) {
      const head = state.selection.main.head;
      const edited = liveObjectAt(state, head);

      if (edited && !isLabelEdit(transaction, edited)) {
        next.push(head);
      }
    }

    for (const range of state.selection.ranges) {
      const target = liveObjectAt(state, range.head);

      if (target && isCaretInsideHiddenSyntax(target, range.head)) {
        next.push(range.head);
      }
    }

    // Keep one point per object, and only while a caret is still on it.
    const kept: number[] = [];
    const seen = new Set<number>();

    for (const point of next) {
      const target = liveObjectAt(state, point);

      if (
        !target ||
        seen.has(target.from) ||
        !state.selection.ranges.some(
          (range) => range.head >= target.from && range.head <= target.to,
        )
      ) {
        continue;
      }

      seen.add(target.from);
      kept.push(point);
    }

    return kept.length === points.length &&
      kept.every((point, index) => point === points[index])
      ? points
      : kept;
  },
});

/** Reveal points, for the inline Live preview pass in `MarkdownEditor`. */
export function liveRevealPoints(state: EditorState): readonly number[] {
  return state.field(liveRevealField, false) ?? [];
}

/** Whether the object spanning `from..to` is showing its source. */
export function isLiveSourceRevealed(state: EditorState, from: number, to: number) {
  return liveRevealPoints(state).some((point) => point >= from && point <= to);
}

/**
 * The Live block the caret has selected as an object: an empty caret on one of
 * its edges, or a selection that is exactly the block. Null while revealed.
 */
export function selectedLiveBlock(state: EditorState): LiveBlock | null {
  const selection = state.selection.main;

  for (const block of getLiveBlocks(state)) {
    const onEdge = selection.empty
      ? selection.head === block.from || selection.head === block.to
      : selection.from === block.from && selection.to === block.to;

    if (onEdge && !isBlockActive(state, block)) {
      return block;
    }
  }

  return null;
}

function createLiveBlockDecorationField(options: LiveBlockOptions) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLiveBlockDecorations(state, options);
    },
    update(decorations, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        transaction.startState.field(liveRevealField, false) ===
          transaction.state.field(liveRevealField, false)
      ) {
        return decorations;
      }

      return buildLiveBlockDecorations(transaction.state, options);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

function buildLiveBlockDecorations(
  state: EditorState,
  options: LiveBlockOptions,
) {
  const ranges = [];

  for (const block of getLiveBlocks(state)) {
    const spec = getLiveBlockSpec(block);
    const isActive = spec.isActive?.(state, block) ?? isBlockActive(state, block);

    if (!isActive) {
      ranges.push(
        Decoration.replace({
          block: true,
          widget: spec.widget(block, options),
        }).range(block.from, block.to),
      );
      continue;
    }

    ranges.push(...(spec.activeDecorations?.(state, block, options) ?? []));
  }

  return Decoration.set(ranges, true);
}

function createLiveBlockNavigationKeymap() {
  return [
    {
      key: "ArrowDown",
      run: (view: EditorView) => moveVerticallyAroundLiveBlocks(view, true),
    },
    {
      key: "ArrowUp",
      run: (view: EditorView) => moveVerticallyAroundLiveBlocks(view, false),
    },
    // ←/→ from a selected block's edge step *into* its source.
    { key: "ArrowRight", run: (view: EditorView) => stepIntoSelectedBlock(view, true) },
    { key: "ArrowLeft", run: (view: EditorView) => stepIntoSelectedBlock(view, false) },
    { key: "Enter", run: insertLineBesideSelectedBlock },
    { key: "Backspace", run: (view: EditorView) => deleteAroundLiveBlock(view, false) },
    { key: "Delete", run: (view: EditorView) => deleteAroundLiveBlock(view, true) },
  ];
}

function inactiveBlockStartingAt(state: EditorState, blocks: LiveBlock[], lineNumber: number) {
  return blocks.find(
    (block) => block.startLine === lineNumber && !isBlockActive(state, block),
  );
}

function inactiveBlockEndingAt(state: EditorState, blocks: LiveBlock[], lineNumber: number) {
  return blocks.find(
    (block) => block.endLine === lineNumber && !isBlockActive(state, block),
  );
}

/**
 * ↑/↓ treat a rendered block as one stop: arriving selects it, the next press
 * leaves it. CodeMirror's own vertical motion would put the caret on the
 * block's far edge (a press that visibly does nothing) or skip the line next
 * to it.
 */
function moveVerticallyAroundLiveBlocks(view: EditorView, forward: boolean) {
  const { state } = view;
  const selection = state.selection.main;

  if (!selection.empty) {
    return false;
  }

  const blocks = getLiveBlocks(state);
  const doc = state.doc;
  const selected = selectedLiveBlock(state);

  if (selected) {
    if (forward) {
      if (selected.endLine >= doc.lines) {
        return true;
      }

      const nextLine = doc.line(selected.endLine + 1);
      const nextBlock = inactiveBlockStartingAt(state, blocks, nextLine.number);
      view.dispatch({
        selection: EditorSelection.cursor(nextBlock ? nextBlock.from : nextLine.from),
        scrollIntoView: true,
        userEvent: "select",
      });
      return true;
    }

    if (selected.startLine <= 1) {
      return true;
    }

    const previousLine = doc.line(selected.startLine - 1);
    const previousBlock = inactiveBlockEndingAt(state, blocks, previousLine.number);
    let target = previousBlock?.to ?? previousLine.from;

    if (!previousBlock) {
      // The last visual row of a wrapped paragraph, not its first.
      const predicted = view.moveVertically(EditorSelection.cursor(selected.from), false);

      if (predicted.head >= previousLine.from && predicted.head <= previousLine.to) {
        target = predicted.head;
      }
    }

    view.dispatch({
      selection: EditorSelection.cursor(target),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  const line = doc.lineAt(selection.head);
  const predicted = view.moveVertically(selection, forward);
  const predictedLine = doc.lineAt(predicted.head);

  if (predictedLine.number === line.number) {
    // Still inside a wrapped line: ordinary motion.
    return false;
  }

  const adjacent = forward
    ? inactiveBlockStartingAt(state, blocks, line.number + 1)
    : inactiveBlockEndingAt(state, blocks, line.number - 1);

  if (adjacent) {
    view.dispatch({
      selection: EditorSelection.cursor(forward ? adjacent.from : adjacent.to),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  if (Math.abs(predictedLine.number - line.number) <= 1) {
    return false;
  }

  // CodeMirror's motion skipped a line (a replaced range in between): land on
  // the next line instead, keeping the column.
  const nextLineNumber = line.number + (forward ? 1 : -1);

  if (nextLineNumber < 1 || nextLineNumber > doc.lines) {
    return false;
  }

  const nextLine = doc.line(nextLineNumber);
  const columnOffset = selection.head - line.from;
  view.dispatch({
    selection: EditorSelection.cursor(
      Math.min(nextLine.to, nextLine.from + columnOffset),
      undefined,
      undefined,
      predicted.goalColumn,
    ),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

function stepIntoSelectedBlock(view: EditorView, forward: boolean) {
  const selection = view.state.selection.main;
  const selected = selection.empty ? selectedLiveBlock(view.state) : null;

  if (!selected) {
    return false;
  }

  // → from the top edge, ← from the bottom edge: into the block. The other
  // direction leaves it like any line end.
  if (forward ? selection.head !== selected.from : selection.head !== selected.to) {
    return false;
  }

  view.dispatch({
    effects: revealLiveSource.of(selected.from),
    selection: EditorSelection.cursor(selection.head),
    scrollIntoView: true,
  });
  return true;
}

/** Enter on a selected block opens a new line after it (before it, from the top edge). */
function insertLineBesideSelectedBlock(view: EditorView) {
  const selection = view.state.selection.main;
  const selected = selection.empty ? selectedLiveBlock(view.state) : null;

  if (!selected) {
    return false;
  }

  const atTop = selection.head === selected.from && selected.from !== selected.to;
  const position = atTop ? selected.from : selected.to;
  view.dispatch({
    changes: { from: position, insert: "\n" },
    selection: EditorSelection.cursor(atTop ? selected.from : selected.to + 1),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/**
 * Backspace/Delete around rendered blocks, without ever merging a paragraph
 * into a block's hidden last line (which turns `![[image]]` into
 * `![[image]]text` and the image back into source):
 *
 * - on a selected block, they delete the block;
 * - next to one, an empty line is removed and a non-empty one selects the
 *   block instead of joining onto it.
 */
function deleteAroundLiveBlock(view: EditorView, forward: boolean) {
  const { state } = view;
  const selection = state.selection.main;

  if (!selection.empty && !selectedLiveBlock(state)) {
    return false;
  }

  const selected = selectedLiveBlock(state);

  if (selected) {
    view.dispatch(deleteBlockTransaction(state, selected));
    return true;
  }

  const doc = state.doc;
  const line = doc.lineAt(selection.head);
  const blocks = getLiveBlocks(state);

  if (!forward && selection.head === line.from && line.number > 1) {
    const above = inactiveBlockEndingAt(state, blocks, line.number - 1);

    if (!above) {
      return false;
    }

    view.dispatch(
      line.length === 0
        ? {
            changes: { from: above.to, to: line.to },
            selection: EditorSelection.cursor(above.to),
            userEvent: "delete.backward",
          }
        : { selection: EditorSelection.cursor(above.to), userEvent: "select" },
    );
    return true;
  }

  if (forward && selection.head === line.to && line.number < doc.lines) {
    const below = inactiveBlockStartingAt(state, blocks, line.number + 1);

    if (!below) {
      return false;
    }

    view.dispatch(
      line.length === 0
        ? {
            changes: { from: line.from, to: below.from },
            selection: EditorSelection.cursor(line.from),
            userEvent: "delete.forward",
          }
        : { selection: EditorSelection.cursor(below.from), userEvent: "select" },
    );
    return true;
  }

  return false;
}

/** Removes a block and one of the line breaks around it. */
export function deleteBlockTransaction(state: EditorState, block: Pick<LiveBlock, "from" | "to">) {
  const doc = state.doc;
  const from = block.to < doc.length ? block.from : Math.max(0, block.from - 1);
  const to = block.to < doc.length ? block.to + 1 : block.to;

  return {
    changes: { from, to },
    selection: EditorSelection.cursor(Math.min(from, doc.length - (to - from))),
    scrollIntoView: true,
    userEvent: "delete",
  };
}

/**
 * Typing on a selected block starts a new paragraph beside it rather than
 * appending text to the block's hidden source line.
 */
const liveObjectInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || view.composing || text.includes("\n")) {
    return false;
  }

  const selection = view.state.selection.main;
  const selected = selection.empty && selection.head === from ? selectedLiveBlock(view.state) : null;

  if (!selected) {
    return false;
  }

  const atTop = from === selected.from && selected.from !== selected.to;
  view.dispatch({
    changes: atTop
      ? { from: selected.from, insert: `${text}\n` }
      : { from: selected.to, insert: `\n${text}` },
    selection: EditorSelection.cursor(
      atTop ? selected.from + text.length : selected.to + 1 + text.length,
    ),
    scrollIntoView: true,
    userEvent: "input.type",
  });
  return true;
});

const liveObjectMouseHandlers = EditorView.domEventHandlers({
  dblclick(event, view) {
    const target = event.target;

    if (!(target instanceof Element) || target.closest("a, button, input, select, textarea")) {
      return false;
    }

    // Rendered callouts and tables are `pointer-events: none`, so the event
    // lands on the content behind them; the coordinates still name the block.
    const element = target.closest<HTMLElement>("[data-live-block]");
    const position =
      element && view.contentDOM.contains(element)
        ? view.posAtDOM(element)
        : view.posAtCoords({ x: event.clientX, y: event.clientY });

    if (position === null) {
      return false;
    }

    const block = getLiveBlocks(view.state).find(
      (candidate) =>
        position >= candidate.from &&
        position <= candidate.to &&
        !isBlockActive(view.state, candidate),
    );

    if (!block) {
      return false;
    }

    event.preventDefault();
    view.dispatch({
      effects: revealLiveSource.of(block.from),
      selection: EditorSelection.cursor(block.kind === "image" ? block.to : block.from),
      scrollIntoView: true,
    });
    view.focus();
    return true;
  },
});

/**
 * Marks selected blocks (`vault-cm-live-object-selected`) and tells the editor
 * root whether the caret is "on" an object, so the caret line is hidden while
 * the ring stands in for it. Classes only: no layout changes, and CodeMirror
 * ignores DOM changes inside widgets.
 */
const liveObjectSelectionPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (
        update.selectionSet ||
        update.docChanged ||
        update.viewportChanged ||
        update.focusChanged ||
        update.startState.field(liveRevealField, false) !==
          update.state.field(liveRevealField, false)
      ) {
        this.schedule();
      }
    }

    schedule() {
      this.view.requestMeasure({
        key: this,
        read: () => null,
        write: () => this.apply(),
      });
    }

    apply() {
      const { view } = this;
      const state = view.state;
      const blocks = getLiveBlocks(state).filter((block) => !isBlockActive(state, block));
      const selected = new Set<number>();

      for (const range of state.selection.ranges) {
        for (const block of blocks) {
          const covered = range.empty
            ? range.head === block.from || range.head === block.to
            : range.from <= block.from && range.to >= block.to;

          if (covered) selected.add(block.from);
        }
      }

      for (const element of view.contentDOM.querySelectorAll<HTMLElement>("[data-live-block]")) {
        let position = -1;

        try {
          position = view.posAtDOM(element);
        } catch {
          // Detached mid-update; the next pass will catch it.
        }

        element.classList.toggle("vault-cm-live-object-selected", selected.has(position));
      }

      const caretOnObject =
        state.selection.main.empty && selected.size > 0;
      view.dom.classList.toggle("vault-cm-object-caret", caretOnObject);
    }

    destroy() {
      this.view.dom.classList.remove("vault-cm-object-caret");
    }
  },
);

function getLiveBlockSpec(block: LiveBlock): LiveBlockSpecForEditor {
  const spec = liveBlockSpecs.find((candidate) => candidate.id === block.kind);

  if (!spec) {
    throw new Error(`No live block spec registered for ${block.kind}`);
  }

  return spec;
}

function getAssetGroupLineDecoration(kind: LiveAssetGroupLineKind) {
  if (kind === "first") {
    return assetGroupFirstLine;
  }

  if (kind === "last") {
    return assetGroupLastLine;
  }

  if (kind === "single") {
    return assetGroupSingleLine;
  }

  return assetGroupMiddleLine;
}

class AssetGroupBlockWidget extends WidgetType {
  constructor(
    private readonly block: LiveAssetGroupBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: AssetGroupBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.onConfigureAssetGroup === this.options.onConfigureAssetGroup
    );
  }

  toDOM() {
    const figure = document.createElement("figure");
    figure.className = [
      getAssetGroupClassName(this.block.attributes),
      "vault-cm-asset-group-rendered",
    ].join(" ");
    applyStableBlockWidgetSpacing(figure);
    figure.dataset.liveBlock = "assetGroup";

    const configureButton = document.createElement("button");
    configureButton.className = "vault-cm-asset-group-configure";
    configureButton.type = "button";
    configureButton.setAttribute("aria-label", "Configure asset group");
    configureButton.title = "Configure asset group";
    configureButton.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>';
    configureButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    configureButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onConfigureAssetGroup?.({
        from: this.block.from,
        to: this.block.to,
        startLine: this.block.startLine,
        endLine: this.block.endLine,
        source: this.block.source,
        attributes: this.block.attributes,
        childCount: this.block.children.length,
      });
    });

    const grid = document.createElement("div");
    grid.className = "vault-asset-group-grid";

    for (const child of this.block.children) {
      const item = document.createElement("div");
      item.className = "vault-asset-group-item";
      const asset = this.options.assetLinks[child.assetId];

      if (!asset) {
        const missing = document.createElement("span");
        missing.className = "vault-asset-embed vault-asset-embed--missing";
        missing.textContent = child.parsed.label || "Private asset";
        item.append(missing);
        grid.append(item);
        continue;
      }

      if (asset.kind !== "image") {
        item.append(createAssetFileCard(asset, child.parsed.label));
        grid.append(item);
        continue;
      }

      const imageFigure = document.createElement("figure");
      imageFigure.className = getAssetEmbedClassName(
        child.parsed.attributes,
        "vault-asset-embed vault-asset-embed--image",
      );
      const imageStyle = getAssetEmbedStyle(child.parsed.attributes);

      if (imageStyle) {
        imageFigure.setAttribute("style", imageStyle);
      }

      const frame = document.createElement("span");
      frame.className = "vault-md-image-frame";

      const image = document.createElement("img");
      image.className = "vault-md-img vault-asset-embed-image";
      image.src = asset.displayUrl ?? asset.url;
      // A display copy that fails (storage hiccup) falls back to the original.
      image.addEventListener("error", () => {
        if (image.src !== new URL(asset.url, window.location.href).href) image.src = asset.url;
      }, { once: true });
      image.alt =
        child.parsed.attributes.alt ||
        asset.altText ||
        child.parsed.label ||
        asset.displayName;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener(
        "error",
        () => {
          frame.dataset.imageState = "error";
        },
        { once: true },
      );

      const fallback = document.createElement("figcaption");
      fallback.className = "vault-md-image-fallback";
      fallback.textContent = "Image unavailable";

      frame.append(image, fallback);
      imageFigure.append(frame);

      if (child.parsed.attributes.caption) {
        const caption = document.createElement("figcaption");
        caption.className = "vault-asset-embed-caption";
        caption.textContent = child.parsed.attributes.caption;
        imageFigure.append(caption);
      }

      item.append(imageFigure);
      grid.append(item);
    }

    figure.append(configureButton, grid);

    if (this.block.attributes.caption) {
      const caption = document.createElement("figcaption");
      caption.className = "vault-asset-group-caption";
      caption.textContent = this.block.attributes.caption;
      figure.append(caption);
    }

    return figure;
  }

  ignoreEvent(event: Event) {
    const target = event.target;

    return target instanceof Element
      ? Boolean(target.closest(".vault-cm-asset-group-configure"))
      : false;
  }
}

class CalloutBlockWidget extends WidgetType {
  private root: Root | null = null;
  private releaseHeight: (() => void) | null = null;

  get estimatedHeight() {
    return knownBlockHeight(liveBlockHeightKey(this.block));
  }

  constructor(
    private readonly block: LiveCalloutBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: CalloutBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.wikiLinks === this.options.wikiLinks
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "vault-cm-callout-rendered";
    applyStableBlockWidgetSpacing(container);
    container.dataset.liveBlock = "callout";
    this.root = createRoot(container);
    this.releaseHeight = holdWidgetHeight(container, liveBlockHeightKey(this.block), view);
    this.root.render(
      createElement(MarkdownDocument, {
        markdown: this.block.source,
        assetLinks: this.options.assetLinks,
        wikiLinks: this.options.wikiLinks,
        contained: false,
        disableLinks: true,
        className: "vault-cm-callout-rendered-markdown",
      }),
    );

    return container;
  }

  destroy() {
    this.releaseHeight?.();
    this.releaseHeight = null;
    const root = this.root;
    this.root = null;

    if (root) {
      window.setTimeout(() => root.unmount(), 0);
    }
  }

  ignoreEvent() {
    return false;
  }
}

class DocumentEmbedBlockWidget extends WidgetType {
  private root: Root | null = null;
  private releaseHeight: (() => void) | null = null;

  get estimatedHeight() {
    return knownBlockHeight(liveBlockHeightKey(this.block));
  }

  constructor(
    private readonly block: LiveDocumentEmbedBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: DocumentEmbedBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.wikiLinks === this.options.wikiLinks
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "vault-cm-document-embed-preview";
    applyStableBlockWidgetSpacing(container, "0.35rem");
    container.dataset.liveBlock = "documentEmbed";
    this.root = createRoot(container);
    this.releaseHeight = holdWidgetHeight(container, liveBlockHeightKey(this.block), view);
    this.root.render(
      createElement(MarkdownDocument, {
        markdown: this.block.source,
        assetLinks: this.options.assetLinks,
        wikiLinks: this.options.wikiLinks,
        contained: false,
        className: "vault-cm-document-embed-markdown",
      }),
    );

    return container;
  }

  destroy() {
    this.releaseHeight?.();
    this.releaseHeight = null;
    const root = this.root;
    this.root = null;

    if (root) {
      window.setTimeout(() => root.unmount(), 0);
    }
  }

  ignoreEvent() {
    return false;
  }
}

class TableBlockWidget extends WidgetType {
  private root: Root | null = null;
  private releaseHeight: (() => void) | null = null;

  get estimatedHeight() {
    return knownBlockHeight(liveBlockHeightKey(this.block));
  }

  constructor(
    private readonly block: LiveTableBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: TableBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.wikiLinks === this.options.wikiLinks
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "vault-cm-table-rendered";
    applyStableBlockWidgetSpacing(container);
    container.dataset.liveBlock = "table";
    this.root = createRoot(container);
    this.releaseHeight = holdWidgetHeight(container, liveBlockHeightKey(this.block), view);
    this.root.render(
      createElement(MarkdownDocument, {
        markdown: this.block.source,
        assetLinks: this.options.assetLinks,
        wikiLinks: this.options.wikiLinks,
        contained: false,
        disableLinks: true,
        className: "vault-cm-table-rendered-markdown",
      }),
    );

    return container;
  }

  destroy() {
    this.releaseHeight?.();
    this.releaseHeight = null;
    const root = this.root;
    this.root = null;

    if (root) {
      window.setTimeout(() => root.unmount(), 0);
    }
  }

  ignoreEvent() {
    return false;
  }
}

class MathBlockWidget extends WidgetType {
  private root: Root | null = null;
  private releaseHeight: (() => void) | null = null;

  get estimatedHeight() {
    return knownBlockHeight(liveBlockHeightKey(this.block));
  }

  constructor(
    private readonly block: LiveMathBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: MathBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.wikiLinks === this.options.wikiLinks
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "vault-cm-math-rendered";
    applyStableBlockWidgetSpacing(container);
    container.dataset.liveBlock = "mathBlock";
    this.root = createRoot(container);
    this.releaseHeight = holdWidgetHeight(container, liveBlockHeightKey(this.block), view);
    this.root.render(
      createElement(MarkdownDocument, {
        markdown: this.block.source,
        assetLinks: this.options.assetLinks,
        wikiLinks: this.options.wikiLinks,
        contained: false,
        disableLinks: true,
        className: "vault-cm-math-rendered-markdown",
      }),
    );

    return container;
  }

  destroy() {
    this.releaseHeight?.();
    this.releaseHeight = null;
    const root = this.root;
    this.root = null;

    if (root) {
      window.setTimeout(() => root.unmount(), 0);
    }
  }

  ignoreEvent() {
    return false;
  }
}

class ExtensionBlockWidget extends WidgetType {
  private root: Root | null = null;
  private releaseHeight: (() => void) | null = null;

  get estimatedHeight() {
    return knownBlockHeight(liveBlockHeightKey(this.block));
  }

  constructor(
    private readonly block: LiveExtensionBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: ExtensionBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.block.documentMarkdown === this.block.documentMarkdown &&
      widget.block.extensionId === this.block.extensionId &&
      widget.options.extensions === this.options.extensions &&
      widget.options.extensionStateStore === this.options.extensionStateStore &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.wikiLinks === this.options.wikiLinks
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = `vault-cm-extension-block vault-cm-${this.block.name}-rendered`;
    container.contentEditable = "false";
    applyStableBlockWidgetSpacing(container);
    container.dataset.liveBlock = "extensionBlock";

    this.root = createRoot(container);
    this.releaseHeight = holdWidgetHeight(container, liveBlockHeightKey(this.block), view);
    const host = createElement(ExtensionBlockHost, {
        // Live mode is where blocks are edited, so the widget carries the
        // page's own `canEdit` (Read mode always renders them read-only).
        ctx: createRenderContext(this.options.extensions, this.block.extensionId),
        name: this.block.name,
        attributes: this.block.attributes,
        source: this.block.source,
        documentMarkdown: this.block.documentMarkdown,
        links: {
          wikiLinks: this.options.wikiLinks,
          assetLinks: this.options.assetLinks,
        },
      });
    const store = this.options.extensionStateStore;
    this.root.render(
      store ? createElement(ExtensionStateStoreProvider, { value: store }, host) : host,
    );

    return container;
  }

  destroy() {
    this.releaseHeight?.();
    this.releaseHeight = null;
    const root = this.root;
    this.root = null;

    if (root) {
      window.setTimeout(() => root.unmount(), 0);
    }
  }

  // Let the embedded React UI handle all interaction so clicks/typing inside
  // the block never fall through to CodeMirror selection handling.
  ignoreEvent() {
    return true;
  }
}

/**
 * A standalone image line, drawn as a block that reserves its height before
 * the picture arrives: an asset's stored pixel size, or the natural size this
 * tab saw last time, sets the frame's aspect ratio, so neither loading nor
 * scrolling it back into view moves the text below.
 */
class ImageBlockWidget extends WidgetType {
  constructor(
    private readonly block: LiveImageBlock,
    private readonly options: LiveBlockOptions,
    /** Drawn under the revealed source line rather than in place of it. */
    private readonly preview = false,
  ) {
    super();
  }

  private get asset() {
    const { image } = this.block;
    return image.variant === "asset" ? this.options.assetLinks[image.parsed.assetId] ?? null : null;
  }

  private get src() {
    const { image } = this.block;

    if (image.variant === "external") {
      return image.src;
    }

    const asset = this.asset;
    return asset ? asset.displayUrl ?? asset.url : "";
  }

  private get heightKey() {
    return `${this.block.source}\u0000${this.src}\u0000${this.preview ? "p" : "b"}`;
  }

  eq(widget: ImageBlockWidget) {
    // Compare the one resolution this block shows, not the map's identity:
    // the map is replaced whenever any asset resolves.
    const mine = this.asset;
    const theirs = widget.asset;

    return (
      widget.block.source === this.block.source &&
      widget.preview === this.preview &&
      widget.src === this.src &&
      (mine?.kind ?? null) === (theirs?.kind ?? null) &&
      (mine?.url ?? null) === (theirs?.url ?? null)
    );
  }

  get estimatedHeight() {
    return knownBlockHeight(this.heightKey);
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = this.preview
      ? "vault-cm-image-block vault-cm-image-block-preview"
      : "vault-cm-image-block";

    if (!this.preview) {
      wrapper.dataset.liveBlock = "image";
    }

    const remember = () => {
      const height = wrapper.getBoundingClientRect().height;
      rememberBlockHeight(this.heightKey, height);
      view.requestMeasure();
    };
    const { image } = this.block;

    if (image.variant === "external") {
      wrapper.append(this.createImage(image.src, image.src, image.alt, null, remember));
      return wrapper;
    }

    const asset = this.asset;

    if (!asset) {
      const missing = document.createElement("span");
      missing.className = "vault-asset-embed vault-asset-embed--missing";
      missing.textContent = image.parsed.label || "Private asset";
      wrapper.append(missing);
      return wrapper;
    }

    if (asset.kind !== "image") {
      wrapper.append(createAssetFileCard(asset, image.parsed.label));
      return wrapper;
    }

    const attributes = image.parsed.attributes;
    const figure = document.createElement("figure");
    figure.className = getAssetEmbedClassName(
      attributes,
      "vault-cm-wiki-image-preview vault-asset-embed vault-asset-embed--image",
    );
    const figureStyle = getAssetEmbedStyle(attributes);

    if (figureStyle) {
      figure.setAttribute("style", figureStyle);
    }

    const frameAndImage = this.createImage(
      asset.displayUrl ?? asset.url,
      asset.url,
      attributes.alt || asset.altText || image.parsed.label || asset.displayName,
      asset.width && asset.height ? { width: asset.width, height: asset.height } : null,
      remember,
    );
    figure.append(frameAndImage);

    if (attributes.caption) {
      const caption = document.createElement("figcaption");
      caption.className = "vault-asset-embed-caption";
      caption.textContent = attributes.caption;
      figure.append(caption);
    }

    wrapper.append(figure);
    return wrapper;
  }

  private createImage(
    src: string,
    original: string,
    alt: string,
    storedSize: { width: number; height: number } | null,
    onSettled: () => void,
  ) {
    const frame = document.createElement("span");
    frame.className = "vault-md-image-frame";

    const image = document.createElement("img");
    image.className = "vault-md-img vault-asset-embed-image";
    image.alt = alt;
    image.decoding = "async";
    // CodeMirror already only draws what is near the viewport; lazy loading on
    // top of that only delays the picture the reader scrolled to.
    image.loading = "eager";
    image.draggable = false;

    const size = storedSize ?? knownImageSize(src);

    if (size) {
      image.width = size.width;
      image.height = size.height;
      frame.dataset.sized = "true";
      frame.style.setProperty("--vault-image-ratio", `${size.width} / ${size.height}`);
    }

    image.addEventListener("load", () => {
      rememberImageSize(src, image.naturalWidth, image.naturalHeight);

      if (!frame.dataset.sized && image.naturalWidth > 0) {
        image.width = image.naturalWidth;
        image.height = image.naturalHeight;
        frame.dataset.sized = "true";
        frame.style.setProperty(
          "--vault-image-ratio",
          `${image.naturalWidth} / ${image.naturalHeight}`,
        );
      }

      onSettled();
    });

    let retried = false;
    image.addEventListener("error", () => {
      // A display copy that fails (storage hiccup) falls back to the original.
      if (!retried && original && original !== src) {
        retried = true;
        image.src = original;
        return;
      }

      frame.dataset.imageState = "error";
      onSettled();
    });

    image.src = src;

    const fallback = document.createElement("span");
    fallback.className = "vault-md-image-fallback";
    fallback.textContent = "Image unavailable";

    frame.append(image, fallback);
    return frame;
  }

  ignoreEvent(event: Event) {
    // A file card's Open link works; everything else selects the block.
    return event.target instanceof Element && Boolean(event.target.closest("a"));
  }
}

class ActiveMathBlockPreviewWidget extends WidgetType {
  constructor(private readonly block: LiveMathBlock) {
    super();
  }

  eq(widget: ActiveMathBlockPreviewWidget) {
    return widget.block.source === this.block.source;
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-math-active-preview";
    applyStableBlockWidgetSpacing(container, "0.3rem");

    const frame = document.createElement("div");
    frame.className = "vault-cm-math-active-preview-frame";

    const source = getMathPreviewSource(this.block.source);

    if (source) {
      try {
        katex.render(source, frame, {
          displayMode: true,
          output: "html",
          throwOnError: false,
          trust: false,
          strict: "ignore",
        });
      } catch {
        frame.textContent = source;
      }
    }

    container.append(frame);

    return container;
  }

  ignoreEvent() {
    return false;
  }
}

function liveBlockHeightKey(block: LiveBlock) {
  return `${block.kind} ${block.source}`;
}

/**
 * React-rendered block widgets (callouts, tables, math, embeds) fill in a beat
 * after CodeMirror inserts and measures them. Without this, a block scrolling
 * back into view was first measured as an empty, padding-only box and then
 * grew, shifting everything below. Hold the height it had last time until its
 * content has arrived, then let it size itself and remember the new height.
 */
function holdWidgetHeight(container: HTMLElement, key: string, view: EditorView) {
  const known = knownBlockHeight(key);

  if (known > 0) {
    container.style.minHeight = `${known}px`;
  }

  const observer = new ResizeObserver(() => {
    if (!container.isConnected || container.childElementCount === 0) {
      return;
    }

    container.style.minHeight = "";
    rememberBlockHeight(key, container.getBoundingClientRect().height);
    view.requestMeasure();
  });
  observer.observe(container);

  // Content that renders at exactly the held height never resizes the box,
  // so also settle once React has committed.
  const settle = window.setTimeout(() => {
    if (container.isConnected && container.childElementCount > 0) {
      container.style.minHeight = "";
      rememberBlockHeight(key, container.getBoundingClientRect().height);
    }
  }, 250);

  return () => {
    observer.disconnect();
    window.clearTimeout(settle);
  };
}

function applyStableBlockWidgetSpacing(
  element: HTMLElement,
  paddingBlock = "0.6rem",
) {
  element.style.boxSizing = "border-box";
  element.style.marginBlock = "0";
  element.style.paddingBlock = paddingBlock;
}

function getActiveMathBlockPreviewDecorations(
  block: LiveMathBlock,
  _options: LiveBlockOptions,
): RangeLike[] {
  return [
    Decoration.widget({
      block: true,
      side: 1,
      widget: new ActiveMathBlockPreviewWidget(block),
    }).range(block.to),
  ];
}

function getMathPreviewSource(source: string) {
  const trimmed = source.trim();

  if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
    return trimmed.slice(2, -2).trim();
  }

  const lines = source.split(/\r?\n/);

  if (lines[0]?.trim().startsWith("$$")) {
    lines.shift();
  }

  if (lines.at(-1)?.trim().endsWith("$$")) {
    lines.pop();
  }

  return lines.join("\n").trim();
}

function createAssetFileCard(
  asset: AssetEmbedResolutionMap[string],
  label: string | null,
) {
  const kindLabel = asset.kind === "pdf" ? "PDF" : asset.kind === "video" ? "Video" : "File";
  const card = document.createElement("span");
  card.className = [
    "vault-asset-embed",
    "vault-asset-embed--file",
    `vault-asset-embed--${asset.kind}`,
  ].join(" ");
  card.setAttribute("role", "group");

  const icon = document.createElement("span");
  icon.className = "vault-asset-file-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = kindLabel;

  const body = document.createElement("span");
  body.className = "vault-asset-file-body";

  const title = document.createElement("span");
  title.className = "vault-asset-file-title";
  title.textContent = label || asset.displayName;

  const meta = document.createElement("span");
  meta.className = "vault-asset-file-meta";
  meta.textContent = [kindLabel, formatAssetFileSize(asset.sizeBytes)]
    .filter(Boolean)
    .join(" - ");

  const action = document.createElement("a");
  action.className = "vault-asset-file-action";
  action.href = asset.url;
  action.target = "_blank";
  action.rel = "noreferrer";
  action.textContent = "Open";

  body.append(title, meta);
  card.append(icon, body, action);

  return card;
}

function formatAssetFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KiB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Whether a block shows its source. A caret merely *on* a block's edge, or a
 * selection covering it whole, selects it instead (see `liveRevealField`).
 */
export function isBlockActive(state: EditorState, block: Pick<LiveBlock, "from" | "to">) {
  if (isLiveSourceRevealed(state, block.from, block.to)) {
    return true;
  }

  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.head > block.from && range.head < block.to;
    }

    // A selection that starts or ends inside the block selects source text.
    return (
      (range.from > block.from && range.from < block.to) ||
      (range.to > block.from && range.to < block.to)
    );
  });
}

// Scans are pure functions of the state, and the reveal field, the decoration
// field, the selection ring and the Live preview pass all ask for the same
// state's blocks within one update.
const liveBlocksByState = new WeakMap<EditorState, LiveBlock[]>();

function getLiveBlocks(state: EditorState): LiveBlock[] {
  const cached = liveBlocksByState.get(state);

  if (cached) {
    return cached;
  }

  const blocks = scanLiveBlocks(state);
  liveBlocksByState.set(state, blocks);
  return blocks;
}

function scanLiveBlocks(state: EditorState): LiveBlock[] {
  const syntaxExclusions = getSyntaxExclusionRanges(state);
  const blocks: LiveBlock[] = [];
  const occupiedRanges: SyntaxRange[] = [...syntaxExclusions];

  for (const spec of [...liveBlockSpecs].sort((a, b) => a.priority - b.priority)) {
    const foundBlocks = spec.scan(state, {
      syntaxExclusions,
      occupiedRanges,
    } satisfies LiveBlockScanContext);

    blocks.push(...foundBlocks);
    occupiedRanges.push(
      ...foundBlocks.map((block) => ({
        from: block.from,
        to: block.to,
      })),
    );
  }

  return blocks.sort((a, b) => a.from - b.from);
}

function getAssetGroupSourceDecorations(
  state: EditorState,
  block: LiveAssetGroupBlock,
) {
  const ranges: RangeLike[] = [];

  for (
    let lineNumber = block.startLine;
    lineNumber <= block.endLine;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    const kind =
      lineNumber === block.startLine && lineNumber === block.endLine
        ? "single"
        : lineNumber === block.startLine
          ? "first"
          : lineNumber === block.endLine
            ? "last"
            : "middle";
    ranges.push(getAssetGroupLineDecoration(kind).range(line.from));
  }

  return ranges;
}

function getLiveAssetGroupBlocks(
  state: EditorState,
  syntaxExclusions = getSyntaxExclusionRanges(state),
): LiveAssetGroupBlock[] {
  const blocks: LiveAssetGroupBlock[] = [];
  const doc = state.doc;
  let openGroup: {
    startLine: number;
    from: number;
    attributes: AssetGroupAttributes;
    children: LiveAssetGroupChild[];
  } | null = null;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const trimmed = line.text.trim();

    if (isInsideSyntaxRange(line.from, syntaxExclusions)) {
      continue;
    }

    if (!openGroup) {
      const fenceMatch = trimmed.match(assetGroupFenceCapturePattern);

      if (fenceMatch) {
        openGroup = {
          startLine: lineNumber,
          from: line.from,
          attributes: parseAssetGroupAttributes(fenceMatch[1]),
          children: [],
        };
      }

      continue;
    }

    const parsedAsset = parseAssetEmbedSource(trimmed);

    if (parsedAsset) {
      openGroup.children.push({
        lineNumber,
        from: line.from,
        to: line.to,
        assetId: parsedAsset.assetId,
        source: trimmed,
        parsed: parsedAsset,
      });
    }

    if (trimmed === ":::") {
      if (openGroup.children.length > 0) {
        blocks.push({
          kind: "assetGroup",
          from: openGroup.from,
          to: line.to,
          startLine: openGroup.startLine,
          endLine: lineNumber,
          source: doc.sliceString(openGroup.from, line.to),
          attributes: openGroup.attributes,
          children: openGroup.children,
        });
      }

      openGroup = null;
    }
  }

  return blocks;
}

function getLiveCalloutBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveCalloutBlock[] {
  const blocks: LiveCalloutBlock[] = [];
  const doc = state.doc;
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const line = doc.line(lineNumber);

    if (
      isInsideSyntaxRange(line.from, excludedRanges) ||
      !calloutStartPattern.test(line.text)
    ) {
      lineNumber += 1;
      continue;
    }

    let endLineNumber = lineNumber;

    while (
      endLineNumber < doc.lines &&
      /^>\s?/.test(doc.line(endLineNumber + 1).text)
    ) {
      endLineNumber += 1;
    }

    while (
      endLineNumber > lineNumber &&
      /^>\s*$/.test(doc.line(endLineNumber).text)
    ) {
      endLineNumber -= 1;
    }

    const endLine = doc.line(endLineNumber);
    blocks.push({
      kind: "callout",
      from: line.from,
      to: endLine.to,
      startLine: lineNumber,
      endLine: endLineNumber,
      source: doc.sliceString(line.from, endLine.to),
    });
    lineNumber = endLineNumber + 1;
  }

  return blocks;
}

function getLiveDocumentEmbedBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveDocumentEmbedBlock[] {
  const blocks: LiveDocumentEmbedBlock[] = [];
  const doc = state.doc;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);

    if (isInsideSyntaxRange(line.from, excludedRanges)) {
      continue;
    }

    const source = line.text.trim();

    if (!source || !getWikiDocumentEmbed(source)) {
      continue;
    }

    blocks.push({
      kind: "documentEmbed",
      from: line.from,
      to: line.to,
      startLine: lineNumber,
      endLine: lineNumber,
      source,
    });
  }

  return blocks;
}

function getLiveExtensionBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveExtensionBlock[] {
  const blocks: LiveExtensionBlock[] = [];
  const doc = state.doc;
  let documentMarkdown: string | null = null;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);

    if (isInsideSyntaxRange(line.from, excludedRanges)) {
      continue;
    }

    const parsed = parseExtensionBlockLine(line.text);

    if (!parsed) {
      continue;
    }

    blocks.push({
      kind: "extensionBlock",
      documentMarkdown: parsed.includeDocumentSource
        ? (documentMarkdown ??= doc.toString())
        : undefined,
      from: line.from,
      to: line.to,
      startLine: lineNumber,
      endLine: lineNumber,
      ...parsed,
    });
  }

  return blocks;
}

function getLiveTableBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveTableBlock[] {
  const blocks: LiveTableBlock[] = [];
  const doc = state.doc;
  let lineNumber = 1;

  while (lineNumber < doc.lines) {
    const headerLine = doc.line(lineNumber);
    const delimiterLine = doc.line(lineNumber + 1);

    if (
      isInsideSyntaxRange(headerLine.from, excludedRanges) ||
      isInsideSyntaxRange(delimiterLine.from, excludedRanges) ||
      !isPotentialTableRow(headerLine.text) ||
      !isTableDelimiterRow(delimiterLine.text)
    ) {
      lineNumber += 1;
      continue;
    }

    const headerCells = splitTableRow(headerLine.text);
    const delimiterCells = splitTableRow(delimiterLine.text);

    if (
      headerCells.length < 2 ||
      delimiterCells.length < 2 ||
      headerCells.length !== delimiterCells.length
    ) {
      lineNumber += 1;
      continue;
    }

    let endLineNumber = lineNumber + 1;

    while (endLineNumber < doc.lines) {
      const nextLine = doc.line(endLineNumber + 1);

      if (
        isInsideSyntaxRange(nextLine.from, excludedRanges) ||
        !isPotentialTableRow(nextLine.text)
      ) {
        break;
      }

      const nextCells = splitTableRow(nextLine.text);

      if (nextCells.length < 2) {
        break;
      }

      endLineNumber += 1;
    }

    const endLine = doc.line(endLineNumber);
    blocks.push({
      kind: "table",
      from: headerLine.from,
      to: endLine.to,
      startLine: lineNumber,
      endLine: endLineNumber,
      source: doc.sliceString(headerLine.from, endLine.to),
    });
    lineNumber = endLineNumber + 1;
  }

  return blocks;
}

function getLiveMathBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveMathBlock[] {
  const blocks: LiveMathBlock[] = [];
  const doc = state.doc;
  let lineNumber = 1;

  while (lineNumber <= doc.lines) {
    const startLine = doc.line(lineNumber);
    const trimmed = startLine.text.trim();

    if (
      isInsideSyntaxRange(startLine.from, excludedRanges) ||
      !trimmed.startsWith("$$")
    ) {
      lineNumber += 1;
      continue;
    }

    if (trimmed.length > 2 && trimmed.endsWith("$$")) {
      blocks.push({
        kind: "mathBlock",
        from: startLine.from,
        to: startLine.to,
        startLine: lineNumber,
        endLine: lineNumber,
        source: startLine.text,
      });
      lineNumber += 1;
      continue;
    }

    let endLineNumber = lineNumber + 1;

    while (endLineNumber <= doc.lines) {
      const endLine = doc.line(endLineNumber);

      if (
        !isInsideSyntaxRange(endLine.from, excludedRanges) &&
        endLine.text.trim().endsWith("$$")
      ) {
        blocks.push({
          kind: "mathBlock",
          from: startLine.from,
          to: endLine.to,
          startLine: lineNumber,
          endLine: endLineNumber,
          source: doc.sliceString(startLine.from, endLine.to),
        });
        lineNumber = endLineNumber + 1;
        break;
      }

      endLineNumber += 1;
    }

    if (endLineNumber > doc.lines) {
      lineNumber += 1;
    }
  }

  return blocks;
}

function isPotentialTableRow(text: string) {
  const trimmed = text.trim();

  return trimmed.includes("|") && splitTableRow(trimmed).length >= 2;
}

function isTableDelimiterRow(text: string) {
  const cells = splitTableRow(text);

  if (cells.length < 2) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(text: string) {
  let trimmed = text.trim();

  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }

  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());

  return cells;
}

function getLiveImageBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveImageBlock[] {
  const blocks: LiveImageBlock[] = [];
  const doc = state.doc;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);

    if (!line.text.includes("![") || isInsideSyntaxRange(line.from, excludedRanges)) {
      continue;
    }

    const image = parseStandaloneImageLine(line.text);

    if (!image) {
      continue;
    }

    blocks.push({
      kind: "image",
      from: line.from,
      to: line.to,
      startLine: lineNumber,
      endLine: lineNumber,
      source: line.text.trim(),
      image,
    });
  }

  return blocks;
}

const syntaxExclusionsByState = new WeakMap<EditorState, SyntaxRange[]>();

function getSyntaxExclusionRanges(state: EditorState): SyntaxRange[] {
  const cached = syntaxExclusionsByState.get(state);

  if (cached) {
    return cached;
  }

  const ranges = scanSyntaxExclusionRanges(state);
  syntaxExclusionsByState.set(state, ranges);
  return ranges;
}

function scanSyntaxExclusionRanges(state: EditorState): SyntaxRange[] {
  const ranges: SyntaxRange[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        ranges.push({
          from: node.from,
          to: node.to,
        });
      }
    },
  });

  return ranges.sort((a, b) => a.from - b.from);
}

function isInsideSyntaxRange(position: number, ranges: SyntaxRange[]) {
  return ranges.some((range) => position >= range.from && position < range.to);
}
