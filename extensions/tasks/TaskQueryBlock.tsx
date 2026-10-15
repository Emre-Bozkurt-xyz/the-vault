"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ListChecks } from "lucide-react";

import {
  TaskPriorityBadge,
  TaskRepeatBadge,
  todayDayKey,
  requestEditorJump,
  formatDueLabel,
  parseTasks,
  describeTaskQuery,
  matchesTaskQuery,
  plainTaskText,
  compareViewTasks,
  navigateWorkspace,
  subscribeToTasksChanged,
  getTaskPageAction,
  parseTaskQueryFence,
  applyTaskPatches,
  runTaskWrite,
  useTaskPatches,
  type TaskQuery,
  type TaskPageResult,
} from "@/lib/extension-api/tasks";
import type { BlockProps } from "@/lib/extension-api";
import { cn } from "@/lib/utils";

/**
 * A `:::tasks{…}` block (plan §6.4). Deliberately does NOT render task text
 * through MarkdownDocument — MarkdownDocument mounts this component, and the
 * import cycle would resolve to `undefined` at module init — so text is shown
 * plain, with links reduced to their labels.
 *
 * In the workspace, editors can tick rows; the write goes through the same
 * permission-checked path as every other task list. Public, share, guide and
 * embed surfaces stay read-only.
 */

type Row = {
  key: string;
  documentId: string | null;
  documentTitle: string | null;
  line: number;
  rawLine: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  text: string;
  dueDay: string | null;
  dueTime: string | null;
  priority: "high" | "medium" | "low" | null;
  repeat: string | null;
};

const maxRows = 50;
const noopSubscribe = () => () => {};

/** Today on the client, null during the server render (so SSR never guesses). */
function useToday(): string | null {
  return useSyncExternalStore(noopSubscribe, todayDayKey, () => null);
}

export default function HostedTaskQueryBlock({ ctx, source, documentMarkdown }: BlockProps) {
  const query = parseTaskQueryFence(source);
  if (!query) return <code>{source}</code>;
  return (
    <TaskQueryBlock
      query={query}
      documentMarkdown={documentMarkdown ?? null}
      documentId={ctx.documentId ?? undefined}
      publicSurface={ctx.surface !== "workspace"}
      canEdit={ctx.surface === "workspace" && ctx.canEdit}
    />
  );
}

function TaskQueryBlock({
  query,
  documentMarkdown,
  documentId,
  publicSurface,
  canEdit,
}: {
  query: TaskQuery;
  /** The whole document's Markdown, for `scope=doc`. */
  documentMarkdown: string | null;
  documentId?: string;
  /** A public page: `scope=all` must not fetch, and rows do not link. */
  publicSurface: boolean;
  /** Ticking writes to the task's document; only for workspace editors. */
  canEdit: boolean;
}) {
  const today = useToday();

  if (query.scope === "all") {
    return publicSurface ? (
      <Frame query={query}>
        <p className="vault-task-query-empty">
          Lists each reader&apos;s own tasks. Open this document in Vault to see yours.
        </p>
      </Frame>
    ) : (
      <PersonalTasks query={query} today={today} />
    );
  }

  return (
    <DocumentTasks
      query={query}
      today={today}
      markdown={documentMarkdown ?? ""}
      documentId={documentId}
      linkable={!publicSurface}
      canEdit={canEdit && Boolean(documentId)}
    />
  );
}

function DocumentTasks({
  query,
  today,
  markdown,
  documentId,
  linkable,
  canEdit,
}: {
  query: TaskQuery;
  today: string | null;
  markdown: string;
  documentId?: string;
  linkable: boolean;
  canEdit: boolean;
}) {
  const rows = useMemo<Row[]>(() => {
    if (!today) return [];
    return parseTasks(markdown)
      .filter((task) => matchesTaskQuery(task, query, today))
      .map((task) => ({
        key: String(task.ordinal),
        documentId: documentId ?? null,
        documentTitle: null,
        line: task.line,
        rawLine: task.rawLine,
        status: task.status,
        text: task.text,
        dueDay: task.dueDay,
        dueTime: task.dueTime,
        priority: task.priority,
        repeat: task.repeat,
      }));
  }, [markdown, query, today, documentId]);

  return (
    <Frame query={query}>
      <Rows rows={rows} today={today} linkable={linkable && Boolean(documentId)} canEdit={canEdit} />
    </Frame>
  );
}

