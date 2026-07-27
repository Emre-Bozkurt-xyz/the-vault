import { NextResponse, type NextRequest } from "next/server";

import {
  buildEnforcedCsp,
  buildReportOnlyCsp,
  generateNonce,
} from "@/lib/security/csp";

/**
 * Attaches security headers to every HTML response:
 *  - an enforced CSP with the safe, high-value directives,
 *  - a report-only CSP carrying the full strict nonce policy (for validation
 *    before flipping to enforce),
 *  - and the standard hardening headers.
 *
 * The per-request nonce is passed forward via the `x-nonce` request header so
 * server components (root layout, snippet <style> injection) can read it with
 * `headers()` and tag inline elements.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // `/embed/...` (the Den embed editor) is meant to be framed cross-origin,
  // so it gets an allow-listed `frame-ancestors` instead of `'self'` and must
  // NOT carry `X-Frame-Options` — XFO has no allow-list concept and would
  // block the framing outright regardless of what CSP says. Every other route
  // keeps today's behavior exactly: `frame-ancestors 'self'` + `X-Frame-Options:
  // SAMEORIGIN`.
  const isEmbedRoute = request.nextUrl.pathname.startsWith("/embed/");

  response.headers.set(
    "Content-Security-Policy",
    buildEnforcedCsp({ embed: isEmbedRoute }),
  );
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    buildReportOnlyCsp(nonce, { embed: isEmbedRoute }),
  );
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
