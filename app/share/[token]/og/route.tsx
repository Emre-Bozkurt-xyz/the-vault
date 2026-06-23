import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { createMarkdownExcerpt } from "@/lib/markdown";
import { getDocumentByShareLink } from "@/server/documents";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const shared = await getDocumentByShareLink(token, null);

  if (!shared?.document) {
    notFound();
  }

  const document = shared.document;
  const excerpt = createMarkdownExcerpt(document.markdown, 220);
  const blocks = createPreviewLines(document.markdown);

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
          fontFamily: "Arial, sans-serif",
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
            borderRadius: 18,
            background: "#0d0d0d",
            boxShadow: "0 28px 90px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "34px 42px 22px",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#a8a8a8",
                fontSize: 20,
                letterSpacing: 5,
                textTransform: "uppercase",
              }}
            >
              Shared with Vault
            </div>
            <div
              style={{
                display: "flex",
                color: "#9b9b9b",
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
              padding: "48px 58px 88px",
              gap: 30,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: "Georgia, serif",
                fontSize: 72,
                lineHeight: 0.98,
                letterSpacing: -2,
                color: "#fffaf2",
                maxWidth: 1000,
              }}
            >
              {document.title}
            </div>

            {blocks.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  maxWidth: 980,
                }}
              >
                {blocks.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    style={{
                      display: "flex",
                      color: index === 0 ? "#f2f2f2" : "#cfcfcf",
                      fontSize: index === 0 ? 31 : 28,
                      lineHeight: 1.28,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  color: "#c8c8c8",
                  fontSize: 30,
                  lineHeight: 1.35,
                }}
              >
                {excerpt}
              </div>
            )}
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

function createPreviewLines(markdown: string) {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => cleanInlineMarkdown(line.trim()))
    .filter(Boolean)
    .filter((line) => !/^```/.test(line) && !/^<\/?[a-z][\s\S]*>/i.test(line))
    .slice(0, 5);
}

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?\[![^\]]+\]\s*/, "")
    .replace(/^>\s?/, "")
    .replace(/^((?:[-*+])|(?:\d+\.))\s+/, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
