import type { ReactNode } from "react";

import type { ProseMirrorDoc, ProseMirrorNode } from "@/lib/editor-content";

export function ReadOnlyDocument({ content }: { content: ProseMirrorDoc }) {
  return (
    <div className="vault-editor-content vault-readonly mx-auto max-w-3xl">
      {(content.content ?? []).map((node, index) => (
        <NodeRenderer key={index} node={node} />
      ))}
    </div>
  );
}

function NodeRenderer({ node }: { node: ProseMirrorNode }) {
  const children = node.content?.map((child, index) => (
    <NodeRenderer key={index} node={child} />
  ));

  if (node.type === "text") {
    return <>{applyMarks(node.text ?? "", node.marks)}</>;
  }

  if (node.type === "heading") {
    const level = node.attrs?.level === 1 ? 1 : node.attrs?.level === 2 ? 2 : 3;
    const Heading = `h${level}` as "h1" | "h2" | "h3";
    return <Heading>{children}</Heading>;
  }

  if (node.type === "bulletList") {
    return <ul>{children}</ul>;
  }

  if (node.type === "orderedList") {
    return <ol>{children}</ol>;
  }

  if (node.type === "listItem") {
    return <li>{children}</li>;
  }

  if (node.type === "blockquote") {
    return <blockquote>{children}</blockquote>;
  }

  if (node.type === "codeBlock") {
    return (
      <pre>
        <code>{children}</code>
      </pre>
    );
  }

  if (node.type === "hardBreak") {
    return <br />;
  }

  return <p>{children}</p>;
}

function applyMarks(
  text: string,
  marks: ProseMirrorNode["marks"] = [],
): ReactNode {
  return marks.reduce<ReactNode>((children, mark) => {
    if (mark.type === "bold") {
      return <strong>{children}</strong>;
    }

    if (mark.type === "italic") {
      return <em>{children}</em>;
    }

    if (mark.type === "code") {
      return <code>{children}</code>;
    }

    if (mark.type === "link") {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "#";

      return (
        <a href={href} rel="noreferrer" target="_blank">
          {children}
        </a>
      );
    }

    return children;
  }, text);
}
