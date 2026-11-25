import { describe, expect, it } from "vitest";

import { isBlockedAddress, parseLinkPreview } from "@/lib/link-preview/parse";

describe("parseLinkPreview", () => {
  it("reads OpenGraph tags, made absolute", () => {
    const html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Lantern &amp; Snow">
      <meta property="og:description" content="A   cosy   game.">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Expedition">
      <link rel="icon" href="/fav.png">
    </head><body>…</body></html>`;
    expect(parseLinkPreview(html, "https://example.com/post")).toEqual({
      url: "https://example.com/post",
      siteName: "Expedition",
      title: "Lantern & Snow",
      description: "A cosy game.",
      image: "https://example.com/img/cover.png",
      favicon: "https://example.com/fav.png",
    });
  });

  it("falls back to <title>, the description and the host", () => {
    const html = `<head><title>Just a page</title><meta name="description" content='Plain.'></head>`;
    expect(parseLinkPreview(html, "https://www.site.org/a")).toMatchObject({
      siteName: "site.org",
      title: "Just a page",
      description: "Plain.",
      image: null,
      favicon: "https://www.site.org/favicon.ico",
    });
  });

  it("ignores non-web image URLs", () => {
    expect(parseLinkPreview(`<head><meta property="og:image" content="javascript:x"></head>`, "https://a.b/").image).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it("blocks private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700::1111"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
});
