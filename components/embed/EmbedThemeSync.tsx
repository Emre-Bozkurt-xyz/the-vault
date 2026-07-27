"use client";

import { useEffect } from "react";

import { useVaultTheme, type Theme } from "@/components/theme-provider";

const validThemes = new Set<Theme>([
  "dark",
  "light",
  "midnight",
  "graphite",
  "paper",
  "system",
]);

function isTheme(value: string | null): value is Theme {
  return value !== null && validThemes.has(value as Theme);
}

/**
 * Applies the `?theme=` query param (docs/DEN_EMBED_BRIDGE.md §C.5) to the
 * embed editor so it visually matches the Den chrome around it. Lives inside
 * the root layout's `ThemeProvider`, so this just forwards a validated value
 * into the same `setTheme` the in-app theme toggle uses.
 */
export function EmbedThemeSync({ theme }: { theme: string | null }) {
  const { setTheme } = useVaultTheme();

  useEffect(() => {
    if (isTheme(theme)) {
      setTheme(theme);
    }
    // Only re-run if the requested theme value itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return null;
}
