import { NextResponse, type NextRequest } from "next/server";

import {
  buildEnforcedCsp,
  buildReportOnlyCsp,
  generateNonce,
} from "@/lib/security/csp";

/**
 * Attaches security headers to every HTML response:
 *  - a report-only CSP carrying the full strict nonce policy (for validation
 *    before flipping to enforce),
 *  - the enforced CSP for `/embed/...` only (see below),
 *  - and the standard hardening headers.
 *
 * The enforced CSP for every other route is set in `next.config.ts`, not here.
 * Next copies each header this function sets on the response onto the request
 * too, and the renderer reads its script nonce from the request's
 * `Content-Security-Policy` first. An enforced policy without a nonce set here
 * therefore hides the nonce, and Next stops nonce-ing its own scripts. Never
 * set a nonce-less `Content-Security-Policy` here for a route that renders
 * pages.
 *
 * The per-request nonce is passed forward via the `x-nonce` request header so
 * server components (root layout, snippet <style> injection) can read it with
 * `headers()` and tag inline elements.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  // `/embed/...` (the Den embed editor) is meant to be framed cross-origin,
  // so it gets an allow-listed `frame-ancestors` instead of `'self'` and must
  // NOT carry `X-Frame-Options` — XFO has no allow-list concept and would
  // block the framing outright regardless of what CSP says. Every other route
  // keeps today's behavior exactly: `frame-ancestors 'self'` + `X-Frame-Options:
  // SAMEORIGIN`.
  const isEmbedRoute = request.nextUrl.pathname.startsWith("/embed/");
  const reportOnlyCsp = buildReportOnlyCsp(nonce, { embed: isEmbedRoute });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next stamps the nonce onto its own <script> tags (framework chunks and the
  // inline RSC payload) only when it finds it in a CSP header on the request;
  // `x-nonce` is ours and Next never reads it. Set explicitly rather than
  // relying on Next also copying the response header onto the request.
  requestHeaders.set("Content-Security-Policy-Report-Only", reportOnlyCsp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Embed routes need `EMBED_FRAME_ANCESTORS` at runtime (deploys provide it
  // only then), so their enforced policy stays here. They pay for it: their
  // nonce stays hidden, which matters only once the strict policy is enforced.
  if (isEmbedRoute) {
    response.headers.set(
      "Content-Security-Policy",
      buildEnforcedCsp({ embed: true }),
    );
  }
  response.headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!isEmbedRoute) {
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );

  return response;
}

export const config = {
  // Run on everything except Next internals and static asset files. Asset
  // content is served through /api routes, which we intentionally cover.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|map)$).*)",
  ],
};
