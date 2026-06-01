"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { HocuspocusProvider } from "@hocuspocus/provider";
import CodeMirror from "@uiw/react-codemirror";
import {
  AlertCircle,
  CheckCircle2,
  Columns2,
  Eye,
  FileCode2,
  Loader2,
  Save,
} from "lucide-react";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import {
  MarkdownToolbar,
  type MarkdownFormat,
} from "@/components/markdown/MarkdownToolbar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  saveDocumentTitleAction,
  saveMarkdownDocumentAction,
} from "@/server/documents";

type MarkdownEditorProps = {
  documentId: string;
  title: string;
  markdown: string;
  collaboration?: {
    url: string;
    token: string;
    user: {
      name: string;
      email: string | null;
    };
  } | null;
};

type PreviewMode = "source" | "live" | "split" | "preview";
type CollabStatus = "off" | "connecting" | "connected" | "disconnected";
type CollabSession = {
  ydoc: Y.Doc;
  ytext: Y.Text;
  undoManager: Y.UndoManager;
  provider: HocuspocusProvider;
};

export function MarkdownEditor({
  documentId,
  title,
  markdown,
  collaboration = null,
}: MarkdownEditorProps) {
  const [titleValue, setTitleValue] = useState(title);
  const [markdownValue, setMarkdownValue] = useState(markdown);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("source");
  const [collabStatus, setCollabStatus] = useState<CollabStatus>(
    collaboration ? "connecting" : "off",
  );
  const [collabReady, setCollabReady] = useState(false);
  const [collabSession, setCollabSession] = useState<CollabSession | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const titleValueRef = useRef(title);
  const markdownValueRef = useRef(markdown);
  const savingRef = useRef(false);
  const isCollaborative = Boolean(collaboration && collabSession && collabReady);
  const collaborationKey = collaboration
    ? `${documentId}:${collaboration.url}:${collaboration.token}`
    : "local";

  useEffect(() => {
    if (!collaboration) {
      return;
    }

    let mounted = true;
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("markdown");
    const undoManager = new Y.UndoManager(ytext);
    const provider = new HocuspocusProvider({
      url: collaboration.url,
      name: documentId,
      document: ydoc,
      token: collaboration.token,
      onStatus: ({ status }) => {
        if (mounted) {
          setCollabStatus(status);
        }
      },
      onAuthenticationFailed: () => {
        if (mounted) {
          setCollabStatus("disconnected");
          setCollabReady(false);
        }
      },
      onSynced: ({ state }) => {
        if (mounted && state) {
          const syncedMarkdown = ytext.toString();
          markdownValueRef.current = syncedMarkdown;
          setMarkdownValue(syncedMarkdown);
          setCollabReady(true);
        }
      },
    });
    const color = colorFromString(
      collaboration.user.email ?? collaboration.user.name,
    );

    provider.awareness?.setLocalStateField("user", {
      name: collaboration.user.name,
      color,
      colorLight: `${color}33`,
    });

    const syncPreview = () => {
      if (!mounted) {
        return;
      }

      const nextMarkdown = ytext.toString();
      markdownValueRef.current = nextMarkdown;
      setMarkdownValue(nextMarkdown);
    };

    ytext.observe(syncPreview);
    setCollabSession({ ydoc, ytext, undoManager, provider });

    return () => {
      mounted = false;
      ytext.unobserve(syncPreview);
      provider.destroy();
      ydoc.destroy();
    };
  }, [collaboration, documentId]);

  const saveDocument = useCallback(async () => {
    if (savingRef.current) {
      return;
    }

    const titleAtSave = titleValueRef.current;
    const markdownAtSave = markdownValueRef.current;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);

    const result = isCollaborative
      ? await saveDocumentTitleAction({
          documentId,
          title: titleAtSave,
        })
      : await saveMarkdownDocumentAction({
          documentId,
          title: titleAtSave,
          markdown: markdownAtSave,
        });

    savingRef.current = false;
    setSaving(false);

    if (!result.ok) {
      setSaveError(result.message);
      setDirty(true);
      return;
    }

    setLastSavedAt(new Date(result.updatedAt));
    setDirty(
      titleValueRef.current !== titleAtSave ||
        (!isCollaborative && markdownValueRef.current !== markdownAtSave),
    );
  }, [documentId, isCollaborative]);

  const extensions = useMemo(
    () => {
      const baseExtensions = [
      markdownLanguage(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          color: "var(--foreground)",
          fontSize: "1rem",
        },
        ".cm-content": {
          caretColor: "var(--foreground)",
          fontFamily: "var(--font-mono)",
          minHeight: "520px",
          padding: "1.5rem",
        },
        ".cm-line": {
          lineHeight: "1.75",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--foreground)",
        },
        "&.cm-focused .cm-cursor": {
          borderLeftColor: "var(--foreground)",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--border)",
          color: "var(--muted-foreground)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor:
            "color-mix(in oklab, var(--muted) 45%, transparent)",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor:
            "color-mix(in oklab, var(--primary) 24%, transparent)",
        },
        ".cm-line .ͼc, .cm-line .ͼd, .cm-line .ͼe, .cm-line .ͼf, .cm-line .ͼg, .cm-line .ͼh, .cm-line .ͼi, .cm-line .ͼj": {
          color: "var(--foreground)",
        },
        ".cm-line [class*='tok-link'], .cm-line [class*='tok-url'], .cm-line [class*='tok-monospace'], .cm-line [class*='tok-meta']": {
          color: "var(--foreground)",
        },
        ".cm-line span": {
          textDecorationColor:
            "color-mix(in oklab, var(--foreground) 55%, transparent)",
        },
        ".vault-cm-hidden-md": {
          display: "none",
        },
        ".vault-cm-preview-heading-1": {
          fontFamily: "var(--font-heading)",
          fontSize: "2rem",
          fontWeight: "600",
          lineHeight: "1.2",
        },
        ".vault-cm-preview-heading-2": {
          fontFamily: "var(--font-heading)",
          fontSize: "1.5rem",
          fontWeight: "600",
          lineHeight: "1.25",
        },
        ".vault-cm-preview-heading-3": {
          fontFamily: "var(--font-heading)",
          fontSize: "1.2rem",
          fontWeight: "600",
          lineHeight: "1.3",
        },
        ".vault-cm-preview-bold": {
          fontWeight: "700",
        },
        ".vault-cm-preview-italic": {
          fontStyle: "italic",
        },
        ".vault-cm-preview-code": {
          border: "1px solid var(--border)",
          borderRadius: "0.3rem",
          backgroundColor: "color-mix(in oklab, var(--muted) 75%, transparent)",
          padding: "0.1rem 0.3rem",
          fontFamily: "var(--font-mono)",
        },
        ".vault-cm-preview-link": {
          color: "var(--foreground)",
          fontWeight: "500",
          textDecoration: "underline",
          textUnderlineOffset: "0.2rem",
        },
        ".vault-cm-preview-quote": {
          borderLeft: "3px solid var(--border)",
          color: "var(--muted-foreground)",
          paddingLeft: "1rem",
        },
        ".vault-cm-preview-codeblock": {
          backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)",
          fontFamily: "var(--font-mono)",
        },
        ".vault-cm-preview-list": {
          paddingLeft: "1rem",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    ];

      if (previewMode === "live") {
        baseExtensions.push(markdownLivePreviewExtension);
      }

      if (collaboration && collabSession) {
        return [
          ...baseExtensions,
          yCollab(collabSession.ytext, collabSession.provider.awareness, {
            undoManager: collabSession.undoManager,
          }),
        ];
      }

      return baseExtensions;
    },
    [collabSession, collaboration, previewMode],
  );

  useEffect(() => {
    if (!dirty || saving) {
      return;
    }

    const autosaveTimer = window.setTimeout(() => {
      void saveDocument();
    }, 1500);

    return () => window.clearTimeout(autosaveTimer);
  }, [dirty, saveDocument, saving, titleValue, markdownValue]);

  const applyFormat = useCallback((format: MarkdownFormat) => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    if (format === "bold") {
      toggleInlineWrapper(view, "**", "bold text");
      return;
    }

    if (format === "italic") {
      toggleInlineWrapper(view, "*", "italic text");
      return;
    }

    if (format === "inlineCode") {
      toggleInlineWrapper(view, "`", "code");
      return;
    }

    if (format === "link") {
      toggleLink(view);
      return;
    }

    if (format === "codeFence") {
      toggleCodeFence(view);
      return;
    }

    if (format === "table") {
      insertBlock(view, "| Column | Column |\n| --- | --- |\n| Value | Value |", 2);
      return;
    }

    if (format === "horizontalRule") {
      insertBlock(view, "---", null);
      return;
    }

    const linePrefix: Record<MarkdownFormat, string | null> = {
      heading1: "# ",
      heading2: "## ",
      heading3: "### ",
      bulletList: "- ",
      orderedList: "1. ",
      taskList: "- [ ] ",
      blockquote: "> ",
      bold: null,
      italic: null,
      link: null,
      inlineCode: null,
      codeFence: null,
      table: null,
      horizontalRule: null,
    };
    const prefix = linePrefix[format];

    if (prefix) {
      toggleLinePrefix(view, prefix, format);
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveDocument();
  }

  const statusIcon = saving ? (
    <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
  ) : saveError ? (
    <AlertCircle data-icon="inline-start" className="size-4" />
  ) : dirty ? (
    <Save data-icon="inline-start" className="size-4" />
  ) : (
    <CheckCircle2 data-icon="inline-start" className="size-4" />
  );
  const statusText = saving
    ? "Saving..."
    : saveError
      ? saveError
      : dirty
        ? "Unsaved changes"
        : lastSavedAt
          ? `Saved ${lastSavedAt.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}`
          : "Saved";
  const collaborationStatusText =
    collabStatus === "connected"
      ? "Live collaboration connected"
      : collabStatus === "connecting"
        ? "Connecting live collaboration..."
        : collabStatus === "disconnected"
          ? "Live collaboration disconnected"
          : "Local Markdown draft";

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>Markdown source</span>
        <div className="flex flex-wrap items-center gap-2">
          <PreviewModeButton
            active={previewMode === "source"}
            label="Source"
            onClick={() => setPreviewMode("source")}
            icon={FileCode2}
          />
          <PreviewModeButton
            active={previewMode === "live"}
            label="Live"
            onClick={() => setPreviewMode("live")}
            icon={Eye}
          />
          <PreviewModeButton
            active={previewMode === "split"}
            label="Split"
            onClick={() => {
              setPreviewMode("split");
            }}
            icon={Columns2}
          />
          <PreviewModeButton
            active={previewMode === "preview"}
            label="Preview"
            onClick={() => {
              setPreviewMode("preview");
            }}
            icon={Eye}
          />
        </div>
      </div>
      <input
        name="title"
        value={titleValue}
        onChange={(event) => {
          titleValueRef.current = event.target.value;
          setTitleValue(event.target.value);
          setDirty(true);
        }}
        className="w-full bg-transparent text-4xl font-semibold leading-[1.05] tracking-tight outline-none sm:text-5xl vault-display"
        aria-label="Document title"
      />
      <div className="overflow-hidden rounded-3xl border border-border/70 bg-card/80 text-card-foreground shadow-[0_25px_80px_-70px_rgba(0,0,0,0.6)] backdrop-blur">
        {previewMode !== "preview" ? (
          <MarkdownToolbar onFormat={applyFormat} />
        ) : null}
        <div
          className={cn(
            previewMode === "split"
              ? "grid min-h-[520px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              : "min-h-[520px]",
          )}
        >
          {previewMode !== "preview" ? (
            <div
              className={cn(
                previewMode === "split"
                  ? "border-b border-border/70 lg:border-b-0 lg:border-r"
                  : null,
              )}
            >
              <CodeMirror
                key={`${collaborationKey}:${isCollaborative ? "collab" : "local"}`}
                value={
                  isCollaborative
                    ? collabSession?.ytext.toString() ?? markdownValue
                    : markdownValue
                }
                extensions={extensions}
                basicSetup={{
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  lineNumbers: true,
                }}
                onCreateEditor={(view) => {
                  viewRef.current = view;
                }}
                onChange={(value) => {
                  markdownValueRef.current = value;
                  setMarkdownValue(value);
                  if (!isCollaborative) {
                    setDirty(true);
                  }
                }}
                theme="none"
              />
            </div>
          ) : null}
          {previewMode !== "source" &&
          previewMode !== "live" ? (
            <div className="min-h-[520px] bg-background/45 px-6 py-6 sm:px-8">
              <MarkdownDocument markdown={markdownValue} />
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col justify-between gap-3 border-t border-border/60 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2">
            {statusIcon}
            {statusText}
          </p>
          <p className="text-xs">{collaborationStatusText}</p>
          {saveError ? (
            <p className="text-xs text-destructive">Try again in a moment.</p>
          ) : null}
        </div>
        <Button type="submit" size="lg" disabled={!dirty || saving}>
          <Save data-icon="inline-start" />
          Save changes
        </Button>
      </div>
    </form>
  );
}

function colorFromString(value: string) {
  const colors = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#0891b2"];
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % colors.length;
  }

  return colors[hash];
}

