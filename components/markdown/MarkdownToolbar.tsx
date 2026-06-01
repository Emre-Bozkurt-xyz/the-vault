"use client";

import type { ComponentType, ReactNode } from "react";
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type MarkdownToolbarProps = {
  onFormat: (format: MarkdownFormat) => void;
};

export type MarkdownFormat =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "link"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "inlineCode"
  | "codeFence"
  | "table"
  | "horizontalRule";

export function MarkdownToolbar({ onFormat }: MarkdownToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2">
      <ToolbarGroup>
        <ToolbarButton label="Heading 1" icon={Heading1} onClick={() => onFormat("heading1")} />
        <ToolbarButton label="Heading 2" icon={Heading2} onClick={() => onFormat("heading2")} />
        <ToolbarButton label="Heading 3" icon={Heading3} onClick={() => onFormat("heading3")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="Bold" icon={Bold} onClick={() => onFormat("bold")} />
        <ToolbarButton label="Italic" icon={Italic} onClick={() => onFormat("italic")} />
        <ToolbarButton label="Link" icon={Link2} onClick={() => onFormat("link")} />
        <ToolbarButton label="Inline code" icon={Code} onClick={() => onFormat("inlineCode")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="Bullet list" icon={List} onClick={() => onFormat("bulletList")} />
        <ToolbarButton label="Ordered list" icon={ListOrdered} onClick={() => onFormat("orderedList")} />
        <ToolbarButton label="Task list" icon={CheckSquare} onClick={() => onFormat("taskList")} />
        <ToolbarButton label="Blockquote" icon={Quote} onClick={() => onFormat("blockquote")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="Code fence" icon={Code} onClick={() => onFormat("codeFence")} />
        <ToolbarButton label="Table" icon={Table2} onClick={() => onFormat("table")} />
        <ToolbarButton label="Horizontal rule" icon={Minus} onClick={() => onFormat("horizontalRule")} />
      </ToolbarGroup>
    </div>
  );
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="button-group"
      className="flex items-center rounded-full border border-border/70 bg-background/70 p-1 shadow-sm"
    >
      {children}
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground transition hover:text-foreground"
    >
      <Icon className="size-4" />
    </Button>
  );
}
