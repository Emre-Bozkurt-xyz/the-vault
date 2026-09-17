"use client";

import { useEffect, useState, useTransition } from "react";
import { FolderOpen, Tags, Trash2, Users } from "lucide-react";

import { InheritedTagList } from "@/components/inherited-tag-list";
import { TagAutocompleteInput } from "@/components/tag-autocomplete-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserSearchField } from "@/components/user-search-field";
import { formatTagInput } from "@/lib/content-metadata";
import { cn } from "@/lib/utils";
import {
  getFolderSettingsData,
  removeFolderCollaboratorAction,
  shareFolderAction,
  updateFolderCollaboratorRoleAction,
  updateFolderDefaultTagsAction,
} from "@/server/folders";

type FolderSettingsData = NonNullable<
  Awaited<ReturnType<typeof getFolderSettingsData>>
>;

type SettingsSection = "tags" | "sharing";

const sections: { id: SettingsSection; label: string; icon: typeof Tags }[] = [
  { id: "tags", label: "Default tags", icon: Tags },
  { id: "sharing", label: "Sharing", icon: Users },
];

/**
 * Per-folder settings. Sharing lives here rather than in its own dialog because
 * both answer the same question — what does this folder impose on everything
 * inside it — and splitting them left the folder menu with two near-identical
 * entries.
 *
 * `initialSection` is only which tab opens focused; the dialog is the single
 * destination either way.
 */
export function FolderSettingsDialog({
  folder,
  initialSection = "tags",
  onClose,
}: {
  folder: { id: string; name: string } | null;
  initialSection?: SettingsSection;
  onClose: () => void;
}) {
  const [data, setData] = useState<FolderSettingsData | null>(null);
  // The tab the user clicked, remembered per folder. Stored this way rather
  // than reset from an effect so opening the dialog on a different folder falls
  // straight back to that caller's `initialSection` with no extra render.
  const [sectionChoice, setSectionChoice] = useState<{
    folderId: string;
    section: SettingsSection;
  } | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const open = folder !== null;
  const isLoaded = Boolean(folder && data && data.folderId === folder.id);
  const section =
    sectionChoice && sectionChoice.folderId === folder?.id
      ? sectionChoice.section
      : initialSection;

  useEffect(() => {
    if (!folder) {
      return;
    }

    let cancelled = false;
    void getFolderSettingsData(folder.id).then((next) => {
      if (cancelled) {
        return;
      }

      setData(next ?? null);
      setTagDraft(formatTagInput(next?.defaultTags ?? []));
    });

    return () => {
      cancelled = true;
    };
  }, [folder]);

  function mutate(action: (fd: FormData) => Promise<unknown>, fd: FormData) {
    startTransition(async () => {
      await action(fd);
      if (folder) {
        const next = await getFolderSettingsData(folder.id);
        setData(next ?? null);
        setTagDraft(formatTagInput(next?.defaultTags ?? []));
      }
    });
  }

  function commitTags(value: string) {
    if (!folder) {
      return;
    }

    const fd = new FormData();
    fd.set("folderId", folder.id);
    fd.set("tags", value);
    mutate(updateFolderDefaultTagsAction, fd);
  }

  const priorityUsers = (data?.friends ?? []).map((friend) => ({
    id: friend.id,
    nickname: friend.name,
    username: friend.username ?? null,
    email: friend.email,
    image: friend.image ?? null,
    priorityLabel: "Friend",
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[min(88dvh,42rem)] overflow-hidden rounded-lg border border-border/70 bg-background/95 p-0 shadow-2xl sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            Folder settings
          </DialogTitle>
          <DialogDescription>
            Settings for{" "}
            <span className="font-medium text-foreground">{folder?.name}</span>{" "}
            apply to every document inside it, subfolders included.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Folder settings sections"
          className="flex gap-1 border-b border-border/60 px-5 pt-3"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() =>
                folder && setSectionChoice({ folderId: folder.id, section: id })
              }
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 text-sm transition",
                section === id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[calc(min(88dvh,42rem)-8.5rem)] overflow-y-auto px-5 py-5">
          {section === "tags" ? (
            <section>
              <h3 className="text-sm font-semibold">Default tags</h3>
              <div className="mt-3 grid gap-1.5">
                <TagAutocompleteInput
                  value={tagDraft}
                  onChange={setTagDraft}
                  onCommit={commitTags}
                  placeholder="tag1 tag2 ..."
                  inputClassName="h-9 w-full rounded-md border border-border/70 bg-background px-3 font-mono text-sm outline-none transition focus:border-primary/60"
                />
                <span className="text-xs text-muted-foreground">
                  Separate tags with spaces. Use underscores for multi-word
                  tags. Saved when you leave the field.
                </span>
              </div>

              <div className="mt-6 border-t border-border/60 pt-5">
                <h3 className="text-sm font-semibold">Inherited from above</h3>
                <div className="mt-3">
                  {!isLoaded ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : data && data.inheritedTags.length > 0 ? (
                    <InheritedTagList tags={data.inheritedTags} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No parent folder adds tags here.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold">Invite people</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Friends appear first, then other matching Vault users.
                </p>
                <form
                  className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const fd = new FormData(event.currentTarget);
                    if (folder) {
                      fd.set("folderId", folder.id);
                      mutate(shareFolderAction, fd);
                      event.currentTarget.reset();
                    }
                  }}
                >
                  <UserSearchField
                    placeholder="Nickname, username, or email"
                    priorityUsers={priorityUsers}
                    required
                  />
                  <select
                    name="role"
                    className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    defaultValue="viewer"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <Button type="submit" disabled={isPending}>
                    Invite
                  </Button>
                </form>
              </section>

              <section className="mt-6 border-t border-border/60 pt-5">
                <h3 className="text-sm font-semibold">People with access</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Folder shares apply to everything inside this folder.
                </p>

                <div className="mt-3 divide-y divide-border/60 rounded-md border border-border/60">
                  {!isLoaded ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      Loading…
                    </p>
                  ) : data && data.collaborators.length > 0 ? (
                    data.collaborators.map((collaborator) => (
                      <div
                        key={collaborator.userId}
                        className="grid items-center gap-3 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_2rem]"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {collaborator.name ??
                              collaborator.email ??
                              "Unnamed user"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {collaborator.email}
                          </p>
                        </div>

                        <select
                          className="h-8 w-full rounded-md border border-border/70 bg-background/70 px-2 text-xs"
                          defaultValue={collaborator.role}
                          disabled={isPending}
                          onChange={(event) => {
                            if (!folder) {
                              return;
                            }
                            const fd = new FormData();
                            fd.set("folderId", folder.id);
                            fd.set("userId", collaborator.userId);
                            fd.set("role", event.currentTarget.value);
                            mutate(updateFolderCollaboratorRoleAction, fd);
                          }}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove access"
                          title="Remove access"
                          disabled={isPending}
                          onClick={() => {
                            if (!folder) {
                              return;
                            }
                            const fd = new FormData();
                            fd.set("folderId", folder.id);
                            fd.set("userId", collaborator.userId);
                            mutate(removeFolderCollaboratorAction, fd);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      No one has folder access yet.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