const hiddenMarkdown = Decoration.mark({ class: "vault-cm-hidden-md" });
const previewBold = Decoration.mark({ class: "vault-cm-preview-bold" });
const previewItalic = Decoration.mark({ class: "vault-cm-preview-italic" });
const previewCode = Decoration.mark({ class: "vault-cm-preview-code" });
const previewLink = Decoration.mark({ class: "vault-cm-preview-link" });
const previewHeading1 = Decoration.line({ class: "vault-cm-preview-heading-1" });
const previewHeading2 = Decoration.line({ class: "vault-cm-preview-heading-2" });
const previewHeading3 = Decoration.line({ class: "vault-cm-preview-heading-3" });
const previewQuote = Decoration.line({ class: "vault-cm-preview-quote" });
const previewCodeBlock = Decoration.line({ class: "vault-cm-preview-codeblock" });
const previewList = Decoration.line({ class: "vault-cm-preview-list" });

const markdownLivePreviewExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = buildLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

function buildLivePreviewDecorations(view: EditorView) {
  const ranges = [];
  const activeLines = getActiveStructuralLines(view);
  const activePositions = view.state.selection.ranges.map((range) => range.head);
  const codeFenceLines = getCodeFenceLines(view);

  for (const visibleRange of view.visibleRanges) {
    let position = visibleRange.from;

    while (position <= visibleRange.to) {
      const line = view.state.doc.lineAt(position);

      if (!activeLines.has(line.number)) {
        const lineRanges = decorateInactiveMarkdownLine(
          line.from,
          line.text,
          codeFenceLines.has(line.number),
          activePositions,
        );
        ranges.push(...lineRanges);
      }

      if (line.to >= visibleRange.to) {
        break;
      }

      position = line.to + 1;
    }
  }

  return Decoration.set(ranges, true);
}

