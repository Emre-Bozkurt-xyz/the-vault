"use client";

import { useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Save } from "lucide-react";

import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { editorExtensions } from "@/components/editor/editor-extensions";
import { Button } from "@/components/ui/button";
import type { ProseMirrorDoc } from "@/lib/editor-content";
import { updateDocumentAction } from "@/server/documents";

type VaultEditorProps = {
  documentId: string;
  title: string;
  content: ProseMirrorDoc;
};

export function VaultEditor({ documentId, title, content }: VaultEditorProps) {
  const contentInputRef = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);

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

  return (
    <form
      action={updateDocumentAction}
      className="grid gap-5"
      onSubmit={() => {
        if (contentInputRef.current && editor) {
          contentInputRef.current.value = JSON.stringify(editor.getJSON());
        }
      }}
    >
      <input type="hidden" name="documentId" value={documentId} />
      <input ref={contentInputRef} type="hidden" name="contentJson" />
      <input
        name="title"
        defaultValue={title}
        onChange={() => setDirty(true)}
        className="w-full bg-transparent text-4xl font-semibold tracking-tight outline-none"
        aria-label="Document title"
      />
      <div className="overflow-hidden border border-border bg-card text-card-foreground">
        <EditorToolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-col justify-between gap-3 border-t border-border pt-5 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {dirty ? "Unsaved changes" : "Saved"}
        </p>
        <Button type="submit" onClick={() => setDirty(false)}>
          <Save className="size-4" />
          Save
        </Button>
      </div>
    </form>
  );
}
