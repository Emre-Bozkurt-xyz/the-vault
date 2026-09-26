import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Extension import boundary (docs/23_EXTENSION_SDK_PLAN.md §11).
 *
 * The MIGRATION_ALLOWLIST_* arrays list files that still cross the boundary
 * because their code has not moved yet. Phase 25 only shrinks them; slice 7 is
 * done when both are empty. Never add a file to make new code pass.
 */
const EXTENSION_RESTRICTION = {
  group: [
    "@/app/**",
    "@/components/**",
    "!@/components/ui",
    "!@/components/ui/**",
    "@/lib/**",
    "!@/lib/extension-api",
    "!@/lib/extension-api/**",
    "!@/lib/utils",
    "@/server/**",
    "@/db",
    "@/db/**",
    "@/auth",
    "@/types/**",
    "@/extensions/**",
  ],
  message:
    "Extensions may import only their own folder (relative paths), @/lib/extension-api, @/components/ui and @/lib/utils. Need something else? It belongs in the SDK (docs/23_EXTENSION_SDK_PLAN.md §8).",
};

const CORE_RESTRICTION = {
  group: [
    "@/extensions/**",
    "!@/extensions/manifests",
    "!@/extensions/registry.client",
    "!@/extensions/registry.render",
    "!@/extensions/registry.server",
  ],
  message:
    "Core never imports an extension's folder; go through the host (lib/extension-host) and the generated registries (docs/23_EXTENSION_SDK_PLAN.md §3).",
};

// Extension files still importing core modules.
const MIGRATION_ALLOWLIST_EXTENSIONS = [
  "extensions/calc/server.ts", // calc engine: slice 6
  // Build the legacy registry shape through the host adapter; move to
  // `@/lib/extension-api/testing` when calc (slice 6) and dictionary (slice 5) do.
  "extensions/calc/server.test.ts",
  "extensions/dictionary/server.test.ts",
];

// Core files still importing an extension's folder.
const MIGRATION_ALLOWLIST_CORE = [
  "lib/extension-host/legacy.ts", // shrinks each slice; deleted after slice 6
  "components/extensions/StickerLayer.tsx", // moves in slice 4
  "components/extensions/PublicStickerDisplay.tsx", // moves in slice 4
  "server/definitions.ts", // dictionary settings: slice 5
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["extensions/*/**/*.{ts,tsx}"],
    ignores: MIGRATION_ALLOWLIST_EXTENSIONS,
    rules: {
      "no-restricted-imports": ["error", { patterns: [EXTENSION_RESTRICTION] }],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "server/**/*.{ts,tsx}"],
    ignores: MIGRATION_ALLOWLIST_CORE,
    rules: {
      "no-restricted-imports": ["error", { patterns: [CORE_RESTRICTION] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
