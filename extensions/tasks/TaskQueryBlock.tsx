"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ListChecks } from "lucide-react";

import {
  TaskPriorityBadge,
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
    />
  );
}

function TaskQueryBlock({
  query,
  documentMarkdown,
  documentId,
  publicSurface,
}: {
  query: TaskQuery;
  /** The whole document's Markdown, for `scope=doc`. */
  documentMarkdown: string | null;
  documentId?: string;
  /** A public page: `scope=all` must not fetch, and rows do not link. */
  publicSurface: boolean;
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
    />
  );
}

function DocumentTasks({
  query,
  today,
  markdown,
  documentId,
  linkable,
}: {
  query: TaskQuery;
  today: string | null;
  markdown: string;
  documentId?: string;
  linkable: boolean;
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
      }));
  }, [markdown, query, today, documentId]);

  return (
    <Frame query={query}>
      <Rows rows={rows} today={today} linkable={linkable && Boolean(documentId)} />
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
      }));
  }, [result, query, today]);

  return (
    <Frame query={query}>
      {result === null ? (
        <p className="vault-task-query-empty">Loading…</p>
      ) : !result.ok ? (
        <p className="vault-task-query-empty">{result.error}</p>
      ) : (
        <Rows rows={rows} today={today} linkable />
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

function Rows({ rows, today, linkable }: { rows: Row[]; today: string | null; linkable: boolean }) {
  if (!today) return <p className="vault-task-query-empty">Loading…</p>;
  if (rows.length === 0) return <p className="vault-task-query-empty">Nothing here.</p>;

  const shown = rows.slice(0, maxRows);

  return (
    <>
      <ul className="vault-task-query-list">
        {shown.map((row) => {
          const overdue = row.status !== "done" && row.dueDay !== null && row.dueDay < today;
          const body = (
            <>
              <span className="vault-task-box" data-status={row.status} data-overdue={overdue ? "true" : undefined} />
              <span
                className={cn(
                  "vault-task-query-text",
                  (row.status === "done" || row.status === "cancelled") && "vault-task-query-text--closed",
                )}
              >
                {plainTaskText(row.text) || "Untitled task"}
              </span>
              <span className={cn("vault-task-query-meta", overdue && "vault-task-query-meta--overdue")}>
                <TaskPriorityBadge priority={row.priority} />
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

          return (
            <li key={row.key}>
              {linkable && row.documentId ? (
                <a
                  href={`/docs/${row.documentId}`}
                  className="vault-task-query-item"
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
                <span className="vault-task-query-item">{body}</span>
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
