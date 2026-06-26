// The single source of truth for user-facing keyboard shortcuts. The editor
// keymap (components/markdown/MarkdownEditor.tsx), the global shortcut matcher
// (components/shortcuts/KeybindingsProvider.tsx), and the Hotkeys settings
// section all build from this list. Completion/navigation keys (Arrow/Enter/Tab/
// Escape/"#") are editor mechanics and intentionally NOT registered here.

export type ShortcutScope = "editor" | "global";

export type ShortcutDef = {
  /** Stable id, also the key under which a user override is stored. */
  id: string;
  label: string;
  /** Grouping header in settings. */
  category: string;
  scope: ShortcutScope;
  /** CodeMirror-format default chord (e.g. "Mod-Shift-k"). */
  defaultBinding: string;
};

export const shortcuts: ShortcutDef[] = [
  // Global
  {
    id: "global.commandPalette",
    label: "Open command palette",
    category: "Global",
    scope: "global",
    defaultBinding: "Mod-k",
  },

  // Editor — inline formatting
  {
    id: "editor.bold",
    label: "Bold",
    category: "Formatting",
    scope: "editor",
    defaultBinding: "Mod-b",
  },
  {
    id: "editor.italic",
    label: "Italic",
    category: "Formatting",
    scope: "editor",
    defaultBinding: "Mod-i",
  },
  {
    id: "editor.inlineCode",
    label: "Inline code",
    category: "Formatting",
    scope: "editor",
    defaultBinding: "Mod-e",
  },
  {
    id: "editor.link",
    label: "Insert link",
    category: "Formatting",
    scope: "editor",
    defaultBinding: "Mod-Shift-k",
  },

  // Editor — blocks
  {
    id: "editor.heading1",
    label: "Heading 1",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Alt-1",
  },
  {
    id: "editor.heading2",
    label: "Heading 2",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Alt-2",
  },
  {
    id: "editor.heading3",
    label: "Heading 3",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Alt-3",
  },
  {
    id: "editor.bulletList",
    label: "Bullet list",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Shift-8",
  },
  {
    id: "editor.orderedList",
    label: "Numbered list",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Shift-7",
  },
  {
    id: "editor.blockquote",
    label: "Blockquote",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Shift-9",
  },
  {
    id: "editor.codeFence",
    label: "Code block",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Alt-c",
  },
  {
    id: "editor.region",
    label: "Insert region",
    category: "Blocks",
    scope: "editor",
    defaultBinding: "Mod-Alt-r",
  },
];

const shortcutById = new Map(shortcuts.map((def) => [def.id, def]));

export function getShortcut(id: string): ShortcutDef | undefined {
  return shortcutById.get(id);
}

export function shortcutsByScope(scope: ShortcutScope): ShortcutDef[] {
  return shortcuts.filter((def) => def.scope === scope);
}

export function isShortcutId(id: string): boolean {
  return shortcutById.has(id);
}
