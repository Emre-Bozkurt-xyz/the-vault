import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { createMarkdownExcerpt } from "@/lib/markdown";
import { getPublicDocumentBySlug } from "@/server/documents";

export const runtime = "nodejs";

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
  const excerpt = createMarkdownExcerpt(document.markdown, 220);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#080808",
          color: "#f6f3ed",
          padding: 64,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#a5a5a5",
            fontSize: 24,
            letterSpacing: 8,
            textTransform: "uppercase",
          }}
        >
          <span>Vault public note</span>
          <span>{document.updatedAt.toLocaleDateString("en-US")}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              fontSize: 78,
              fontWeight: 700,
              lineHeight: 1.03,
              letterSpacing: -2,
              maxWidth: 980,
            }}
          >
            {document.title}
          </div>
          <div
            style={{
              display: "flex",
              color: "#d2d2d2",
              fontSize: 34,
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            {excerpt}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            borderTop: "1px solid rgba(255,255,255,0.16)",
            paddingTop: 30,
          }}
        >
          <div
            style={{
              width: 62,
              height: 62,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#1d1d1d",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#f6f3ed",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {ownerInitial}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>
              {ownerName}
            </div>
            {ownerHandle ? (
              <div style={{ display: "flex", color: "#a5a5a5", fontSize: 24 }}>
                {ownerHandle}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
