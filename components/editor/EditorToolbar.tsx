"use client";

import type { ComponentType, ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EditorToolbarProps = {
  editor: Editor | null;
};

export function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2">
      <ToolbarGroup>
        <ToolbarButton
          label="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          icon={Heading1}
        />
        <ToolbarButton
          label="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          icon={Heading2}
        />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          icon={Bold}
        />
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          icon={Italic}
        />
        <ToolbarButton
          label="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          icon={Quote}
        />
        <ToolbarButton
          label="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          icon={Code}
        />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          icon={List}
        />
        <ToolbarButton
          label="Ordered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          icon={ListOrdered}
        />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          icon={Undo2}
        />
        <ToolbarButton
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          icon={Redo2}
        />
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
  active = false,
  onClick,
  icon: Icon,
}: {
  label: string;
  active?: boolean;
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
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "text-muted-foreground transition",
        active
          ? "bg-primary/15 text-primary hover:bg-primary/25"
          : "hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
    </Button>
  );
}
