import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/editor-content";

export const maxMarkdownLength = 1_000_000;

export function normalizeStoredMarkdown(
  markdown: string | null | undefined,
  fallbackContent?: ProseMirrorDoc,
) {
  if (markdown && markdown.trim().length > 0) {
    return markdown;
  }

  if (fallbackContent) {
    return proseMirrorToMarkdown(fallbackContent);
  }

  return "";
}

export function proseMirrorToMarkdown(content: ProseMirrorDoc) {
  return (content.content ?? [])
    .map((node) => nodeToMarkdown(node))
    .filter(Boolean)
    .join("\n\n");
}

function nodeToMarkdown(node: ProseMirrorNode): string {
  const children = inlineChildrenToMarkdown(node.content);

  if (node.type === "heading") {
    const level = node.attrs?.level === 1 ? 1 : node.attrs?.level === 2 ? 2 : 3;
    return `${"#".repeat(level)} ${children}`.trim();
  }

  if (node.type === "bulletList") {
    return listChildrenToMarkdown(node.content, "-");
  }

  if (node.type === "orderedList") {
    return listChildrenToMarkdown(node.content, "1.");
  }

  if (node.type === "listItem") {
    return children;
  }

  if (node.type === "blockquote") {
    return children
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (node.type === "codeBlock") {
    return `\`\`\`txt\n${children}\n\`\`\``;
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  return children;
}

function inlineChildrenToMarkdown(children: ProseMirrorNode[] = []) {
  return children.map((child) => inlineNodeToMarkdown(child)).join("");
}

function inlineNodeToMarkdown(node: ProseMirrorNode): string {
  if (node.type !== "text") {
    return nodeToMarkdown(node);
  }

  return applyMarkdownMarks(node.text ?? "", node.marks);
}

function applyMarkdownMarks(
  text: string,
  marks: ProseMirrorNode["marks"] = [],
) {
  return marks.reduce((current, mark) => {
    if (mark.type === "bold") {
      return `**${current}**`;
    }

    if (mark.type === "italic") {
      return `*${current}*`;
    }

    if (mark.type === "code") {
      return `\`${current}\``;
    }

    if (mark.type === "link") {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      return href ? `[${current}](${href})` : current;
    }

    return current;
  }, text);
}

function listChildrenToMarkdown(
  children: ProseMirrorNode[] = [],
  marker: "-" | "1.",
) {
  return children
    .map((child) => {
      const text = nodeToMarkdown(child)
        .split("\n")
        .map((line, index) => (index === 0 ? line : `  ${line}`))
        .join("\n");

      return `${marker} ${text}`.trimEnd();
    })
    .join("\n");
}
