"use client";

import { EditorSelection, Facet, StateField, type EditorState } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Captions,
  Check,
  Code,
  Copy,
  ExternalLink,
  LayoutGrid,
  Link2,
  Pencil,
  Trash2,
  Type,
  Unlink,
  X,
} from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  deleteBlockTransaction,
  isLiveSourceRevealed,
  liveObjectAt,
  liveRevealField,
  revealLiveSource,
  selectedLiveBlock,
  type LiveAssetGroupSelection,
  type LiveBlock,
  type LiveImageBlock,
} from "@/components/markdown/live-blocks";
import type { LiveLinkTarget } from "@/components/markdown/live-link-open";
import { formatExternalImageSource } from "@/components/markdown/live-objects";
import {
  formatAssetEmbedSource,
  type AssetEmbedAlign,
  type AssetEmbedAttributes,
  type AssetEmbedLayout,
  type AssetEmbedResolutionMap,
  type AssetEmbedWidthPreset,
} from "@/lib/asset-embeds";
import {
  parseWikiLinkParts,
  wikiKeyForTarget,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";

/**
 * The Live-mode object toolbar: what replaces "show the Markdown" for the
 * things Live mode keeps rendered (`live-blocks.ts`, "Rendered by default,
 * source on intent"). It floats beside the selected object — an image, table,
 * callout, embed — or under the link the caret is in, and every action edits
 * the Markdown directly, so the document stays plain text with no hidden state.
 */
export type LiveObjectToolsConfig = {
  onOpenLink: (target: LiveLinkTarget, options: { newTab: boolean }) => void;
  getAssetLinks: () => AssetEmbedResolutionMap;
  getWikiLinks: () => WikiLinkResolutionMap;
  onConfigureAssetGroup?: (selection: LiveAssetGroupSelection) => void;
};

const liveObjectToolsConfig = Facet.define<LiveObjectToolsConfig, LiveObjectToolsConfig | null>({
  combine: (values) => values[0] ?? null,
});

type LinkTarget = {
  kind: "link" | "wikiLink";
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  source: string;
};

type ToolsTarget =
  | { kind: "block"; block: LiveBlock }
  | { kind: "link"; link: LinkTarget };

function describeTarget(state: EditorState): ToolsTarget | null {
  if (state.readOnly) return null;

  const block = selectedLiveBlock(state);
  if (block) return { kind: "block", block };

  const selection = state.selection.main;
  if (!selection.empty) return null;

  const target = liveObjectAt(state, selection.head);
  if (
    !target ||
    target.kind !== "inline" ||
    target.object.kind === "image" ||
    isLiveSourceRevealed(state, target.from, target.to)
  ) {
    return null;
  }

  const offset = selection.head - target.lineFrom;
  if (offset < target.object.labelFrom || offset > target.object.labelTo) return null;

  return {
    kind: "link",
    link: {
      kind: target.object.kind,
      from: target.from,
      to: target.to,
      labelFrom: target.lineFrom + target.object.labelFrom,
      labelTo: target.lineFrom + target.object.labelTo,
      source: state.doc.sliceString(target.from, target.to),
    },
  };
}

function targetKey(target: ToolsTarget) {
  return target.kind === "block"
    ? `block:${target.block.kind}:${target.block.from}:${target.block.source}`
    : `link:${target.link.from}:${target.link.source}`;
}

type ToolsState = { key: string; tooltip: Tooltip } | null;

function computeTools(state: EditorState, previous: ToolsState): ToolsState {
  const target = describeTarget(state);
  if (!target) return null;

  const key = targetKey(target);
  // Same object, same text: keep the mounted toolbar, so an input inside it
  // keeps focus and a click on it is not swallowed by a remount.
  if (previous?.key === key) return previous;

  const pos = target.kind === "block" ? target.block.from : target.link.labelFrom;

  return {
    key,
    tooltip: {
      pos,
      above: target.kind === "block",
      strictSide: false,
      arrow: false,
      create(view) {
        const dom = document.createElement("div");
        dom.className = "vault-object-tooltip";
        // Keep the editor's selection (and so this toolbar) while it is used.
        dom.addEventListener("mousedown", (event) => {
          if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) {
            event.preventDefault();
          }
        });
        const root = createRoot(dom);
        root.render(<LiveObjectTools view={view} target={target} />);
        return { dom, destroy: () => window.setTimeout(() => root.unmount(), 0) };
      },
    },
  };
}

