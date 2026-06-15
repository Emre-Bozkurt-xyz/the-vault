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
  autocompletion,
  closeCompletion,
  type Completion,
  type CompletionContext,
  completionStatus,
  moveCompletionSelection,
  pickedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { html, htmlCompletionSource } from "@codemirror/lang-html";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, type EditorState, Prec } from "@codemirror/state";
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
import { createRoot, type Root } from "react-dom/client";
import {
  AlertCircle,
  BookOpenText,
  CheckCircle2,
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
  escapeWikiLinkLabel,
  getWikiDocumentEmbed,
  type WikiLinkAnchor,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";
import {
  saveDocumentTitleAction,
  saveMarkdownDocumentAction,
} from "@/server/documents";

type MarkdownEditorProps = {
  documentId: string;
  title: string;
  markdown: string;
  shareLinkId?: string | null;
  collaboration?: {
    url: string;
    token: string;
    user: {
      name: string;
      email: string | null;
      image: string | null;
    };
  } | null;
  wikiLinks?: WikiLinkResolutionMap;
};

type EditorMode = "source" | "live" | "read";
type CollabStatus = "off" | "connecting" | "connected" | "disconnected";
type RangeLike = ReturnType<Decoration["range"]>;
type CollabSession = {
  ydoc: Y.Doc;
  ytext: Y.Text;
  undoManager: Y.UndoManager;
  provider: HocuspocusProvider;
};
type CollabPresenceUser = {
  clientId: number;
  name: string;
  email: string | null;
  image: string | null;
  color: string;
  colorLight: string;
};
type WikiCompletionRegion = {
  markerFrom: number;
  markerTo: number;
  contentTo: number;
  hasClosingMarker: boolean;
  query: string;
  headingFrom: number | null;
};
type WikiCompletionDismissal = {
  markerFrom: number;
};
type WikiCompletionDismissalStore = {
  get: () => WikiCompletionDismissal | null;
  set: (dismissal: WikiCompletionDismissal) => void;
  clear: () => void;
};
type WikiLinkMapStore = {
  get: () => WikiLinkResolutionMap;
  set: (wikiLinks: WikiLinkResolutionMap) => void;
};

export function MarkdownEditor({
  documentId,
  title,
  markdown,
  shareLinkId = null,
  collaboration = null,
  wikiLinks,
}: MarkdownEditorProps) {
  const [titleValue, setTitleValue] = useState(title);
  const [markdownValue, setMarkdownValue] = useState(markdown);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("live");
  const [wikiLinkMap] = useState<WikiLinkResolutionMap>(wikiLinks ?? {});
  const [collabStatus, setCollabStatus] = useState<CollabStatus>(
    collaboration ? "connecting" : "off",
  );
  const [collabReady, setCollabReady] = useState(false);
  const [collabSession, setCollabSession] = useState<CollabSession | null>(null);
  const [collabInitialMarkdown, setCollabInitialMarkdown] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<CollabPresenceUser[]>([]);
  const [editorMountMarkdown, setEditorMountMarkdown] = useState(markdown);
  const viewRef = useRef<EditorView | null>(null);
  const wikiCompletionDismissal = useMemo(
    () => createWikiCompletionDismissalStore(),
    [],
  );
  const wikiLinkMapStore = useMemo(
    () => createWikiLinkMapStore(wikiLinks ?? {}),
    [wikiLinks],
  );
  const titleValueRef = useRef(title);
  const markdownValueRef = useRef(markdown);
  const savingRef = useRef(false);
  const collaborationKey = collaboration
    ? `${documentId}:${collaboration.url}:${collaboration.token}`
    : "local";
  const isCollaborative = Boolean(
    collaboration &&
      collabSession &&
      collabReady &&
      collabInitialMarkdown?.key === collaborationKey,
  );

  useEffect(() => {
    if (!collaboration) {
      return;
    }

    let mounted = true;
    let initializedFromSync = false;
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

          if (!initializedFromSync) {
            initializedFromSync = true;
            setCollabInitialMarkdown({
              key: collaborationKey,
              value: syncedMarkdown,
            });
            setEditorMountMarkdown(syncedMarkdown);
            setCollabReady(true);
          }
        }
      },
    });
    const color = colorFromString(
      collaboration.user.email ?? collaboration.user.name,
    );
    const awareness = provider.awareness;

    awareness?.setLocalStateField("user", {
      name: collaboration.user.name,
      email: collaboration.user.email,
      image: collaboration.user.image,
      color,
      colorLight: `${color}33`,
    });

    const updatePresenceUsers = () => {
      if (!mounted || !awareness) {
        return;
      }

      const users = Array.from(awareness.getStates().entries())
        .map(([clientId, state]) => {
          const user = (state as { user?: Partial<CollabPresenceUser> }).user;

          if (!user?.name) {
            return null;
          }

          const userColor = user.color ?? colorFromString(user.email ?? user.name);

          return {
            clientId,
            name: user.name,
            email: user.email ?? null,
            image: user.image ?? null,
            color: userColor,
            colorLight: user.colorLight ?? `${userColor}33`,
          };
        })
        .filter((user): user is CollabPresenceUser => Boolean(user))
        .sort((a, b) => a.name.localeCompare(b.name));

      setPresenceUsers(users);
    };

    awareness?.on("change", updatePresenceUsers);
    updatePresenceUsers();
    setCollabSession({ ydoc, ytext, undoManager, provider });

    return () => {
      mounted = false;
      awareness?.off("change", updatePresenceUsers);
      setPresenceUsers([]);
      provider.destroy();
      ydoc.destroy();
    };
  }, [collaboration, collaborationKey, documentId]);

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
          shareLinkId,
        })
      : await saveMarkdownDocumentAction({
          documentId,
          title: titleAtSave,
          markdown: markdownAtSave,
          shareLinkId,
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
  }, [documentId, isCollaborative, shareLinkId]);

  useEffect(() => {
    if (editorMode !== "read" || !isCollaborative || !collabSession) {
      return;
    }

    const updateReadMarkdown = () => {
      const latestMarkdown = collabSession.ytext.toString();
      markdownValueRef.current = latestMarkdown;
      setMarkdownValue(latestMarkdown);
      setEditorMountMarkdown(latestMarkdown);
    };

    updateReadMarkdown();
    collabSession.ytext.observe(updateReadMarkdown);

    return () => {
      collabSession.ytext.unobserve(updateReadMarkdown);
    };
  }, [collabSession, editorMode, isCollaborative]);

  const extensions = useMemo(
    () => {
      const baseExtensions = [
      markdownLanguage({
        htmlTagLanguage: html({
          matchClosingTags: false,
          selfClosingTags: true,
        }),
      }),
      EditorView.lineWrapping,
      Prec.highest(keymap.of(createMarkdownShortcutKeymap(wikiCompletionDismissal))),
      createBlockAnchorMarkerExtension(),
      EditorView.updateListener.of((update) => {
        const dismissal = wikiCompletionDismissal.get();

        if (!dismissal || !update.selectionSet) {
          return;
        }

        if (
          !isInsideDismissedWikiCompletionRegion(
            update.state,
            update.state.selection.main.head,
            dismissal,
          )
        ) {
          wikiCompletionDismissal.clear();
        }
      }),
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
        ".vault-markdown-editor-source & .cm-content span, .vault-markdown-editor-split & .cm-content span": {
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
        ".vault-markdown-editor-source & .cm-content, .vault-markdown-editor-split & .cm-content": {
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
        ".vault-markdown-editor-live & .cm-content .vault-cm-preview-wiki-link": {
          borderRadius: "0.35rem",
          color: "var(--foreground)",
          fontWeight: "500",
          textDecoration: "underline",
          textDecorationColor:
            "color-mix(in oklab, var(--primary) 70%, transparent)",
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

      if (editorMode === "live") {
        baseExtensions.push(createMarkdownLivePreviewExtension(wikiLinkMap));
      }

      baseExtensions.push(
        autocompletion({
          override: [
            htmlCompletionSource,
            createWikiLinkCompletionSource(
              wikiLinkMapStore,
              wikiCompletionDismissal,
            ),
          ],
        }),
      );

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
    [
      collabSession,
      isCollaborative,
      editorMode,
      wikiCompletionDismissal,
      wikiLinkMap,
      wikiLinkMapStore,
    ],
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

    if (format === "region") {
      insertVaultRegion(view);
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
      region: null,
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

  const changeEditorMode = useCallback(
    (nextMode: EditorMode) => {
      if (editorMode === nextMode) {
        return;
      }

      if (editorMode === "read" || nextMode === "read") {
        const latestMarkdown =
          isCollaborative && collabSession
            ? collabSession.ytext.toString()
            : markdownValueRef.current;

        markdownValueRef.current = latestMarkdown;
        setMarkdownValue(latestMarkdown);
        setEditorMountMarkdown(latestMarkdown);
      }

      setEditorMode(nextMode);
    },
    [collabSession, editorMode, isCollaborative],
  );

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
  const showManualSave =
    Boolean(saveError) || (collaboration && collabStatus === "disconnected");

  return (
    <form
      onSubmit={handleSubmit}
      className="vault-editor-canvas min-h-full px-4 py-6 sm:px-8 sm:py-8 lg:px-14 lg:py-10"
    >
      <div className="vault-editor-column mx-auto flex min-h-full w-full max-w-[56rem] flex-col gap-5">
        <div className="vault-editor-toolbar-row flex items-center gap-3">
          {editorMode !== "read" ? (
            <div className="min-w-0 flex-1">
              <MarkdownToolbar onFormat={applyFormat} />
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <CollaborationPresence users={presenceUsers} />
          <EditorModeSwitch mode={editorMode} onChange={changeEditorMode} />
        </div>
        {editorMode === "read" ? (
          <h1 className="vault-editor-title w-full text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl lg:text-6xl vault-display">
            {titleValue || "Untitled document"}
          </h1>
        ) : (
          <input
            name="title"
            value={titleValue}
            onChange={(event) => {
              titleValueRef.current = event.target.value;
              setTitleValue(event.target.value);
              setDirty(true);
            }}
            className="vault-editor-title w-full bg-transparent text-4xl font-semibold leading-[1.02] tracking-tight outline-none sm:text-5xl lg:text-6xl vault-display"
            aria-label="Document title"
          />
        )}
        <div
          className={cn(
            "vault-markdown-editor min-h-[calc(100svh-12rem)] overflow-visible bg-transparent text-card-foreground",
            `vault-markdown-editor-${editorMode}`,
          )}
        >
          <div
            className={cn(
              "min-h-[calc(100svh-18rem)] lg:min-h-[520px]",
            )}
          >
            {editorMode !== "read" ? (
              <div>
                <CodeMirror
                  key={`${collaborationKey}:${isCollaborative ? "collab" : "local"}`}
                  value={
                    isCollaborative
                      ? editorMountMarkdown
                      : markdownValue
                  }
                  extensions={extensions}
                  basicSetup={{
                    foldGutter: editorMode !== "live",
                    highlightActiveLine: true,
                    highlightSelectionMatches: true,
                    lineNumbers: editorMode !== "live",
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
            {editorMode === "read" ? (
              <div className="vault-markdown-editor-preview-pane min-h-[calc(100svh-18rem)] py-5 sm:min-h-[520px] sm:py-8">
                <MarkdownDocument
                  markdown={markdownValue}
                  wikiLinks={wikiLinkMap}
                  contained={false}
                />
              </div>
            ) : null}
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {statusText}. {collaborationStatusText}.
        </p>
        {showManualSave ? (
          <div className="flex flex-col justify-between gap-3 border border-border/70 bg-card/80 px-4 py-3 text-sm text-muted-foreground shadow-[0_18px_60px_-55px_rgba(0,0,0,0.55)] sm:flex-row sm:items-center">
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
        ) : null}
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

function EditorModeSwitch({
  mode,
  onChange,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}) {
  const modes: Array<{
    value: EditorMode;
    label: string;
    icon: typeof BookOpenText;
  }> = [
    { value: "read", label: "Read", icon: BookOpenText },
    { value: "live", label: "Live", icon: Eye },
    { value: "source", label: "Source", icon: FileCode2 },
  ];
  const orderedModes = [
    ...modes.filter((item) => item.value === mode),
    ...modes.filter((item) => item.value !== mode),
  ];

  return (
    <div
      className="vault-editor-mode-switch group/mode-switch relative ml-auto h-8 w-8 shrink-0"
      aria-label="Editor mode"
    >
      {orderedModes.map((item) => {
        const Icon = item.icon;
        const active = item.value === mode;

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            title={`${item.label} mode`}
            className={cn(
              "vault-editor-mode-button absolute left-0 top-0 flex size-8 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none",
              active ? "vault-editor-mode-button-active text-foreground" : null,
            )}
          >
            <Icon className="size-4" />
            <span className="sr-only">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function createWikiCompletionDismissalStore(): WikiCompletionDismissalStore {
  let dismissal: WikiCompletionDismissal | null = null;

  return {
    get: () => dismissal,
    set: (nextDismissal) => {
      dismissal = nextDismissal;
    },
    clear: () => {
      dismissal = null;
    },
  };
}

function createWikiLinkMapStore(initialWikiLinks: WikiLinkResolutionMap): WikiLinkMapStore {
  let currentWikiLinks = initialWikiLinks;

  return {
    get: () => currentWikiLinks,
    set: (nextWikiLinks) => {
      currentWikiLinks = nextWikiLinks;
    },
  };
}

function createMarkdownShortcutKeymap(
  wikiCompletionDismissal?: WikiCompletionDismissalStore,
): KeyBinding[] {
  const run = (command: (view: EditorView) => void) => (view: EditorView) => {
    command(view);
    return true;
  };

  return [
    {
      key: "ArrowDown",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? moveCompletionSelection(true)(view)
          : false,
    },
    {
      key: "ArrowUp",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? moveCompletionSelection(false)(view)
          : false,
    },
    {
      key: "PageDown",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? moveCompletionSelection(true, "page")(view)
          : false,
    },
    {
      key: "PageUp",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? moveCompletionSelection(false, "page")(view)
          : false,
    },
    {
      key: "Escape",
      run: (view) => {
        if (completionStatus(view.state) !== "active") {
          return false;
        }

        const region = getOpenWikiLinkCompletionRegion(
          view.state,
          view.state.selection.main.head,
        );

        if (region && wikiCompletionDismissal) {
          wikiCompletionDismissal.set({
            markerFrom: region.markerFrom,
          });
        }

        return closeCompletion(view);
      },
    },
    {
      key: "Enter",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? acceptCompletion(view)
          : false,
    },
    {
      key: "Tab",
      run: (view) =>
        completionStatus(view.state) === "active"
          ? acceptCompletion(view)
          : false,
    },
    {
      key: "#",
      run: (view) => {
        const selection = view.state.selection.main;

        if (!selection.empty) {
          return false;
        }

        const region = getOpenWikiLinkCompletionRegion(
          view.state,
          selection.head,
        );

        if (!region) {
          return false;
        }

        view.dispatch(view.state.replaceSelection("#"));
        return startCompletion(view);
      },
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
    { key: "Mod-Alt-r", run: run(insertVaultRegion) },
  ];
}

const hiddenMarkdown = Decoration.replace({});
const previewBold = Decoration.mark({ class: "vault-cm-preview-bold" });
const previewItalic = Decoration.mark({ class: "vault-cm-preview-italic" });
const previewCode = Decoration.mark({ class: "vault-cm-preview-code" });
const previewLink = Decoration.mark({ class: "vault-cm-preview-link" });
const previewWikiLink = Decoration.mark({ class: "vault-cm-preview-wiki-link" });
const previewBlockAnchor = Decoration.mark({ class: "vault-cm-preview-block-anchor" });
const previewWikiDocumentEmbedLine = Decoration.line({
  class: "vault-cm-document-embed-line",
});
const previewHeading1 = Decoration.line({ class: "vault-cm-preview-heading-1" });
const previewHeading2 = Decoration.line({ class: "vault-cm-preview-heading-2" });
const previewHeading3 = Decoration.line({ class: "vault-cm-preview-heading-3" });
const previewHeading4 = Decoration.line({ class: "vault-cm-preview-heading-4" });
const previewHeading5 = Decoration.line({ class: "vault-cm-preview-heading-5" });
const previewHeading6 = Decoration.line({ class: "vault-cm-preview-heading-6" });
const previewQuote = Decoration.line({ class: "vault-cm-preview-quote" });
const previewCodeBlock = Decoration.line({ class: "vault-cm-preview-codeblock" });
const previewList = Decoration.line({ class: "vault-cm-preview-list" });

const calloutAliases = new Map<string, string>([
  ["summary", "abstract"],
  ["tldr", "abstract"],
  ["hint", "tip"],
  ["important", "tip"],
  ["check", "success"],
  ["done", "success"],
  ["help", "question"],
  ["faq", "question"],
  ["caution", "warning"],
  ["attention", "warning"],
  ["fail", "failure"],
  ["missing", "failure"],
  ["error", "danger"],
  ["cite", "quote"],
]);

const calloutTypes = new Set([
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
]);
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

class WikiImagePreviewWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super();
  }

  eq(widget: WikiImagePreviewWidget) {
    return widget.src === this.src && widget.alt === this.alt;
  }

  toDOM() {
    const figure = document.createElement("figure");
    figure.className = "vault-cm-wiki-image-preview vault-md-image-frame";

    const image = document.createElement("img");
    image.className = "vault-md-img";
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener(
      "error",
      () => {
        figure.dataset.imageState = "error";
      },
      { once: true },
    );

    const fallback = document.createElement("figcaption");
    fallback.className = "vault-md-image-fallback";
    fallback.textContent = "Image unavailable";

    figure.append(image, fallback);

    return figure;
  }
}

class WikiDocumentEmbedPreviewWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    private readonly source: string,
    private readonly wikiLinks: WikiLinkResolutionMap,
  ) {
    super();
  }

  eq(widget: WikiDocumentEmbedPreviewWidget) {
    return widget.source === this.source && widget.wikiLinks === this.wikiLinks;
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = "vault-cm-document-embed-preview";

    this.root = createRoot(container);
    this.root.render(
      <MarkdownDocument
        markdown={this.source}
        wikiLinks={this.wikiLinks}
        contained={false}
        className="vault-cm-document-embed-markdown"
      />,
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

class ListMarkerWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super();
  }

  eq(widget: ListMarkerWidget) {
    return widget.marker === this.marker;
  }

  toDOM() {
    const marker = document.createElement("span");
    const ordered = /^\d+\.$/.test(this.marker);
    marker.className = ordered
      ? "vault-cm-list-marker vault-cm-list-marker-ordered"
      : "vault-cm-list-marker vault-cm-list-marker-bullet";
    marker.textContent = ordered ? this.marker : "•";
    marker.setAttribute("aria-hidden", "true");

    return marker;
  }
}

class CalloutMarkerWidget extends WidgetType {
  constructor(
    private readonly inputType: string,
    private readonly resolvedType: string,
    private readonly spacerOnly = false,
  ) {
    super();
  }

  eq(widget: CalloutMarkerWidget) {
    return (
      widget.inputType === this.inputType &&
      widget.resolvedType === this.resolvedType &&
      widget.spacerOnly === this.spacerOnly
    );
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.spacerOnly
      ? "callout-icon vault-cm-callout-marker vault-cm-callout-spacer"
      : "callout-icon vault-cm-callout-marker";
    marker.dataset.callout = this.inputType;
    marker.dataset.calloutResolved = this.resolvedType;
    marker.setAttribute("aria-hidden", "true");

    return marker;
  }
}

function createMarkdownLivePreviewExtension(wikiLinks: WikiLinkResolutionMap) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      isMouseSelecting = false;
      dragActiveLines = new Set<number>();

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view, wikiLinks, false);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged
        ) {
          this.decorations = buildLivePreviewDecorations(
            update.view,
            wikiLinks,
            this.isMouseSelecting,
            this.dragActiveLines,
          );
        }
      }
    },
    {
      decorations: (value) => value.decorations,
      eventHandlers: {
        mousedown(event, view) {
          if (event.button !== 0) {
            return;
          }

          this.isMouseSelecting = true;
          this.dragActiveLines = getActiveStructuralLines(view);
          this.decorations = buildLivePreviewDecorations(
            view,
            wikiLinks,
            true,
            this.dragActiveLines,
          );
        },
        mouseup(_event, view) {
          if (!this.isMouseSelecting) {
            return;
          }

          this.isMouseSelecting = false;
          this.dragActiveLines = new Set<number>();
          this.decorations = buildLivePreviewDecorations(view, wikiLinks, false);
          view.dispatch({});
        },
        mouseleave(event, view) {
          if (
            event.buttons !== 0 ||
            !this.isMouseSelecting
          ) {
            return;
          }

          this.isMouseSelecting = false;
          this.dragActiveLines = new Set<number>();
          this.decorations = buildLivePreviewDecorations(view, wikiLinks, false);
          view.dispatch({});
        },
        mousemove(event, view) {
          if (event.buttons !== 0 || !this.isMouseSelecting) {
            return;
          }

          this.isMouseSelecting = false;
          this.dragActiveLines = new Set<number>();
          this.decorations = buildLivePreviewDecorations(view, wikiLinks, false);
          view.dispatch({});
        },
      },
    },
  );
}

function createBlockAnchorMarkerExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildBlockAnchorMarkerDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildBlockAnchorMarkerDecorations(update.view);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );
}

function buildBlockAnchorMarkerDecorations(view: EditorView) {
  const ranges: RangeLike[] = [];
  const codeFenceLines = getCodeFenceLines(view);
  const activePositions = view.state.selection.ranges.map((range) => range.head);

  for (const visibleRange of view.visibleRanges) {
    let position = visibleRange.from;

    while (position <= visibleRange.to) {
      const line = view.state.doc.lineAt(position);

      if (!codeFenceLines.has(line.number)) {
        const marker = trailingBlockAnchorMatch(line.text);

        if (marker) {
          const markerFrom = line.from + marker.index;
          const markerTo = markerFrom + marker.text.length;

          if (!hasActivePositionInRange(activePositions, markerFrom, markerTo)) {
            ranges.push(previewBlockAnchor.range(markerFrom, markerTo));
          }
        }
      }

      if (line.to >= visibleRange.to) {
        break;
      }

      position = line.to + 1;
    }
  }

  return Decoration.set(ranges, true);
}

function buildLivePreviewDecorations(
  view: EditorView,
  wikiLinks: WikiLinkResolutionMap,
  suppressSourceReveal: boolean,
  forcedActiveLines = new Set<number>(),
) {
  const ranges = [];
  const activeLines = suppressSourceReveal
    ? forcedActiveLines
    : getActiveStructuralLines(view);
  const activePositions = suppressSourceReveal
    ? []
    : view.state.selection.ranges.map((range) => range.head);
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

        const wikiEmbed = getWikiDocumentEmbed(line.text, wikiLinks);

        if (
          wikiEmbed &&
          !hasActivePositionInRange(activePositions, line.from, line.to)
        ) {
          ranges.push(previewWikiDocumentEmbedLine.range(line.from));
          ranges.push(
            Decoration.replace({
              widget: new WikiDocumentEmbedPreviewWidget(
                line.text.trim(),
                wikiLinks,
              ),
            }).range(line.from, line.to),
          );

          position = line.to + 1;
          continue;
        }

        const lineRanges = decorateInactiveMarkdownLine(
          doc,
          line.number,
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

  if (/^(>\s?)/.test(startLine.text)) {
    const calloutBlock = calloutBlockRangeContainingLine(doc, fromLineNumber);

    if (calloutBlock) {
      return {
        from: calloutBlock.from,
        to: Math.max(calloutBlock.to, toLineNumber),
      };
    }

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

function calloutBlockRangeContainingLine(
  doc: EditorView["state"]["doc"],
  lineNumber: number,
) {
  let from = lineNumber;

  while (from > 1 && /^>\s?/.test(doc.line(from - 1).text)) {
    from -= 1;
  }

  const start = parseCalloutLine(doc.line(from).text);

  if (!start) {
    return null;
  }

  let to = from;

  while (to < doc.lines && /^>\s?/.test(doc.line(to + 1).text)) {
    to += 1;
  }

  while (to > from && isQuoteOnlyLine(doc.line(to).text)) {
    to -= 1;
  }

  if (lineNumber > to) {
    return null;
  }

  return { from, to, callout: start };
}

function isQuoteOnlyLine(text: string) {
  return /^>\s*$/.test(text);
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
  doc: EditorView["state"]["doc"],
  lineNumber: number,
  lineFrom: number,
  text: string,
  inCodeFence: boolean,
  activePositions: number[],
) {
  const ranges: RangeLike[] = [];

  if (inCodeFence) {
    ranges.push(previewCodeBlock.range(lineFrom));

    if (isCodeFenceLine(text)) {
      ranges.push(hiddenMarkdown.range(lineFrom, lineFrom + text.length));
    }

    return ranges;
  }

  const calloutBlock = calloutBlockRangeContainingLine(doc, lineNumber);

  if (calloutBlock) {
    return decorateInactiveCalloutLine(
      ranges,
      lineNumber,
      lineFrom,
      text,
      calloutBlock,
      activePositions,
    );
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

  const quote = text.match(/^(>\s*)/);

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
      if (!hasActivePositionInRange(activePositions, markerFrom, markerTo)) {
        ranges.push(
          Decoration.replace({
            widget: new TaskCheckboxWidget(task[2].toLowerCase() === "x"),
          }).range(markerFrom, markerTo),
        );
      }
    } else {
      const markerFrom = lineFrom + list[1].length;
      const markerTo = lineFrom + list[0].length;

      if (!hasActivePositionInRange(activePositions, markerFrom, markerTo)) {
        ranges.push(
          Decoration.replace({
            widget: new ListMarkerWidget(list[2].trim()),
          }).range(markerFrom, markerTo),
        );
      }
    }
  }

  addInlinePreviewDecorations(ranges, lineFrom, text, activePositions);

  return ranges;
}

function decorateInactiveCalloutLine(
  ranges: RangeLike[],
  lineNumber: number,
  lineFrom: number,
  text: string,
  calloutBlock: NonNullable<ReturnType<typeof calloutBlockRangeContainingLine>>,
  activePositions: number[],
) {
  const isFirst = lineNumber === calloutBlock.from;
  const isLast = lineNumber === calloutBlock.to;
  const blockPositionClass =
    isFirst && isLast
      ? "vault-cm-callout-single"
      : isFirst
        ? "vault-cm-callout-first"
        : isLast
          ? "vault-cm-callout-last"
          : "vault-cm-callout-middle";
  const lineRoleClass = isFirst
    ? "vault-cm-callout-title-line"
    : "vault-cm-callout-body-line";

  ranges.push(
    Decoration.line({
      class: [
        "callout",
        "vault-cm-callout",
        `vault-cm-callout-type-${calloutBlock.callout.resolvedType}`,
        blockPositionClass,
        lineRoleClass,
      ].join(" "),
      attributes: {
        "data-callout": calloutBlock.callout.inputType,
        "data-callout-resolved": calloutBlock.callout.resolvedType,
        ...(calloutBlock.callout.metadata
          ? { "data-callout-fold": calloutBlock.callout.metadata }
          : {}),
      },
    }).range(lineFrom),
  );

  if (isFirst) {
    ranges.push(
      Decoration.replace({
        widget: new CalloutMarkerWidget(
          calloutBlock.callout.inputType,
          calloutBlock.callout.resolvedType,
        ),
      }).range(lineFrom, lineFrom + calloutBlock.callout.markerLength),
    );
    addInlinePreviewDecorations(ranges, lineFrom, text, activePositions);

    return ranges;
  }

  const quote = text.match(/^(>\s*)/);

  if (quote) {
    ranges.push(
      Decoration.replace({
        widget: new CalloutMarkerWidget(
          calloutBlock.callout.inputType,
          calloutBlock.callout.resolvedType,
          true,
        ),
      }).range(lineFrom, lineFrom + quote[0].length),
    );
  }

  addInlinePreviewDecorations(ranges, lineFrom, text, activePositions);

  return ranges;
}

function parseCalloutLine(text: string) {
  const match = text.match(/^(>\s*)\[!([^\]\s]+)\]([+-])?\s*/i);

  if (!match) {
    return null;
  }

  const inputType = normalizeCalloutType(match[2]);
  const aliasResolved = calloutAliases.get(inputType) ?? inputType;
  const resolvedType = calloutTypes.has(aliasResolved) ? aliasResolved : "note";

  return {
    inputType,
    resolvedType,
    metadata: match[3] ?? "",
    markerLength: match[0].length,
  };
}

function normalizeCalloutType(type: string) {
  return type.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
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
  const inlineCodeRanges = getInlineCodeRanges(text).map(({ from, to }) => ({
    from: lineFrom + from,
    to: lineFrom + to,
  }));

  addInlineHtmlDecorations(ranges, lineFrom, text, activePositions);
  addWikiImageDecorations(ranges, lineFrom, text, activePositions, inlineCodeRanges);
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
    inlineCodeRanges,
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
    inlineCodeRanges,
  );
  addLinkDecorations(ranges, lineFrom, text, activePositions, inlineCodeRanges);
  addWikiLinkDecorations(ranges, lineFrom, text, activePositions, inlineCodeRanges);
}

function getInlineCodeRanges(text: string) {
  const ranges: Array<{ from: number; to: number }> = [];

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index === undefined) {
      continue;
    }

    ranges.push({
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return ranges;
}

function addWikiImageDecorations(
  ranges: RangeLike[],
  lineFrom: number,
  text: string,
  activePositions: number[],
  protectedRanges: Array<{ from: number; to: number }> = [],
) {
  for (const match of text.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    if (match.index === undefined) {
      continue;
    }

    const parts = match[1].split("|", 2);
    const target = parts[0]?.trim() ?? "";
    const alt = parts[1]?.trim() || target;
    const safeSrc = safeExternalImageSrc(target);
    const from = lineFrom + match.index;
    const to = from + match[0].length;

    if (
      !safeSrc ||
      hasActivePositionInRange(activePositions, from, to) ||
      overlapsAnyRange(from, to, protectedRanges)
    ) {
      continue;
    }

    ranges.push(
      Decoration.replace({
        widget: new WikiImagePreviewWidget(safeSrc, alt),
      }).range(from, to),
    );
  }
}

function addWikiLinkDecorations(
  ranges: RangeLike[],
  lineFrom: number,
  text: string,
  activePositions: number[],
  protectedRanges: Array<{ from: number; to: number }> = [],
) {
  for (const match of text.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const to = from + match[0].length;

    if (
      hasActivePositionInRange(activePositions, from, to) ||
      overlapsAnyRange(from, to, protectedRanges)
    ) {
      continue;
    }

    const [target = "", label = ""] = match[1].split("|", 2);
    const visibleText = label.trim() || target.trim();
    const visibleStartInMatch = match[0].indexOf(visibleText);

    if (!visibleText || visibleStartInMatch < 0) {
      continue;
    }

    const visibleFrom = from + visibleStartInMatch;
    const visibleTo = visibleFrom + visibleText.length;

    ranges.push(previewWikiLink.range(visibleFrom, visibleTo));
    ranges.push(hiddenMarkdown.range(from, visibleFrom));
    ranges.push(hiddenMarkdown.range(visibleTo, to));
  }
}

function safeExternalImageSrc(target: string) {
  let url: URL;

  try {
    url = new URL(target);
  } catch {
    return null;
  }

  return url.protocol === "https:" || url.protocol === "http:"
    ? url.toString()
    : null;
}

function createWikiLinkCompletionSource(
  wikiLinkMapStore: WikiLinkMapStore,
  wikiCompletionDismissal: WikiCompletionDismissalStore,
) {
  return async (context: CompletionContext) => {
    const region = getOpenWikiLinkCompletionRegion(context.state, context.pos);

    if (!region) {
      return null;
    }

    if (
      wikiCompletionDismissal.get()?.markerFrom === region.markerFrom &&
      !context.explicit
    ) {
      return null;
    }

    const freshWikiLinks = await fetchWikiLinkCompletionMap(wikiLinkMapStore.get());
    wikiLinkMapStore.set(freshWikiLinks);

    return {
      from: region.headingFrom ?? region.markerTo,
      to: region.contentTo,
      options: createWikiLinkCompletionOptions(
        freshWikiLinks,
        region.hasClosingMarker,
        region.query,
      ),
      validFor: (text: string) =>
        /^[^\[\]\n]*$/.test(text) &&
        text.includes("#") === region.query.includes("#"),
    };
  };
}

function getOpenWikiLinkCompletionRegion(
  state: EditorState,
  pos: number,
): WikiCompletionRegion | null {
  const line = state.doc.lineAt(pos);
  const beforeCursor = state.sliceDoc(line.from, pos);
  const markerIndex = beforeCursor.lastIndexOf("[[");

  if (markerIndex < 0) {
    return null;
  }

  const query = beforeCursor.slice(markerIndex + 2);

  if (query.includes("[") || query.includes("]") || query.includes("\n")) {
    return null;
  }

  const markerFrom = line.from + markerIndex;
  const afterCursor = state.sliceDoc(pos, line.to);
  const hasClosingMarker = afterCursor.startsWith("]]");

  return {
    markerFrom,
    markerTo: markerFrom + 2,
    contentTo: pos,
    hasClosingMarker,
    query,
    headingFrom:
      query.lastIndexOf("#") >= 0
        ? markerFrom + 2 + query.lastIndexOf("#") + 1
        : null,
  };
}

function isInsideDismissedWikiCompletionRegion(
  state: EditorState,
  pos: number,
  dismissal: WikiCompletionDismissal,
) {
  const region = getOpenWikiLinkCompletionRegion(state, pos);

  return region?.markerFrom === dismissal.markerFrom;
}

async function fetchWikiLinkCompletionMap(fallback: WikiLinkResolutionMap) {
  try {
    const response = await fetch("/api/documents/wiki-links", {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) {
      return fallback;
    }

    const payload: unknown = await response.json();

    if (
      typeof payload === "object" &&
      payload !== null &&
      "wikiLinks" in payload &&
      typeof payload.wikiLinks === "object" &&
      payload.wikiLinks !== null
    ) {
      return payload.wikiLinks as WikiLinkResolutionMap;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function createWikiLinkCompletionOptions(
  wikiLinks?: WikiLinkResolutionMap,
  hasClosingMarker = false,
  query = "",
): Completion[] {
  const options: Completion[] = [];
  const targetOptions = createWikiTargetCompletionOptions(
    wikiLinks,
    hasClosingMarker,
    query,
  );

  if (targetOptions) {
    return targetOptions;
  }

  for (const [key, resolution] of Object.entries(wikiLinks ?? {})) {
    if (
      !isWikiCompletionDocumentKey(key) ||
      resolution.status !== "resolved" ||
      !matchesWikiResolutionCompletionQuery(key, resolution, query)
    ) {
      continue;
    }

    const title = resolution.label?.trim() || "Untitled document";
    const insertText = `${key}|${escapeWikiLinkLabel(title)}`;

    options.push({
      label: wikiCompletionDocumentSearchLabel(key, resolution),
      displayLabel: title,
      detail: wikiCompletionDocumentDetail(key, resolution),
      type: "text",
      apply: createWikiCompletionApply(insertText, hasClosingMarker),
      info: wikiCompletionDocumentInfo(key),
    });
  }

  return options.sort((first, second) => first.label.localeCompare(second.label));
}

function createWikiTargetCompletionOptions(
  wikiLinks: WikiLinkResolutionMap | undefined,
  hasClosingMarker: boolean,
  query: string,
): Completion[] | null {
  const hashIndex = query.lastIndexOf("#");

  if (hashIndex < 0) {
    return null;
  }

  const documentQuery = query.slice(0, hashIndex).trim();
  const targetQuery = query.slice(hashIndex + 1).trim().toLowerCase();
  const docs = Object.entries(wikiLinks ?? {}).filter(
    ([key, resolution]) =>
      isWikiCompletionDocumentKey(key) &&
      resolution.status === "resolved" &&
      matchesWikiResolutionCompletionQuery(key, resolution, documentQuery, {
        allowPublicWithoutNamespace: true,
      }),
  );
  const options: Completion[] = [];

  for (const [key, resolution] of docs) {
    const title = resolution.label?.trim() || "Untitled document";

    for (const anchor of wikiCompletionAnchorsForResolution(resolution)) {
      if (!matchesWikiTargetQuery(anchor, targetQuery)) {
        continue;
      }

      options.push({
        label: `${key}#${anchor.id} ${title} ${anchor.label}`,
        displayLabel: `${title} # ${wikiCompletionAnchorLabel(anchor)}`,
        detail: wikiCompletionAnchorDetail(anchor),
        type: "text",
        apply: createWikiCompletionApply(
          escapeWikiLinkLabel(anchor.id),
          hasClosingMarker,
        ),
        info: wikiCompletionAnchorInfo(anchor),
      });
    }
  }

  return options.sort((first, second) => first.label.localeCompare(second.label));
}

function wikiCompletionAnchorsForResolution(
  resolution: WikiLinkResolutionMap[string],
): WikiLinkAnchor[] {
  if (resolution.anchors?.length) {
    return resolution.anchors;
  }

  return (resolution.headings ?? []).map((heading) => ({
    type: "heading" as const,
    id: heading.slug,
    label: heading.text,
    level: heading.level,
  }));
}

function matchesWikiTargetQuery(anchor: WikiLinkAnchor, query: string) {
  if (!query) {
    return true;
  }

  return (
    anchor.id.toLowerCase().includes(query) ||
    anchor.label.toLowerCase().includes(query)
  );
}

function wikiCompletionAnchorLabel(anchor: WikiLinkAnchor) {
  if (anchor.type === "heading") {
    return anchor.label;
  }

  return `${anchor.id} ${anchor.label}`;
}

function wikiCompletionAnchorDetail(anchor: WikiLinkAnchor) {
  if (anchor.type === "heading") {
    return `H${anchor.level}`;
  }

  return anchor.type === "region" ? "region" : "block";
}

function wikiCompletionAnchorInfo(anchor: WikiLinkAnchor) {
  if (anchor.type === "heading") {
    return "Link to a heading inside this document";
  }

  if (anchor.type === "region") {
    return "Link to a hidden Vault region inside this document";
  }

  return "Link to an Obsidian-style block anchor inside this document";
}

function createWikiCompletionApply(insertText: string, hasClosingMarker: boolean) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const text = hasClosingMarker ? insertText : `${insertText}]]`;
    const cursor = from + insertText.length;

    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(cursor),
      annotations: pickedCompletion.of(completion),
    });
  };
}

function isWikiCompletionDocumentKey(key: string) {
  return (
    key.startsWith("doc:") ||
    key.startsWith("guide:") ||
    key.startsWith("public:")
  );
}

function wikiCompletionDocumentDetail(
  key: string,
  resolution: WikiLinkResolutionMap[string],
) {
  if (key.startsWith("guide:")) {
    return "guide";
  }

  if (key.startsWith("public:")) {
    return resolution.ownerUsername
      ? `public · @${resolution.ownerUsername}`
      : "public";
  }

  return resolution.source === "public" && resolution.ownerUsername
    ? `public · @${resolution.ownerUsername}`
    : "document";
}

function wikiCompletionDocumentInfo(key: string) {
  if (key.startsWith("guide:")) {
    return "Insert a stable link to an official Vault guide";
  }

  if (key.startsWith("public:")) {
    return "Insert a stable link to a published Vault document";
  }

  return "Insert a stable Vault document link";
}

function wikiCompletionDocumentSearchLabel(
  key: string,
  resolution: WikiLinkResolutionMap[string],
) {
  return [
    key,
    resolution.label ?? "",
    resolution.ownerUsername ? `@${resolution.ownerUsername}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function matchesWikiResolutionCompletionQuery(
  key: string,
  resolution: WikiLinkResolutionMap[string],
  query: string,
  options: { allowPublicWithoutNamespace?: boolean } = {},
) {
  const isImplicitPublicDocument =
    key.startsWith("doc:") && resolution.source === "public";

  if (!query) {
    return (
      (key.startsWith("doc:") && !isImplicitPublicDocument) ||
      key.startsWith("guide:")
    );
  }

  const normalizedQuery = query.toLowerCase();
  const normalizedTitle = (resolution.label ?? "").toLowerCase();
  const ownerUsername = (resolution.ownerUsername ?? "").toLowerCase();

  if (normalizedQuery.startsWith("guide:")) {
    const target = normalizedQuery.slice(6).split("|", 1)[0]?.trim();

    return (
      key.startsWith("guide:") &&
      (!target ||
        key.slice(6).includes(target) ||
        normalizedTitle.includes(target))
    );
  }

  if (normalizedQuery.startsWith("public:")) {
    const target = normalizedQuery.slice(7).split("|", 1)[0]?.trim();

    return (
      key.startsWith("public:") &&
      (!target ||
        key.slice(7).includes(target) ||
        normalizedTitle.includes(target) ||
        ownerUsername.includes(target.replace(/^@/, "")))
    );
  }

  if (normalizedQuery.startsWith("doc:")) {
    const target = normalizedQuery.slice(4).split("|", 1)[0]?.trim();
    return Boolean(
      target && key.startsWith("doc:") && key.slice(4).startsWith(target),
    );
  }

  if (
    (key.startsWith("public:") || isImplicitPublicDocument) &&
    !options.allowPublicWithoutNamespace
  ) {
    return false;
  }

  return normalizedTitle.includes(normalizedQuery);
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
  protectedRanges: Array<{ from: number; to: number }> = [],
) {
  for (const match of text.matchAll(regex)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const to = from + match[0].length;

    if (
      hasActivePositionInRange(activePositions, from, to) ||
      overlapsAnyRange(from, to, protectedRanges)
    ) {
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
  protectedRanges: Array<{ from: number; to: number }> = [],
) {
  for (const match of text.matchAll(/\[([^\]\n]+)]\(([^)\n]+)\)/g)) {
    if (match.index === undefined) {
      continue;
    }

    const from = lineFrom + match.index;
    const labelStart = from + 1;
    const labelEnd = labelStart + match[1].length;
    const to = from + match[0].length;

    if (
      hasActivePositionInRange(activePositions, from, to) ||
      overlapsAnyRange(from, to, protectedRanges)
    ) {
      continue;
    }

    ranges.push(previewLink.range(labelStart, labelEnd));
    ranges.push(hiddenMarkdown.range(from, labelStart));
    ranges.push(hiddenMarkdown.range(labelEnd, to));
  }
}

function overlapsAnyRange(
  from: number,
  to: number,
  ranges: Array<{ from: number; to: number }>,
) {
  return ranges.some((range) => from < range.to && to > range.from);
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

function trailingBlockAnchorMatch(text: string) {
  const match = text.match(/(?:^|\s)(\^[A-Za-z0-9_-]+)\s*$/);

  if (!match || match.index === undefined) {
    return null;
  }

  const markerOffset = match[0].indexOf(match[1]);

  return {
    index: match.index + markerOffset,
    text: match[1],
  };
}

function isListContinuation(text: string) {
  return /^(\s*)([-*+]\s+\[[ xX]]\s+|[-*+]\s+|\d+\.\s+|\S)/.test(text);
}

function CollaborationPresence({ users }: { users: CollabPresenceUser[] }) {
  if (users.length < 2) {
    return null;
  }

  return (
    <div
      className="group/presence relative -my-2 hidden shrink-0 items-center py-2 pr-1 sm:flex"
      aria-label={`${users.length} people in this document`}
    >
      <div className="flex -space-x-3 transition-[gap] duration-150 ease-out group-hover/presence:space-x-1">
        {users.slice(0, 8).map((user) => (
          <div key={user.clientId} className="group/user relative">
            <span
              className="flex size-8 items-center justify-center overflow-hidden rounded-full border-2 bg-background text-[0.7rem] font-semibold text-foreground shadow-[0_0_0_1px_var(--background)] transition-transform duration-150 group-hover/presence:shadow-none group-hover/user:-translate-y-0.5"
              style={{
                borderColor: user.color,
                boxShadow: `0 0 0 1px var(--background), 0 0 16px ${user.colorLight}`,
              }}
            >
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt=""
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                getInitials(user.name)
              )}
            </span>
            <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-max max-w-60 -translate-x-1/2 border border-border bg-popover px-3 py-2 text-left text-xs text-popover-foreground shadow-xl group-hover/user:block">
              <span className="block font-medium">{user.name}</span>
              {user.email ? (
                <span className="mt-0.5 block text-muted-foreground">
                  {user.email}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "V";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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

function insertVaultRegion(view: EditorView) {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const body = selectedText || "Region content";
  const text = `<!-- vault-region id="region-id" title="Region title" foldable collapsed -->\n${body}\n<!-- /vault-region -->`;
  const idOffset = text.indexOf("region-id");
  const cursorOffset = idOffset >= 0 ? idOffset : null;

  insertBlock(view, text, cursorOffset);
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
