"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { navigateFromOverlay } from "@/components/ui/use-close-on-back";
import { dispatchWorkspaceDocumentChanged } from "@/components/workspace/workspace-events";
import type { WorkspaceDocumentItem, WorkspaceFolderItem } from "@/components/workspace/workspace-types";
import {
  BUILT_IN_TEMPLATES,
  fillTemplate,
  isTemplatesFolderName,
  localTemplateValues,
  type BuiltInTemplate,
} from "@/lib/document-templates";
import { subscribeToNewDocumentRequests } from "@/lib/new-document-events";
import { cn } from "@/lib/utils";
import { showWorkspaceToast } from "@/lib/workspace-toast";
import { createDocumentFromTemplateAction } from "@/server/documents";

type TemplateChoice =
  | { kind: "builtin"; template: BuiltInTemplate }
  | { kind: "document"; doc: WorkspaceDocumentItem };

const choiceId = (choice: TemplateChoice) => (choice.kind === "builtin" ? choice.template.id : `doc:${choice.doc.id}`);

/**
 * "New document": pick a template (built-in, or one of yours: any document in
 * a folder named "Templates"), name it and choose its folder. Opened through
 * `openNewDocumentDialog` from every "New document" entry point.
 */
export function NewDocumentDialog({
  folders,
  documents,
}: {
  folders: WorkspaceFolderItem[];
  documents: WorkspaceDocumentItem[];
}) {
  const [request, setRequest] = useState<{ folderId: string | null; key: number } | null>(null);

  useEffect(
    () =>
      subscribeToNewDocumentRequests((next) =>
        setRequest({ folderId: next.folderId ?? null, key: Date.now() }),
      ),
    [],
  );

  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? null : setRequest(null))}>
      <DialogContent className="sm:max-w-2xl">
        {request ? (
          <NewDocumentForm
            key={request.key}
            initialFolderId={request.folderId}
            folders={folders}
            documents={documents}
            onDone={() => setRequest(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewDocumentForm({
  initialFolderId,
  folders,
  documents,
  onDone,
}: {
  initialFolderId: string | null;
  folders: WorkspaceFolderItem[];
  documents: WorkspaceDocumentItem[];
  onDone: () => void;
}) {
  const router = useRouter();
  const folderOptions = useMemo(() => folderPaths(folders), [folders]);
  const yourTemplates = useMemo(() => {
    const templateFolders = new Set(folders.filter((folder) => isTemplatesFolderName(folder.name)).map((folder) => folder.id));
    return documents
      .filter((doc) => doc.folderId && templateFolders.has(doc.folderId))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [documents, folders]);
  const choices: TemplateChoice[] = [
    ...BUILT_IN_TEMPLATES.map((template) => ({ kind: "builtin" as const, template })),
    ...yourTemplates.map((doc) => ({ kind: "document" as const, doc })),
  ];

  const [selected, setSelected] = useState<TemplateChoice>(choices[0]);
  const [folderId, setFolderId] = useState(initialFolderId && folderOptions.some((f) => f.id === initialFolderId) ? initialFolderId : "");
  const [title, setTitle] = useState(() => suggestedTitle(choices[0]));
  const [titleEdited, setTitleEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  function choose(choice: TemplateChoice) {
    setSelected(choice);
    if (!titleEdited) setTitle(suggestedTitle(choice));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const values = localTemplateValues(new Date());
    const created = await createDocumentFromTemplateAction({
      title: title.trim(),
      folderId: folderId || null,
      template: choiceId(selected),
      date: values.date,
      time: values.time,
      weekday: values.weekday,
    }).catch(() => null);
    if (!created) {
      setSaving(false);
      showWorkspaceToast({ message: "Couldn't create the document.", tone: "error" });
      return;
    }
    const href = `/docs/${created.id}`;
    dispatchWorkspaceDocumentChanged({
      id: created.id,
      title: created.title,
      href,
      folderId: created.folderId,
      role: "owner",
      visibility: "private",
      updatedAt: created.updatedAt,
    });
    navigateFromOverlay(() => router.push(href));
    onDone();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New document</DialogTitle>
        <DialogDescription>
          Start from a template, or blank. Your own templates are the documents in a folder named “Templates”.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <Input
            autoFocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleEdited(true);
            }}
            placeholder="Untitled document"
            maxLength={200}
            aria-label="Title"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Folder</span>
          <select
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Folder"
          >
            <option value="">No folder</option>
            {folderOptions.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid max-h-[50vh] gap-3 overflow-y-auto pr-1">
        <TemplateGrid label="Templates" choices={choices.filter((c) => c.kind === "builtin")} selected={selected} onChoose={choose} />
        {yourTemplates.length > 0 ? (
          <TemplateGrid label="Your templates" choices={choices.filter((c) => c.kind === "document")} selected={selected} onChoose={choose} />
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TemplateGrid({
  label,
  choices,
  selected,
  onChoose,
}: {
  label: string;
  choices: TemplateChoice[];
  selected: TemplateChoice;
  onChoose: (choice: TemplateChoice) => void;
}) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={label}>
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {choices.map((choice) => {
          const on = choiceId(choice) === choiceId(selected);
          const name = choice.kind === "builtin" ? choice.template.name : choice.doc.title || "Untitled template";
          const description = choice.kind === "builtin" ? choice.template.description : "Your template";
          return (
            <button
              key={choiceId(choice)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(choice)}
              className={cn(
                "grid gap-2 rounded-lg border bg-background p-2.5 text-left transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                on ? "border-foreground ring-1 ring-foreground" : "border-border",
              )}
            >
              <TemplateThumbnail kind={choice.kind === "builtin" ? choice.template.preview : "lines"} />
              <span className="grid gap-0.5">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TemplateThumbnail({ kind }: { kind: BuiltInTemplate["preview"] }) {
  return (
    <span aria-hidden="true" className="flex h-14 flex-col gap-1.5 overflow-hidden rounded-md border border-border/70 bg-muted/40 p-2">
      {kind === "blank" ? (
        <FileText className="m-auto size-5 text-muted-foreground/60" />
      ) : kind === "columns" ? (
        <span className="flex h-full gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex-1 rounded-sm bg-muted-foreground/15" />
          ))}
        </span>
      ) : (
        [0.6, 0.9, 0.75, 0.5].map((width, i) => (
          <span key={i} className="flex items-center gap-1">
            {kind === "checklist" ? <span className="size-1.5 shrink-0 rounded-[2px] border border-muted-foreground/50" /> : null}
            <span className="h-1 rounded-full bg-muted-foreground/25" style={{ width: `${width * 100}%` }} />
          </span>
        ))
      )}
    </span>
  );
}

function suggestedTitle(choice: TemplateChoice): string {
  if (choice.kind === "document") return choice.doc.title;
  return fillTemplate(choice.template.defaultTitle, localTemplateValues(new Date()));
}

function folderPaths(folders: WorkspaceFolderItem[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathOf = (folder: WorkspaceFolderItem) => {
    const names = [folder.name];
    const seen = new Set([folder.id]);
    let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.join(" / ");
  };
  return folders
    .map((folder) => ({ id: folder.id, label: pathOf(folder) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