const liveObjectToolsField = StateField.define<ToolsState>({
  create: (state) => computeTools(state, null),
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      transaction.startState.field(liveRevealField, false) ===
        transaction.state.field(liveRevealField, false)
    ) {
      return value;
    }

    return computeTools(transaction.state, value);
  },
  provide: (field) => showTooltip.compute([field], (state) => state.field(field)?.tooltip ?? null),
});

export function createLiveObjectToolsExtension(config: LiveObjectToolsConfig) {
  return [liveObjectToolsConfig.of(config), liveObjectToolsField];
}

function LiveObjectTools({ view, target }: { view: EditorView; target: ToolsTarget }) {
  const config = view.state.facet(liveObjectToolsConfig);

  if (target.kind === "link") {
    return <LinkTools view={view} link={target.link} config={config} />;
  }

  return <BlockTools view={view} block={target.block} config={config} />;
}

// --- blocks -----------------------------------------------------------------

function revealBlock(view: EditorView, block: LiveBlock) {
  view.dispatch({
    effects: revealLiveSource.of(block.from),
    selection: EditorSelection.cursor(block.kind === "image" ? block.to : block.from),
    scrollIntoView: true,
  });
  view.focus();
}

/** Replaces an image line's source, keeping the block selected on the same edge. */
function replaceImageSource(view: EditorView, block: LiveImageBlock, nextSource: string) {
  const line = view.state.doc.lineAt(block.from);
  const start = line.from + Math.max(0, line.text.indexOf(block.source));
  const end = start + block.source.length;
  const onTop = view.state.selection.main.head === block.from;
  const lineEnd = line.to + (nextSource.length - block.source.length);

  view.dispatch({
    changes: { from: start, to: end, insert: nextSource },
    selection: EditorSelection.cursor(onTop ? line.from : lineEnd),
  });
  view.focus();
}

const blockLabels: Record<LiveBlock["kind"], string> = {
  assetGroup: "Asset group",
  callout: "Callout",
  documentEmbed: "Embedded document",
  table: "Table",
  mathBlock: "Math",
  extensionBlock: "Block",
  image: "Image",
};

function BlockTools({
  view,
  block,
  config,
}: {
  view: EditorView;
  block: LiveBlock;
  config: LiveObjectToolsConfig | null;
}) {
  const common = (
    <>
      <ToolButton label="Edit source (double-click, or ← / →)" onClick={() => revealBlock(view, block)}>
        <Code />
      </ToolButton>
      <ToolButton
        label={`Delete ${blockLabels[block.kind].toLowerCase()} (Backspace)`}
        onClick={() => {
          view.dispatch(deleteBlockTransaction(view.state, block));
          view.focus();
        }}
      >
        <Trash2 />
      </ToolButton>
    </>
  );

  if (block.kind === "image") {
    return <ImageTools view={view} block={block} config={config} trailing={common} />;
  }

  return (
    <div className="vault-object-tools" role="toolbar" aria-label={`${blockLabels[block.kind]} tools`}>
      <span className="vault-object-tools-label">{blockLabels[block.kind]}</span>
      {block.kind === "assetGroup" && config?.onConfigureAssetGroup ? (
        <ToolButton
          label="Configure group"
          onClick={() =>
            config.onConfigureAssetGroup?.({
              from: block.from,
              to: block.to,
              startLine: block.startLine,
              endLine: block.endLine,
              source: block.source,
              attributes: block.attributes,
              childCount: block.children.length,
            })
          }
        >
          <LayoutGrid />
        </ToolButton>
      ) : null}
      <Divider />
      {common}
    </div>
  );
}

const widthOptions: Array<[AssetEmbedWidthPreset, string]> = [
  ["small", "S"],
  ["medium", "M"],
  ["large", "L"],
  ["full", "Full"],
];

const alignOptions: Array<[AssetEmbedAlign, string, ReactNode]> = [
  ["left", "Align left", <AlignLeft key="l" />],
  ["center", "Center", <AlignCenter key="c" />],
  ["right", "Align right", <AlignRight key="r" />],
];