function getActiveStructuralLines(view: EditorView) {
  const activeLines = new Set<number>();

  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from);
    const toLine = view.state.doc.lineAt(range.to);
    const block = getActiveMarkdownBlockRange(view, fromLine.number, toLine.number);

    if (!block) {
      continue;
    }

    for (let line = block.from; line <= block.to; line += 1) {
      activeLines.add(line);
    }
  }

  return activeLines;
}

function getActiveMarkdownBlockRange(
  view: EditorView,
  fromLineNumber: number,
  toLineNumber: number,
) {
  const doc = view.state.doc;
  const startLine = doc.line(fromLineNumber);
  const codeFenceLines = getCodeFenceLines(view);

  if (codeFenceLines.has(fromLineNumber)) {
    return codeFenceBlockRange(doc, fromLineNumber);
  }

  if (isCodeFenceLine(startLine.text)) {
    return codeFenceBlockRange(doc, fromLineNumber);
  }

  if (/^(#{1,6}\s+)/.test(startLine.text)) {
    return { from: fromLineNumber, to: toLineNumber };
  }

  if (/^(>\s+)/.test(startLine.text)) {
    return { from: fromLineNumber, to: toLineNumber };
  }

  const listPrefix = startLine.text.match(/^(\s*)([-*+]\s+\[[ xX]]\s+|[-*+]\s+|\d+\.\s+)/);

  if (listPrefix) {
    let from = fromLineNumber;
    let to = toLineNumber;

    while (from > 1 && isListContinuation(doc.line(from - 1).text)) {
      from -= 1;
    }

    while (to < doc.lines && isListContinuation(doc.line(to + 1).text)) {
      to += 1;
    }

    return { from, to };
  }

  return null;
}

function codeFenceBlockRange(doc: EditorView["state"]["doc"], lineNumber: number) {
  let from = lineNumber;
  let to = lineNumber;

  while (from > 1 && !isCodeFenceLine(doc.line(from - 1).text)) {
    from -= 1;
  }

  if (from > 1) {
    from -= 1;
  }

  while (to < doc.lines && !isCodeFenceLine(doc.line(to + 1).text)) {
    to += 1;
  }

  if (to < doc.lines) {
    to += 1;
  }

  return { from, to };
}

function getCodeFenceLines(view: EditorView) {
  const lines = new Set<number>();
  let insideFence = false;

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);

    if (isCodeFenceLine(line.text)) {
      lines.add(lineNumber);
      insideFence = !insideFence;
      continue;
    }

    if (insideFence) {
      lines.add(lineNumber);
    }
  }

  return lines;
}

