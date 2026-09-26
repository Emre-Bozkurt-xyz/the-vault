import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // An array, not an object: the first matching entry wins, so the specific
    // server-action stubs must come before the general "@" alias.
    alias: [
      // Server actions client code imports: a build-time RPC stub in the app,
      // a stub here (see the file).
      ...["@/server/extension-actions", "@/server/document-extension-actions"].map(
        (find) => ({
          find,
          replacement: fileURLToPath(
            new URL("./test/stubs/server-actions.ts", import.meta.url),
          ),
        }),
      ),
      { find: "@", replacement: fileURLToPath(new URL("./", import.meta.url)) },
      // Next resolves this guard itself; under vitest server modules run directly.
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./test/stubs/server-only.ts", import.meta.url),
        ),
      },
    ],
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
