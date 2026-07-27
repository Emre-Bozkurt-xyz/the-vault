import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // Globs must be `**/`-prefixed: setting `exclude` replaces vitest's
    // defaults, and a bare `node_modules/**` only matches the root copy — a
    // nested one (agent worktrees under .claude/, .next/standalone) would drag
    // in thousands of dependency tests.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/output/**",
      "**/.claude/**",
    ],
    environment: "node",
  },
});
