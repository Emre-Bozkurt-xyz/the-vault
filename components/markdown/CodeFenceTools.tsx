"use client";

import { useEffect, useRef, useState } from "react";
import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Check, Copy, LoaderCircle, Play, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { survivesInertOutput } from "@/lib/code/jobs";
import { codeLanguageHint, codeLanguages, MAX_CODE_FORMAT_LENGTH, resolveCodeLanguage } from "@/lib/code/languages";
import { formatCodeInWorker } from "@/lib/code/format-client";
import { codeFenceAt, codeLanguageChange, formattedCodeChange, formattedCodeSelection } from "./code-fences";
import {
  codeCapabilitiesField,
  formatCodeOnRunner,
  inputForFence,
  isActiveRun,
  runForFence,
  runUnavailableReason,
  startCodeRun,
  toggleCodeInput,
} from "./code-run";

export function CodeFenceTools({ view, position, onFormatBoundary }: {
  view: EditorView;
  position: number;
  onFormatBoundary: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const say = (text: string, tone: "info" | "error" = "info") => setMessage({ text, tone });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const fence = codeFenceAt(view.state, position);
  if (!fence) return null;
  const language = resolveCodeLanguage(fence.info);
  // Run appears only for a language this user can actually execute, so an
  // account without execution never sees a button that cannot work.
  const capabilities = view.state.field(codeCapabilitiesField, false);
  const offered = capabilities?.enabled
    ? capabilities.languages.find((item) => item.id === language?.id)
    : undefined;
  const runnable = !!offered?.canRun;
  // Prettier languages format in the browser; the native formatters (Ruff,
  // google-java-format, Ormolu, clang-format) only exist on the runner, so
  // they are offered on the same terms as Run.
  const onRunner = !language?.formatter && !!offered?.canFormatOnRunner;
  // A language with no formatter for this user gets no Format button at all,
  // rather than a disabled one and a sentence explaining why.
  const formattable = !!language?.formatter || onRunner;
  const unavailable = fence.formatError
    || (fence.source.length > MAX_CODE_FORMAT_LENGTH ? "This code block is too large to format."
      : onRunner && !survivesInertOutput(fence.source) ? "This code contains control characters, so it cannot be formatted safely."
      : "");
  // An unrecognized hint stays selectable, so opening the menu on a fence this
  // build has no grammar for cannot silently rewrite the author's own word.
  const hint = codeLanguageHint(fence.info);
  const unknown = !language && hint ? hint : "";
  const existing = runForFence(view.state, fence);
  const running = existing ? isActiveRun(existing) : false;
  const runBlocked = runnable ? runUnavailableReason(view.state, fence) : null;
  const inputOpen = !!inputForFence(view.state, fence);
  const format = async () => {
    const snapshot = view.state;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage(null);
    try {
      const formatted = onRunner
        ? await formatCodeOnRunner(view, fence, controller.signal)
        : await formatCodeInWorker(fence.source, fence.info, controller.signal);
      if (controller.signal.aborted || !view.dom.isConnected) return;
      const changes = formattedCodeChange(snapshot, view.state, fence, formatted);
      // Yjs' UndoManager groups by time; close both sides of this explicit edit.
      onFormatBoundary();
      view.dispatch({ changes, selection: formattedCodeSelection(fence, formatted), annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.format")] });
      onFormatBoundary();
      view.focus();
    } catch (error) {
      if (!controller.signal.aborted) say(error instanceof Error ? error.message : "Could not format code.", "error");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return (
    <div className="vault-code-tools" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); view.focus(); }
    }}>
      <div className="vault-code-tools-actions">
        <select
          className="vault-code-language-select"
          aria-label="Code block language"
          value={language?.id ?? unknown}
          onChange={(event) => {
            // Same undo bracketing as Format: one explicit action, one step.
            onFormatBoundary();
            view.dispatch({
              changes: codeLanguageChange(fence, event.target.value),
              annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.language")],
            });
            onFormatBoundary();
            setMessage(null);
            view.focus();
          }}
        >
          <option value="">Plain text</option>
          {unknown ? <option value={unknown}>{unknown}</option> : null}
          {codeLanguages.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <span className="vault-code-tools-divider" aria-hidden="true" />
        {runnable ? (
          <>
            <span title={runBlocked ?? (running ? "This block is already running" : "Run (Ctrl+Enter in Input)")}>
              <Button type="button" variant="ghost" size="xs" disabled={!!runBlocked || running} onClick={() => {
                void startCodeRun(view, fence);
                view.focus();
              }}>
                {running
                  ? <LoaderCircle data-icon="inline-start" className="animate-spin" />
                  : <Play data-icon="inline-start" fill="currentColor" />}
                {running ? "Running" : "Run"}
              </Button>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={inputOpen}
              aria-label={inputOpen ? "Remove input" : "Add input"}
              title={inputOpen ? "Remove the input box and its text" : "Standard input for this program"}
              className={inputOpen ? "bg-muted text-foreground" : "text-muted-foreground"}
              onClick={() => toggleCodeInput(view, fence)}
            >Input</Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(fence.source);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch { say("Could not copy code.", "error"); }
          }}
        >{copied ? <Check /> : <Copy />}</Button>
        {formattable ? (
          <span title={unavailable || (busy ? "Formatting…" : "Format")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={busy ? "Formatting" : "Format code"}
              disabled={busy || !!unavailable}
              onClick={format}
            >{busy ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}</Button>
          </span>
        ) : null}
      </div>
      {message ? (
        <div className="vault-code-tools-message" role="status" data-tone={message.tone}>{message.text}</div>
      ) : null}
    </div>
  );
}
