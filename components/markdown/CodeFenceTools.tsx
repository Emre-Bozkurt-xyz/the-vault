"use client";

import { useEffect, useRef, useState } from "react";
import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Copy, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { codeLanguageHint, codeLanguages, MAX_CODE_FORMAT_LENGTH, resolveCodeLanguage } from "@/lib/code/languages";
import { formatCodeInWorker } from "@/lib/code/format-client";
import { codeFenceAt, codeLanguageChange, formattedCodeChange, formattedCodeSelection } from "./code-fences";

export function CodeFenceTools({ view, position, onFormatBoundary }: { view: EditorView; position: number; onFormatBoundary: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const fence = codeFenceAt(view.state, position);
  if (!fence) return null;
  const language = resolveCodeLanguage(fence.info);
  const unavailable = fence.formatError || (!language?.formatter ? "Formatting is not available for this language yet." : fence.source.length > MAX_CODE_FORMAT_LENGTH ? "This code block is too large to format." : "");
  // An unrecognized hint stays selectable, so opening the menu on a fence this
  // build has no grammar for cannot silently rewrite the author's own word.
  const hint = codeLanguageHint(fence.info);
  const unknown = !language && hint ? hint : "";
  return (
    <div className="vault-code-tools" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); view.focus(); }
    }}>
      <div className="vault-code-tools-actions">
        <select
          className="vault-code-language vault-code-language-select"
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
            setMessage("");
            view.focus();
          }}
        >
          <option value="">Plain text</option>
          {unknown ? <option value={unknown}>{unknown}</option> : null}
          {codeLanguages.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <Button type="button" variant="ghost" size="xs" onClick={async () => {
          try { await navigator.clipboard.writeText(fence.source); setMessage("Copied"); }
          catch { setMessage("Could not copy code."); }
        }}><Copy data-icon="inline-start" />Copy</Button>
        <span title={unavailable || "Format this code block"}>
          <Button type="button" variant="ghost" size="xs" disabled={busy || !!unavailable} onClick={async () => {
            const snapshot = view.state;
            pending.current?.abort();
            const controller = new AbortController();
            pending.current = controller;
            setBusy(true);
            setMessage("");
            try {
              const formatted = await formatCodeInWorker(fence.source, fence.info, controller.signal);
              if (controller.signal.aborted || !view.dom.isConnected) return;
              const changes = formattedCodeChange(snapshot, view.state, fence, formatted);
              // Yjs' UndoManager groups by time; close both sides of this explicit edit.
              onFormatBoundary();
              view.dispatch({ changes, selection: formattedCodeSelection(fence, formatted), annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.format")] });
              onFormatBoundary();
              view.focus();
              setMessage("Formatted");
            } catch (error) {
              if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not format code.");
            } finally { if (!controller.signal.aborted) setBusy(false); }
          }}><WandSparkles data-icon="inline-start" />{busy ? "Formatting…" : "Format"}</Button>
        </span>
      </div>
      {unavailable || message ? <div className="vault-code-tools-message" role="status">{message || unavailable}</div> : null}
    </div>
  );
}