function PersonalTasks({ query, today }: { query: TaskQuery; today: string | null }) {
  const [result, setResult] = useState<TaskPageResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getTaskPageAction({ today: todayDayKey() })
        .catch((): TaskPageResult => ({ ok: false, error: "Could not load tasks." }))
        .then((next) => {
          if (!cancelled) setResult(next);
        });
    };

    load();
    const unsubscribe = subscribeToTasksChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!today || !result?.ok) return [];
    return result.tasks
      .filter((task) => matchesTaskQuery(task, query, today, result.tagsByDocument))
      .sort(compareViewTasks)
      .map((task) => ({
        key: `${task.documentId}:${task.ordinal}`,
        documentId: task.documentId,
        documentTitle: task.documentTitle,
        line: task.line,
        rawLine: task.rawLine,
        status: task.status,
        text: task.text,
        dueDay: task.dueDay,
        dueTime: task.dueTime,
        priority: task.priority,
        repeat: task.repeat,
      }));
  }, [result, query, today]);

  return (
    <Frame query={query}>
      {result === null ? (
        <p className="vault-task-query-empty">Loading…</p>
      ) : !result.ok ? (
        <p className="vault-task-query-empty">{result.error}</p>
      ) : (
        // Personal rows are the viewer's own tasks, so always tickable.
        <Rows rows={rows} today={today} linkable canEdit />
      )}
    </Frame>
  );
}

function Frame({ query, children }: { query: TaskQuery; children: React.ReactNode }) {
  return (
    <section className="vault-task-query" data-scope={query.scope} aria-label={describeTaskQuery(query)}>
      <p className="vault-task-query-title">
        <ListChecks aria-hidden="true" />
        {describeTaskQuery(query)}
      </p>
      {children}
    </section>
  );
}

function Rows({
  rows: storedRows,
  today,
  linkable,
  canEdit,
}: {
  rows: Row[];
  today: string | null;
  linkable: boolean;
  canEdit: boolean;
}) {
  const patches = useTaskPatches();
  const rows = useMemo(
    () => (today ? applyTaskPatches(storedRows.map((row) => ({ ...row, documentId: row.documentId ?? "" })), patches, today) : []),
    [storedRows, patches, today],
  );

  if (!today) return <p className="vault-task-query-empty">Loading…</p>;
  if (rows.length === 0) return <p className="vault-task-query-empty">Nothing here.</p>;

  const shown = rows.slice(0, maxRows);

  return (
    <>
      <ul className="vault-task-query-list">
        {shown.map((row) => {
          const closed = row.status === "done" || row.status === "cancelled";
          const overdue = !closed && row.dueDay !== null && row.dueDay < today;
          const box =
            canEdit && row.documentId ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={row.status === "done"}
                aria-label={closed ? "Mark not done" : "Mark done"}
                title={closed ? "Mark not done" : "Mark done"}
                className="vault-task-box"
                data-status={row.status}
                data-overdue={overdue ? "true" : undefined}
                // In Live mode this sits inside CodeMirror: keep the click from
                // moving the cursor into (and revealing) the block's source.
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void runTaskWrite([row], { type: "status", status: closed ? "open" : "done" });
                }}
              />
            ) : (
              <span className="vault-task-box" data-status={row.status} data-overdue={overdue ? "true" : undefined} />
            );
          const body = (
            <>
              <span
                className={cn(
                  "vault-task-query-text",
                  (row.status === "done" || row.status === "cancelled") && "vault-task-query-text--closed",
                )}
              >
                {plainTaskText(row.text) || "Untitled task"}
              </span>
              <span className={cn("vault-task-query-meta", overdue && "vault-task-query-meta--overdue")}>
                <TaskPriorityBadge priority={row.priority} /> <TaskRepeatBadge repeat={row.repeat} />
                {row.documentTitle ? <span>{row.documentTitle}</span> : null}
                {row.dueDay ? (
                  <span>
                    {formatDueLabel(row.dueDay, today)}
                    {row.dueTime ? ` ${row.dueTime}` : ""}
                  </span>
                ) : null}
              </span>
            </>
          );

          const linked = linkable && Boolean(row.documentId);

          return (
            <li key={row.key} className="vault-task-query-item" data-linkable={linked ? "true" : undefined}>
              {box}
              {linked ? (
                <a
                  href={`/docs/${row.documentId}`}
                  className="vault-task-query-link"
                  onClick={(event) => {
                    event.preventDefault();
                    requestEditorJump({
                      documentId: row.documentId as string,
                      line: row.line,
                      text: row.rawLine,
                    });
                    // Already on that document: the open editor takes the jump.
                    if (!window.location.pathname.endsWith(`/docs/${row.documentId}`)) {
                      navigateWorkspace(`/docs/${row.documentId}`);
                    }
                  }}
                >
                  {body}
                </a>
              ) : (
                <span className="vault-task-query-link">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > maxRows ? (
        <p className="vault-task-query-empty">{rows.length - maxRows} more not shown.</p>
      ) : null}
    </>
  );
}
