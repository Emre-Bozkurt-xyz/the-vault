import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // `GET /api/embed/documents/:id/rendered` renders `MarkdownDocument` to a
  // static HTML string via `renderToStaticMarkup` for Den's read view (docs/
  // DEN_EMBED_BRIDGE.md §B.4). Turbopack's default RSC bundling resolves
  // `react-dom/server` through the `react-server` export condition inside
  // Route Handlers, which strips the legacy sync renderer entirely. Marking
  // `react-dom` external keeps that one Node-runtime route handler on a plain
  // `require()` of the real package instead.
  serverExternalPackages: ["react-dom"],
};

export default nextConfig;
