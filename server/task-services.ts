import "server-only";

import {
  collectFolderSubtreeIds,
  resolveFolderRef,
} from "@/lib/folder-paths";
import type {
  ExtensionAgentDocumentTasksApi,
  ExtensionAgentTask,
  ExtensionAgentTaskQuery,
  ExtensionAgentWorkspaceTasksApi,
} from "@/lib/extensions/types";
import { withLiveDocumentText } from "@/lib/mcp/collab-write";
import { documentPath } from "@/lib/mcp/workspace-index";
import { isValidDayKey } from "@/lib/tasks/dates";
import { parseTasks, type ParsedTask } from "@/lib/tasks/parse";
import {
  formatTaskLine,
  locateTaskLine,
  minimalReplacement,
  planTaskInsertion,
  setTaskLineDue,
  setTaskLineStatus,
} from "@/lib/tasks/write";
import { getDocumentForUser } from "@/server/documents-data";
import { listAccessibleFoldersForUser } from "@/server/folders-data";
import {
  ensureTaskIndexFresh,
  queryTasksForUser,
  reindexDocumentTasksFromText,
} from "@/server/tasks-data";

/**
 * The task host service behind `ctx.workspace.tasks` and `ctx.document.tasks`
 * for extension agent actions (`docs/24_TASKS_AND_AGENDA_PLAN.md` §5, §8).
 * Generic over Markdown task lines — no extension's own data — and pre-bound
 * to the acting user by the dispatcher in `server/extensions.ts`.
 *
 * Writes go through the live collab session with origin `"tasks"` and no
 * restore point, edit only the task's own line (as a minimal span), and
 * reindex the document from the resulting text so a list right after a write
 * already reflects it.
 */

const defaultLimit = 100;
const maxLimit = 500;

function assertDayKey(value: string | undefined, name: string) {
  if (value !== undefined && !isValidDayKey(value)) {
    throw new Error(`${name} must be a real YYYY-MM-DD date.`);
  }
}

function toAgentTask(
  task: Omit<ParsedTask, "dueInvalid"> & { line: number },
  document: { id: string; title: string; folderPath: string | null },
): ExtensionAgentTask {
  return {
    documentId: document.id,
    documentTitle: document.title,
    folderPath: document.folderPath,
    path: documentPath(document.folderPath, document.title),
    line: task.line + 1,
    rawLine: task.rawLine,
    ordinal: task.ordinal,
    parentOrdinal: task.parentOrdinal,
    status: task.status,
    text: task.text,
    note: task.note,
    heading: task.heading,
    dueDay: task.dueDay,
    dueTime: task.dueTime,
    doneDay: task.doneDay,
  };
}

/** Workspace-wide task listing over the user's own documents. */
export function buildWorkspaceTasksApi(userId: string): ExtensionAgentWorkspaceTasksApi {
  return {
    async list(query: ExtensionAgentTaskQuery) {
      assertDayKey(query.dueFrom, "dueFrom");
      assertDayKey(query.dueThrough, "dueThrough");

      const folders = await listAccessibleFoldersForUser(userId);
      let folderIds: string[] | undefined;

      if (query.folder) {
        const resolved = resolveFolderRef(folders, query.folder);
        if (!resolved.ok) throw new Error(resolved.error);
        folderIds =
          query.recursive === false
            ? [resolved.folder.id]
            : collectFolderSubtreeIds(folders, resolved.folder.id);
      }

      await ensureTaskIndexFresh(userId);

      const { tasks, total } = await queryTasksForUser(userId, {
        statuses: query.statuses ?? ["open", "in_progress"],
        dueFrom: query.dueFrom,
        dueThrough: query.dueThrough,
        dated: query.dated,
        folderIds,
        documentId: query.documentId,
        text: query.text,
        limit: Math.min(Math.max(query.limit ?? defaultLimit, 1), maxLimit),
      });
      const folderPaths = new Map(folders.map((folder) => [folder.id, folder.path]));

      return {
        total,
        tasks: tasks.map((task) =>
          toAgentTask(task, {
            id: task.documentId,
            title: task.documentTitle,
            folderPath: task.folderId ? (folderPaths.get(task.folderId) ?? null) : null,
          }),
        ),
      };
    },
  };
}

/**
 * Tasks in one document. The dispatcher has already checked read (and, for a
 * mutating action, edit) access; `withLiveDocumentText` re-checks edit access
 * for every write regardless.
 */
export function buildDocumentTasksApi(
  userId: string,
  documentId: string,
  options: { write: boolean },
): ExtensionAgentDocumentTasksApi {
  const loadDocument = async () => {
    const document = await getDocumentForUser(userId, documentId);

    if (!document) {
      throw new Error("Document not found or you do not have access.");
    }

    const folders = document.folderId
      ? await listAccessibleFoldersForUser(userId)
      : [];
    const folderPath = document.folderId
      ? (folders.find((folder) => folder.id === document.folderId)?.path ?? null)
      : null;

    return { id: document.id, title: document.title, markdown: document.markdown, folderPath };
  };

  /** Parses `markdown` and returns the task on 0-based `line`. */
  const taskAtLine = async (markdown: string, line: number) => {
    const document = await loadDocument();
    const task = parseTasks(markdown).find((candidate) => candidate.line === line);

    if (!task) {
      throw new Error("The edit was applied, but the line no longer parses as a task.");
    }

    return toAgentTask(task, document);
  };

  const rewriteTaskLine = async (
    ref: { line: number; rawLine: string },
    transform: (line: string) => string,
  ) => {
    let lineIndex = -1;

    const { markdown } = await withLiveDocumentText(
      userId,
      documentId,
      (ytext) => {
        // CRLF-safe: the parser's rawLine never carries the trailing "\r".
        const lines = ytext.toString().split("\n");
        const bare = lines.map((line) => line.replace(/\r$/, ""));
        lineIndex = locateTaskLine(bare, ref.line - 1, ref.rawLine);

        const before = bare[lineIndex]!;
        const edit = minimalReplacement(before, transform(before));
        const lineStart = lines
          .slice(0, lineIndex)
          .reduce((sum, line) => sum + line.length + 1, 0);

        if (edit.deleteCount > 0) ytext.delete(lineStart + edit.from, edit.deleteCount);
        if (edit.insert) ytext.insert(lineStart + edit.from, edit.insert);
      },
      { origin: "tasks", snapshot: false },
    );

    await reindexDocumentTasksFromText(documentId, markdown);
    return taskAtLine(markdown, lineIndex);
  };

  const api: ExtensionAgentDocumentTasksApi = {
    async list() {
      const document = await loadDocument();
      return parseTasks(document.markdown).map((task) => toAgentTask(task, document));
    },
  };

  if (options.write) {
    api.setStatus = (ref, status, { today }) =>
      rewriteTaskLine(ref, (line) => setTaskLineStatus(line, status, today));

    api.setDue = (ref, due) => rewriteTaskLine(ref, (line) => setTaskLineDue(line, due));

    api.add = async ({ text, due, heading }) => {
      const taskLine = formatTaskLine(text, due);
      let lineIndex = -1;

      const { markdown } = await withLiveDocumentText(
        userId,
        documentId,
        (ytext) => {
          const plan = planTaskInsertion(ytext.toString(), taskLine, heading);

          if (!plan) {
            throw new Error(`No heading matching "${heading}" was found.`);
          }

          ytext.insert(plan.offset, plan.text);
          lineIndex = plan.line;
        },
        { origin: "tasks", snapshot: false },
      );

      await reindexDocumentTasksFromText(documentId, markdown);
      return taskAtLine(markdown, lineIndex);
    };
  }

  return api;
}
