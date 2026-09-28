import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

// NextResponse.next({ request: { headers } }) hands the rewritten request
// headers to Next as `x-middleware-request-<name>` on the response.
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name.toLowerCase()}`);

describe("proxy", () => {
  it("forwards the report-only policy on the request so Next nonces its scripts", () => {
    const response = proxy(new NextRequest("http://localhost/workspace"));
    const nonce = forwarded(response, "x-nonce");
    const policy = forwarded(response, "Content-Security-Policy-Report-Only");

    expect(nonce).toBeTruthy();
    expect(policy).toContain(`'nonce-${nonce}'`);
    // The response carries the same policy the browser evaluates.
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toBe(policy);
  });

  // Next copies every proxy response header onto the request and reads the
  // enforced header before the report-only one. The enforced policy has no
  // nonce, so setting it here would hide the nonce; next.config.ts sets it.
  it("sets no enforced policy on page routes", () => {
    const response = proxy(new NextRequest("http://localhost/workspace"));
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(forwarded(response, "Content-Security-Policy")).toBeNull();
  });

  it("keeps the runtime-configured enforced policy on embed routes", () => {
    const response = proxy(new NextRequest("http://localhost/embed/editor/abc"));
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors");
    expect(response.headers.get("X-Frame-Options")).toBeNull();
  });

  it("keeps a fresh nonce per request", () => {
    const first = forwarded(proxy(new NextRequest("http://localhost/a")), "x-nonce");
    const second = forwarded(proxy(new NextRequest("http://localhost/b")), "x-nonce");
    expect(first).not.toBe(second);
  });
});
