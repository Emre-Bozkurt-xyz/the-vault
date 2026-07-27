import type { MetadataRoute } from "next";

// Web app manifest for installability. Served at /manifest.webmanifest and
// auto-linked by Next.js. Keep `theme_color`/`background_color` in sync with the
// dark-first shell background so the standalone splash/status chrome matches.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vault",
    short_name: "Vault",
    description: "A self-hosted collaborative document platform.",
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0d0d0d",
    theme_color: "#0d0d0d",
    categories: ["productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
