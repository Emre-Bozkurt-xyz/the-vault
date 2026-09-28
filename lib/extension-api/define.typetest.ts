/**
 * Compile-time checks for the typed `define*` chain (plan §18.2). Never run;
 * `npx tsc --noEmit` fails if any `@ts-expect-error` below stops being an error,
 * i.e. if the SDK starts accepting what it should reject.
 */
import { z } from "zod";

import { defineManifest } from "@/lib/extension-api";
import { defineServer } from "@/lib/extension-api/server";

const manifest = {
  id: "vault.typetest",
  name: "Type test",
  version: 1,
  description: "",
  category: "editor",
  permissions: ["document:read"],
} as const;

// Typed but never executed: `defineManifest` validates at call time.
export function typeChecks() {
  defineManifest(manifest);

  defineServer(manifest, {
    actions: [
      {
        id: "vault.typetest.ok",
        title: "",
        description: "",
        scope: "document",
        permissions: ["document:read"],
        input: z.object({}),
        async handler() {
          return {};
        },
      },
      {
        // @ts-expect-error — outside the extension's namespace.
        id: "vault.other.action",
        title: "",
        description: "",
        scope: "document",
        input: z.object({}),
        async handler() {
          return {};
        },
      },
      {
        id: "vault.typetest.write",
        title: "",
        description: "",
        scope: "document",
        // @ts-expect-error — the manifest never declared document:write.
        permissions: ["document:write"],
        input: z.object({}),
        async handler() {
          return {};
        },
      },
    ],
  });
}
