"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
} from "lucide-react";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDocumentExtensionState } from "@/components/extensions/use-document-extension-state";
import {
  calendarStateSchema,
  type CalendarEntry,
  type CalendarState,
} from "@/lib/extensions/catalog";
import {
  addMonths,
  calendarStateKey,
  currentMonth,
  formatMonthLabel,
  generateCalendarId,
  getMonthMatrix,
  todayDayKey,
  weekdayLabels,
  type CalendarMonth,
  type CalendarWeekStart,
} from "@/lib/calendar";
import type {
  ExtensionStateValue,
  ExtensionStateVisibility,
} from "@/lib/extensions/types";
import type { AssetEmbedResolutionMap } from "@/lib/asset-embeds";
import type { WikiLinkResolutionMap } from "@/lib/wiki-links";
import { cn } from "@/lib/utils";

type EntryWithId = CalendarEntry & { id: string };

type CalendarBlockProps = {
  documentId: string;
  calendarId: string | null;
  canEdit: boolean;
  weekStartsOn?: CalendarWeekStart;
  visibility?: ExtensionStateVisibility;
  /**
   * Server-prefetched state for public/SSR surfaces where the auth-gated state
   * action can't be called. When provided, the widget renders from it and does
   * not fetch.
   */
  prefetchedState?: CalendarState | null;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
};

const emptyCalendarState: CalendarState = { entries: {}, expanded: false };

function readCalendarState(
  state: Record<string, ExtensionStateValue> | null,
): CalendarState {
  const parsed = calendarStateSchema.safeParse(state ?? {});
  return parsed.success ? parsed.data : emptyCalendarState;
}

function compareEntries(a: EntryWithId, b: EntryWithId): number {
  const at = a.time ?? null;
  const bt = b.time ?? null;
  if (at && bt) return at.localeCompare(bt) || a.order - b.order;
  if (at) return -1;
  if (bt) return 1;
  return a.order - b.order || a.text.localeCompare(b.text);
}

