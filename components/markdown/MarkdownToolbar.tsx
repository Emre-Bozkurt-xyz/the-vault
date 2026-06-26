"use client";

import type { ComponentType, ReactNode, JSX } from "react";
import {
  Bold,
  Braces,
  CheckSquare,
  Code,
  Grid2x2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useKeybindings } from "@/components/shortcuts/KeybindingsProvider";
import { formatBindingForDisplay } from "@/lib/shortcuts/binding";

type MarkdownToolbarProps = {
  onFormat: (format: MarkdownFormat) => void;
  extensionItems?: JSX.Element;
};

const formatShortcutId: Partial<Record<MarkdownFormat, string>> = {
  heading1: "editor.heading1",
  heading2: "editor.heading2",
  heading3: "editor.heading3",
  bold: "editor.bold",
  italic: "editor.italic",
  link: "editor.link",
  inlineCode: "editor.inlineCode",
  bulletList: "editor.bulletList",
  orderedList: "editor.orderedList",
  blockquote: "editor.blockquote",
  codeFence: "editor.codeFence",
  region: "editor.region",
};

export type MarkdownFormat =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "link"
  | "imageUpload"
  | "assetGroup"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "inlineCode"
  | "codeFence"
  | "table"
  | "region"
  | "horizontalRule"
  | "calendar";

export function MarkdownToolbar({ onFormat, extensionItems }: MarkdownToolbarProps) {
  const { bindings, isMac, editorShortcutsEnabled } = useKeybindings();

  const shortcutFor = (format: MarkdownFormat): string | undefined => {
    if (!editorShortcutsEnabled) {
      return undefined;
    }
    const id = formatShortcutId[format];
    const binding = id ? bindings[id] : undefined;
    return binding ? formatBindingForDisplay(binding, isMac) : undefined;
  };

  return (
    <div className="vault-editor-toolbar -mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 py-1 sm:flex-wrap sm:gap-2">
      <ToolbarGroup>
        <ToolbarButton label="Heading 1" shortcut={shortcutFor("heading1")} icon={Heading1} onClick={() => onFormat("heading1")} />
        <ToolbarButton label="Heading 2" shortcut={shortcutFor("heading2")} icon={Heading2} onClick={() => onFormat("heading2")} />
        <ToolbarButton label="Heading 3" shortcut={shortcutFor("heading3")} icon={Heading3} onClick={() => onFormat("heading3")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="Bold" shortcut={shortcutFor("bold")} icon={Bold} onClick={() => onFormat("bold")} />
        <ToolbarButton label="Italic" shortcut={shortcutFor("italic")} icon={Italic} onClick={() => onFormat("italic")} />
        <ToolbarButton label="Link" shortcut={shortcutFor("link")} icon={Link2} onClick={() => onFormat("link")} />
        <ToolbarButton label="Upload image" icon={ImageIcon} onClick={() => onFormat("imageUpload")} />
        <ToolbarButton label="Asset group" icon={Grid2x2} onClick={() => onFormat("assetGroup")} />
        <ToolbarButton label="Inline code" shortcut={shortcutFor("inlineCode")} icon={Code} onClick={() => onFormat("inlineCode")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="Bullet list" shortcut={shortcutFor("bulletList")} icon={List} onClick={() => onFormat("bulletList")} />
        <ToolbarButton label="Ordered list" shortcut={shortcutFor("orderedList")} icon={ListOrdered} onClick={() => onFormat("orderedList")} />
        <ToolbarButton label="Task list" icon={CheckSquare} onClick={() => onFormat("taskList")} />
        <ToolbarButton label="Blockquote" shortcut={shortcutFor("blockquote")} icon={Quote} onClick={() => onFormat("blockquote")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="Code fence" shortcut={shortcutFor("codeFence")} icon={Code} onClick={() => onFormat("codeFence")} />
        <ToolbarButton label="Table" icon={Table2} onClick={() => onFormat("table")} />
        <ToolbarButton label="Vault region" shortcut={shortcutFor("region")} icon={Braces} onClick={() => onFormat("region")} />
        <ToolbarButton label="Horizontal rule" icon={Minus} onClick={() => onFormat("horizontalRule")} />
      </ToolbarGroup>
      {extensionItems}
    </div>
  );
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="button-group"
      className="flex shrink-0 items-center rounded-md border border-border/60 bg-card/35 p-0.5 shadow-sm sm:p-1"
    >
      {children}
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  onClick,
  icon: Icon,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={title}
      aria-label={label}
      onClick={onClick}
      className="size-8 rounded text-muted-foreground transition hover:text-foreground sm:size-9"
    >
      <Icon className="size-4" />
    </Button>
  );
}
