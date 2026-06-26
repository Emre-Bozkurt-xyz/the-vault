import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  Prec,
  StateField,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from "@codemirror/view";
import katex from "katex";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { CalendarBlock } from "@/components/extensions/CalendarBlock";
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
import { parseCalendarFence, type CalendarWeekStart } from "@/lib/calendar";
import type { ExtensionStateVisibility } from "@/lib/extensions/types";
import { createVaultExtensionRegistry } from "@/lib/extensions/registry";
import type {
  LiveBlockScanContext,
  LiveBlockSpec,
  LiveBlockWidgetContext,
  VaultExtension,
} from "@/lib/extensions/types";

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

export type LiveCalendarBlock = {
  kind: "calendar";
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
  id: string | null;
};

export type LiveBlock =
  | LiveAssetGroupBlock
  | LiveCalloutBlock
  | LiveDocumentEmbedBlock
  | LiveTableBlock
  | LiveMathBlock
  | LiveCalendarBlock;
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
  /** Present in the editor so stateful block widgets (e.g. calendar) can save. */
  documentId?: string;
  canEdit?: boolean;
  calendarWeekStartsOn?: CalendarWeekStart;
  calendarVisibility?: ExtensionStateVisibility;
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
    id: "calendar",
    priority: 15,
    scan: (state, context) =>
      getLiveCalendarBlocks(state, context.occupiedRanges),
    widget: (block, context) =>
      new CalendarBlockWidget(block as LiveCalendarBlock, context),
  },
] satisfies LiveBlockSpecForEditor[];

const coreMarkdownLiveBlockExtension: VaultExtension = {
  id: "vault.core-markdown-live-blocks",
  name: "Core Markdown Live Blocks",
  version: 1,
  kind: "core",
  markdown: {
    liveBlocks: coreMarkdownLiveBlockSpecs as unknown as LiveBlockSpec[],
  },
};

const liveBlockRegistry = createVaultExtensionRegistry([
  coreMarkdownLiveBlockExtension,
]);

const liveBlockSpecs =
  liveBlockRegistry.getMarkdownLiveBlockSpecs() as LiveBlockSpecForEditor[];

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
    createLiveBlockDecorationField(options),
    Prec.highest(keymap.of(createLiveBlockNavigationKeymap())),
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

function createLiveBlockDecorationField(options: LiveBlockOptions) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLiveBlockDecorations(state, options);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged && !transaction.selection) {
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
      run: (view: EditorView) => moveIntoAdjacentLiveBlock(view, true),
    },
    {
      key: "ArrowUp",
      run: (view: EditorView) => moveIntoAdjacentLiveBlock(view, false),
    },
  ];
}

function moveIntoAdjacentLiveBlock(view: EditorView, forward: boolean) {
  const selection = view.state.selection.main;

  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.head);
  const blocks = getLiveBlocks(view.state);
  const targetBlock = forward
    ? blocks.find((block) => block.startLine === line.number + 1)
    : blocks.find((block) => block.endLine === line.number - 1);

  if (!targetBlock || isBlockActive(view.state, targetBlock)) {
    const predictedSelection = view.moveVertically(selection, forward);
    const predictedLine = view.state.doc.lineAt(predictedSelection.head);

    if (Math.abs(predictedLine.number - line.number) <= 1) {
      return false;
    }

    const nextLineNumber = line.number + (forward ? 1 : -1);

    if (nextLineNumber < 1 || nextLineNumber > view.state.doc.lines) {
      return false;
    }

    const nextBlock = getBlockAtLine(blocks, nextLineNumber);

    if (nextBlock && !isBlockActive(view.state, nextBlock)) {
      view.dispatch({
        selection: EditorSelection.cursor(forward ? nextBlock.from : nextBlock.to),
        scrollIntoView: true,
      });
      return true;
    }

    const nextLine = view.state.doc.line(nextLineNumber);
    const columnOffset = selection.head - line.from;
    const nextPosition = Math.min(nextLine.to, nextLine.from + columnOffset);

    view.dispatch({
      selection: EditorSelection.cursor(
        nextPosition,
        undefined,
        undefined,
        predictedSelection.goalColumn,
      ),
      scrollIntoView: true,
    });
    return true;
  }

  view.dispatch({
    selection: EditorSelection.cursor(forward ? targetBlock.from : targetBlock.to),
    scrollIntoView: true,
  });
  return true;
}

