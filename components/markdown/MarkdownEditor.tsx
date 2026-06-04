"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  acceptCompletion,
  completionStatus,
} from "@codemirror/autocomplete";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, Prec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
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
import { sanitizeInlineStyle } from "@/lib/html-style";
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
type RangeLike = ReturnType<Decoration["range"]>;
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
  const [previewMode, setPreviewMode] = useState<PreviewMode>("live");
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
    setCollabSession({ ydoc, ytext, undoManager, provider });

    return () => {
      mounted = false;
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
      Prec.highest(keymap.of(createMarkdownShortcutKeymap())),
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
        ".cm-tooltip": {
          border: "1px solid var(--border)",
          borderRadius: "0.75rem",
          backgroundColor: "color-mix(in oklab, var(--card) 96%, black 4%)",
          color: "var(--card-foreground)",
          boxShadow: "0 24px 80px -45px rgba(0, 0, 0, 0.85)",
          overflow: "hidden",
        },
        ".cm-tooltip-autocomplete": {
          minWidth: "14rem",
          padding: "0.35rem",
          fontFamily: "var(--font-sans)",
        },
        ".cm-tooltip-autocomplete > ul": {
          maxHeight: "15rem",
          padding: "0",
        },
        ".cm-tooltip-autocomplete ul li": {
          minHeight: "2rem",
          borderRadius: "0.5rem",
          padding: "0.35rem 0.55rem",
          color: "var(--muted-foreground)",
          lineHeight: "1.25",
        },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor:
            "color-mix(in oklab, var(--primary) 18%, transparent)",
          color: "var(--foreground)",
        },
        ".cm-tooltip-autocomplete .cm-completionIcon": {
          color: "var(--muted-foreground)",
          opacity: "0.75",
        },
        ".cm-tooltip-autocomplete .cm-completionLabel": {
          fontFamily: "var(--font-mono)",
          fontSize: "0.82rem",
        },
        ".cm-tooltip-autocomplete .cm-completionDetail": {
          color: "var(--muted-foreground)",
          fontSize: "0.75rem",
          marginLeft: "0.75rem",
        },
        ".cm-tooltip-autocomplete .cm-completionMatchedText": {
          color: "var(--foreground)",
          fontWeight: "700",
          textDecoration: "none",
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
        ".vault-markdown-editor-source & .cm-content span, .vault-markdown-editor-split & .cm-content span, .vault-markdown-editor-live & .cm-content span": {
          fontFamily: "var(--font-mono)",
          fontSize: "inherit",
          fontStyle: "normal",
          fontWeight: "inherit",
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
          letterSpacing: "0",
          textDecoration: "none",
          textDecorationLine: "none",
        },
        ".vault-markdown-editor-source & .cm-content, .vault-markdown-editor-split & .cm-content, .vault-markdown-editor-live & .cm-content": {
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
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
        ".vault-cm-preview-heading-4": {
          fontFamily: "var(--font-heading)",
          fontSize: "1.05rem",
          fontWeight: "600",
          lineHeight: "1.35",
        },
        ".vault-cm-preview-heading-5": {
          fontFamily: "var(--font-heading)",
          fontSize: "1rem",
          fontWeight: "600",
          lineHeight: "1.4",
        },
        ".vault-cm-preview-heading-6": {
          fontFamily: "var(--font-heading)",
          fontSize: "0.95rem",
          fontWeight: "600",
          lineHeight: "1.45",
          color: "var(--muted-foreground)",
        },
        ".vault-markdown-editor-live & .cm-content .vault-cm-preview-bold": {
          fontWeight: "700",
        },
        ".vault-markdown-editor-live & .cm-content .vault-cm-preview-italic": {
          fontStyle: "italic",
        },
        ".vault-markdown-editor-live & .cm-content .vault-cm-preview-code": {
          border: "1px solid var(--border)",
          borderRadius: "0.3rem",
          backgroundColor: "color-mix(in oklab, var(--muted) 75%, transparent)",
          padding: "0.1rem 0.3rem",
          fontFamily: "var(--font-mono)",
        },
        ".vault-markdown-editor-live & .cm-content .vault-cm-preview-link": {
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

      if (isCollaborative && collabSession) {
        return [
          ...baseExtensions,
          yCollab(collabSession.ytext, collabSession.provider.awareness, {
            undoManager: collabSession.undoManager,
          }),
        ];
      }

      return baseExtensions;
    },
    [collabSession, isCollaborative, previewMode],
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
      toggleInlineFormat(view, "bold");
      return;
    }

    if (format === "italic") {
      toggleInlineFormat(view, "italic");
      return;
    }

    if (format === "inlineCode") {
      toggleInlineFormat(view, "code");
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
      orderedList: "",
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

    if (format === "orderedList") {
      toggleLinePrefix(view, "1. ", format);
      return;
    }

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
    <form onSubmit={handleSubmit} className="grid gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 px-3 pt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-0 sm:pt-0">
        <span>Markdown source</span>
        <div className="-mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
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
        className="w-full bg-transparent px-3 text-3xl font-semibold leading-[1.08] tracking-tight outline-none sm:px-0 sm:text-5xl vault-display"
        aria-label="Document title"
      />
      <div
        className={cn(
          "vault-markdown-editor overflow-hidden border-y border-border/70 bg-card/80 text-card-foreground shadow-[0_25px_80px_-70px_rgba(0,0,0,0.6)] backdrop-blur sm:rounded-3xl sm:border",
          `vault-markdown-editor-${previewMode}`,
        )}
      >
        {previewMode !== "preview" ? (
          <MarkdownToolbar onFormat={applyFormat} />
        ) : null}
        <div
          className={cn(
            previewMode === "split"
              ? "grid min-h-[calc(100svh-17rem)] lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              : "min-h-[calc(100svh-17rem)] lg:min-h-[520px]",
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
            <div className="min-h-[calc(100svh-17rem)] bg-background/45 px-4 py-5 sm:min-h-[520px] sm:px-8 sm:py-6">
              <MarkdownDocument markdown={markdownValue} />
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col justify-between gap-3 border-t border-border/60 px-3 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-0">
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

function createMarkdownShortcutKeymap(): KeyBinding[] {
  const run = (command: (view: EditorView) => void) => (view: EditorView) => {
    command(view);
    return true;
  };

  return [
    {
      key: "Tab",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? acceptCompletion(view)
          : false,
    },
    { key: "Mod-b", run: run((view) => toggleInlineFormat(view, "bold")) },
    { key: "Mod-i", run: run((view) => toggleInlineFormat(view, "italic")) },
    { key: "Mod-e", run: run((view) => toggleInlineFormat(view, "code")) },
    { key: "Mod-k", run: run(toggleLink) },
    {
      key: "Mod-Alt-1",
      run: run((view) => toggleLinePrefix(view, "# ", "heading1")),
    },
    {
      key: "Mod-Alt-2",
      run: run((view) => toggleLinePrefix(view, "## ", "heading2")),
    },
    {
      key: "Mod-Alt-3",
      run: run((view) => toggleLinePrefix(view, "### ", "heading3")),
    },
    {
      key: "Mod-Shift-8",
      run: run((view) => toggleLinePrefix(view, "- ", "bulletList")),
    },
    {
      key: "Mod-Shift-7",
      run: run((view) => toggleLinePrefix(view, "1. ", "orderedList")),
    },
    {
      key: "Mod-Shift-9",
      run: run((view) => toggleLinePrefix(view, "> ", "blockquote")),
    },
    { key: "Mod-Alt-c", run: run(toggleCodeFence) },
  ];
}

const hiddenMarkdown = Decoration.replace({});
const previewBold = Decoration.mark({ class: "vault-cm-preview-bold" });
const previewItalic = Decoration.mark({ class: "vault-cm-preview-italic" });
const previewCode = Decoration.mark({ class: "vault-cm-preview-code" });
const previewLink = Decoration.mark({ class: "vault-cm-preview-link" });
const previewHeading1 = Decoration.line({ class: "vault-cm-preview-heading-1" });
const previewHeading2 = Decoration.line({ class: "vault-cm-preview-heading-2" });
const previewHeading3 = Decoration.line({ class: "vault-cm-preview-heading-3" });
const previewHeading4 = Decoration.line({ class: "vault-cm-preview-heading-4" });
const previewHeading5 = Decoration.line({ class: "vault-cm-preview-heading-5" });
const previewHeading6 = Decoration.line({ class: "vault-cm-preview-heading-6" });
const previewQuote = Decoration.line({ class: "vault-cm-preview-quote" });
const previewCodeBlock = Decoration.line({ class: "vault-cm-preview-codeblock" });
const previewList = Decoration.line({ class: "vault-cm-preview-list" });
const htmlVoidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const blockedHtmlTags = new Set([
  "script",
  "style",
  "form",
  "object",
  "embed",
  "link",
  "meta",
]);
const htmlBlockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "header",
  "hr",
  "iframe",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul",
]);
const safeHtmlUrl = /^(https?:|mailto:|\/|#)/i;
const iframeSandbox =
  "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
const iframeAllow =
  "accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share";
const allowedIframeProviders = [
  {
    hosts: new Set(["www.youtube.com", "youtube.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["www.youtube-nocookie.com", "youtube-nocookie.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["open.spotify.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["embed.tidal.com"]),
    path: /^\/(tracks|albums|playlists|mixes|videos)\//,
  },
  {
    hosts: new Set(["player.vimeo.com"]),
    path: /^\/video\//,
  },
  {
    hosts: new Set(["w.soundcloud.com"]),
    path: /^\/player\//,
  },
  {
    hosts: new Set(["embed.music.apple.com"]),
    path: /^\//,
  },
  {
    hosts: new Set<string>(),
    hostPattern: /(^|\.)bandcamp\.com$/,
    path: /^\/EmbeddedPlayer\//,
  },
] as const;

function safeIframeSrc(src: unknown) {
  if (typeof src !== "string") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = allowedIframeProviders.some((provider) => {
    const hostMatches =
      provider.hosts.has(hostname) ||
      ("hostPattern" in provider && provider.hostPattern.test(hostname));

    return hostMatches && provider.path.test(url.pathname);
  });

  return allowed ? url.toString() : null;
}

function normalizeSelfClosingIframes(html: string) {
  return html.replace(/<iframe\b([^>]*)\/>/gi, "<iframe$1></iframe>");
}

class HtmlBlockPreviewWidget extends WidgetType {
  constructor(private readonly html: string) {
    super();
  }

  eq(widget: HtmlBlockPreviewWidget) {
    return widget.html === this.html;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "vault-cm-html-preview vault-markdown";
    wrapper.innerHTML = normalizeSelfClosingIframes(this.html);
    sanitizeHtmlPreviewDom(wrapper);

    return wrapper;
  }
}

class InlineHtmlPreviewWidget extends WidgetType {
  constructor(private readonly html: string) {
    super();
  }

  eq(widget: InlineHtmlPreviewWidget) {
    return widget.html === this.html;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "vault-cm-html-inline-preview";
    wrapper.innerHTML = normalizeSelfClosingIframes(this.html);
    sanitizeHtmlPreviewDom(wrapper);

    return wrapper;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(widget: TaskCheckboxWidget) {
    return widget.checked === this.checked;
  }

  toDOM() {
    const checkbox = document.createElement("span");
    checkbox.className = "vault-cm-task-checkbox";
    checkbox.dataset.checked = String(this.checked);
    checkbox.setAttribute("aria-hidden", "true");

    return checkbox;
  }
}

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
  const doc = view.state.doc;

  for (const visibleRange of view.visibleRanges) {
    let position = visibleRange.from;

    while (position <= visibleRange.to) {
      const line = doc.lineAt(position);

      if (!activeLines.has(line.number)) {
        const htmlBlock = codeFenceLines.has(line.number)
          ? null
          : htmlBlockRangeFromStart(doc, line.number);

        if (htmlBlock && htmlBlock.from === htmlBlock.to) {
          const fromLine = doc.line(htmlBlock.from);
          const html = doc.sliceString(fromLine.from, fromLine.to);

          if (!hasActivePositionInRange(activePositions, fromLine.from, fromLine.to)) {
            ranges.push(
              Decoration.replace({
                widget: new HtmlBlockPreviewWidget(html),
              }).range(fromLine.from, fromLine.to),
            );

            position = fromLine.to + 1;
            continue;
          }
        }

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

  const htmlBlock = htmlBlockRangeContainingLine(doc, fromLineNumber);

  if (htmlBlock) {
    return {
      from: htmlBlock.from,
      to: Math.max(htmlBlock.to, toLineNumber),
    };
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

function htmlBlockRangeContainingLine(
  doc: EditorView["state"]["doc"],
  lineNumber: number,
) {
  let enclosingRange: { from: number; to: number } | null = null;

  for (let candidate = lineNumber; candidate >= 1; candidate -= 1) {
    const candidateText = doc.line(candidate).text;

    if (!candidateText.trim()) {
      break;
    }

    const range = htmlBlockRangeFromStart(doc, candidate);

    if (range && lineNumber >= range.from && lineNumber <= range.to) {
      enclosingRange = range;
    }
  }

  return enclosingRange;
}

function htmlBlockRangeFromStart(
  doc: EditorView["state"]["doc"],
  lineNumber: number,
) {
  const line = doc.line(lineNumber);
  const openTag = line.text.match(/^\s{0,3}<([A-Za-z][\w:-]*)(?:\s[^>]*)?>/);

  if (!openTag) {
    return null;
  }

  const tagName = openTag[1].toLowerCase();

  if (blockedHtmlTags.has(tagName) || !htmlBlockTags.has(tagName)) {
    return null;
  }

  if (
    htmlVoidTags.has(tagName) ||
    /\/>\s*$/.test(line.text) ||
    new RegExp(`</${escapeRegExp(tagName)}>`, "i").test(line.text)
  ) {
    return { from: lineNumber, to: lineNumber };
  }

  const closeTag = new RegExp(`</${escapeRegExp(tagName)}>`, "i");

  for (let nextLineNumber = lineNumber + 1; nextLineNumber <= doc.lines; nextLineNumber += 1) {
    const nextLine = doc.line(nextLineNumber);

    if (closeTag.test(nextLine.text)) {
      return { from: lineNumber, to: nextLineNumber };
    }
  }

  return null;
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
    const markerFrom = lineFrom;
    const markerTo = lineFrom + heading[0].length;

    ranges.push(headingDecorationForLevel(level).range(lineFrom));

    if (!hasActivePositionInRange(activePositions, markerFrom, markerTo)) {
      ranges.push(hiddenMarkdown.range(markerFrom, markerTo));
    }
  }

  const quote = text.match(/^(>\s+)/);

  if (quote) {
    ranges.push(previewQuote.range(lineFrom));
    ranges.push(hiddenMarkdown.range(lineFrom, lineFrom + quote[0].length));
  }

  const list = text.match(/^(\s*)([-*+]\s+\[[ xX]]\s+|[-*+]\s+|\d+\.\s+)/);

  if (list) {
    ranges.push(previewList.range(lineFrom));

    const task = text.match(/^(\s*)[-*+]\s+\[([ xX])]\s+/);

    if (task) {
      const markerFrom = lineFrom + task[1].length;
      const markerTo = lineFrom + task[0].length;
      ranges.push(
        Decoration.replace({
          widget: new TaskCheckboxWidget(task[2].toLowerCase() === "x"),
        }).range(markerFrom, markerTo),
      );
    }
  }

  addInlinePreviewDecorations(ranges, lineFrom, text, activePositions);

  return ranges;
}

function headingDecorationForLevel(level: number) {
  if (level === 1) {
    return previewHeading1;
  }

  if (level === 2) {
    return previewHeading2;
  }

  if (level === 3) {
    return previewHeading3;
  }

  if (level === 4) {
    return previewHeading4;
  }

  if (level === 5) {
    return previewHeading5;
  }

  return previewHeading6;
}

function addInlinePreviewDecorations(
  ranges: RangeLike[],
  lineFrom: number,
  text: string,
  activePositions: number[],
) {
  addInlineHtmlDecorations(ranges, lineFrom, text, activePositions);
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

function addInlineHtmlDecorations(
  ranges: RangeLike[],
  lineFrom: number,
  text: string,
  activePositions: number[],
) {
  const inlineHtml =
    /<(a|abbr|b|cite|code|data|del|em|i|ins|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;

  for (const match of text.matchAll(inlineHtml)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const to = from + match[0].length;

    if (hasActivePositionInRange(activePositions, from, to)) {
      continue;
    }

    ranges.push(
      Decoration.replace({
        widget: new InlineHtmlPreviewWidget(match[0]),
      }).range(from, to),
    );
  }
}

function addRegexDecorations(
  ranges: RangeLike[],
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

    if (hasActivePositionInRange(activePositions, from, to)) {
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
  ranges: RangeLike[],
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

    if (hasActivePositionInRange(activePositions, from, to)) {
      continue;
    }

    ranges.push(previewLink.range(labelStart, labelEnd));
    ranges.push(hiddenMarkdown.range(from, labelStart));
    ranges.push(hiddenMarkdown.range(labelEnd, to));
  }
}

function hasActivePositionInRange(
  activePositions: number[],
  from: number,
  to: number,
) {
  return activePositions.some((position) => position >= from && position <= to);
}

function sanitizeHtmlPreviewDom(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const elementsToRemove: Element[] = [];
  const elements: Element[] = [];

  while (walker.nextNode()) {
    elements.push(walker.currentNode as Element);
  }

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();

    if (blockedHtmlTags.has(tagName)) {
      elementsToRemove.push(element);
      continue;
    }

    if (tagName === "iframe") {
      const safeSrc = safeIframeSrc(element.getAttribute("src"));

      if (!safeSrc) {
        elementsToRemove.push(element);
        continue;
      }

      for (const attribute of Array.from(element.attributes)) {
        if (
          ![
            "src",
            "title",
            "width",
            "height",
            "style",
            "class",
          ].includes(attribute.name.toLowerCase())
        ) {
          element.removeAttribute(attribute.name);
        }
      }

      element.setAttribute("src", safeSrc);
      element.setAttribute("allow", iframeAllow);
      element.setAttribute("allowfullscreen", "true");
      element.setAttribute("loading", "lazy");
      element.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      element.setAttribute("sandbox", iframeSandbox);
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "style") {
        const style = sanitizeInlineStyle(value);

        if (style) {
          element.setAttribute("style", style);
        } else {
          element.removeAttribute(attribute.name);
        }

        continue;
      }

      if ((name === "href" || name === "src") && !safeHtmlUrl.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const element of elementsToRemove) {
    element.remove();
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      className="shrink-0 gap-1.5 normal-case tracking-normal"
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  );
}

type InlineFormat = "bold" | "italic" | "code";

type InlineRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  open: string;
  close: string;
};

const inlineFormatConfig: Record<
  InlineFormat,
  {
    wrappers: Array<{ open: string; close: string }>;
    preferred: { open: string; close: string };
    placeholder: string;
  }
> = {
  bold: {
    wrappers: [{ open: "**", close: "**" }],
    preferred: { open: "**", close: "**" },
    placeholder: "bold text",
  },
  italic: {
    wrappers: [
      { open: "_", close: "_" },
      { open: "*", close: "*" },
    ],
    preferred: { open: "_", close: "_" },
    placeholder: "italic text",
  },
  code: {
    wrappers: [{ open: "`", close: "`" }],
    preferred: { open: "`", close: "`" },
    placeholder: "code",
  },
};

function toggleInlineFormat(view: EditorView, format: InlineFormat) {
  const selection = view.state.selection.main;
  const config = inlineFormatConfig[format];
  const existingRange = findInlineFormatRange(view, format);

  if (existingRange) {
    unwrapInlineRange(view, existingRange, selection);
    return;
  }

  const target = getInlineWrapTarget(view, config.placeholder);
  wrapInlineRange(view, target.from, target.to, config.preferred, target.text);
}

function findInlineFormatRange(
  view: EditorView,
  format: InlineFormat,
): InlineRange | null {
  const selection = view.state.selection.main;
  const text = view.state.doc.toString();
  const config = inlineFormatConfig[format];

  for (const wrapper of config.wrappers) {
    const ranges = findWrapperRanges(text, wrapper.open, wrapper.close, format);
    const selectedText = view.state.sliceDoc(selection.from, selection.to);

    if (
      selectedText.startsWith(wrapper.open) &&
      selectedText.endsWith(wrapper.close)
    ) {
      return {
        from: selection.from,
        to: selection.to,
        contentFrom: selection.from + wrapper.open.length,
        contentTo: selection.to - wrapper.close.length,
        open: wrapper.open,
        close: wrapper.close,
      };
    }

    const range = ranges.find((candidate) =>
      selectionTouchesInlineRange(selection.from, selection.to, candidate),
    );

    if (range) {
      return range;
    }
  }

  return null;
}

function findWrapperRanges(
  text: string,
  open: string,
  close: string,
  format: InlineFormat,
) {
  const ranges: InlineRange[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIndex = findNextMarker(text, open, searchFrom, format);

    if (openIndex === -1) {
      break;
    }

    const contentFrom = openIndex + open.length;
    const closeIndex = findNextMarker(text, close, contentFrom, format);

    if (closeIndex === -1) {
      break;
    }

    ranges.push({
      from: openIndex,
      to: closeIndex + close.length,
      contentFrom,
      contentTo: closeIndex,
      open,
      close,
    });
    searchFrom = closeIndex + close.length;
  }

  return ranges;
}

function findNextMarker(
  text: string,
  marker: string,
  from: number,
  format: InlineFormat,
) {
  let index = text.indexOf(marker, from);

  while (index !== -1) {
    if (format !== "italic" || marker !== "*" || isSingleAsterisk(text, index)) {
      return index;
    }

    index = text.indexOf(marker, index + 1);
  }

  return -1;
}

function isSingleAsterisk(text: string, index: number) {
  return text[index - 1] !== "*" && text[index + 1] !== "*";
}

function selectionTouchesInlineRange(
  selectionFrom: number,
  selectionTo: number,
  range: InlineRange,
) {
  if (selectionFrom === selectionTo) {
    return selectionFrom > range.from && selectionFrom < range.to;
  }

  return selectionFrom < range.to && selectionTo > range.from;
}

function unwrapInlineRange(
  view: EditorView,
  range: InlineRange,
  selection: EditorSelection["main"],
) {
  const removedBeforeSelection =
    selection.from > range.contentFrom ? range.open.length : 0;
  const removedBeforeSelectionEnd =
    selection.to > range.contentFrom ? range.open.length : 0;

  view.dispatch({
    changes: [
      { from: range.contentTo, to: range.contentTo + range.close.length },
      { from: range.from, to: range.from + range.open.length },
    ],
    selection: EditorSelection.range(
      Math.max(range.from, selection.from - removedBeforeSelection),
      Math.max(range.from, selection.to - removedBeforeSelectionEnd),
    ),
    scrollIntoView: true,
  });
  view.focus();
}

function getInlineWrapTarget(view: EditorView, placeholder: string) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);

  if (selectedText) {
    return {
      from: selection.from,
      to: selection.to,
      text: selectedText,
    };
  }

  const word = wordRangeAtPosition(view, selection.from);

  if (word) {
    return word;
  }

  return {
    from: selection.from,
    to: selection.to,
    text: placeholder,
  };
}

function wordRangeAtPosition(view: EditorView, position: number) {
  const line = view.state.doc.lineAt(position);
  const offset = position - line.from;
  const wordPattern = /[A-Za-z0-9_'-]/;
  let start = offset;
  let end = offset;

  while (start > 0 && wordPattern.test(line.text[start - 1])) {
    start -= 1;
  }

  while (end < line.text.length && wordPattern.test(line.text[end])) {
    end += 1;
  }

  if (start === end) {
    return null;
  }

  return {
    from: line.from + start,
    to: line.from + end,
    text: line.text.slice(start, end),
  };
}

function wrapInlineRange(
  view: EditorView,
  from: number,
  to: number,
  wrapper: { open: string; close: string },
  text: string,
) {
  const replacement = `${wrapper.open}${text}${wrapper.close}`;
  const anchor = from + wrapper.open.length;
  const head = anchor + text.length;

  view.dispatch({
    changes: { from, to, insert: replacement },
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  });
  view.focus();
}

function toggleLink(view: EditorView) {
  const selection = view.state.selection.main;
  const existingLink = findLinkRange(view);

  if (existingLink) {
    view.dispatch({
      changes: {
        from: existingLink.from,
        to: existingLink.to,
        insert: existingLink.label,
      },
      selection: EditorSelection.range(
        Math.max(
          existingLink.from,
          Math.min(selection.from, existingLink.labelEnd) -
            (selection.from > existingLink.labelStart ? 1 : 0),
        ),
        Math.max(
          existingLink.from,
          Math.min(selection.to, existingLink.labelEnd) -
            (selection.to > existingLink.labelStart ? 1 : 0),
        ),
      ),
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  const target = getInlineWrapTarget(view, "link text");
  const text = target.text;
  const url = "https://example.com";
  const replacement = `[${text}](${url})`;
  const urlStart = target.from + text.length + 3;

  view.dispatch({
    changes: { from: target.from, to: target.to, insert: replacement },
    selection: EditorSelection.range(urlStart, urlStart + url.length),
    scrollIntoView: true,
  });
  view.focus();
}

function findLinkRange(view: EditorView) {
  const selection = view.state.selection.main;
  const text = view.state.doc.toString();

  for (const match of text.matchAll(/\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const from = match.index;
    const to = from + match[0].length;

    if (
      selection.from === selection.to
        ? selection.from > from && selection.from < to
        : selection.from < to && selection.to > from
    ) {
      const labelStart = from + 1;
      const labelEnd = labelStart + match[1].length;

      return {
        from,
        to,
        label: match[1],
        labelStart,
        labelEnd,
      };
    }
  }

  return null;
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

  const prefixMatches = lines.map((line) =>
    getRemovablePrefixLength(format, line.text, prefix),
  );
  const allHavePrefix = prefixMatches.every((length) => length > 0);
  const orderedListStart =
    format === "orderedList"
      ? orderedListStartNumber(view, fromLine.number)
      : 1;
  const changes = lines.map((line, index) => {
    const removablePrefixLength = getRemovablePrefixLength(
      format,
      line.text,
      prefix,
    );

    if (allHavePrefix) {
      return {
        from: line.from,
        to: line.from + removablePrefixLength,
        insert: "",
      };
    }

    const lineText = line.text;
    const existingPrefix = prefixToReplace(format, lineText);
    const from = line.from;
    const to = existingPrefix ? line.from + existingPrefix.length : line.from;
    const insert =
      format === "orderedList"
        ? `${orderedListStart + index}. `
        : prefix;

    return { from, to, insert };
  });
  const transaction = view.state.update({
    changes,
    selection: view.state.selection.map(
      view.state.changes(changes),
      1,
    ),
    scrollIntoView: true,
  });

  view.dispatch(transaction);
  view.focus();
}

function orderedListStartNumber(view: EditorView, firstLineNumber: number) {
  const doc = view.state.doc;
  let expectedNumber = 1;

  for (let lineNumber = firstLineNumber - 1; lineNumber >= 1; lineNumber -= 1) {
    const lineText = doc.line(lineNumber).text;

    if (!lineText.trim()) {
      break;
    }

    const match = lineText.match(/^(\s*)(\d+)\.\s+/);

    if (match) {
      expectedNumber = Number(match[2]) + 1;
      break;
    }

    if (!isListContinuation(lineText)) {
      break;
    }
  }

  return expectedNumber;
}

function getRemovablePrefixLength(
  format: MarkdownFormat,
  lineText: string,
  prefix: string,
) {
  if (format === "orderedList") {
    return lineText.match(/^(\s*)\d+\.\s+/)?.[0].length ?? 0;
  }

  if (format === "bulletList") {
    return lineText.match(/^(\s*)[-*+]\s+/)?.[0].length ?? 0;
  }

  if (format === "taskList") {
    return lineText.match(/^(\s*)[-*+]\s+\[[ xX]]\s+/)?.[0].length ?? 0;
  }

  if (format === "heading1" || format === "heading2" || format === "heading3") {
    return lineText.startsWith(prefix) ? prefix.length : 0;
  }

  if (format === "blockquote") {
    return lineText.match(/^(>\s+)/)?.[0].length ?? 0;
  }

  return lineText.startsWith(prefix) ? prefix.length : 0;
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
