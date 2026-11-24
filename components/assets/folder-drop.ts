"use client";

import { planFolderUpload } from "@/lib/asset-folders";
import { showWorkspaceToast } from "@/lib/workspace-toast";

import { createMediaFolder } from "./folder-actions";

/**
 * Dropping (or picking) a whole folder — a camera card's `DCIM`, say — into the
 * media library: read the tree, recreate its directories as media folders, and
 * queue each file into its folder. Directory names that clash with an existing
 * folder get "(2)" rather than merging into it, like a file manager's copy.
 */

export type DroppedFile = { file: File; relativePath: string };

/** More than this in one drop is almost certainly a mistake (a whole disk). */
export const MAX_DROPPED_FILES = 5000;

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (resolve: (file: File) => void, reject: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (resolve: (entries: Entry[]) => void, reject: (error: unknown) => void) => void;
  };
};

/**
 * Must be called synchronously inside the drop handler: the browser empties
 * `dataTransfer` as soon as the event returns. Hands back a promise for the
 * files, read afterwards.
 */
export function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const entries: Entry[] = [];
  const looseFiles: File[] = [];

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null })
      .webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
    }
  }

  if (entries.length === 0 && looseFiles.length === 0) {
    looseFiles.push(...Array.from(dataTransfer.files ?? []));
  }

  return (async () => {
    const collected: DroppedFile[] = looseFiles.map((file) => ({ file, relativePath: file.name }));
    for (const entry of entries) {
      await walk(entry, collected);
      if (collected.length > MAX_DROPPED_FILES) break;
    }
    return collected;
  })();
}

async function walk(entry: Entry, out: DroppedFile[]) {
  if (out.length > MAX_DROPPED_FILES) return;

  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ file, relativePath: entry.fullPath.replace(/^\/+/, "") || file.name });
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns batches (about 100 in Chrome) until it returns none.
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

/** From `<input webkitdirectory>`: every file carries its relative path. */
export function filesFromDirectoryInput(files: FileList | null): DroppedFile[] {
  return Array.from(files ?? []).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

/**
 * Creates the dropped tree's folders under `parentFolderId` (null = root),
 * parents first, then queues each file into its folder through `enqueue`.
 * Resolves to how many files were queued (0 if nothing could be created).
 */
export async function uploadDroppedTree(input: {
  dropped: DroppedFile[];
  parentFolderId: string | null;
  enqueue: (files: File[], folderId: string | null) => void;
}) {
  if (input.dropped.length > MAX_DROPPED_FILES) {
    showWorkspaceToast({
      message: `That's more than ${MAX_DROPPED_FILES.toLocaleString()} files. Drop a smaller folder.`,
      tone: "error",
    });
    return 0;
  }

  const byPath = new Map(input.dropped.map((item) => [item.relativePath, item.file]));
  const plan = planFolderUpload([...byPath.keys()]);
  const folderIds = new Map<string, string | null>([["", input.parentFolderId]]);

  try {
    for (const directory of plan.directories) {
      const slash = directory.lastIndexOf("/");
      const parentPath = slash === -1 ? "" : directory.slice(0, slash);
      const folder = await createMediaFolder({
        name: directory.slice(slash + 1),
        parentId: folderIds.get(parentPath) ?? input.parentFolderId,
        onConflict: "rename",
      });
      folderIds.set(directory, folder.id);
    }
  } catch (error) {
    showWorkspaceToast({
      message: error instanceof Error ? `Could not create folders: ${error.message}` : "Could not create folders.",
      tone: "error",
    });
    return 0;
  }

  const groups = new Map<string, File[]>();
  for (const { path, directory } of plan.files) {
    const file = byPath.get(path);
    if (file) groups.set(directory, [...(groups.get(directory) ?? []), file]);
  }
  let queued = 0;
  for (const [directory, files] of groups) {
    input.enqueue(files, folderIds.get(directory) ?? input.parentFolderId);
    queued += files.length;
  }
  return queued;
}
