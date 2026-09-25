import { syntaxTree } from "@codemirror/language";
import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { formatDuration, formatJobOutcome } from "@/lib/code/jobs";
import { codeLanguageHint, resolveCodeLanguage } from "@/lib/code/languages";
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
  stdin: string;
  jobId: string | null;
  state: RunState;
  result: CodeJobResult | null;
  runtimeVersion: string | null;
  error: string | null;
};

export type CodeCapabilities = {
  enabled: boolean;
  languages: { id: string; label: string; version: string; canRun: boolean; canFormatOnRunner: boolean }[];
};

/**
 * Standard input for one fence (plan §4.5). Like a run, it belongs to the
 * author's session rather than to the document: it is anchored to the fence's
 * start and mapped through edits, and it never enters Markdown, Yjs or the
 * collaborator's view. An entry existing is what "the input box is open" means.
 */
export type CodeInput = {
  id: string;
  pos: number;
  text: string;
};

const runEffect = StateEffect.define<{ upsert: CodeRun } | { remove: string }>();
const capabilitiesEffect = StateEffect.define<CodeCapabilities>();
const inputEffect = StateEffect.define<
  { open: CodeInput } | { text: { id: string; text: string } } | { remove: string }
>();

/** The document a run is submitted against. Set once per editor. */
const codeDocumentId = Facet.define<string, string>({ combine: (values) => values[0] ?? "" });

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

export const codeInputsField = StateField.define<readonly CodeInput[]>({
  create: () => [],
  update(inputs, tr) {
    let next = inputs;
    if (tr.docChanged) next = next.map((input) => ({ ...input, pos: tr.changes.mapPos(input.pos, 1) }));
    for (const effect of tr.effects) {
      if (!effect.is(inputEffect)) continue;
      const value = effect.value;
      if ("remove" in value) {
        next = next.filter((input) => input.id !== value.remove);
      } else if ("open" in value) {
        next = [...next.filter((input) => input.pos !== value.open.pos), value.open];
      } else {
        // By id, not position: the textarea that sent this was created against
        // an older state, and its fence may have moved since.
        next = next.map((input) => (input.id === value.text.id ? { ...input, text: value.text.text } : input));
      }
    }
    return next;
  },
});

export function runForFence(state: EditorState, fence: CodeFence): CodeRun | undefined {
  return state.field(codeRunsField, false)?.find((run) => run.pos === fence.from);
}

export function inputForFence(state: EditorState, fence: CodeFence): CodeInput | undefined {
  return state.field(codeInputsField, false)?.find((input) => input.pos === fence.from);
}

