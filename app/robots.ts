import type { MetadataRoute } from "next";

import { getAbsoluteSiteUrl, getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/docs",
        "/docs/guides/",
        "/public/",
        "/privacy",
        "/terms",
        "/api/assets/*/content",
      ],
      disallow: [
        "/api/",
        "/assets",
        "/dashboard/",
        "/workspace/",
        "/gallery",
        "/login",
        "/onboarding",
        "/banned",
        "/healthz",
        "/share/",
      ],
    },
    sitemap: getAbsoluteSiteUrl("/sitemap.xml"),
    host: getSiteUrl(),
  };
}
