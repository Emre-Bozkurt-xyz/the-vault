import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { resolveCodeLanguage } from "@/lib/code/languages";
import {
  codeJobStateMessage,
  isTerminalCodeJobState,
  JOB_POLL_INTERVAL_MS,
  type CodeJobResult,
  type CodeJobState,
} from "@/lib/config/code-execution";
import { codeFenceAt, type CodeFence } from "./code-fences";

/**
 * Run/Stop for code fences (plan §4.5, slice 4).
 *
 * A run cannot live in the code toolbar: that is a CodeMirror tooltip, rebuilt
 * on every keystroke and cursor move, so any state in it would vanish the
 * moment the author typed. Runs live in a StateField instead, anchored to the
 * fence's start position and mapped through every change — local or arriving
 * over Yjs — so a run follows its block rather than being tied to an ordinal
 * index (which plan §4 forbids). Output renders as a block widget below the
 * fence, in plain DOM through `textContent`, so output cannot become markup.
 */

type ClientState = "submitting" | "rejected";
export type RunState = CodeJobState | ClientState;

export type CodeRun = {
  /** Client id. Also the job's requestId, so a retried POST is deduplicated. */
  id: string;
  /** Start of the fence, mapped through edits. */
  pos: number;
  /** Exactly what was submitted, for the stale check. */
  source: string;
  jobId: string | null;
  state: RunState;
  result: CodeJobResult | null;
  runtimeVersion: string | null;
  error: string | null;
};

export type CodeCapabilities = {
  enabled: boolean;
  languages: { id: string; label: string; version: string; canRun: boolean }[];
};

const runEffect = StateEffect.define<{ upsert: CodeRun } | { remove: string }>();
const capabilitiesEffect = StateEffect.define<CodeCapabilities>();

export function isActiveRun(run: CodeRun): boolean {
  return run.state === "submitting" || (run.state !== "rejected" && !isTerminalCodeJobState(run.state));
}

export const codeRunsField = StateField.define<readonly CodeRun[]>({
  create: () => [],
  update(runs, tr) {
    let next = runs;
    // Only map here. A run whose fence was deleted is pruned by the view
    // plugin instead, because pruning also cancels the job over the network —
    // a side effect a field update must stay free of.
    if (tr.docChanged) next = next.map((run) => ({ ...run, pos: tr.changes.mapPos(run.pos, 1) }));
    for (const effect of tr.effects) {
      if (!effect.is(runEffect)) continue;
      if ("remove" in effect.value) {
        const id = effect.value.remove;
        next = next.filter((run) => run.id !== id);
      } else {
        const run = effect.value.upsert;
        // One run per fence: a new run replaces whatever the block showed before.
        next = [...next.filter((other) => other.id !== run.id && other.pos !== run.pos), run];
      }
    }
    return next;
  },
});

export const codeCapabilitiesField = StateField.define<CodeCapabilities | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(capabilitiesEffect)) return effect.value;
    return value;
  },
});

export function runForFence(state: EditorState, fence: CodeFence): CodeRun | undefined {
  return state.field(codeRunsField, false)?.find((run) => run.pos === fence.from);
}

/** Why Run is unavailable for this fence, or null when it can run. */
export function runUnavailableReason(state: EditorState, fence: CodeFence): string | null {
  const capabilities = state.field(codeCapabilitiesField, false);
  if (!capabilities?.enabled) return "Running code is not enabled.";
  const languageId = resolveCodeLanguage(fence.info)?.id;
  if (!capabilities.languages.some((language) => language.id === languageId && language.canRun)) {
    return "Running is not available for this language yet.";
  }
  if (!fence.closed) return "Close this code fence before running it.";
  if (!fence.source.trim()) return "There is no code to run.";
  return null;
}

/** True when the set of active runs differs — the only change the toolbar cares about. */
export function activeRunsChanged(before: EditorState, after: EditorState): boolean {
  const key = (state: EditorState) =>
    (state.field(codeRunsField, false) ?? []).filter(isActiveRun).map((run) => run.pos).join(",");
  return key(before) !== key(after)
    || before.field(codeCapabilitiesField, false) !== after.field(codeCapabilitiesField, false);
}

