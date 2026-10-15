"use client";

import { css as cssLanguage } from "@codemirror/lang-css";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";

const extensions = [cssLanguage(), EditorView.lineWrapping];

/**
 * The snippet CSS editor. A module of its own so `SnippetsSettingsSection` can
 * load CodeMirror only when a snippet is actually being edited.
 */
export function SnippetCssEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <CodeMirror
      value={value}
      height="320px"
      extensions={extensions}
      onChange={onChange}
      theme="dark"
    />
  );
}
