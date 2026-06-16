import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

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

export type LiveBlock = LiveAssetGroupBlock;

type SyntaxRange = {
  from: number;
  to: number;
};

const assetGroupFenceCapturePattern = /^:::assets(?:\s*\{([^}\n]*)\})?\s*$/i;
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
  assetLinks: AssetEmbedResolutionMap,
) {
  return createLiveBlockDecorationField(assetLinks);
}

export function getMarkdownLiveBlocks(state: EditorState): LiveBlock[] {
  return getLiveAssetGroupBlocks(state);
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

function createLiveBlockDecorationField(assetLinks: AssetEmbedResolutionMap) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLiveBlockDecorations(state, assetLinks);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged && !transaction.selection) {
        return decorations;
      }

      return buildLiveBlockDecorations(transaction.state, assetLinks);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

function buildLiveBlockDecorations(
  state: EditorState,
  assetLinks: AssetEmbedResolutionMap,
) {
  const ranges = [];

  for (const block of getLiveAssetGroupBlocks(state)) {
    if (!isBlockActive(state, block)) {
      ranges.push(
        Decoration.replace({
          block: true,
          widget: new AssetGroupBlockWidget(block, assetLinks),
        }).range(block.from, block.to),
      );
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
    private readonly assetLinks: AssetEmbedResolutionMap,
  ) {
    super();
  }

  eq(widget: AssetGroupBlockWidget) {
    return (
      widget.block.source === this.block.source &&
      widget.assetLinks === this.assetLinks
    );
  }

  toDOM() {
    const figure = document.createElement("figure");
    figure.className = [
      getAssetGroupClassName(this.block.attributes),
      "vault-cm-asset-group-rendered",
    ].join(" ");

    const grid = document.createElement("div");
    grid.className = "vault-asset-group-grid";

    for (const child of this.block.children) {
      const item = document.createElement("div");
      item.className = "vault-asset-group-item";
      const asset = this.assetLinks[child.assetId];

      if (!asset) {
        const missing = document.createElement("span");
        missing.className = "vault-asset-embed vault-asset-embed--missing";
        missing.textContent = child.parsed.label || "Private asset";
        item.append(missing);
        grid.append(item);
        continue;
      }

      if (asset.kind !== "image") {
        const link = document.createElement("a");
        link.className = "vault-asset-embed vault-asset-embed--file";
        link.href = asset.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = child.parsed.label || asset.displayName;
        item.append(link);
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

    figure.append(grid);

    if (this.block.attributes.caption) {
      const caption = document.createElement("figcaption");
      caption.className = "vault-asset-group-caption";
      caption.textContent = this.block.attributes.caption;
      figure.append(caption);
    }

    return figure;
  }
}

function isBlockActive(state: EditorState, block: LiveBlock) {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= block.from && range.from <= block.to;
    }

    return range.from < block.to && range.to > block.from;
  });
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