// ---------------------------------------------------------------------------
// Network. Called from the toolbar with the view it belongs to.
// ---------------------------------------------------------------------------

export async function startCodeRun(view: EditorView, documentId: string, fence: CodeFence): Promise<void> {
  const run: CodeRun = {
    id: crypto.randomUUID(),
    pos: fence.from,
    source: fence.source,
    jobId: null,
    state: "submitting",
    result: null,
    runtimeVersion: null,
    error: null,
  };
  view.dispatch({ effects: runEffect.of({ upsert: run }) });

  const update = (patch: Partial<CodeRun>) => {
    // The fence may have moved (or gone) while the request was in flight.
    const current = view.state.field(codeRunsField).find((other) => other.id === run.id);
    if (current) view.dispatch({ effects: runEffect.of({ upsert: { ...current, ...patch } }) });
  };

  try {
    const response = await fetch("/api/code/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId,
        operation: "run",
        language: fence.info,
        source: fence.source,
        stdin: "",
        requestId: run.id,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      update({ state: "rejected", error: body?.error ?? "Could not start this run." });
      return;
    }
    update({ jobId: body.id, state: "queued" });
  } catch {
    update({ state: "rejected", error: "Could not reach Vault. Check your connection and try again." });
  }
}

async function stopCodeRun(view: EditorView, run: CodeRun): Promise<void> {
  if (!run.jobId) return;
  await fetch(`/api/code/jobs/${run.jobId}/cancel`, { method: "POST" }).catch(() => {});
  // Polling picks up the terminal state; nothing to dispatch here.
  void view;
}

function dismissCodeRun(view: EditorView, run: CodeRun): void {
  view.dispatch({ effects: runEffect.of({ remove: run.id }) });
}

/**
 * Fetches capabilities once, then polls every active run. Polling is the
 * slice 4 transport; plan §9.5 leaves streaming as a later optimization.
 */
const runPoller = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = new Set<string>();
  private destroyed = false;

  constructor(private view: EditorView) {
    void this.loadCapabilities();
  }

  private async loadCapabilities() {
    const capabilities = await fetch("/api/code/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    if (!this.destroyed && capabilities) {
      this.view.dispatch({ effects: capabilitiesEffect.of(capabilities as CodeCapabilities) });
    }
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      const orphans = update.state.field(codeRunsField)
        .filter((run) => codeFenceAt(update.state, run.pos + 1)?.from !== run.pos);
      if (orphans.length) {
        // A deleted fence takes its run with it — and stops its polling. A view
        // cannot dispatch from inside an update, so defer by a microtask.
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.view.dispatch({ effects: orphans.map((run) => runEffect.of({ remove: run.id })) });
          // Removing the run removes its Stop button and its only place to
          // show output, so an in-flight job is cancelled rather than left to
          // burn its sandbox's time for a result nobody can see.
          for (const run of orphans) if (isActiveRun(run)) void stopCodeRun(this.view, run);
        });
      }
    }
    const needsPolling = this.view.state.field(codeRunsField).some((run) => run.jobId && isActiveRun(run));
    if (needsPolling && !this.timer) {
      this.timer = setInterval(() => void this.poll(), JOB_POLL_INTERVAL_MS);
    } else if (!needsPolling && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll() {
    for (const run of this.view.state.field(codeRunsField)) {
      if (!run.jobId || !isActiveRun(run) || this.inflight.has(run.id)) continue;
      this.inflight.add(run.id);
      try {
        const response = await fetch(`/api/code/jobs/${run.jobId}`);
        if (this.destroyed) return;
        if (response.status === 404) {
          // Expired, revoked, or no longer ours. Stop polling and say so.
          this.patch(run.id, { state: "rejected", error: "This result is no longer available." });
          continue;
        }
        if (!response.ok) continue;
        const status = await response.json();
        this.patch(run.id, {
          state: status.state,
          result: status.result,
          runtimeVersion: status.runtimeVersion,
        });
      } catch {
        // Transient; the next tick retries.
      } finally {
        this.inflight.delete(run.id);
      }
    }
  }

  private patch(id: string, patch: Partial<CodeRun>) {
    const current = this.view.state.field(codeRunsField).find((run) => run.id === id);
    if (!current) return;
    if (current.state === patch.state && current.result === patch.result) return;
    this.view.dispatch({ effects: runEffect.of({ upsert: { ...current, ...patch } }) });
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
  }
});