/** Open the stdin box under a fence and focus it, or close it and discard its text. */
export function toggleCodeInput(view: EditorView, fence: CodeFence): void {
  const existing = inputForFence(view.state, fence);
  if (existing) {
    view.dispatch({ effects: inputEffect.of({ remove: existing.id }) });
    view.focus();
    return;
  }
  const id = crypto.randomUUID();
  view.dispatch({ effects: inputEffect.of({ open: { id, pos: fence.from, text: "" } }) });
  // The widget is drawn on the next frame; focus it once it exists.
  requestAnimationFrame(() => {
    view.dom.querySelector<HTMLTextAreaElement>(`[data-code-input="${id}"] textarea`)?.focus();
  });
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

/**
 * True when something the toolbar draws has changed: which blocks are running,
 * which have an input box open, or what this user can run. Deliberately blind
 * to run progress and to input text, both of which change several times a
 * second and would otherwise remount the toolbar under the pointer.
 */
export function codeToolsStateChanged(before: EditorState, after: EditorState): boolean {
  const key = (state: EditorState) => [
    (state.field(codeRunsField, false) ?? []).filter(isActiveRun).map((run) => run.pos).join(","),
    (state.field(codeInputsField, false) ?? []).map((input) => input.pos).join(","),
  ].join("|");
  return key(before) !== key(after)
    || before.field(codeCapabilitiesField, false) !== after.field(codeCapabilitiesField, false);
}

// ---------------------------------------------------------------------------
// Network. Called from the toolbar with the view it belongs to.
// ---------------------------------------------------------------------------

export async function startCodeRun(view: EditorView, fence: CodeFence): Promise<void> {
  const documentId = view.state.facet(codeDocumentId);
  const run: CodeRun = {
    id: crypto.randomUUID(),
    pos: fence.from,
    source: fence.source,
    // An input box that is not open means no input, not the last text it held.
    stdin: inputForFence(view.state, fence)?.text ?? "",
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
        stdin: run.stdin,
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

const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

/**
 * Format a block with its native formatter on the runner (plan §5): Ruff,
 * google-java-format, Ormolu or clang-format. Same job queue as Run, with
 * `operation: "format"`; a finished job's stdout is the formatted source.
 *
 * Resolves with that source, or rejects with a message fit for the toolbar.
 * The caller revalidates it against the live document before applying it,
 * exactly as it does for the browser formatter. Aborting cancels the job, so
 * a toolbar that goes away does not leave a formatter running for nobody.
 */
export async function formatCodeOnRunner(view: EditorView, fence: CodeFence, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/code/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: view.state.facet(codeDocumentId),
      operation: "format",
      language: fence.info,
      source: fence.source,
      stdin: "",
      requestId: crypto.randomUUID(),
    }),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Could not start formatting.");
  const jobId: string = body.id;

  try {
    for (;;) {
      await delay(JOB_POLL_INTERVAL_MS, signal);
      let status;
      try {
        const poll = await fetch(`/api/code/jobs/${jobId}`, { signal });
        if (poll.status === 404) throw new Error("This format request is no longer available.");
        if (!poll.ok) continue;
        status = await poll.json();
      } catch (error) {
        // A dropped poll is retried; only an abort or a definite answer ends it.
        if (signal.aborted || (error instanceof Error && !(error instanceof TypeError))) throw error;
        continue;
      }
      if (!isTerminalCodeJobState(status.state)) continue;
      const outcome = formatJobOutcome(status);
      if (!outcome.ok) throw new Error(outcome.message);
      return outcome.formatted;
    }
  } catch (error) {
    if (signal.aborted) void fetch(`/api/code/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => {});
    throw error;
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
      const gone = (pos: number) => codeFenceAt(update.state, pos + 1)?.from !== pos;
      const orphans = update.state.field(codeRunsField).filter((run) => gone(run.pos));
      const orphanInputs = update.state.field(codeInputsField).filter((input) => gone(input.pos));
      if (orphans.length || orphanInputs.length) {
        // A deleted fence takes its run and input with it — and stops its
        // polling. A view cannot dispatch from inside an update, so defer.
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.view.dispatch({ effects: [
            ...orphans.map((run) => runEffect.of({ remove: run.id })),
            ...orphanInputs.map((input) => inputEffect.of({ remove: input.id })),
          ] });
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

/**
 * The stdin box. Equality is by id alone, deliberately: typing updates the
 * field on every keystroke, and if that produced an unequal widget CodeMirror
 * would rebuild the DOM and throw the textarea — and its focus and caret —
 * away mid-word. The textarea is therefore the source of truth while it is
 * mounted, and the field only mirrors it for Run to read.
 */
class InputWidget extends WidgetType {
  constructor(private input: CodeInput) {
    super();
  }

  eq(other: InputWidget) {
    return other.input.id === this.input.id;
  }

  toDOM(view: EditorView) {
    const id = this.input.id;
    const root = document.createElement("div");
    root.className = "vault-code-input";
    root.dataset.codeInput = id;

    const header = document.createElement("div");
    header.className = "vault-code-input-header";
    const label = document.createElement("label");
    label.className = "vault-code-input-label";
    label.htmlFor = `vault-code-input-${id}`;
    label.textContent = "Input";
    const hint = document.createElement("span");
    hint.className = "vault-code-input-hint";
    hint.textContent = "stdin · not saved to the document";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vault-code-run-button";
    close.textContent = "Remove";
    close.setAttribute("aria-label", "Remove input");
    close.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ effects: inputEffect.of({ remove: id }) });
      view.focus();
    });
    header.append(label, hint, close);

    const field = document.createElement("textarea");
    field.id = `vault-code-input-${id}`;
    field.className = "vault-code-input-field";
    field.rows = 3;
    field.spellcheck = false;
    field.autocomplete = "off";
    field.placeholder = "Text your program reads from standard input";
    field.value = this.input.text;
    field.addEventListener("input", () => {
      view.dispatch({ effects: inputEffect.of({ text: { id, text: field.value } }) });
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        view.focus();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runFromInput(view, id);
      }
    });
    root.append(header, field);
    return root;
  }

  // Keystrokes, clicks and selection inside the textarea belong to it, not to
  // the editor: without this CodeMirror would treat typing here as document input.
  ignoreEvent() {
    return true;
  }
}

/** Ctrl/Cmd+Enter in an input box runs its block, subject to the usual checks. */
function runFromInput(view: EditorView, inputId: string): void {
  const input = view.state.field(codeInputsField).find((item) => item.id === inputId);
  if (!input) return;
  const fence = codeFenceAt(view.state, input.pos + 1);
  if (!fence || fence.from !== input.pos) return;
  const existing = runForFence(view.state, fence);
  if (existing && isActiveRun(existing)) return;
  if (runUnavailableReason(view.state, fence)) return;
  void startCodeRun(view, fence);
}

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

    const meta = (text: string, title?: string) => {
      const span = document.createElement("span");
      span.className = "vault-code-run-meta";
      span.textContent = text;
      if (title) span.title = title;
      header.append(span);
    };
    if (run.runtimeVersion) meta(run.runtimeVersion);
    const result = run.result;
    if (result && isTerminalCodeJobState(run.state as CodeJobState)) {
      // Wall time per phase as the runner measured it, sandbox start included,
      // so it is what the author waited for rather than CPU time.
      if (result.compileMs !== null) meta(`compiled in ${formatDuration(result.compileMs)}`, "Compile time, including sandbox start");
      if (result.runMs !== null) meta(`ran in ${formatDuration(result.runMs)}`, "Run time, including sandbox start");
      if (result.exitCode !== null && result.exitCode !== 0) meta(`exit ${result.exitCode}`);
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
      note.textContent = "The code or its input has changed since this ran.";
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
  const inputs = state.field(codeInputsField);
  // Input first (side 1), output under it (side 2): the order a reader
  // expects, and the order the program consumed them in.
  for (const input of inputs) {
    const fence = codeFenceAt(state, input.pos + 1);
    if (!fence || fence.from !== input.pos) continue;
    widgets.push(
      Decoration.widget({ widget: new InputWidget(input), block: true, side: 1 })
        .range(state.doc.lineAt(fence.to).to),
    );
  }
  for (const run of state.field(codeRunsField)) {
    const fence = codeFenceAt(state, run.pos + 1);
    if (!fence || fence.from !== run.pos) continue;
    const stdin = inputs.find((input) => input.pos === run.pos)?.text ?? "";
    widgets.push(
      Decoration.widget({
        widget: new RunOutputWidget(run, fence.source !== run.source || stdin !== run.stdin),
        block: true,
        side: 2,
      }).range(state.doc.lineAt(fence.to).to),
    );
  }
  return Decoration.set(widgets, true);
}

// ---------------------------------------------------------------------------
// Idle-block chrome: a language label in the top-right corner and a Run
// button in the bottom-right. Both sit on the fence's own delimiter lines,
// which Live mode hides while the cursor is elsewhere, so they take no extra
// vertical space. Neither is drawn while the cursor is inside the block — the
// toolbar has the same controls then, and the raw delimiters are showing.
// ---------------------------------------------------------------------------

const PLAY_PATH = "M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z";
const STOP_PATH = "M4 3.5A.5.5 0 0 1 4.5 3h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-7Z";

function filledIcon(path: string, offset = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "currentColor");
  if (offset) shape.setAttribute("transform", offset);
  svg.append(shape);
  return svg;
}

class LanguageLabelWidget extends WidgetType {
  constructor(private label: string) {
    super();
  }

  eq(other: LanguageLabelWidget) {
    return other.label === this.label;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "vault-cm-code-label";
    span.textContent = this.label;
    return span;
  }
}

class CornerRunWidget extends WidgetType {
  constructor(private mode: "run" | "stop", private label: string) {
    super();
  }

  eq(other: CornerRunWidget) {
    return other.mode === this.mode && other.label === this.label;
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vault-cm-code-run";
    button.dataset.mode = this.mode;
    const name = this.mode === "run" ? `Run ${this.label} block` : `Stop ${this.label} block`;
    button.setAttribute("aria-label", name);
    button.title = this.mode === "run" ? "Run" : "Stop";
    // The play triangle's visual centre sits left of its box; nudge it.
    button.append(this.mode === "run" ? filledIcon(PLAY_PATH, "translate(0.5 0)") : filledIcon(STOP_PATH, "translate(0 1)"));
    // Keep the cursor where it is: without this the mousedown would move the
    // selection into the block, which removes this very button mid-click.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const fence = codeFenceAt(view.state, view.posAtDOM(button));
      if (!fence) return;
      const run = runForFence(view.state, fence);
      if (run && isActiveRun(run)) {
        void stopCodeRun(view, run);
      } else if (!runUnavailableReason(view.state, fence)) {
        void startCodeRun(view, fence);
      }
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

function chromeDecorations(state: EditorState): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const head = state.selection.main.head;
  const capabilities = state.field(codeCapabilitiesField);
  const seen = new Set<number>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      if (seen.has(node.from)) return false;
      seen.add(node.from);
      const fence = codeFenceAt(state, node.from + 1);
      if (!fence || fence.from !== node.from) return false;
      // The block the cursor is in shows raw delimiters and the toolbar instead.
      if (head >= fence.from && head <= fence.to) return false;
      const language = resolveCodeLanguage(fence.info);
      const opening = state.doc.lineAt(fence.from);
      const label = language?.label ?? codeLanguageHint(fence.info).slice(0, 24);
      if (label) widgets.push(Decoration.widget({ widget: new LanguageLabelWidget(label), side: 1 }).range(opening.to));

      const runnable = capabilities?.enabled
        && capabilities.languages.some((item) => item.id === language?.id && item.canRun);
      // Only a closed, non-empty block gets a button: its closing line is where
      // the button lives, and an empty one has nothing to run.
      if (runnable && fence.closed && fence.source.trim()) {
        const closing = state.doc.lineAt(fence.to);
        if (closing.number !== opening.number) {
          const run = runForFence(state, fence);
          const mode = run && isActiveRun(run) ? "stop" : "run";
          widgets.push(Decoration.widget({ widget: new CornerRunWidget(mode, language!.label), side: 1 }).range(closing.to));
        }
      }
      return false;
    },
  });
  return Decoration.set(widgets, true);
}

export function codeRunExtension(documentId: string): Extension {
  return [
    codeDocumentId.of(documentId),
    codeRunsField,
    codeInputsField,
    codeCapabilitiesField,
    runPoller,
    // Block widgets must come from state, never from a view plugin.
    EditorView.decorations.compute([codeRunsField, codeInputsField, "doc"], outputDecorations),
    EditorView.decorations.compute([codeRunsField, codeCapabilitiesField, "doc", "selection"], chromeDecorations),
  ];
}
