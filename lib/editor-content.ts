import type { JSONContent } from "@tiptap/core";

export type ProseMirrorText = {
  type: "text";
  text: string;
  marks?: JSONContent["marks"];
};

export type ProseMirrorNode = JSONContent;

export type ProseMirrorDoc = JSONContent & {
  type: "doc";
};

export const emptyDocumentContent: ProseMirrorDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function plainTextToDocumentContent(text: string): ProseMirrorDoc {
  const paragraphs = text.split(/\r?\n/).map((line) => {
    const trimmedLine = line.trimEnd();

    if (!trimmedLine) {
      return { type: "paragraph" as const };
    }

    return {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: trimmedLine }],
    };
  });

  return {
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  };
}

export function documentContentToPlainText(content: ProseMirrorDoc): string {
  return (content.content ?? [])
    .map((paragraph) => paragraph.content?.map((node) => node.text ?? "").join("") ?? "")
    .join("\n");
}

export function isProseMirrorDoc(value: unknown): value is ProseMirrorDoc {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { type?: unknown; content?: unknown };

  return (
    candidate.type === "doc" &&
    (candidate.content === undefined || Array.isArray(candidate.content))
  );
}