// ---------------------------------------------------------------------------
// Output panel
// ---------------------------------------------------------------------------

class RunOutputWidget extends WidgetType {
  constructor(private run: CodeRun, private stale: boolean) {
    super();
  }

  eq(other: RunOutputWidget) {
    return other.run.id === this.run.id
      && other.run.state === this.run.state
      && other.run.result === this.run.result
      && other.run.error === this.run.error
      && other.stale === this.stale;
  }

  toDOM(view: EditorView) {
    const run = this.run;
    const root = document.createElement("div");
    root.className = "vault-code-run";
    root.dataset.state = run.state;
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Code output");

    const header = document.createElement("div");
    header.className = "vault-code-run-header";
    const status = document.createElement("span");
    status.className = "vault-code-run-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = run.state === "submitting" ? "Submitting"
      : run.state === "rejected" ? "Not run"
      : codeJobStateMessage(run.state);
    header.append(status);

    if (run.runtimeVersion) {
      const version = document.createElement("span");
      version.className = "vault-code-run-meta";
      version.textContent = run.runtimeVersion;
      header.append(version);
    }
    if (run.result?.exitCode !== null && run.result?.exitCode !== undefined && isTerminalCodeJobState(run.state as CodeJobState)) {
      const code = document.createElement("span");
      code.className = "vault-code-run-meta";
      code.textContent = `exit ${run.result.exitCode}`;
      header.append(code);
    }

    const actions = document.createElement("span");
    actions.className = "vault-code-run-actions";
    const button = (label: string, onClick: () => void) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "vault-code-run-button";
      element.textContent = label;
      element.addEventListener("click", (event) => {
        event.preventDefault();
        onClick();
      });
      return element;
    };
    if (isActiveRun(run) && run.jobId) actions.append(button("Stop", () => void stopCodeRun(view, run)));
    if (!isActiveRun(run)) actions.append(button("Dismiss", () => dismissCodeRun(view, run)));
    header.append(actions);
    root.append(header);

    if (this.stale && !isActiveRun(run)) {
      const note = document.createElement("div");
      note.className = "vault-code-run-note";
      note.textContent = "The code has changed since this ran.";
      root.append(note);
    }

    const block = (text: string, kind: string) => {
      if (!text) return;
      const pre = document.createElement("pre");
      pre.className = `vault-code-run-output vault-code-run-${kind}`;
      // textContent, never innerHTML: output is inert text by construction.
      pre.textContent = text;
      root.append(pre);
    };
    if (run.error) block(run.error, "stderr");
    block(run.result?.compilerOutput ?? "", "compiler");
    block(run.result?.stdout ?? "", "stdout");
    block(run.result?.stderr ?? "", "stderr");

    if (run.result?.truncated) {
      const note = document.createElement("div");
      note.className = "vault-code-run-note";
      note.textContent = "Output was cut off at the size limit.";
      root.append(note);
    }
    if (run.state === "succeeded" && !run.result?.stdout && !run.result?.stderr) {
      const note = document.createElement("div");
      note.className = "vault-code-run-note";
      note.textContent = "Finished with no output.";
      root.append(note);
    }
    return root;
  }

  // Let clicks reach the Stop and Dismiss buttons instead of moving the cursor.
  ignoreEvent() {
    return true;
  }
}

function outputDecorations(state: EditorState): DecorationSet {
  const widgets = [];
  for (const run of state.field(codeRunsField)) {
    const fence = codeFenceAt(state, run.pos + 1);
    if (!fence || fence.from !== run.pos) continue;
    const at = state.doc.lineAt(fence.to).to;
    widgets.push(
      Decoration.widget({
        widget: new RunOutputWidget(run, fence.source !== run.source),
        block: true,
        side: 1,
      }).range(at),
    );
  }
  return Decoration.set(widgets, true);
}

export function codeRunExtension(): Extension {
  return [
    codeRunsField,
    codeCapabilitiesField,
    runPoller,
    // Block widgets must come from state, never from a view plugin.
    EditorView.decorations.compute([codeRunsField, "doc"], outputDecorations),
  ];
}
