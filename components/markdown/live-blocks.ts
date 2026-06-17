import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
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

export type LiveBlock =
  | LiveAssetGroupBlock
  | LiveCalloutBlock
  | LiveDocumentEmbedBlock;
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
};

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

export function createLiveBlockDecorationExtension(
  options: LiveBlockOptions,
) {
  return createLiveBlockDecorationField(options);
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
    if (!isBlockActive(state, block)) {
      ranges.push(
        Decoration.replace({
          block: true,
          widget:
            block.kind === "assetGroup"
              ? new AssetGroupBlockWidget(block, options)
              : block.kind === "callout"
                ? new CalloutBlockWidget(block, options)
                : new DocumentEmbedBlockWidget(block, options),
        }).range(block.from, block.to),
      );
      continue;
    }

    if (block.kind === "callout" || block.kind === "documentEmbed") {
      continue;
    }

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
  }

  return Decoration.set(ranges, true);
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

function createAssetFileCard(
  asset: AssetEmbedResolutionMap[string],
  label: string | null,
) {
  const kindLabel = asset.kind === "pdf" ? "PDF" : "File";
  const link = document.createElement("a");
  link.className = [
    "vault-asset-embed",
    "vault-asset-embed--file",
    `vault-asset-embed--${asset.kind}`,
  ].join(" ");
  link.href = asset.url;
  link.target = "_blank";
  link.rel = "noreferrer";

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

  const action = document.createElement("span");
  action.className = "vault-asset-file-action";
  action.textContent = "Open";

  body.append(title, meta);
  link.append(icon, body, action);

  return link;
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
  const assetGroups = getLiveAssetGroupBlocks(state);
  const syntaxExclusions = getSyntaxExclusionRanges(state);
  const assetGroupRanges = assetGroups.map((block) => ({
    from: block.from,
    to: block.to,
  }));
  const callouts = getLiveCalloutBlocks(state, [
    ...syntaxExclusions,
    ...assetGroupRanges,
  ]);
  const occupiedRanges = [
    ...syntaxExclusions,
    ...assetGroupRanges,
    ...callouts.map((block) => ({ from: block.from, to: block.to })),
  ];
  const documentEmbeds = getLiveDocumentEmbedBlocks(state, occupiedRanges);

  return [...assetGroups, ...callouts, ...documentEmbeds].sort(
    (a, b) => a.from - b.from,
  );
}

function getLiveAssetGroupBlocks(state: EditorState): LiveAssetGroupBlock[] {
  const blocks: LiveAssetGroupBlock[] = [];
  const syntaxExclusions = getSyntaxExclusionRanges(state);
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
