import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { getPublicDocumentBySlug } from "@/server/documents";

export const runtime = "nodejs";

type OgBlock =
  | { kind: "heading"; depth: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "rule" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const document = await getPublicDocumentBySlug(slug);

  if (!document) {
    notFound();
  }

  const ownerName = document.ownerName ?? document.ownerUsername ?? "Vault user";
  const ownerHandle = document.ownerUsername ? `@${document.ownerUsername}` : null;
  const ownerInitial = ownerName.trim().charAt(0).toUpperCase() || "V";
  const blocks = createOgBlocks(document.markdown);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#070707",
          color: "#f7f2eb",
          padding: 42,
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 38,
            background: "#0d0d0d",
            boxShadow: "0 28px 90px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "34px 42px 24px",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontFamily: "Arial, sans-serif",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#171717",
                  border: "1px solid rgba(255,255,255,0.17)",
                  color: "#f7f2eb",
                  fontSize: 22,
                  fontWeight: 700,
                }}
              >
                {ownerInitial}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    display: "flex",
                    color: "#f7f2eb",
                    fontSize: 24,
                    fontWeight: 700,
                  }}
                >
                  {ownerName}
                </div>
                <div style={{ display: "flex", color: "#a8a8a8", fontSize: 19 }}>
                  {ownerHandle ?? "Vault public note"}
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                color: "#9b9b9b",
                fontFamily: "Arial, sans-serif",
                fontSize: 18,
                letterSpacing: 5,
                textTransform: "uppercase",
              }}
            >
              Vault
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "42px 54px 82px",
              gap: 28,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 70,
                lineHeight: 0.98,
                letterSpacing: -2,
                color: "#fffaf2",
                maxWidth: 990,
              }}
            >
              {document.title}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
                maxWidth: 980,
              }}
            >
              {blocks.length > 0 ? (
                blocks.map((block, index) => (
                  <OgMarkdownBlock key={index} block={block} />
                ))
              ) : (
                <div
                  style={{
                    display: "flex",
                    color: "#c8c8c8",
                    fontFamily: "Arial, sans-serif",
                    fontSize: 30,
                    lineHeight: 1.35,
                  }}
                >
                  This published note is currently empty.
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 155,
              display: "flex",
              background:
                "linear-gradient(to bottom, rgba(13,13,13,0), rgba(13,13,13,0.94) 74%, #0d0d0d)",
            }}
          />
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}

function OgMarkdownBlock({ block }: { block: OgBlock }) {
  if (block.kind === "heading") {
    const fontSize = block.depth === 1 ? 44 : block.depth === 2 ? 36 : 30;

    return (
      <div
        style={{
          display: "flex",
          fontSize,
          lineHeight: 1.08,
          color: "#f7f2eb",
        }}
      >
        {block.text}
      </div>
    );
  }

  if (block.kind === "paragraph") {
    return (
      <div
        style={{
          display: "flex",
          color: "#d6d6d6",
          fontFamily: "Arial, sans-serif",
          fontSize: 30,
          lineHeight: 1.32,
        }}
      >
        {block.text}
      </div>
    );
  }

  if (block.kind === "list") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          color: "#e1e1e1",
          fontFamily: "Arial, sans-serif",
          fontSize: 28,
          lineHeight: 1.25,
        }}
      >
        {block.items.map((item, index) => (
          <div key={`${item}-${index}`} style={{ display: "flex", gap: 14 }}>
            <span style={{ color: "#858585", width: 32 }}>
              {block.ordered ? `${index + 1}.` : "•"}
            </span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    );
  }

  if (block.kind === "quote") {
    return (
      <div
        style={{
          display: "flex",
          borderLeft: "5px solid #4d68ff",
          paddingLeft: 18,
          color: "#cfcfcf",
          fontFamily: "Arial, sans-serif",
          fontSize: 28,
          lineHeight: 1.3,
        }}
      >
        {block.text}
      </div>
    );
  }

  if (block.kind === "code") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 14,
          background: "#141414",
          color: "#ededed",
          padding: "18px 22px",
          fontFamily: "monospace",
          fontSize: 23,
          lineHeight: 1.28,
        }}
      >
        {block.lines.map((line, index) => (
          <span key={`${line}-${index}`}>{line || " "}</span>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: 1,
        background: "rgba(255,255,255,0.12)",
      }}
    />
  );
}

function createOgBlocks(markdown: string) {
  const blocks: OgBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length && blocks.length < 7) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.trim().startsWith("```")) {
        if (codeLines.length < 4) {
          codeLines.push(lines[index] ?? "");
        }
        index += 1;
      }
      blocks.push({ kind: "code", lines: codeLines.length ? codeLines : [""] });
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        depth: heading[1].length,
        text: cleanInlineMarkdown(heading[2]),
      });
      index += 1;
      continue;
    }

    const list = trimmed.match(/^((?:[-*+])|(?:\d+\.))\s+(.+)$/);
    if (list) {
      const ordered = /\d+\./.test(list[1]);
      const items = [cleanInlineMarkdown(list[2])];
      index += 1;
      while (index < lines.length && items.length < 4) {
        const nextList = lines[index]?.trim().match(/^((?:[-*+])|(?:\d+\.))\s+(.+)$/);
        if (!nextList || /\d+\./.test(nextList[1]) !== ordered) {
          break;
        }
        items.push(cleanInlineMarkdown(nextList[2]));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote && !quote[1].startsWith("[!")) {
      blocks.push({ kind: "quote", text: cleanInlineMarkdown(quote[1]) });
      index += 1;
      continue;
    }

    if (/^<\/?[a-z][\s\S]*>/i.test(trimmed)) {
      index += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && paragraphLines.length < 3) {
      const next = lines[index]?.trim() ?? "";
      if (
        !next ||
        next.startsWith("```") ||
        /^(#{1,6})\s+/.test(next) ||
        /^((?:[-*+])|(?:\d+\.))\s+/.test(next) ||
        /^>\s?/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }
    blocks.push({
      kind: "paragraph",
      text: cleanInlineMarkdown(paragraphLines.join(" ")),
    });
  }

  return blocks;
}

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