function ImageTools({
  view,
  block,
  config,
  trailing,
}: {
  view: EditorView;
  block: LiveImageBlock;
  config: LiveObjectToolsConfig | null;
  trailing: ReactNode;
}) {
  const [editing, setEditing] = useState<null | "caption" | "alt" | "url">(null);
  const { image } = block;

  if (image.variant === "external") {
    const apply = (field: "alt" | "url", value: string) => {
      const next = field === "alt" ? { alt: value } : { src: value.trim() };
      if (field === "url" && !next.src) return;
      replaceImageSource(view, block, formatExternalImageSource(image, next));
    };

    return (
      <div className="vault-object-tools" role="toolbar" aria-label="Image tools">
        {editing ? (
          <TextField
            label={editing === "alt" ? "Alt text" : "Image URL"}
            initial={editing === "alt" ? image.alt : image.src}
            onSubmit={(value) => {
              setEditing(null);
              apply(editing === "alt" ? "alt" : "url", value);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <span className="vault-object-tools-label">Image</span>
            <ToolButton label="Alt text" onClick={() => setEditing("alt")}>
              <Type />
            </ToolButton>
            <ToolButton label="Change image URL" onClick={() => setEditing("url")}>
              <Link2 />
            </ToolButton>
            <ToolButton
              label="Open image"
              onClick={() => window.open(image.src, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink />
            </ToolButton>
            <Divider />
            {trailing}
          </>
        )}
      </div>
    );
  }

  const asset = config?.getAssetLinks()[image.parsed.assetId] ?? null;
  const attributes = image.parsed.attributes;
  const update = (next: Partial<AssetEmbedAttributes>) =>
    replaceImageSource(
      view,
      block,
      formatAssetEmbedSource(image.parsed, { ...attributes, ...next }),
    );

  if (!asset || asset.kind !== "image") {
    return (
      <div className="vault-object-tools" role="toolbar" aria-label="Attachment tools">
        <span className="vault-object-tools-label">
          {asset?.displayName ?? image.parsed.label ?? "Attachment"}
        </span>
        {asset ? (
          <ToolButton
            label="Open"
            onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink />
          </ToolButton>
        ) : null}
        <Divider />
        {trailing}
      </div>
    );
  }

  if (editing) {
    const field = editing === "caption" ? "caption" : "alt";
    return (
      <div className="vault-object-tools" role="toolbar" aria-label="Image tools">
        <TextField
          label={field === "caption" ? "Caption" : "Alt text"}
          initial={attributes[field] ?? ""}
          onSubmit={(value) => {
            setEditing(null);
            update({ [field]: value.trim() || null });
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  const width = attributes.customWidth ? null : attributes.width;

  return (
    <div className="vault-object-tools" role="toolbar" aria-label="Image tools">
      <div className="vault-object-tools-segment" role="group" aria-label="Alignment">
        {alignOptions.map(([value, label, icon]) => (
          <ToolButton
            key={value}
            label={label}
            pressed={attributes.align === value}
            onClick={() => update({ align: value })}
          >
            {icon}
          </ToolButton>
        ))}
      </div>
      <Divider />
      <div className="vault-object-tools-segment" role="group" aria-label="Width">
        {widthOptions.map(([value, label]) => (
          <ToolButton
            key={value}
            label={`Width: ${value}`}
            pressed={width === value}
            onClick={() => update({ width: value, customWidth: null })}
            text
          >
            {label}
          </ToolButton>
        ))}
      </div>
      <Divider />
      <label className="vault-object-tools-select" title="Layout">
        <span className="sr-only">Layout</span>
        <select
          value={attributes.layout}
          onChange={(event) => update({ layout: event.currentTarget.value as AssetEmbedLayout })}
        >
          <option value="block">Block</option>
          <option value="wrap">Wrap</option>
          <option value="inline">Inline</option>
        </select>
      </label>
      <ToolButton
        label={attributes.caption ? `Caption: ${attributes.caption}` : "Add caption"}
        pressed={Boolean(attributes.caption)}
        onClick={() => setEditing("caption")}
      >
        <Captions />
      </ToolButton>
      <ToolButton
        label={attributes.alt ? `Alt text: ${attributes.alt}` : "Alt text"}
        pressed={Boolean(attributes.alt)}
        onClick={() => setEditing("alt")}
      >
        <Type />
      </ToolButton>
      <Divider />
      {trailing}
    </div>
  );
}

// --- links ------------------------------------------------------------------

function markdownLinkParts(source: string) {
  const match = source.match(/^\[([^\]\n]+)]\(([^)\n]+)\)$/);
  if (!match) return null;
  const destination = match[2];
  const titled = destination.match(/^(\S+)(\s+"[^"\n]*")$/);
  const raw = titled ? titled[1] : destination;
  return {
    label: match[1],
    url: raw.replace(/^<|>$/g, ""),
    title: titled?.[2] ?? "",
  };
}

function LinkTools({
  view,
  link,
  config,
}: {
  view: EditorView;
  link: LinkTarget;
  config: LiveObjectToolsConfig | null;
}) {
  const [editingUrl, setEditingUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = view.state.doc.sliceString(link.labelFrom, link.labelTo);

  const editSource = () => {
    view.dispatch({
      effects: revealLiveSource.of(link.from),
      selection: EditorSelection.cursor(view.state.selection.main.head),
    });
    view.focus();
  };
  const unlink = () => {
    view.dispatch({
      changes: { from: link.from, to: link.to, insert: label },
      selection: EditorSelection.cursor(link.from + label.length),
    });
    view.focus();
  };

  if (link.kind === "wikiLink") {
    const body = link.source.slice(2, -2);
    const parts = parseWikiLinkParts("", body);
    const resolution = config?.getWikiLinks()[wikiKeyForTarget(parts.target)];
    const resolved = resolution?.status === "resolved";
    const title = resolution?.label || (parts.target.startsWith("doc:") ? "Linked document" : parts.target);

    return (
      <div className="vault-object-tools" role="toolbar" aria-label="Link tools">
        <span
          className="vault-object-tools-url"
          title={parts.fragment ? `${title} › ${parts.fragment}` : title}
          data-unresolved={resolved ? undefined : "true"}
        >
          {title}
          {parts.fragment ? <span className="text-muted-foreground"> › {parts.fragment}</span> : null}
        </span>
        <ToolButton
          label={resolved ? "Open (Ctrl+click)" : "Create and open"}
          onClick={(event) =>
            config?.onOpenLink(
              { kind: "wiki", target: parts.target, fragment: parts.fragment },
              { newTab: event.ctrlKey || event.metaKey },
            )
          }
        >
          <ExternalLink />
        </ToolButton>
        <Divider />
        <ToolButton label="Remove link" onClick={unlink}>
          <Unlink />
        </ToolButton>
        <ToolButton label="Edit source" onClick={editSource}>
          <Code />
        </ToolButton>
      </div>
    );
  }

  const parts = markdownLinkParts(link.source);
  if (!parts) return null;

  const setUrl = (value: string) => {
    const url = value.trim();
    if (!url) return;
    const destination = `${/[\s()]/.test(url) ? `<${url}>` : url}${parts.title}`;
    const start = link.labelTo + 2;
    view.dispatch({
      changes: { from: start, to: link.to - 1, insert: destination },
      selection: view.state.selection,
    });
    view.focus();
  };

  return (
    <div className="vault-object-tools" role="toolbar" aria-label="Link tools">
      {editingUrl ? (
        <TextField
          label="Link URL"
          initial={parts.url}
          onSubmit={(value) => {
            setEditingUrl(false);
            setUrl(value);
          }}
          onCancel={() => setEditingUrl(false)}
        />
      ) : (
        <>
          <a
            className="vault-object-tools-url"
            href={parts.url}
            title={parts.url}
            onClick={(event) => {
              event.preventDefault();
              config?.onOpenLink({ kind: "url", url: parts.url }, { newTab: true });
            }}
          >
            {parts.url.replace(/^https?:\/\/(www\.)?/i, "")}
          </a>
          <ToolButton label="Edit URL" onClick={() => setEditingUrl(true)}>
            <Pencil />
          </ToolButton>
          <ToolButton
            label="Open link (Ctrl+click)"
            onClick={() => config?.onOpenLink({ kind: "url", url: parts.url }, { newTab: true })}
          >
            <ExternalLink />
          </ToolButton>
          <ToolButton
            label={copied ? "Copied" : "Copy URL"}
            onClick={() => {
              void navigator.clipboard?.writeText(parts.url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? <Check /> : <Copy />}
          </ToolButton>
          <Divider />
          <ToolButton label="Remove link" onClick={unlink}>
            <Unlink />
          </ToolButton>
          <ToolButton label="Edit source" onClick={editSource}>
            <Code />
          </ToolButton>
        </>
      )}
    </div>
  );
}

// --- pieces -----------------------------------------------------------------

function ToolButton({
  label,
  onClick,
  pressed,
  text,
  children,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  text?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={text ? "vault-object-tool vault-object-tool-text" : "vault-object-tool"}
      title={label}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="vault-object-tools-divider" aria-hidden="true" />;
}

function TextField({
  label,
  initial,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);

  // Not a <form>: the editor already sits inside the page's own form, and
  // Enter in a nested field would submit that.
  return (
    <div className="vault-object-tools-field">
      <input
        // The field only exists because the author just asked to type here.
        autoFocus
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <button type="button" className="vault-object-tool" title="Apply" aria-label="Apply" onClick={() => onSubmit(value)}>
        <Check />
      </button>
      <button type="button" className="vault-object-tool" title="Cancel" aria-label="Cancel" onClick={onCancel}>
        <X />
      </button>
    </div>
  );
}