export function CalendarBlock({
  documentId,
  calendarId,
  canEdit,
  weekStartsOn = 0,
  visibility = "private",
  prefetchedState,
  wikiLinks,
  assetLinks,
}: CalendarBlockProps) {
  const hasId = Boolean(calendarId);
  const usePrefetched = prefetchedState !== undefined;
  const stateKey = hasId ? calendarStateKey(calendarId as string) : undefined;
  const { state, setState } = useDocumentExtensionState({
    documentId,
    extensionId: "vault.calendar",
    stateKey,
    version: 1,
    visibility,
    // Public/SSR: seed from the prefetched state and never fetch or save.
    // Otherwise load read access for everyone with `hasId`; saves are gated on
    // canEdit in the UI, so read-only viewers fetch but can't mutate.
    initialState:
      usePrefetched && stateKey
        ? {
            extensionId: "vault.calendar",
            stateKey,
            state: (prefetchedState ?? {}) as Record<string, ExtensionStateValue>,
            version: 1,
            visibility,
            updatedAt: new Date().toISOString(),
          }
        : undefined,
    disabled: usePrefetched || !hasId,
  });

  const calendarState = useMemo(() => readCalendarState(state), [state]);
  const [viewMonth, setViewMonth] = useState<CalendarMonth>(() => currentMonth());
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const todayKey = useMemo(() => todayDayKey(), []);

  const weeks = useMemo(
    () => getMonthMatrix(viewMonth, weekStartsOn, todayKey),
    [viewMonth, weekStartsOn, todayKey],
  );
  const weekdays = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, EntryWithId[]>();
    for (const [id, entry] of Object.entries(calendarState.entries)) {
      const list = map.get(entry.day);
      const withId = { ...entry, id };
      if (list) {
        list.push(withId);
      } else {
        map.set(entry.day, [withId]);
      }
    }
    for (const list of map.values()) {
      list.sort(compareEntries);
    }
    return map;
  }, [calendarState.entries]);

  const update = useCallback(
    (mutate: (draft: CalendarState) => CalendarState) => {
      if (!canEdit) return;
      const next = mutate(calendarState);
      setState(next as unknown as Record<string, ExtensionStateValue>);
    },
    [calendarState, setState, canEdit],
  );

  const toggleTask = useCallback(
    (entryId: string) => {
      update((draft) => {
        const entry = draft.entries[entryId];
        if (!entry || entry.type !== "task") return draft;
        return {
          ...draft,
          entries: {
            ...draft.entries,
            [entryId]: { ...entry, done: !entry.done },
          },
        };
      });
    },
    [update],
  );

  // Expand is a transient "focus mode" overlay, not persisted layout: an inline
  // breakout gets clipped by the editor's overflow, so we portal a full-viewport
  // view instead.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const editingEntries = editingDay ? (entriesByDay.get(editingDay) ?? []) : [];

  const calendarBody = (
    <>
      <div className="vault-calendar-toolbar">
        <div className="vault-calendar-title">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span>{formatMonthLabel(viewMonth)}</span>
        </div>
        <div className="vault-calendar-controls">
          <button
            type="button"
            className="vault-calendar-btn"
            aria-label="Previous month"
            onClick={() => setViewMonth((month) => addMonths(month, -1))}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="vault-calendar-btn vault-calendar-btn--text"
            onClick={() => setViewMonth(currentMonth())}
          >
            Today
          </button>
          <button
            type="button"
            className="vault-calendar-btn"
            aria-label="Next month"
            onClick={() => setViewMonth((month) => addMonths(month, 1))}
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            className="vault-calendar-btn"
            aria-label={expanded ? "Collapse calendar" : "Expand calendar"}
            title={expanded ? "Fit to document" : "Expand"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
        </div>
      </div>

      {!hasId ? (
        <div className="vault-calendar-notice">
          This calendar has no id yet, so it can&apos;t store entries. Replace the
          line with <code>:::calendar{"{id=…}"}</code> or use Insert calendar.
        </div>
      ) : null}

      <div className="vault-calendar-weekdays">
        {weekdays.map((label) => (
          <div key={label} className="vault-calendar-weekday">
            {label}
          </div>
        ))}
      </div>

      <div className="vault-calendar-grid">
        {weeks.map((week) => (
          <div key={week[0]?.dayKey} className="vault-calendar-week">
            {week.map((cell) => {
              const dayEntries = entriesByDay.get(cell.dayKey) ?? [];
              return (
                <div
                  key={cell.dayKey}
                  className={cn(
                    "vault-calendar-cell",
                    !cell.inMonth && "vault-calendar-cell--muted",
                    cell.isToday && "vault-calendar-cell--today",
                  )}
                >
                  <div className="vault-calendar-cell-head">
                    <span className="vault-calendar-daynum">{cell.day}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        className="vault-calendar-add"
                        aria-label={`Add to ${cell.dayKey}`}
                        title="Add task or event"
                        onClick={() => setEditingDay(cell.dayKey)}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <div className="vault-calendar-entries">
                    {dayEntries.map((entry) => (
                      <CalendarCellEntry
                        key={entry.id}
                        entry={entry}
                        canEdit={canEdit}
                        wikiLinks={wikiLinks}
                        assetLinks={assetLinks}
                        onToggle={() => toggleTask(entry.id)}
                        onOpen={() => setEditingDay(cell.dayKey)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

    </>
  );

  return (
    <>
      {expanded ? (
        <div className="vault-calendar-stub">
          <CalendarDays className="size-4 shrink-0" />
          <span className="vault-calendar-stub-label">
            {formatMonthLabel(viewMonth)} — expanded view
          </span>
          <button
            type="button"
            className="vault-calendar-btn vault-calendar-btn--text"
            onClick={() => setExpanded(false)}
          >
            Collapse
          </button>
        </div>
      ) : (
        <div
          className="vault-calendar"
          data-calendar-id={calendarId ?? undefined}
        >
          {calendarBody}
        </div>
      )}

      {expanded
        ? createPortal(
            <div
              className="vault-calendar-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Expanded calendar"
            >
              <button
                type="button"
                className="vault-calendar-overlay-backdrop"
                aria-label="Close expanded calendar"
                onClick={() => setExpanded(false)}
              />
              <div className="vault-calendar vault-calendar--expanded vault-calendar-overlay-panel">
                {calendarBody}
              </div>
            </div>,
            document.body,
          )
        : null}

      {canEdit ? (
        <CalendarDayDialog
          dayKey={editingDay}
          entries={editingEntries}
          wikiLinks={wikiLinks}
          assetLinks={assetLinks}
          onClose={() => setEditingDay(null)}
          onChange={update}
        />
      ) : null}
    </>
  );
}

function CalendarCellEntry({
  entry,
  canEdit,
  wikiLinks,
  assetLinks,
  onToggle,
  onOpen,
}: {
  entry: EntryWithId;
  canEdit: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const isTask = entry.type === "task";
  const text = entry.text.trim();

  return (
    <div
      className={cn(
        "vault-calendar-entry",
        `vault-calendar-entry--${entry.type}`,
        isTask && entry.done && "vault-calendar-entry--done",
      )}
    >
      {isTask ? (
        <button
          type="button"
          className="vault-calendar-check"
          role="checkbox"
          aria-checked={Boolean(entry.done)}
          aria-label={entry.done ? "Mark incomplete" : "Mark complete"}
          disabled={!canEdit}
          onClick={onToggle}
        >
          {entry.done ? <Check className="size-3" /> : null}
        </button>
      ) : entry.time ? (
        <span className="vault-calendar-entry-time">
          <Clock className="size-3 shrink-0" />
          {entry.time}
        </span>
      ) : null}
      <button
        type="button"
        className="vault-calendar-entry-text"
        onClick={onOpen}
        disabled={!canEdit}
      >
        {text ? (
          <MarkdownDocument
            markdown={text}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            contained={false}
            className="vault-calendar-entry-md"
          />
        ) : (
          <span className="vault-calendar-entry-empty">Untitled</span>
        )}
      </button>
    </div>
  );
}

function CalendarDayDialog({
  dayKey,
  entries,
  wikiLinks,
  assetLinks,
  onClose,
  onChange,
}: {
  dayKey: string | null;
  entries: EntryWithId[];
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  onClose: () => void;
  onChange: (mutate: (draft: CalendarState) => CalendarState) => void;
}) {
  const addEntry = (type: CalendarEntry["type"]) => {
    if (!dayKey) return;
    const id = generateCalendarId();
    onChange((draft) => {
      const order =
        Object.values(draft.entries)
          .filter((entry) => entry.day === dayKey)
          .reduce((max, entry) => Math.max(max, entry.order), -1) + 1;
      const entry: CalendarEntry = {
        type,
        day: dayKey,
        text: "",
        order,
        ...(type === "task" ? { done: false } : {}),
      };
      return { ...draft, entries: { ...draft.entries, [id]: entry } };
    });
  };

  const patchEntry = (id: string, patch: Partial<CalendarEntry>) => {
    onChange((draft) => {
      const entry = draft.entries[id];
      if (!entry) return draft;
      return {
        ...draft,
        entries: { ...draft.entries, [id]: { ...entry, ...patch } },
      };
    });
  };

  const removeEntry = (id: string) => {
    onChange((draft) => {
      const next = { ...draft.entries };
      delete next[id];
      return { ...draft, entries: next };
    });
  };

  return (
    <Dialog open={dayKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dayKey ? formatLongDay(dayKey) : ""}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
          {entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No tasks or events yet.
            </p>
          ) : (
            entries.map((entry) => (
              <CalendarEntryEditor
                key={entry.id}
                entry={entry}
                wikiLinks={wikiLinks}
                assetLinks={assetLinks}
                onPatch={(patch) => patchEntry(entry.id, patch)}
                onRemove={() => removeEntry(entry.id)}
              />
            ))
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="vault-calendar-dialog-add"
            onClick={() => addEntry("task")}
          >
            <Plus className="size-3.5" /> Task
          </button>
          <button
            type="button"
            className="vault-calendar-dialog-add"
            onClick={() => addEntry("event")}
          >
            <Plus className="size-3.5" /> Event
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CalendarEntryEditor({
  entry,
  wikiLinks,
  assetLinks,
  onPatch,
  onRemove,
}: {
  entry: EntryWithId;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  onPatch: (patch: Partial<CalendarEntry>) => void;
  onRemove: () => void;
}) {
  const isTask = entry.type === "task";

  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-2.5">
      <div className="flex items-start gap-2">
        {isTask ? (
          <button
            type="button"
            className="vault-calendar-check mt-1"
            role="checkbox"
            aria-checked={Boolean(entry.done)}
            aria-label={entry.done ? "Mark incomplete" : "Mark complete"}
            onClick={() => onPatch({ done: !entry.done })}
          >
            {entry.done ? <Check className="size-3" /> : null}
          </button>
        ) : (
          <input
            type="time"
            value={entry.time ?? ""}
            aria-label="Start time"
            className="mt-0.5 w-[6.5rem] rounded-md border border-border/70 bg-background px-2 py-1 text-xs"
            onChange={(event) =>
              onPatch({ time: event.target.value || undefined })
            }
          />
        )}
        <input
          type="text"
          value={entry.text}
          autoFocus={entry.text === ""}
          placeholder={isTask ? "Task — supports [[doc links]]" : "Event title"}
          className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 py-1 text-sm"
          onChange={(event) => onPatch({ text: event.target.value })}
        />
        <button
          type="button"
          className="vault-calendar-icon-btn mt-0.5"
          aria-label="Delete entry"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <textarea
        value={entry.note ?? ""}
        placeholder="Notes (optional)"
        rows={entry.note ? 2 : 1}
        className="mt-2 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground"
        onChange={(event) => onPatch({ note: event.target.value || undefined })}
      />
      {entry.text.trim() ? (
        <div className="vault-calendar-entry-preview mt-1.5">
          <MarkdownDocument
            markdown={entry.text}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            contained={false}
            className="vault-calendar-entry-md"
          />
        </div>
      ) : null}
    </div>
  );
}

const longDayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatLongDay(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;
  // Construct in UTC and format in UTC so the label matches the day key exactly.
  return longDayFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}