function decorateInactiveMarkdownLine(
  lineFrom: number,
  text: string,
  inCodeFence: boolean,
  activePositions: number[],
) {
  const ranges = [];

  if (inCodeFence) {
    ranges.push(previewCodeBlock.range(lineFrom));

    if (isCodeFenceLine(text)) {
      ranges.push(hiddenMarkdown.range(lineFrom, lineFrom + text.length));
    }

    return ranges;
  }

  const heading = text.match(/^(#{1,6})(\s+)/);

  if (heading) {
    const level = heading[1].length;
    ranges.push(
      (level === 1
        ? previewHeading1
        : level === 2
          ? previewHeading2
          : previewHeading3
      ).range(lineFrom),
    );
    ranges.push(hiddenMarkdown.range(lineFrom, lineFrom + heading[0].length));
  }

  const quote = text.match(/^(>\s+)/);

  if (quote) {
    ranges.push(previewQuote.range(lineFrom));
    ranges.push(hiddenMarkdown.range(lineFrom, lineFrom + quote[0].length));
  }

  const list = text.match(/^(\s*)([-*+]\s+\[[ xX]]\s+|[-*+]\s+|\d+\.\s+)/);

  if (list) {
    ranges.push(previewList.range(lineFrom));
  }

  addInlinePreviewDecorations(ranges, lineFrom, text, activePositions);

  return ranges;
}

function addInlinePreviewDecorations(
  ranges: ReturnType<typeof hiddenMarkdown.range>[],
  lineFrom: number,
  text: string,
  activePositions: number[],
) {
  addRegexDecorations(
    ranges,
    lineFrom,
    text,
    /\*\*([^*\n]+)\*\*/g,
    previewBold,
    [
      [0, 2],
      [-2, 0],
    ],
    activePositions,
  );
  addRegexDecorations(
    ranges,
    lineFrom,
    text,
    /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
    previewItalic,
    [
      [0, 1],
      [-1, 0],
    ],
    activePositions,
  );
  addRegexDecorations(
    ranges,
    lineFrom,
    text,
    /`([^`\n]+)`/g,
    previewCode,
    [
      [0, 1],
      [-1, 0],
    ],
    activePositions,
  );
  addLinkDecorations(ranges, lineFrom, text, activePositions);
}

function addRegexDecorations(
  ranges: ReturnType<typeof hiddenMarkdown.range>[],
  lineFrom: number,
  text: string,
  regex: RegExp,
  contentDecoration: Decoration,
  markerOffsets: Array<[number, number]>,
  activePositions: number[],
) {
  for (const match of text.matchAll(regex)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const to = from + match[0].length;

    if (activePositions.some((position) => position >= from && position <= to)) {
      continue;
    }

    ranges.push(contentDecoration.range(from, to));

    for (const [startOffset, endOffset] of markerOffsets) {
      const markerFrom = startOffset >= 0 ? from + startOffset : to + startOffset;
      const markerTo = endOffset > 0 ? from + endOffset : to + endOffset;
      ranges.push(hiddenMarkdown.range(markerFrom, markerTo));
    }
  }
}

function addLinkDecorations(
  ranges: ReturnType<typeof hiddenMarkdown.range>[],
  lineFrom: number,
  text: string,
  activePositions: number[],
) {
  for (const match of text.matchAll(/\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const labelStart = from + 1;
    const labelEnd = labelStart + match[1].length;
    const to = from + match[0].length;

    if (activePositions.some((position) => position >= from && position <= to)) {
      continue;
    }

    ranges.push(previewLink.range(labelStart, labelEnd));
    ranges.push(hiddenMarkdown.range(from, labelStart));
    ranges.push(hiddenMarkdown.range(labelEnd, to));
  }
}

function isCodeFenceLine(text: string) {
  return /^```/.test(text.trim());
}

function isListContinuation(text: string) {
  return /^(\s*)([-*+]\s+\[[ xX]]\s+|[-*+]\s+|\d+\.\s+|\S)/.test(text);
}

function PreviewModeButton({
  active,
  label,
  onClick,
  icon: Icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: typeof FileCode2;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className="gap-1.5 normal-case tracking-normal"
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  );
}

function toggleInlineWrapper(
  view: EditorView,
  marker: "**" | "*" | "`",
  placeholder: string,
) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const markerLength = marker.length;

  if (selectedText.startsWith(marker) && selectedText.endsWith(marker)) {
    const unwrapped = selectedText.slice(markerLength, -markerLength);

    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: unwrapped },
      selection: EditorSelection.range(
        selection.from,
        selection.from + unwrapped.length,
      ),
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  const before =
    selection.from >= markerLength
      ? view.state.sliceDoc(selection.from - markerLength, selection.from)
      : "";
  const after = view.state.sliceDoc(selection.to, selection.to + markerLength);

  if (selectedText && before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: selection.to, to: selection.to + markerLength },
        { from: selection.from - markerLength, to: selection.from },
      ],
      selection: EditorSelection.range(
        selection.from - markerLength,
        selection.to - markerLength,
      ),
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  const replacement = `${marker}${selectedText || placeholder}${marker}`;
  const anchor = selection.from + markerLength;
  const head = anchor + (selectedText || placeholder).length;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: replacement },
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  });
  view.focus();
}

