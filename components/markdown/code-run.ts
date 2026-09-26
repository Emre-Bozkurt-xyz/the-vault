import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { highlightDiagnostics } from "@/lib/code/diagnostics";
import { countCompilerWarnings, formatDuration, formatJobOutcome } from "@/lib/code/jobs";
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

/**
 * Compiler output as coloured spans, the way a terminal would show it. Every
 * piece goes in through `textContent`; `highlightDiagnostics` only chooses a
 * class, so output still cannot become markup.
 */
function renderDiagnostics(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  highlightDiagnostics(text).forEach((line, index) => {
    if (index > 0) fragment.append("\n");
    for (const span of line) {
      if (span.kind === "text") {
        fragment.append(span.text);
        continue;
      }
      const element = document.createElement("span");
      element.className = `vault-code-diag-${span.kind}`;
      element.textContent = span.text;
      fragment.append(element);
    }
  });
  return fragment;
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
    // A failed build's diagnostics are the whole story, so they stay open and
    // red. After a successful build they are only advice: collapse them behind
    // an amber "2 warnings" line instead of dressing them up as errors.
    const compiler = run.result?.compilerOutput ?? "";
    if (compiler && run.state === "compile_error") {
      const pre = document.createElement("pre");
      pre.className = "vault-code-run-output vault-code-run-compiler";
      pre.append(renderDiagnostics(compiler));
      root.append(pre);
    } else if (compiler) {
      const warnings = countCompilerWarnings(compiler);
      const details = document.createElement("details");
      details.className = "vault-code-run-diagnostics";
      details.dataset.kind = warnings ? "warning" : "info";
      const summary = document.createElement("summary");
      summary.textContent = warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "Compiler output";
      const pre = document.createElement("pre");
      pre.className = "vault-code-run-diagnostics-body";
      pre.append(renderDiagnostics(compiler));
      details.append(summary, pre);
      root.append(details);
    }
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

const COPY_PATHS = [
  "M8 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z",
  "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
];
const CHECK_PATHS = ["M20 6 9 17l-5-5"];

function strokeIcon(paths: readonly string[]) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * A copy button that reads its text when clicked, not when drawn, so it
 * always copies what the block holds now. Feedback (a check mark) is local to
 * the button: it is not state anything else needs to know about.
 */
function copyButton(className: string, label: string, read: () => string | null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = "Copy";
  button.setAttribute("aria-label", label);
  button.append(strokeIcon(COPY_PATHS));
  // Keep the cursor where it is; a click here is not a click into the text.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = read();
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      button.replaceChildren(strokeIcon(CHECK_PATHS));
      button.title = "Copied";
      button.dataset.copied = "true";
      window.setTimeout(() => {
        button.replaceChildren(strokeIcon(COPY_PATHS));
        button.title = "Copy";
        delete button.dataset.copied;
      }, 1400);
    } catch {
      button.title = "Could not copy";
    }
  });
  return button;
}

/**
 * Top-right of an idle block: the language label, with a copy button stacked
 * in the same spot. Hovering the block swaps one for the other. The swap is a
 * class on the fence's first line rather than a different widget, so this DOM
 * outlives the hover and CSS can animate both directions.
 */
class FenceHeaderWidget extends WidgetType {
  constructor(private label: string) {
    super();
  }

  eq(other: FenceHeaderWidget) {
    return other.label === this.label;
  }

  toDOM(view: EditorView) {
    const header = document.createElement("span");
    header.className = "vault-cm-code-header";
    header.append(copyButton("vault-cm-code-copy", "Copy code", () => {
      return codeFenceAt(view.state, view.posAtDOM(header))?.source ?? null;
    }));
    if (this.label) {
      const span = document.createElement("span");
      span.className = "vault-cm-code-label";
      span.textContent = this.label;
      header.append(span);
    }
    return header;
  }

  ignoreEvent() {
    return true;
  }
}

