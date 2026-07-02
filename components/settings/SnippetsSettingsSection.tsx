"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { css as cssLanguage } from "@codemirror/lang-css";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import { DocumentCanvas } from "@/components/markdown/DocumentCanvas";
import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SnippetDiagnostic } from "@/lib/snippets/compile";
import type { SnippetDetail, SnippetSummary } from "@/server/snippets";
import {
  compileSnippetPreviewAction,
  createSnippetAction,
  deleteSnippetAction,
  getSnippetDetailAction,
  listSnippetsAction,
  setViewerStylingPreferenceAction,
  updateSnippetAction,
} from "@/server/snippets-actions";

const PREVIEW_DOC_ID = "preview";

const sampleMarkdown = `# Heading one

A paragraph with **bold**, *italic*, and \`inline code\`.

> [!tip] Callout
> Snippets can restyle callouts too.

- List item one
- List item two

\`\`\`js
const hello = "world";
\`\`\`
`;

type SnippetsSettingsSectionProps = {
  initialSnippets: SnippetSummary[];
  initialApplyAuthorStyling: boolean;
};

export function SnippetsSettingsSection({
  initialSnippets,
  initialApplyAuthorStyling,
}: SnippetsSettingsSectionProps) {
  const [snippets, setSnippets] = useState(initialSnippets);
  const [applyStyling, setApplyStyling] = useState(initialApplyAuthorStyling);
  const [editing, setEditing] = useState<SnippetDetail | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const rows = await listSnippetsAction();
    setSnippets(rows);
  }, []);

  // The settings modal is server-rendered once and reused; re-sync on mount so
  // reopening the panel reflects snippets created earlier without a page reload.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createSnippetAction({ name: newName });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNewName("");
      await refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteSnippetAction(id);
      if (editing?.id === id) {
        setEditing(null);
      }
      await refresh();
    });
  }

  function handleToggleStyling(next: boolean) {
    setApplyStyling(next);
    startTransition(async () => {
      await setViewerStylingPreferenceAction(next);
    });
  }

  if (editing) {
    return (
      <SnippetEditor
        snippet={editing}
        onClose={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <label className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
          <input
            type="checkbox"
            checked={applyStyling}
            onChange={(event) => handleToggleStyling(event.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="text-sm">
            <span className="font-medium">
              Apply custom styling from document authors
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When off, documents you view are shown without their authors&apos;
              CSS snippets. You can still toggle styling per document.
            </span>
          </span>
        </label>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Your snippets</h3>
          <span className="text-xs text-muted-foreground">
            {snippets.length} total
          </span>
        </div>

        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="snippet-name">
              New snippet name
            </label>
            <Input
              id="snippet-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. warm-serif"
              maxLength={60}
            />
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={pending || newName.trim().length === 0}
          >
            <Plus className="size-4" /> Create
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}

        <ul className="grid gap-2">
          {snippets.length === 0 ? (
            <li className="rounded-md border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              No snippets yet. Create one, then attach it to a document from the
              document&apos;s Styling panel.
            </li>
          ) : null}
          {snippets.map((snippet) => (
            <li
              key={snippet.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">
                    {snippet.name}
                  </span>
                  {snippet.status !== "ok" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[0.65rem] font-semibold text-destructive">
                      <AlertTriangle className="size-3" /> {snippet.status}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {snippet.attachedCount} document
                  {snippet.attachedCount === 1 ? "" : "s"} ·{" "}
                  {(snippet.sourceBytes / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    startTransition(async () => {
                      const detail = await getSnippetDetailAction(snippet.id);
                      if (detail) {
                        setEditing(detail);
                      }
                    })
                  }
                >
                  Edit CSS
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${snippet.name}`}
                  onClick={() => handleDelete(snippet.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type SnippetEditorProps = {
  snippet: SnippetDetail;
  onClose: () => void;
};

function SnippetEditor({ snippet, onClose }: SnippetEditorProps) {
  const [source, setSource] = useState(snippet.sourceCss);
  const [compiledCss, setCompiledCss] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<SnippetDiagnostic[]>([]);
  const [saving, startSaving] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCompile = useCallback((value: string) => {
    void compileSnippetPreviewAction(value).then((result) => {
      setCompiledCss(result.css);
      setDiagnostics(result.diagnostics);
    });
  }, []);

  useEffect(() => {
    runCompile(snippet.sourceCss);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(value: string) {
    setSource(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => runCompile(value), 400);
  }

  function handleSave() {
    startSaving(async () => {
      const result = await updateSnippetAction(snippet.id, { sourceCss: source });
      if (result.ok) {
        setDiagnostics(result.data.diagnostics);
        setSavedAt(new Date().toLocaleTimeString());
      }
    });
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Editing “{snippet.name}”</h3>
          <p className="text-xs text-muted-foreground">
            CSS is sanitized on save; the preview shows exactly what viewers get.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt ? (
            <span className="text-xs text-muted-foreground">Saved {savedAt}</span>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-2">
          <div className="overflow-hidden rounded-md border border-border/70">
            <CodeMirror
              value={source}
              height="320px"
              extensions={[cssLanguage(), EditorView.lineWrapping]}
              onChange={handleChange}
              theme="dark"
            />
          </div>
          {errors.length > 0 || warnings.length > 0 ? (
            <div className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
              {errors.map((d, index) => (
                <p key={`e-${index}`} className="text-destructive">
                  {d.line ? `L${d.line}: ` : ""}
                  {d.message}
                </p>
              ))}
              {warnings.map((d, index) => (
                <p key={`w-${index}`} className="text-muted-foreground">
                  {d.line ? `L${d.line}: ` : ""}
                  {d.message}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No issues. All rules are scoped to your document body.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Live preview
          </span>
          <div className="max-h-[360px] overflow-auto rounded-md border border-border/70 p-4">
            <DocumentCanvas
              documentId={PREVIEW_DOC_ID}
              snippetCss={compiledCss || null}
            >
              <MarkdownDocument markdown={sampleMarkdown} contained={false} />
            </DocumentCanvas>
          </div>
        </div>
      </div>
    </div>
  );
}