function toggleLink(view: EditorView) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const selectedLink = selectedText.match(/^\[([^\]]+)]\(([^)]+)\)$/);

  if (selectedLink) {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: selectedLink[1] },
      selection: EditorSelection.range(
        selection.from,
        selection.from + selectedLink[1].length,
      ),
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  const text = selectedText || "link text";
  const url = "https://example.com";
  const replacement = `[${text}](${url})`;
  const urlStart = selection.from + text.length + 3;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: replacement },
    selection: EditorSelection.range(urlStart, urlStart + url.length),
    scrollIntoView: true,
  });
  view.focus();
}

function toggleCodeFence(view: EditorView) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const fenceMatch = selectedText.match(/^```[^\n]*\n([\s\S]*)\n```$/);

  if (fenceMatch) {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: fenceMatch[1] },
      selection: EditorSelection.range(
        selection.from,
        selection.from + fenceMatch[1].length,
      ),
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  insertBlock(view, `\`\`\`txt\n${selectedText || ""}\n\`\`\``, selectedText ? null : 7);
}

function insertBlock(view: EditorView, text: string, cursorOffset: number | null) {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const needsLeadingBreak = selection.from > line.from;
  const insert = `${needsLeadingBreak ? "\n\n" : ""}${text}\n`;
  const cursorPosition =
    cursorOffset === null
      ? selection.from + insert.length
      : selection.from + (needsLeadingBreak ? 2 : 0) + cursorOffset;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(cursorPosition),
    scrollIntoView: true,
  });
  view.focus();
}