/** The text between an inline code span's backticks. */
function inlineCodeText(state: EditorState, from: number, to: number): string | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from + 1, 1);
  while (node && node.name !== "InlineCode") node = node.parent;
  if (!node || node.from !== from || node.to !== to) return null;
  const marks = node.getChildren("CodeMark");
  if (marks.length < 2) return null;
  // CommonMark trims one space from each side when both are present.
  const inner = state.sliceDoc(marks[0].to, marks[marks.length - 1].from);
  return /^ .* $/s.test(inner) && inner.trim() ? inner.slice(1, -1) : inner;
}

/**
 * Inline code's copy button. It is placed just before the closing backtick,
 * which puts it inside the chip's mark element, so CSS can pin it to the
 * chip's own right edge with a fade over the text beneath.
 */
class InlineCopyWidget extends WidgetType {
  constructor(private from: number, private to: number) {
    super();
  }

  eq(other: InlineCopyWidget) {
    return other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    return copyButton("vault-cm-inline-copy-button", "Copy inline code", () => {
      const hover = view.state.field(codeHoverField);
      return hover?.kind === "inline" ? inlineCodeText(view.state, hover.from, hover.to) : null;
    });
  }

  ignoreEvent() {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Hover: which code block or inline code span the pointer is over. Tracked in
// state so the copy buttons can be decorations like everything else here;
// updated only when the target changes, never on every mouse move.
// ---------------------------------------------------------------------------

type HoverTarget = { kind: "fence" | "inline"; from: number; to: number };
const hoverEffect = StateEffect.define<HoverTarget | null>();

const codeHoverField = StateField.define<HoverTarget | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(hoverEffect)) return effect.value;
    if (value && tr.docChanged) {
      return { ...value, from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) };
    }
    return value;
  },
});

function hoverTargetAt(state: EditorState, pos: number): HoverTarget | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "InlineCode") return { kind: "inline", from: node.from, to: node.to };
      if (node.name === "FencedCode") return { kind: "fence", from: node.from, to: node.to };
    }
  }
  return null;
}

const sameTarget = (a: HoverTarget | null, b: HoverTarget | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.from === b.from && a.to === b.to);

const hoverTracker = EditorView.domEventHandlers({
  mousemove(event, view) {
    // Never while a button is held: that is a drag-selection in progress.
    if (event.buttons) return false;
    // Approximate on purpose: the empty space right of a short code line is
    // still that block, and should still offer its copy button.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    const target = hoverTargetAt(view.state, pos);
    if (!sameTarget(target, view.state.field(codeHoverField))) {
      view.dispatch({ effects: hoverEffect.of(target) });
    }
    return false;
  },
  mouseleave(_event, view) {
    if (view.state.field(codeHoverField)) view.dispatch({ effects: hoverEffect.of(null) });
    return false;
  },
});

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
  const hover = state.field(codeHoverField);
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
      if (fence.source) {
        widgets.push(Decoration.widget({ widget: new FenceHeaderWidget(label), side: 1 }).range(opening.to));
        if (hover?.kind === "fence" && hover.from === fence.from) {
          widgets.push(Decoration.line({ class: "vault-cm-code-hovered" }).range(opening.from));
        }
      } else if (label) {
        widgets.push(Decoration.widget({ widget: new FenceHeaderWidget(label), side: 1 }).range(opening.to));
      }

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
  // Only a single-backtick span the cursor is not in: that is the form Live
  // mode draws as a chip, and the button needs the chip to sit inside.
  if (
    hover?.kind === "inline"
    && hover.to <= state.doc.length
    && (head < hover.from || head > hover.to)
    && state.sliceDoc(hover.from, hover.from + 2).match(/^`[^`]/)
    && inlineCodeText(state, hover.from, hover.to)
  ) {
    widgets.push(Decoration.widget({ widget: new InlineCopyWidget(hover.from, hover.to), side: -1 }).range(hover.to - 1));
  }
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
    codeHoverField,
    hoverTracker,
    EditorView.decorations.compute([codeRunsField, codeCapabilitiesField, codeHoverField, "doc", "selection"], chromeDecorations),
  ];
}
