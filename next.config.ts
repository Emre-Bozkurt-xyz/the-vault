import type { NextConfig } from "next";

import { buildEnforcedCsp } from "./lib/security/csp";

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
  // The enforced CSP for every route except `/embed/...`. It lives here, not in
  // `proxy.ts`, because Next copies every header the proxy puts on a response
  // onto the request as well, and the renderer takes its script nonce from the
  // request's `Content-Security-Policy` before its report-only one. This
  // policy has no nonce, so set from the proxy it hid the report-only policy's
  // nonce and Next never nonced its own scripts. Headers set here reach only
  // the response. It is static, so baking it at build time loses nothing;
  // `/embed/...` keeps its runtime-configured policy in the proxy.
  async headers() {
    return [
      {
        source: "/((?!embed/).*)",
        headers: [{ key: "Content-Security-Policy", value: buildEnforcedCsp() }],
      },
    ];
  },
};

export default nextConfig;