function getBlockAtLine(blocks: LiveBlock[], lineNumber: number) {
  return blocks.find(
    (block) => block.startLine <= lineNumber && block.endLine >= lineNumber,
  );
}

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
      image.src = asset.url;
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

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-callout-rendered";
    applyStableBlockWidgetSpacing(container);
    this.root = createRoot(container);
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

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-document-embed-preview";
    applyStableBlockWidgetSpacing(container, "0.35rem");
    this.root = createRoot(container);
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

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-table-rendered";
    applyStableBlockWidgetSpacing(container);
    this.root = createRoot(container);
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

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-math-rendered";
    applyStableBlockWidgetSpacing(container);
    this.root = createRoot(container);
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

class CalendarBlockWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    private readonly block: LiveCalendarBlock,
    private readonly options: LiveBlockOptions,
  ) {
    super();
  }

  eq(widget: CalendarBlockWidget) {
    return (
      widget.block.id === this.block.id &&
      widget.options.documentId === this.options.documentId &&
      widget.options.canEdit === this.options.canEdit &&
      widget.options.calendarWeekStartsOn === this.options.calendarWeekStartsOn &&
      widget.options.calendarVisibility === this.options.calendarVisibility &&
      widget.options.assetLinks === this.options.assetLinks &&
      widget.options.wikiLinks === this.options.wikiLinks
    );
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-calendar-rendered";
    container.contentEditable = "false";
    applyStableBlockWidgetSpacing(container);

    const documentId = this.options.documentId;

    if (!documentId) {
      // Read-only render surfaces (non-editor) mount the calendar elsewhere.
      const frame = document.createElement("div");
      frame.className = "vault-calendar-notice";
      frame.textContent = "Calendar";
      container.append(frame);
      return container;
    }

    this.root = createRoot(container);
    this.root.render(
      createElement(CalendarBlock, {
        documentId,
        calendarId: this.block.id,
        canEdit: this.options.canEdit ?? false,
        weekStartsOn: this.options.calendarWeekStartsOn,
        visibility: this.options.calendarVisibility,
        wikiLinks: this.options.wikiLinks,
        assetLinks: this.options.assetLinks,
      }),
    );

    return container;
  }

  destroy() {
    const root = this.root;
    this.root = null;

    if (root) {
      window.setTimeout(() => root.unmount(), 0);
    }
  }

  // Let the embedded React UI handle all interaction so clicks/typing inside
  // the calendar never fall through to CodeMirror selection handling.
  ignoreEvent() {
    return true;
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
  const kindLabel = asset.kind === "pdf" ? "PDF" : "File";
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

function isBlockActive(state: EditorState, block: LiveBlock) {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= block.from && range.from <= block.to;
    }

    return range.from < block.to && range.to > block.from;
  });
}

function getLiveBlocks(state: EditorState): LiveBlock[] {
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

function getLiveCalendarBlocks(
  state: EditorState,
  excludedRanges: SyntaxRange[],
): LiveCalendarBlock[] {
  const blocks: LiveCalendarBlock[] = [];
  const doc = state.doc;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);

    if (isInsideSyntaxRange(line.from, excludedRanges)) {
      continue;
    }

    const fence = parseCalendarFence(line.text);

    if (!fence) {
      continue;
    }

    blocks.push({
      kind: "calendar",
      from: line.from,
      to: line.to,
      startLine: lineNumber,
      endLine: lineNumber,
      source: line.text.trim(),
      id: fence.id,
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

function getSyntaxExclusionRanges(state: EditorState): SyntaxRange[] {
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
