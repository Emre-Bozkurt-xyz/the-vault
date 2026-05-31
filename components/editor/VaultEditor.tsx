"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";

import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { editorExtensions } from "@/components/editor/editor-extensions";
import { Button } from "@/components/ui/button";
import type { ProseMirrorDoc } from "@/lib/editor-content";
import { saveDocumentDraftAction } from "@/server/documents";

type VaultEditorProps = {
  documentId: string;
  title: string;
  content: ProseMirrorDoc;
};

export function VaultEditor({ documentId, title, content }: VaultEditorProps) {
  const [titleValue, setTitleValue] = useState(title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const titleValueRef = useRef(title);
  const savingRef = useRef(false);

  const editor = useEditor({
    extensions: editorExtensions,
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "vault-editor-content min-h-[520px] px-5 py-4 text-base leading-7 outline-none",
      },
    },
    onUpdate: () => setDirty(true),
  });

  const saveDocument = useCallback(async () => {
    if (!editor || savingRef.current) {
      return;
    }

    const contentJson = JSON.stringify(editor.getJSON());
    const titleAtSave = titleValueRef.current;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);

    const result = await saveDocumentDraftAction({
      documentId,
      title: titleAtSave,
      content: editor.getJSON(),
    });

    savingRef.current = false;
    setSaving(false);

    if (!result.ok) {
      setSaveError(result.message);
      setDirty(true);
      return;
    }

    setLastSavedAt(new Date(result.updatedAt));

    const currentContentJson = JSON.stringify(editor.getJSON());
    setDirty(
      titleValueRef.current !== titleAtSave || currentContentJson !== contentJson,
    );
  }, [documentId, editor]);

  useEffect(() => {
    if (!dirty || !editor || saving) {
      return;
    }

    const autosaveTimer = window.setTimeout(() => {
      void saveDocument();
    }, 1500);

    return () => window.clearTimeout(autosaveTimer);
  }, [dirty, editor, saveDocument, saving, titleValue]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveDocument();
  }

  const statusIcon = saving ? (
    <Loader2 data-icon="inline-start" className="animate-spin" />
  ) : saveError ? (
    <AlertCircle data-icon="inline-start" />
  ) : dirty ? (
    <Save data-icon="inline-start" />
  ) : (
    <CheckCircle2 data-icon="inline-start" />
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

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-5"
    >
      <input
        name="title"
        value={titleValue}
        onChange={(event) => {
          titleValueRef.current = event.target.value;
          setTitleValue(event.target.value);
          setDirty(true);
        }}
        className="w-full bg-transparent text-4xl font-semibold tracking-tight outline-none"
        aria-label="Document title"
      />
      <div className="overflow-hidden border border-border bg-card text-card-foreground">
        <EditorToolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-col justify-between gap-3 border-t border-border pt-5 sm:flex-row">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {statusIcon}
          {statusText}
        </p>
        <Button type="submit" disabled={!dirty || saving || !editor}>
          <Save data-icon="inline-start" />
          Save
        </Button>
      </div>
    </form>
  );
}
