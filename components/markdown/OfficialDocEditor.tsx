"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { autocompletion } from "@codemirror/autocomplete";
import { html, htmlCompletionSource } from "@codemirror/lang-html";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { AlertCircle, CheckCircle2, Columns2, Eye, FileCode2, Loader2, Save } from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import {
  MarkdownToolbar,
  type MarkdownFormat,
} from "@/components/markdown/MarkdownToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveOfficialDocAction } from "@/server/official-docs";

type OfficialDocEditorProps = {
  id: string;
  title: string;
  slug: string;
  category: string;
  sortOrder: number;
  markdown: string;
  status: "draft" | "published" | "archived";
};

type PreviewMode = "source" | "split" | "preview";

export function OfficialDocEditor({
  id,
  title,
  slug,
  category,
  sortOrder,
  markdown,
  status,
}: OfficialDocEditorProps) {
  const [titleValue, setTitleValue] = useState(title);
  const [slugValue, setSlugValue] = useState(slug);
  const [categoryValue, setCategoryValue] = useState(category);
  const [sortOrderValue, setSortOrderValue] = useState(String(sortOrder));
  const [markdownValue, setMarkdownValue] = useState(markdown);
  const [statusValue, setStatusValue] = useState(status);
  const [mode, setMode] = useState<PreviewMode>("split");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const editorViewRef = useRef<EditorView | null>(null);
  const editorExtensions = useMemo(
    () => [
      markdownLanguage({
        htmlTagLanguage: html({
          matchClosingTags: false,
          selfClosingTags: true,
        }),
      }),
      EditorView.lineWrapping,
      autocompletion({
        override: [htmlCompletionSource],
      }),
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          color: "var(--foreground)",
          fontSize: "1rem",
        },
        ".cm-content": {
          minHeight: "620px",
          padding: "1.25rem",
          caretColor: "var(--foreground)",
          fontFamily: "var(--font-mono)",
        },
        ".cm-line": {
          lineHeight: "1.75",
        },
        ".cm-cursor, .cm-dropCursor": {
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
        ".cm-tooltip-autocomplete .cm-completionLabel": {
          fontFamily: "var(--font-mono)",
          fontSize: "0.82rem",
        },
        ".cm-tooltip-autocomplete .cm-completionDetail": {
          color: "var(--muted-foreground)",
          fontSize: "0.75rem",
          marginLeft: "0.75rem",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    ],
    [],
  );

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveOfficialDocAction({
        id,
        title: titleValue,
        slug: slugValue,
        category: categoryValue,
        sortOrder: sortOrderValue,
        markdown: markdownValue,
        status: statusValue,
      });

      if (result.ok) {
        setMessage(result.message);
        return;
      }

      setError(result.message);
    });
  }

  function applyFormat(format: MarkdownFormat) {
    const view = editorViewRef.current;

    if (!view) {
      return;
    }

    const selection = view.state.selection.main;
    const next = formatTextareaValue(
      view.state.doc.toString(),
      selection.from,
      selection.to,
      format,
    );

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: next.value,
      },
      selection: EditorSelection.range(next.selectionStart, next.selectionEnd),
    });
    view.focus();
  }

  return (
    <section className="grid gap-4 text-foreground">
      <div className="grid gap-4 border-b border-border/70 pb-5 lg:grid-cols-[1fr_220px_180px_110px_auto] lg:items-end">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Title
          </span>
          <Input
            value={titleValue}
            onChange={(event) => setTitleValue(event.target.value)}
            className="h-11 text-lg font-semibold"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Slug
          </span>
          <Input
            value={slugValue}
            onChange={(event) => setSlugValue(event.target.value)}
            autoComplete="off"
            className="h-11"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Category
          </span>
          <Input
            value={categoryValue}
            onChange={(event) => setCategoryValue(event.target.value)}
            autoComplete="off"
            className="h-11"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Order
          </span>
          <Input
            type="number"
            min={0}
            max={9999}
            value={sortOrderValue}
            onChange={(event) => setSortOrderValue(event.target.value)}
            className="h-11"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusValue}
            onChange={(event) =>
              setStatusValue(event.target.value as OfficialDocEditorProps["status"])
            }
            className="h-11 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <Button onClick={save} disabled={isPending} className="h-11">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Official documentation
        </p>
        <div className="flex rounded-full border border-border/70 bg-background/70 p-1">
          <ModeButton active={mode === "source"} onClick={() => setMode("source")}>
            <FileCode2 className="size-4" />
            Source
          </ModeButton>
          <ModeButton active={mode === "split"} onClick={() => setMode("split")}>
            <Columns2 className="size-4" />
            Split
          </ModeButton>
          <ModeButton active={mode === "preview"} onClick={() => setMode("preview")}>
            <Eye className="size-4" />
            Preview
          </ModeButton>
        </div>
      </div>

      <div className="overflow-x-auto border-y border-border/70 bg-card/35 py-2">
        <MarkdownToolbar onFormat={applyFormat} />
      </div>

      <div
        className={cn(
          "grid min-h-[620px] border-b border-border/70",
          mode === "split" ? "lg:grid-cols-2" : "grid-cols-1",
        )}
      >
        {mode !== "preview" ? (
          <CodeMirror
            value={markdownValue}
            extensions={editorExtensions}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
            }}
            onChange={(value) => setMarkdownValue(value)}
            basicSetup={{
              foldGutter: true,
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
            }}
            className="min-h-[620px] overflow-hidden border-r border-border/60 bg-transparent"
          />
        ) : null}
        {mode !== "source" ? (
          <div className="min-h-[620px] overflow-auto bg-transparent p-6">
            <MarkdownDocument markdown={markdownValue} className="max-w-4xl" />
          </div>
        ) : null}
      </div>

      {message || error ? (
        <div className="flex items-center gap-2 text-sm">
          {error ? (
            <>
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-destructive">{error}</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4 text-emerald-500" />
              <span className="text-muted-foreground">{message}</span>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

function formatTextareaValue(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  format: MarkdownFormat,
) {
  const selected = value.slice(selectionStart, selectionEnd);
  const replacement = replacementForFormat(format, selected)!;
  const nextValue =
    value.slice(0, selectionStart) + replacement.text + value.slice(selectionEnd);

  return {
    value: nextValue,
    selectionStart: selectionStart + replacement.cursorStart,
    selectionEnd: selectionStart + replacement.cursorEnd,
  };
}

function replacementForFormat(format: MarkdownFormat, selected: string) {
  const content = selected || sampleTextForFormat(format);

  switch (format) {
    case "heading1":
      return linePrefix("# ", content);
    case "heading2":
      return linePrefix("## ", content);
    case "heading3":
      return linePrefix("### ", content);
    case "bold":
      return wrap("**", content);
    case "italic":
      return wrap("*", content);
    case "inlineCode":
      return wrap("`", content);
    case "link":
      return {
        text: `[${content}](https://example.com)`,
        cursorStart: 1,
        cursorEnd: 1 + content.length,
      };
    case "bulletList":
      return linePrefix("- ", content);
    case "orderedList":
      return {
        text: content
          .split(/\r?\n/)
          .map((line, index) => `${index + 1}. ${line}`)
          .join("\n"),
        cursorStart: 3,
        cursorEnd: 3 + content.length,
      };
    case "taskList":
      return linePrefix("- [ ] ", content);
    case "blockquote":
      return linePrefix("> ", content);
    case "codeFence":
      return {
        text: `\`\`\`\n${content}\n\`\`\``,
        cursorStart: 4,
        cursorEnd: 4 + content.length,
      };
    case "table":
      return {
        text: "| Column | Column |\n| --- | --- |\n| Value | Value |",
        cursorStart: 2,
        cursorEnd: 8,
      };
    case "region": {
      const text = `<!-- vault-region id="region-id" title="Region title" foldable collapsed -->\n${content}\n<!-- /vault-region -->`;
      const cursorStart = text.indexOf("region-id");

      return {
        text,
        cursorStart,
        cursorEnd: cursorStart + "region-id".length,
      };
    }
    case "horizontalRule":
      return { text: "\n---\n", cursorStart: 5, cursorEnd: 5 };
  }
}

function wrap(marker: string, content: string) {
  return {
    text: `${marker}${content}${marker}`,
    cursorStart: marker.length,
    cursorEnd: marker.length + content.length,
  };
}

function linePrefix(prefix: string, content: string) {
  return {
    text: content
      .split(/\r?\n/)
      .map((line) => `${prefix}${line}`)
      .join("\n"),
    cursorStart: prefix.length,
    cursorEnd: prefix.length + content.length,
  };
}

function sampleTextForFormat(format: MarkdownFormat) {
  if (format === "link") {
    return "link text";
  }

  if (format === "table") {
    return "";
  }

  if (format === "region") {
    return "Region content";
  }

  return "text";
}
