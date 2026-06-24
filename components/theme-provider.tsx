"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme =
  | "dark"
  | "light"
  | "midnight"
  | "graphite"
  | "paper"
  | "system";

type ThemeContextValue = {
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
};

const themeStorageKey = "theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [resolvedTheme, setResolvedTheme] = useState<Theme>("dark");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedTheme = readStoredTheme();
      applyTheme(storedTheme);
      setResolvedTheme(storedTheme);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme,
      setTheme: (theme) => {
        window.localStorage.setItem(themeStorageKey, theme);
        applyTheme(theme);
        setResolvedTheme(theme);
      },
    }),
    [resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useVaultTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useVaultTheme must be used inside ThemeProvider");
  }

  return context;
}

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey);

  return isTheme(stored) ? stored : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const effectiveTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
  const darkMode =
    effectiveTheme === "dark" ||
    effectiveTheme === "midnight" ||
    effectiveTheme === "graphite";

  root.dataset.theme = theme;
  root.classList.toggle("dark", darkMode);
  root.style.colorScheme = darkMode ? "dark" : "light";
}

function isTheme(value: string | null): value is Theme {
  return (
    value === "dark" ||
    value === "light" ||
    value === "midnight" ||
    value === "graphite" ||
    value === "paper" ||
    value === "system"
  );
}
