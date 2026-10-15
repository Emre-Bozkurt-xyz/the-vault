"use client";

import { useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";

import { useTaskTargets } from "@/components/tasks/use-task-targets";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runTaskWrite, type TaskTarget } from "@/lib/tasks/task-writes";
import { cn } from "@/lib/utils";

const requestEvent = "vault:move-tasks";

/** Opens the document search for moving `tasks` ("Move to → Other document…"). */
export function requestMoveTasks(tasks: TaskTarget[]) {
  if (typeof window === "undefined" || tasks.length === 0) return;
  window.dispatchEvent(new CustomEvent<TaskTarget[]>(requestEvent, { detail: tasks }));
}

/**
 * Mounted once by the workspace shell while Tasks is on. Any task list can ask
 * for it through `requestMoveTasks`, so moving looks the same everywhere.
 */
export function MoveTasksDialogHost() {
  const [tasks, setTasks] = useState<TaskTarget[] | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      if (event instanceof CustomEvent && Array.isArray(event.detail)) setTasks(event.detail as TaskTarget[]);
    };
    window.addEventListener(requestEvent, onRequest);
    return () => window.removeEventListener(requestEvent, onRequest);
  }, []);

  return (
    <Dialog open={tasks !== null} onOpenChange={(open) => !open && setTasks(null)}>
      <DialogContent className="gap-3 sm:max-w-md">
        {tasks ? <MoveTasksPicker tasks={tasks} onDone={() => setTasks(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveTasksPicker({ tasks, onDone }: { tasks: TaskTarget[]; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useTaskTargets(query);
  const sources = new Set(tasks.map((task) => task.documentId));
  const options = (results ?? []).filter((document) => !(sources.size === 1 && sources.has(document.id)));

  const choose = (index: number) => {
    const document = options[index];
    if (!document) return;
    onDone();
    void runTaskWrite(tasks, { type: "move", targetDocumentId: document.id, targetTitle: document.title });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tasks.length === 1 ? "Move task to…" : `Move ${tasks.length} tasks to…`}</DialogTitle>
        <DialogDescription>
          {tasks.length === 1 ? "It goes" : "They go"} to the end of the document you choose, with notes and subtasks.
        </DialogDescription>
      </DialogHeader>
      <label className="flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2.5 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(active);
            }
          }}
          placeholder="Search your documents"
          aria-label="Search your documents"
          role="combobox"
          aria-expanded="true"
          aria-controls="move-task-targets"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div id="move-task-targets" role="listbox" aria-label="Documents" className="-mx-1 grid max-h-72 gap-0.5 overflow-y-auto">
        {results === null ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Searching…</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No documents of yours match.</p>
        ) : (
          options.map((document, index) => (
            <button
              key={document.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                index === active ? "bg-muted text-foreground" : "text-foreground/90",
              )}
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{document.title || "Untitled document"}</span>
              {document.path ? (
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{document.path}</span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </>
  );
}
