"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { EditorContent, useEditor } from "@tiptap/react";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { createEditorExtensions } from "@/components/editor/editor-extensions";
import { Button } from "@/components/ui/button";
import type { ProseMirrorDoc } from "@/lib/editor-content";
import { saveDocumentDraftAction } from "@/server/documents";

type VaultEditorProps = {
  documentId: string;
  title: string;
  content: ProseMirrorDoc;
  collaboration?: {
    url: string;
    token: string;
    user: {
      name: string;
      email: string | null;
    };
  } | null;
};

type CollabSession = {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
};

export function VaultEditor({
  documentId,
  title,
  content,
  collaboration = null,
}: VaultEditorProps) {
  const [titleValue, setTitleValue] = useState(title);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [collabStatus, setCollabStatus] = useState<
    "off" | "connecting" | "connected" | "disconnected"
  >(collaboration ? "connecting" : "off");
  const titleValueRef = useRef(title);
  const savingRef = useRef(false);
  const collaborationKey = collaboration
    ? `${documentId}:${collaboration.url}:${collaboration.token}`
    : "local";

  const collabSession = useMemo<CollabSession | null>(() => {
    if (!collaboration) {
      return null;
    }

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: collaboration.url,
      name: documentId,
      document: ydoc,
      token: collaboration.token,
      onStatus: ({ status }) => {
        setCollabStatus(status);
      },
      onAuthenticationFailed: () => {
        setCollabStatus("disconnected");
      },
    });

    return { ydoc, provider };
  }, [collaboration, documentId]);

  useEffect(() => {
    if (!collabSession) {
      return;
    }

    return () => {
      collabSession.provider.destroy();
      collabSession.ydoc.destroy();
    };
  }, [collabSession]);

  const extensions = useMemo(() => {
    if (collaboration && collabSession) {
      const color = colorFromString(
        collaboration.user.email ?? collaboration.user.name,
      );

      return [
        ...createEditorExtensions({ history: false }),
        Collaboration.configure({
          document: collabSession.ydoc,
          field: "default",
        }),
        CollaborationCaret.configure({
          provider: collabSession.provider,
          user: {
            name: collaboration.user.name,
            color,
          },
          render: (user) => {
            const cursor = document.createElement("span");
            cursor.classList.add("vault-collab-caret");
            cursor.style.borderColor = user.color;

            const label = document.createElement("span");
            label.classList.add("vault-collab-label");
            label.style.backgroundColor = user.color;
            label.textContent = user.name;
            cursor.append(label);

            return cursor;
          },
          selectionRender: (user) => ({
            class: "vault-collab-selection",
            style: `background-color: ${user.color}33`,
          }),
        }),
      ];
    }

    return createEditorExtensions();
  }, [collabSession, collaboration]);

  const editor = useEditor({
    extensions,
    content: collaboration ? undefined : content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "vault-editor-content min-h-[520px] px-5 py-4 text-base leading-7 outline-none",
      },
    },
    onUpdate: () => setDirty(true),
  }, [collaborationKey, extensions]);

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
  const collaborationStatusText =
    collabStatus === "connected"
      ? "Live collaboration connected"
      : collabStatus === "connecting"
        ? "Connecting live collaboration..."
        : collabStatus === "disconnected"
          ? "Live collaboration disconnected"
          : null;

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
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5">
            {statusIcon}
            {statusText}
          </p>
          {collaborationStatusText ? <p>{collaborationStatusText}</p> : null}
        </div>
        <Button type="submit" disabled={!dirty || saving || !editor}>
          <Save data-icon="inline-start" />
          Save
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