function toggleLinePrefix(
  view: EditorView,
  prefix: string,
  format: MarkdownFormat,
) {
  const selection = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(selection.from);
  const toLine = view.state.doc.lineAt(selection.to);
  const lines = [];

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    lines.push(view.state.doc.line(lineNumber));
  }

  const allHavePrefix = lines.every((line) =>
    line.text.startsWith(prefix),
  );
  const changes = lines.map((line) => {
    if (allHavePrefix) {
      return { from: line.from, to: line.from + prefix.length, insert: "" };
    }

    const lineText = line.text;
    const existingPrefix = prefixToReplace(format, lineText);
    const from = line.from;
    const to = existingPrefix ? line.from + existingPrefix.length : line.from;

    return { from, to, insert: prefix };
  });
  const selectionDelta = allHavePrefix ? -prefix.length : prefix.length;

  view.dispatch({
    changes,
    selection: EditorSelection.range(
      Math.max(fromLine.from, selection.from + selectionDelta),
      Math.max(fromLine.from, selection.to + selectionDelta * changes.length),
    ),
    scrollIntoView: true,
  });
  view.focus();
}

function prefixToReplace(format: MarkdownFormat, lineText: string) {
  if (format === "heading1" || format === "heading2" || format === "heading3") {
    return lineText.match(/^(#{1,6}\s+)/)?.[0] ?? null;
  }

  if (format === "bulletList" || format === "orderedList" || format === "taskList") {
    return lineText.match(/^(\s*)([-*+]\s+\[[ xX]]\s+|[-*+]\s+|\d+\.\s+)/)?.[0] ?? null;
  }

  if (format === "blockquote") {
    return lineText.match(/^(>\s+)/)?.[0] ?? null;
  }

  return null;
}
